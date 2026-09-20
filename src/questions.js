import { clip } from "./transcript.js";
import { redactDeep } from "./redact.js";

export const MAX_STEPS_SENT = 120;
export const MAX_REQUIREMENTS = 8;

// The user's own sentences and bullets are the candidate requirements.
// Nothing is generated: Jev is asked, per sentence, whether it is an ask at
// all and whether it was delivered. Sentences with request cues go first so a
// long prompt keeps its instructions inside the cap.
const ASK_CUE = /\b(please|can you|could you|let'?s|i want|i need|we need|should|must|make sure|build|write|fix|add|create|update|remove|delete|check|verify|test|run|open|give me|show me|tell me|find|search|research|draft|implement|refactor|rename|deploy|install|set up|generate|explain|review|compare|list)\b|\?\s*$/i;

// Follow-ups can change the ask ("clean them up" after "is it merged?"), so
// they are candidates too, with a lower length bar because they are terse.
export function splitRequirements(prompt, followups = []) {
  const split = (text, minWords) => text
    .split(/\n+|(?<=[.?!])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((s) => s.split(/\s+/).length >= minWords);
  const lines = [...split(prompt, 4), ...followups.flatMap((f) => split(f, 3).filter((s) => !/^\[/.test(s)))];
  const seen = new Set();
  const cands = [];
  for (const l of lines) {
    const key = l.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cands.push({ text: clip(l, 240), cue: ASK_CUE.test(l) ? 0 : 1, order: cands.length });
  }
  const picked = [...cands].sort((a, b) => a.cue - b.cue || a.order - b.order).slice(0, MAX_REQUIREMENTS).sort((a, b) => a.order - b.order);
  const out = picked.map((c) => c.text);
  return out.length ? out : [clip(prompt, 240)];
}

export function windowSteps(steps, max = MAX_STEPS_SENT) {
  if (steps.length <= max) return steps;
  const half = Math.floor(max / 2);
  return [...steps.slice(0, half), { i: "…", tool: "…", what: `${steps.length - max} steps omitted` }, ...steps.slice(-half)];
}

function stepLine(s) {
  const base = `${s.tool}: ${s.what}`;
  return s.error ? `${base} [error: ${s.errorText || "failed"}]` : base;
}

// A step's output travels only where it is evidence: checks, and the last
// three steps, where "it worked" or "it did not" usually shows.
function withResult(s, keep) {
  const o = { i: s.i, tool: s.tool, what: s.error ? stepLine(s) : s.what };
  if (keep && s.result) o.result = clip(s.result, 120);
  return o;
}

export function buildState(turn, session) {
  const requirements = splitRequirements(turn.prompt, turn.followups.slice(0, 12));
  const n = turn.steps.length;
  const checks = turn.steps.filter((s) => s.check).slice(-6).map((s) => ({ i: s.i, what: clip(s.what, 100), ok: !s.error, result: clip(s.result || "", 120) }));
  const state = {
    task: clip(turn.prompt, 1500),
    requirements,
    followups: turn.followups.slice(0, 12),
    project: session.project,
    session: { git_branch: turn.branch || "unknown", folder: turn.cwd || session.project },
    artifacts: (turn.artifacts || []).slice(0, 12),
    checks,
    steps: windowSteps(turn.steps).map((s) => withResult(s, s.check || (typeof s.i === "number" && s.i > n - 3))),
    step_count: n,
    tool_errors: turn.toolErrors,
    final_assistant: clip(turn.lastText, 4000),
  };
  return redactDeep(state);
}

// Choice options for "where did it first go wrong": one per step when the
// turn is short, otherwise chunks, plus a way to say nothing went wrong.
export function stepOptions(steps) {
  const opts = {};
  if (steps.length <= 12) {
    for (const s of steps) opts[`s${s.i}`] = clip(`${s.tool}: ${s.what}`, 120);
  } else {
    const chunks = Math.min(12, Math.ceil(steps.length / 5));
    const size = Math.ceil(steps.length / chunks);
    for (let c = 0; c < chunks; c++) {
      const part = steps.slice(c * size, (c + 1) * size);
      if (!part.length) continue;
      const first = part[0], last = part[part.length - 1];
      const tools = [...new Set(part.map((s) => s.tool))].join(", ");
      opts[`s${first.i}-s${last.i}`] = clip(`${tools}; starts with ${first.what}; ends with ${last.what}`, 160);
    }
  }
  opts.none = "Every step was a reasonable thing to do for the task";
  return opts;
}

export function buildQuestions(state, turn) {
  const q = {
    completed: {
      type: "noul",
      instructions: "Judging from `steps` and `final_assistant`, was `task`, as amended by any `followups`, fully completed as the user asked? Judge the request itself, not the wider project it is about.",
      criteria: {
        true: "Every outcome the request asked for exists in the evidence: files in `artifacts`, results in `checks`, commands run, results reported. A question or a request for advice is completed by a direct answer, even when that answer is no, not yet, or a list of things to do first",
        false: "Something the request asked for is missing, unverified, deferred to later, or only described",
      },
    },
    claimed_done: {
      type: "noul",
      instructions: "Does `final_assistant` present the user's request as handled?",
      criteria: {
        true: "Says or implies the requested work is done or delivered, or gives a direct answer to the question asked",
        false: "Reports partial progress on the requested work, asks the user something before it can continue, or lists work still owed on the request",
      },
    },
    done_share: {
      type: "score",
      instructions: "How much of `task`, as amended by any `followups`, was delivered, judging from `steps` and `final_assistant`? For a question, a direct answer is all of it.",
      criteria: ["Nothing usable delivered", "Less than half", "About half", "Most of it, with gaps", "All of it"],
    },
    verified: {
      type: "noul",
      instructions: "Before `final_assistant`, did the agent check its own work: a step after the last change that runs tests, a build or a validator (see `checks`), or reads the produced output back?",
      criteria: {
        true: "A check step exists after the last change and its result is consistent with the final message",
        false: "No check after the last change, or the check failed and the final message ignores it; a task with no changes and a direct answer also counts as false",
      },
    },
    in_scope: {
      type: "noul",
      instructions: "Did the agent stay within what `task` and `followups` asked for, without unrequested changes or extra deliverables?",
    },
    wasted_effort: {
      type: "score",
      instructions: "How much of `steps` was wasted: retries of the same failing action, loops, detours unrelated to `task`?",
      criteria: ["No wasted steps", "A few retries or detours", "Many loops or repeated failures"],
    },
  };
  if (state.followups.length) {
    q.corrections = {
      type: "score",
      instructions: "Judging from `followups`, how much did the user have to correct or redirect the agent?",
      criteria: ["No correction needed", "One nudge or clarification", "Repeated corrections of the same kind", "The user gave up or restarted the approach"],
    };
  }
  if (turn.steps.length >= 2) {
    q.first_wrong = {
      type: "choice",
      instructions: "Which is the first step in `steps` that should not have happened for `task`: wrong target, premature, off-task, or repeating a failure?",
      criteria: stepOptions(turn.steps),
    };
  }
  if (state.requirements.length > 1) {
    state.requirements.forEach((_, i) => {
      q[`is_ask_${i}`] = {
        type: "noul",
        instructions: `Is \`requirements[${i}]\` something the user asked to be done or answered, rather than background, opinion or a rhetorical question?`,
        criteria: { true: "An instruction, request or direct question with a checkable outcome; an answer counts as an outcome", false: "Context, opinion, or a rhetorical question with nothing to deliver" },
      };
      q[`delivered_${i}`] = {
        type: "noul",
        instructions: `Was \`requirements[${i}]\` delivered, judging from \`steps\` and \`final_assistant\`?`,
        criteria: { true: "The evidence shows it done", false: "Missing, deferred, or only talked about" },
      };
    });
  }
  return q;
}

export function estimateTokens(obj) {
  return Math.ceil(JSON.stringify(obj).length / 4);
}
