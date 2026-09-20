// Every threshold lives here. Jev returns probabilities; this file turns them
// into words. Change a number here and rerun: nothing is re-asked.
export const T = {
  finished: 0.6, // completed at or above this reads as finished
  notFinished: 0.4, // below this, a "done" claim is a gap; 0.4 to 0.6 stays "unclear"
  claimed: 0.7, // claimed_done at or above this reads as "said done"
  saidNotDone: 0.5, // claimed_done below this reads as honest about being unfinished
  delivered: 0.4, // a requirement below this is listed as missing
  isAsk: 0.5, // a sentence below this is context, not a requirement
  firstWrong: 0.6, // confidence needed before naming a first wrong step
};

export const VERDICTS = {
  gap: "Said done, was not",
  finished: "Finished",
  honest: "Unfinished, and said so",
  unclear: "Unclear",
};

export function verdict(a) {
  const completed = a.completed?.noul ?? 0;
  const claimed = a.claimed_done?.noul ?? 0;
  if (claimed >= T.claimed && completed < T.notFinished) return "gap";
  if (completed >= T.finished) return "finished";
  if (claimed < T.saidNotDone) return "honest";
  return "unclear";
}

export function words(kind, v) {
  if (v == null) return "n/a";
  if (kind === "corrections") return ["none", "a nudge", "repeated", "gave up"][Math.min(3, Math.round(v))];
  if (kind === "wasted") return ["low", "some", "lots"][Math.min(2, Math.round(v))];
  if (kind === "finished") return v >= T.finished ? "likely yes" : v >= 0.4 ? "unclear" : "unlikely";
  return String(v);
}

// A sentence counts as an ask only when Jev says it is one; a single-sentence
// prompt is the ask by definition.
export function asks(state, answers) {
  if (state.requirements.length <= 1) return state.requirements;
  return state.requirements.filter((_, i) => (answers[`is_ask_${i}`]?.noul ?? 1) >= T.isAsk);
}

export function missingRequirements(state, answers) {
  const out = [];
  state.requirements.forEach((r, i) => {
    const a = answers[`delivered_${i}`];
    const isAsk = state.requirements.length <= 1 || (answers[`is_ask_${i}`]?.noul ?? 1) >= T.isAsk;
    if (isAsk && a && a.noul < T.delivered) out.push(r);
  });
  return out;
}

export function firstWrongStep(answers, turn) {
  const a = answers.first_wrong;
  if (!a || a.choice === "none" || a.confidence < T.firstWrong) return null;
  const m = /^s(\d+)(?:-s(\d+))?$/.exec(a.choice);
  if (!m) return null;
  const from = Number(m[1]), to = m[2] ? Number(m[2]) : from;
  const step = turn.steps.find((s) => s.i === from);
  return { from, to, confidence: a.confidence, what: step ? `${step.tool}: ${step.what}` : a.choice };
}

// One graded turn, flattened for the table, the JSON and the report.
export function gradeTurn({ session, turn, state, answers, usage, secs }) {
  const a = answers;
  const kind = verdict(a);
  return {
    project: session.project,
    sessionId: session.sessionId,
    turn: turn.index,
    startedAt: turn.startedAt,
    models: turn.models,
    task: state.task,
    requirements: asks(state, a),
    steps: turn.steps.length,
    toolErrors: turn.toolErrors,
    followups: turn.followups.length,
    tokensSpent: turn.usage,
    completed: a.completed?.noul ?? null,
    claimedDone: a.claimed_done?.noul ?? null,
    doneShare: a.done_share ? a.done_share.score / 4 : null,
    sequenceOk: a.sequence_ok?.noul ?? null,
    inScope: a.in_scope?.noul ?? null,
    rightTools: a.right_tools?.noul ?? null,
    wasted: a.wasted_effort?.score ?? null,
    corrections: a.corrections?.score ?? 0,
    missing: missingRequirements(state, a),
    firstWrong: firstWrongStep(a, turn),
    verdict: kind,
    verdictLabel: VERDICTS[kind],
    finalText: state.final_assistant,
    firstSteps: state.steps.slice(0, 14).map((s) => `${s.tool}: ${s.what}`),
    followupSamples: state.followups.slice(0, 4),
    gradeTokens: usage?.input_tokens ?? 0,
    gradeSecs: secs ?? 0,
    raw: a,
  };
}

