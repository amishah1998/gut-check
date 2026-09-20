import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict, gradeTurn, summarize, missingRequirements, firstWrongStep, biggestMiss, modelName } from "../src/policy.js";
import { askJev, mapLimit } from "../src/jev.js";

const turn = { index: 1, steps: [{ i: 1, tool: "Read", what: "a.ts" }, { i: 2, tool: "Bash", what: "git push --force" }], followups: [], toolErrors: 0, models: ["m"], startedAt: Date.parse("2026-09-01T10:00:00Z"), usage: { input: 1, output: 1 } };
const session = { project: "demo", sessionId: "abc" };
const state = { task: "do x and y", requirements: ["do x", "do y"], steps: [], followups: [], final_assistant: "Done." };

test("verdicts", () => {
  assert.equal(verdict({ completed: { noul: 0.2 }, claimed_done: { noul: 0.9 }, done_share: { score: 1 } }), "gap");
  assert.equal(verdict({ completed: { noul: 0.2 }, claimed_done: { noul: 0.9 }, done_share: { score: 3.2 } }), "unclear", "most delivered is not a gap");
  assert.equal(verdict({ completed: { noul: 0.8 }, claimed_done: { noul: 0.9 } }), "finished");
  assert.equal(verdict({ completed: { noul: 0.65 }, claimed_done: { noul: 0.9 } }), "unclear", "finished needs 0.7");
  assert.equal(verdict({ completed: { noul: 0.8 }, claimed_done: { noul: 0.2 } }), "unclear", "no claim, no finished");
  assert.equal(verdict({ completed: { noul: 0.2 }, claimed_done: { noul: 0.1 } }), "honest");
  assert.equal(verdict({ completed: { noul: 0.5 }, claimed_done: { noul: 0.6 } }), "unclear");
  assert.equal(verdict({ completed: { noul: 0.45 }, claimed_done: { noul: 0.95 } }), "unclear");
  assert.equal(verdict({ completed: { noul: 0.9 }, claimed_done: { noul: 0.9 } }, "You're out of usage credits. Run /usage-credits"), "cutoff");
});

test("missing requirements and first wrong step", () => {
  const a = { delivered_0: { noul: 0.9 }, delivered_1: { noul: 0.1 }, first_wrong: { choice: "s2", confidence: 0.8 } };
  assert.deepEqual(missingRequirements(state, a), ["do y"]);
  assert.deepEqual(missingRequirements(state, { ...a, is_ask_1: { noul: 0.1 } }), []);
  assert.deepEqual(firstWrongStep(a, turn), { from: 2, to: 2, confidence: 0.8, what: "Bash: git push --force" });
  assert.equal(firstWrongStep({ first_wrong: { choice: "none", confidence: 0.9 } }, turn), null);
  assert.equal(firstWrongStep({ first_wrong: { choice: "s1", confidence: 0.55 } }, turn), null);
});

test("gradeTurn and summarize", () => {
  const answers = { completed: { noul: 0.2 }, claimed_done: { noul: 0.9 }, done_share: { score: 1 }, verified: { noul: 0.1 }, in_scope: { noul: 0.5 }, wasted_effort: { score: 1 }, delivered_0: { noul: 0.9 }, delivered_1: { noul: 0.1 } };
  const row = gradeTurn({ session, turn, state, answers, usage: { input_tokens: 500 }, secs: 1.2 });
  assert.equal(row.verdict, "gap");
  assert.equal(row.doneShare, 0.25);
  assert.deepEqual(row.missing, ["do y"]);
  const s = summarize([row, { ...row, verdict: "finished", sessionId: "def", models: ["n"] }]);
  assert.equal(s.turns, 2);
  assert.equal(s.gaps, 1);
  assert.equal(s.finished, 1);
  assert.equal(s.sessions, 2);
  assert.deepEqual(Object.keys(s.byModel).sort(), ["m", "n"]);
  assert.deepEqual(Object.keys(s.byWeek), ["2026-08-31"]);
  assert.equal(s.tokensPerGap, 2);
  assert.equal(s.corrected, 0);
  assert.equal(s.unverifiedClaims, 2);
  assert.equal(s.unclear, 0);
  assert.equal(s.span, "Sep 2026");
  assert.equal(s.biggestMiss, null);
  assert.equal(s.byModel.m.avgTokens, 2);
});

test("askJev retries on 429 then succeeds", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 429, headers: { get: () => "0" }, text: async () => "slow down" };
    return { ok: true, json: async () => ({ answers: { x: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 10 } }) };
  };
  const res = await askJev({ state: {}, questions: {}, apiKey: "k", fetchImpl });
  assert.equal(calls, 2);
  assert.equal(res.answers.x.noul, 0.5);
});

test("mapLimit keeps order under concurrency", async () => {
  const out = await mapLimit([3, 1, 2], 2, async (x) => { await new Promise((r) => setTimeout(r, x * 5)); return x * 10; });
  assert.deepEqual(out, [30, 10, 20]);
});

test("watch line and png finder", async () => {
  const { formatLine } = await import("../src/watch.js");
  const { findChrome } = await import("../src/png.js");
  const line = formatLine({ project: "demo", sessionId: "abcdef1234", turn: 2, verdictLabel: "Said done, was not", completed: 0.2, claimedDone: 0.9, missing: ["write the tests"], firstWrong: null });
  assert.match(line, /demo abcdef12 turn 2: SAID DONE, WAS NOT · finished 20% · said done 90% · missing: write the tests/);
  const c = findChrome();
  assert.ok(c === null || typeof c === "string");
});

test("card helpers", async () => {
  assert.equal(modelName("claude-opus-4-8"), "Opus 4.8");
  assert.equal(modelName("claude-fable-5"), "Fable 5");
  const rows = [
    { verdict: "gap", missing: ["a very long missing requirement sentence that goes on and on and on and on and on and on and on and on"] },
    { verdict: "gap", missing: ["add the migration", "[Image #1]"] },
    { verdict: "finished", missing: ["ignored because not flagged"] },
  ];
  assert.equal(biggestMiss(rows), "add the migration");
  assert.equal(biggestMiss([]), null);
  const { renderCard } = await import("../src/report.js");
  const html = renderCard({ turns: 10, sessions: 1, finished: 4, gaps: 1, honest: 5, unclear: 0, corrected: 2, unverifiedClaims: 3, span: "Sep 2026", biggestMiss: "add the migration", byModel: { "claude-opus-5": { turns: 5, finished: 3 }, "claude-sonnet-5": { turns: 5, finished: 1 } }, gradeTokens: 1000 }, { pricePerMtok: 0.042, model: "jev-latest", date: "2026-09-20" });
  assert.match(html, /1 of 10/);
  assert.match(html, /class="cbar"/);
  assert.match(html, /Biggest miss/);
  assert.match(html, /without checking its work: <b>3 of 10/);
  assert.match(html, /Opus 5 finished 3 of 5 · Sonnet 5 finished 1 of 5/);
  assert.match(html, /10 tasks · 1 session · Sep 2026/);
});
