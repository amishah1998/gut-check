import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { discoverSessions, parseSession, isGradeable, DEFAULT_ROOT } from "./transcript.js";
import { buildState, buildQuestions, estimateTokens } from "./questions.js";
import { askJev, mapLimit, PRICE_PER_MTOK } from "./jev.js";
import { gradeTurn, summarize, VERDICTS } from "./policy.js";
import { renderReport, renderCardPage } from "./report.js";
import { exportPng } from "./png.js";
import { watch } from "./watch.js";

const HELP = `gut-check: a report card for your AI coding agent

Reads the transcripts Claude Code keeps under ~/.claude/projects, splits each
session into tasks, and asks Jev (TypeSafe) whether each task was finished,
whether the agent said it was, what is missing, and where it first went wrong.

Usage: gut-check [options]

  --include a,b       only projects whose name contains one of these
  --exclude a,b       skip projects whose name contains one of these
  --since N           only sessions modified in the last N days
  --limit N           at most N sessions (most recent first)
  --max-turns N       at most N tasks per session (most recent first), default 40
  --concurrency N     parallel requests, default 6
  --model NAME        Jev model, default jev-latest
  --out DIR           where to write report.html, card.html, results.json (default ~/.gut-check)
  --root DIR          transcript root (default ~/.claude/projects)
  --dry-run [N]       print exactly what would be sent for the first N tasks, send nothing
  --no-cache          re-ask Jev even for tasks graded before
  --png               also write card.png using the machine's Chrome, if found
  --open              open the report when done
  --watch             keep running: grade each task the moment its turn ends, one line each
  --notify            with --watch on macOS, a notification when a task says done but was not
  --interval N        with --watch, seconds between checks, default 2
  --help

Needs TYPESAFE_API_KEY in the environment (https://typesafe.ai). Nothing leaves
the machine except the task text, a one-line summary per step, your follow-ups
and the agent's last message, after secret-shaped strings are redacted.
`;

export function parseArgs(argv) {
  const o = { include: [], exclude: [], since: 0, limit: 0, maxTurns: 40, concurrency: 6, model: "jev-latest", out: path.join(os.homedir(), ".gut-check"), root: DEFAULT_ROOT, dryRun: 0, cache: true, open: false, png: false, watch: false, notify: false, interval: 2, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--include": o.include = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--exclude": o.exclude = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--since": o.since = Number(next()); break;
      case "--limit": o.limit = Number(next()); break;
      case "--max-turns": o.maxTurns = Number(next()); break;
      case "--concurrency": o.concurrency = Number(next()); break;
      case "--model": o.model = next(); break;
      case "--out": o.out = next(); break;
      case "--root": o.root = next(); break;
      case "--dry-run": o.dryRun = argv[i + 1] && /^\d+$/.test(argv[i + 1]) ? Number(next()) : 3; break;
      case "--no-cache": o.cache = false; break;
      case "--open": o.open = true; break;
      case "--png": o.png = true; break;
      case "--watch": o.watch = true; break;
      case "--notify": o.notify = true; break;
      case "--interval": o.interval = Number(next()); break;
      case "--help": case "-h": o.help = true; break;
      default: throw new Error(`unknown option ${a} (try --help)`);
    }
  }
  return o;
}

function loadCache(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

function hashOf(obj) {
  return crypto.createHash("sha1").update(JSON.stringify(obj)).digest("hex");
}

function pad(s, n, right = false) {
  s = String(s);
  return right ? s.padStart(n) : s.padEnd(n);
}

function openFile(p) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [p], { stdio: "ignore", detached: true }).unref();
}