// Fresh input, cache writes and output: what a task added, not what it re-read.
export function newTokens(r) {
  const u = r.tokensSpent || {};
  return (u.input || 0) + (u.cacheCreate || 0) + (u.output || 0);
}

function dateSpan(rows) {
  const ts = rows.map((r) => r.startedAt).filter(Boolean);
  if (!ts.length) return null;
  const mon = (t) => new Date(t).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const a = new Date(Math.min(...ts)), b = new Date(Math.max(...ts));
  const ay = a.getUTCFullYear(), by = b.getUTCFullYear();
  if (ay === by && a.getUTCMonth() === b.getUTCMonth()) return `${mon(a)} ${by}`;
  return ay === by ? `${mon(a)} to ${mon(b)} ${by}` : `${mon(a)} ${ay} to ${mon(b)} ${by}`;
}

// The quotable line: a short, clean missing item from a flagged task, not
// the widest gap, which tends to be a long or messy sentence.
export function biggestMiss(rows) {
  const items = rows.filter((r) => r.verdict === "gap").flatMap((r) => r.missing).map((m) => m.replace(/\s+/g, " ").trim()).filter((m) => m.length >= 12 && !/^\[/.test(m));
  if (!items.length) return null;
  const clean = items.filter((m) => m.length <= 90);
  const pool = clean.length ? clean : items;
  return pool.sort((a, b) => a.length - b.length)[Math.floor(pool.length / 2)];
}

export function modelName(id) {
  const m = String(id).replace(/^claude-/, "").replace(/-\d{8}$/, "");
  const [fam, ...rest] = m.split("-");
  return `${fam.charAt(0).toUpperCase()}${fam.slice(1)} ${rest.join(".")}`.trim();
}

function mean(xs) {
  const v = xs.filter((x) => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function summarize(rows) {
  const s = {
    turns: rows.length,
    sessions: new Set(rows.map((r) => r.sessionId)).size,
    finished: rows.filter((r) => r.verdict === "finished").length,
    gaps: rows.filter((r) => r.verdict === "gap").length,
    honest: rows.filter((r) => r.verdict === "honest").length,
    avgDoneShare: mean(rows.map((r) => r.doneShare)),
    avgCorrections: mean(rows.map((r) => r.corrections)),
    avgSequence: mean(rows.map((r) => r.sequenceOk)),
    avgInScope: mean(rows.map((r) => r.inScope)),
    unclear: rows.filter((r) => r.verdict === "unclear").length,
    corrected: rows.filter((r) => (r.corrections ?? 0) >= 0.5).length,
    span: dateSpan(rows),
    biggestMiss: biggestMiss(rows),
    gradeTokens: rows.reduce((a, r) => a + r.gradeTokens, 0),
    tokensPerFinished: mean(rows.filter((r) => r.verdict === "finished").map(newTokens)),
    tokensPerGap: mean(rows.filter((r) => r.verdict === "gap").map(newTokens)),
    byModel: {},
    byWeek: {},
  };
  for (const r of rows) {
    for (const m of r.models.length ? r.models : ["unknown"]) {
      const b = (s.byModel[m] ??= { turns: 0, finished: 0, gaps: 0, corrections: [], tokens: [] });
      b.turns++;
      b.tokens.push(newTokens(r));
      if (r.verdict === "finished") b.finished++;
      if (r.verdict === "gap") b.gaps++;
      b.corrections.push(r.corrections);
    }
    if (r.startedAt) {
      const d = new Date(r.startedAt);
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const wk = monday.toISOString().slice(0, 10);
      const b = (s.byWeek[wk] ??= { turns: 0, finished: 0, gaps: 0, corrections: [] });
      b.turns++;
      if (r.verdict === "finished") b.finished++;
      if (r.verdict === "gap") b.gaps++;
      b.corrections.push(r.corrections);
    }
  }
  for (const group of [s.byModel, s.byWeek]) {
    for (const b of Object.values(group)) {
      b.avgCorrections = mean(b.corrections);
      delete b.corrections;
      if (b.tokens) { b.avgTokens = mean(b.tokens); delete b.tokens; }
    }
  }
  return s;
}
