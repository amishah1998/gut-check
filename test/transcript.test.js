import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSession, isGradeable, isContinuation, summarizeInput, projectName, commandPrompt } from "../src/transcript.js";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "session.jsonl");

test("parses a session into turns, keeping short replies inside the task", () => {
  const s = parseSession(fixture, { project: "demo", sessionId: "abc" });
  assert.equal(s.turns.length, 3);
  const [t1, t2, t3] = s.turns;
  assert.equal(t3.prompt, "/review the parser change");
  assert.deepEqual(t3.models, ["claude-opus-5"]);
  assert.match(t1.prompt, /^Fix the failing date test/);
  assert.deepEqual(t1.followups, ["yes go ahead"]);
  assert.deepEqual(t1.steps.map((x) => x.tool), ["Read", "Bash", "Edit"]);
  assert.equal(t1.toolErrors, 1);
  assert.equal(t1.steps[1].error, true);
  assert.match(t1.lastText, /^Done\./);
  assert.deepEqual(t1.models, ["claude-opus-5"]);
  assert.equal(t1.usage.input, 600);
  assert.match(t2.prompt, /^Now write a README/);
  assert.deepEqual(t2.models, ["claude-sonnet-5"]);
  assert.deepEqual(s.models.sort(), ["claude-opus-5", "claude-sonnet-5"]);
});

test("ignores slash-command wrappers and subagent sidechains", () => {
  const s = parseSession(fixture, { project: "demo", sessionId: "abc" });
  assert.ok(s.turns.every((t) => !t.prompt.startsWith("<")));
  assert.ok(s.turns.every((t) => !/subagent prompt/.test(t.prompt)));
  assert.ok(s.turns.every((t) => !/design lead/.test(t.prompt)));
  assert.equal(s.turns.length, 3);
  assert.ok(s.turns.every((t) => t.prompt !== "/clear"));
  assert.match(s.turns[2].followups[0], /^\[Image: original/);
});

test("gradeable needs real work behind a real ask", () => {
  const s = parseSession(fixture, { project: "demo", sessionId: "abc" });
  assert.equal(isGradeable(s.turns[0]), true);
  assert.equal(isGradeable(s.turns[1]), true);
  assert.equal(isGradeable({ prompt: "hi", steps: [], lastText: "hello" }), false);
  assert.equal(isGradeable({ prompt: "please fix the build on ci now", steps: [{}], lastText: "" }), false);
});

test("slash commands reduce to the command line", () => {
  assert.equal(commandPrompt("<command-name>/pr</command-name>\n<command-args>fix</command-args>\nbody"), "/pr fix");
  assert.equal(commandPrompt("<command-name>deploy</command-name>"), "/deploy");
  assert.equal(commandPrompt("plain prompt"), null);
});

test("continuations", () => {
  assert.equal(isContinuation("ok"), true);
  assert.equal(isContinuation("yes please do it"), true);
  assert.equal(isContinuation("[Request interrupted by user]"), true);
  assert.equal(isContinuation("[Image: original 2880x1880, displayed at 2000x1306. Multiply coordinates by 1.44 to map to original image.]"), true);
  assert.equal(isContinuation("[Image #1] make the header match this screenshot exactly please"), false);
  assert.equal(isContinuation("now rename the module and update every import"), false);
});

test("input summaries", () => {
  assert.equal(summarizeInput("Bash", { command: "git status" }), "git status");
  assert.equal(summarizeInput("Edit", { file_path: "a.ts", old_string: "x" }), "a.ts");
  assert.equal(summarizeInput("mcp__x__y", { a: 1 }), '{"a":1}');
});

test("project names drop the home prefix", () => {
  const home = process.env.HOME.replace(/\//g, "-");
  assert.equal(projectName(`${home}-GitHub-app`), "GitHub-app");
});