export async function main(argv, { log = console.error, out = console.log } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) { out(HELP); return 0; }

  if (opts.watch) {
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) { log("TYPESAFE_API_KEY is not set. Get a key at https://typesafe.ai and export it."); return 2; }
    const ctrl = new AbortController();
    process.on("SIGINT", () => { ctrl.abort(); log("\nStopped."); process.exit(0); });
    await watch(opts, { log, out, apiKey, signal: ctrl.signal });
    return 0;
  }

  const sessions = discoverSessions({ root: opts.root, include: opts.include, exclude: opts.exclude, sinceDays: opts.since });
  const picked = opts.limit ? sessions.slice(0, opts.limit) : sessions;
  if (!picked.length) { log(`No sessions found under ${opts.root}`); return 1; }

  const jobs = [];
  let allTurns = 0;
  for (const s of picked) {
    const session = parseSession(s.path, s);
    const gradeable = session.turns.filter(isGradeable);
    allTurns += session.turns.length;
    for (const turn of gradeable.slice(-opts.maxTurns)) {
      const state = buildState(turn, session);
      const questions = buildQuestions(state, turn);
      jobs.push({ session, turn, state, questions });
    }
  }
  log(`Found ${sessions.length} sessions under ${opts.root}${opts.include.length ? ` matching ${opts.include.join(", ")}` : ""}; ${picked.length} picked, ${allTurns} turns, ${jobs.length} tasks worth grading.`);
  if (!jobs.length) return 1;

  if (opts.dryRun) {
    for (const j of jobs.slice(0, opts.dryRun)) {
      out(`\n=== ${j.session.project} ${j.session.sessionId.slice(0, 8)} turn ${j.turn.index} (about ${estimateTokens({ state: j.state, questions: j.questions })} tokens) ===`);
      out(JSON.stringify({ model: opts.model, state: j.state, questions: j.questions }, null, 2));
    }
    out(`\nDry run: nothing was sent. ${jobs.length} tasks would be graded.`);
    return 0;
  }

  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) { log("TYPESAFE_API_KEY is not set. Get a key at https://typesafe.ai and export it, or use --dry-run to see what would be sent."); return 2; }

  fs.mkdirSync(opts.out, { recursive: true });
  const cacheFile = path.join(opts.out, "cache.json");
  const cache = opts.cache ? loadCache(cacheFile) : {};
  let hits = 0, sent = 0, failed = 0;
  const t0 = Date.now();
  const rows = await mapLimit(jobs, opts.concurrency, async (j) => {
    const key = hashOf({ m: opts.model, s: j.state, q: j.questions });
    let res = cache[key];
    let secs = 0;
    if (res) hits++;
    else {
      const t = Date.now();
      try {
        res = await askJev({ state: j.state, questions: j.questions, apiKey, model: opts.model });
      } catch (err) {
        failed++;
        log(`  failed: ${j.session.project} ${j.session.sessionId.slice(0, 8)} turn ${j.turn.index}: ${err.message}`);
        return null;
      }
      secs = (Date.now() - t) / 1000;
      sent++;
      cache[key] = res;
    }
    return gradeTurn({ session: j.session, turn: j.turn, state: j.state, answers: res.answers, usage: res.usage, secs });
  }, (done, total) => { if (done % 10 === 0 || done === total) log(`  graded ${done}/${total}`); });
  const graded = rows.filter(Boolean);
  if (opts.cache) fs.writeFileSync(cacheFile, JSON.stringify(cache));
  const elapsed = (Date.now() - t0) / 1000;
  if (!graded.length) { log("Nothing graded."); return 1; }

  const summary = summarize(graded);
  const meta = { model: graded[0]?.raw ? opts.model : opts.model, date: new Date().toISOString().slice(0, 10), pricePerMtok: PRICE_PER_MTOK };
  const reportPath = path.join(opts.out, "report.html");
  const cardPath = path.join(opts.out, "card.html");
  const jsonPath = path.join(opts.out, "results.json");
  fs.writeFileSync(reportPath, renderReport(graded, summary, meta));
  fs.writeFileSync(cardPath, renderCardPage(summary, meta));
  fs.writeFileSync(jsonPath, JSON.stringify({ meta, summary, tasks: graded }, null, 1));

  // per-session roll-up for the terminal
  const bySession = new Map();
  for (const r of graded) {
    const b = bySession.get(r.sessionId) ?? { project: r.project, sessionId: r.sessionId, tasks: 0, finished: 0, gaps: 0, corrections: [] };
    b.tasks++; if (r.verdict === "finished") b.finished++; if (r.verdict === "gap") b.gaps++; b.corrections.push(r.corrections);
    bySession.set(r.sessionId, b);
  }
  out("");
  out(`${pad("session", 9)} ${pad("project", 28)} ${pad("tasks", 5, true)} ${pad("finished", 8, true)} ${pad("said done, was not", 18, true)} ${pad("corrections", 11, true)}`);
  for (const b of [...bySession.values()].sort((a, c) => c.gaps - a.gaps || a.finished / a.tasks - c.finished / c.tasks)) {
    const corr = b.corrections.reduce((a, c) => a + c, 0) / b.corrections.length;
    out(`${pad(b.sessionId.slice(0, 8), 9)} ${pad(b.project.slice(0, 28), 28)} ${pad(b.tasks, 5, true)} ${pad(b.finished, 8, true)} ${pad(b.gaps, 18, true)} ${pad(corr.toFixed(1), 11, true)}`);
  }
  const cost = (summary.gradeTokens * PRICE_PER_MTOK) / 1e6;
  out("");
  out(`${summary.turns} tasks in ${summary.sessions} sessions: ${summary.finished} finished, ${summary.gaps} "${VERDICTS.gap}", ${summary.honest} "${VERDICTS.honest}".`);
  out(`Sent ${sent} requests (${hits} from cache, ${failed} failed) in ${elapsed.toFixed(1)} s, ${summary.gradeTokens.toLocaleString("en-US")} tokens, about $${cost.toFixed(3)}.`);
  out(`Report: ${reportPath}\nCard:   ${cardPath}\nData:   ${jsonPath}`);
  if (opts.png) {
    const png = exportPng(cardPath, path.join(opts.out, "card.png"));
    out(png ? `PNG:    ${png}` : "PNG:    no Chrome found; set GUT_CHECK_CHROME to a Chrome or Chromium binary");
  }
  if (opts.open) openFile(reportPath);
  return 0;
}
