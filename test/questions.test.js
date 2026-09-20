import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSession } from "../src/transcript.js";
import { buildState, buildQuestions, splitRequirements, stepOptions, windowSteps } from "../src/questions.js";
import { redact } from "../src/redact.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "session.jsonl");

test("requirements come from the user's own sentences", () => {
  const r = splitRequirements("Fix the failing date test in src/parser.ts and open a PR. Do not touch main.");
  assert.deepEqual(r, ["Fix the failing date test in src/parser.ts and open a PR.", "Do not touch main."]);
  assert.deepEqual(splitRequirements("- add tests\n- update the README file please\n- ship it"), ["update the README file please"]);
  const long = Array.from({ length: 12 }, (_, i) => (i === 10 ? "Please fix the login bug today." : `Background sentence number ${i} here.`)).join(" ");
  assert.ok(splitRequirements(long).includes("Please fix the login bug today."));
  assert.deepEqual(splitRequirements("hi"), ["hi"]);
  assert.deepEqual(splitRequirements("Are all our changes merged on main?", ["clean them up..", "ok", "[Image #1]"]), ["Are all our changes merged on main?", "clean them up.."]);
});

test("state is redacted and windowed", () => {
  const s = parseSession(fixture, { project: "demo", sessionId: "abc" });
  const state = buildState(s.turns[1], s);
  assert.match(state.task, /token [\[]redacted[\]]/);
  assert.deepEqual(buildState(s.turns[0], s).session, { git_branch: "fix/parser-tz", folder: "app" });
  assert.ok(!/abcdefghijklmnop123456/.test(JSON.stringify(state)));
  const many = Array.from({ length: 300 }, (_, i) => ({ i: i + 1, tool: "Bash", what: `cmd ${i}` }));
  const w = windowSteps(many);
  assert.equal(w.length, 121);
  assert.match(w[60].what, /180 steps omitted/);
});

test("questions follow the state", () => {
  const s = parseSession(fixture, { project: "demo", sessionId: "abc" });
  const state = buildState(s.turns[0], s);
  const q = buildQuestions(state, s.turns[0]);
  for (const k of ["completed", "claimed_done", "done_share", "sequence_ok", "in_scope", "wasted_effort", "corrections", "first_wrong", "is_ask_0", "delivered_0", "is_ask_1", "delivered_1", "is_ask_2", "delivered_2"]) {
    assert.ok(q[k], `missing ${k}`);
  }
  assert.deepEqual(Object.keys(q.first_wrong.criteria), ["s1", "s2", "s3", "none"]);
  assert.match(q.completed.instructions, /as amended by any `followups`/);
  const q2 = buildQuestions(buildState(s.turns[1], s), s.turns[1]);
  assert.equal(q2.corrections, undefined);
  assert.equal(q2.first_wrong, undefined);
  assert.equal(q2.delivered_0, undefined);
});

test("step options chunk long turns", () => {
  const steps = Array.from({ length: 100 }, (_, i) => ({ i: i + 1, tool: i % 2 ? "Bash" : "Edit", what: `thing ${i}` }));
  const o = stepOptions(steps);
  const keys = Object.keys(o);
  assert.equal(keys[keys.length - 1], "none");
  assert.ok(keys.length <= 13);
  assert.equal(keys[0], "s1-s9");
});

test("redaction catches the common shapes and leaves prose alone", () => {
  assert.equal(redact("use sk-abcdefghijklmnopqrstuvwxyz1234 now"), "use [redacted] now");
  assert.equal(redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def"), "Authorization: Bearer [redacted]");
  assert.equal(redact("password=hunter2hunter2"), "password [redacted]");
  assert.equal(redact("edit src/parser.ts and run npm test"), "edit src/parser.ts and run npm test");
});
