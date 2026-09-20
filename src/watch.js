import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { discoverSessions, parseSession, isGradeable, isClosed } from "./transcript.js";
import { buildState, buildQuestions } from "./questions.js";
import { askJev } from "./jev.js";
import { gradeTurn } from "./policy.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function notify(title, body) {
  if (process.platform !== "darwin") return;
  const esc = (s) => String(s).replace(/["\\]/g, " ");
  execFile("osascript", ["-e", `display notification "${esc(body)}" with title "${esc(title)}"`], () => {});
}

export function formatLine(r) {
  const t = new Date().toTimeString().slice(0, 5);
  const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;
  const bits = [`finished ${pct(r.completed)}`, `said done ${pct(r.claimedDone)}`];
  if (r.missing.length) bits.push(`missing: ${r.missing[0].slice(0, 60)}${r.missing.length > 1 ? ` (+${r.missing.length - 1})` : ""}`);
  if (r.firstWrong) bits.push(`first wrong step ${r.firstWrong.from}: ${r.firstWrong.what.slice(0, 50)}`);
  return `[${t}] ${r.project} ${r.sessionId.slice(0, 8)} turn ${r.turn}: ${r.verdictLabel.toUpperCase()} · ${bits.join(" · ")}`;
}

// Polls the transcript folder and grades each task the moment its turn ends.
// Polling beats fs.watch here: it is the same on every platform and a few
// hundred stats every couple of seconds costs nothing.
export async function watch(opts, { log, out, apiKey, signal }) {
  const seen = new Map(); // sessionId:turn -> hash of the state last graded
  const mtimes = new Map();
  const logFile = path.join(opts.out, "watch.jsonl");
  fs.mkdirSync(opts.out, { recursive: true });
  let first = true;
  log(`Watching ${opts.root} for finished tasks. Ctrl-C to stop.`);
  while (!signal?.aborted) {
    const sessions = discoverSessions({ root: opts.root, include: opts.include, exclude: opts.exclude, sinceDays: opts.since || 1 });
    for (const s of sessions) {
      if (mtimes.get(s.path) === s.mtime) continue;
      mtimes.set(s.path, s.mtime);
      if (first) continue; // existing history is for the normal run, not the watcher
      let session;
      try { session = parseSession(s.path, s); } catch { continue; }
      session.turns.forEach(async (turn, idx) => {
        if (!isGradeable(turn) || !isClosed(turn, idx === session.turns.length - 1)) return;
        const state = buildState(turn, session);
        const questions = buildQuestions(state, turn);
        const key = `${session.sessionId}:${turn.index}`;
        const sig = JSON.stringify(state);
        if (seen.get(key) === sig) return;
        seen.set(key, sig);
        try {
          const res = await askJev({ state, questions, apiKey, model: opts.model });
          const r = gradeTurn({ session, turn, state, answers: res.answers, usage: res.usage });
          out(formatLine(r));
          fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...r, raw: undefined }) + "\n");
          if (opts.notify && r.verdict === "gap") notify("said-done", `${r.project}: said done, was not. ${r.missing[0] ? "Missing: " + r.missing[0].slice(0, 80) : ""}`);
        } catch (err) {
          log(`  failed: ${key}: ${err.message}`);
          seen.delete(key);
        }
      });
    }
    first = false;
    await sleep((opts.interval ?? 2) * 1000);
  }
}
