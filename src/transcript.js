import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const DEFAULT_ROOT = path.join(os.homedir(), ".claude", "projects");

export function clip(s, n) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n) + "…";
}

// A project folder is named after its working directory with slashes turned
// into dashes, e.g. -Users-jane-GitHub-app. Drop the home prefix for display.
export function projectName(dirName) {
  const home = os.homedir().replace(/\//g, "-");
  return dirName.startsWith(home + "-") ? dirName.slice(home.length + 1) : dirName.replace(/^-/, "");
}

export function discoverSessions({ root = DEFAULT_ROOT, include = [], exclude = [], sinceDays = 0 } = {}) {
  if (!fs.existsSync(root)) return [];
  const cutoff = sinceDays > 0 ? Date.now() - sinceDays * 86400e3 : 0;
  const out = [];
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const project = projectName(dir.name);
    const lower = project.toLowerCase();
    if (include.length && !include.some((s) => lower.includes(s.toLowerCase()))) continue;
    if (exclude.some((s) => lower.includes(s.toLowerCase()))) continue;
    const dirPath = path.join(root, dir.name);
    // Only files directly in the project folder: subfolders hold subagent transcripts.
    for (const f of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const p = path.join(dirPath, f.name);
      const st = fs.statSync(p);
      if (cutoff && st.mtimeMs < cutoff) continue;
      out.push({ path: p, project, sessionId: f.name.replace(/\.jsonl$/, ""), mtime: st.mtimeMs, size: st.size });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export function summarizeInput(name, input) {
  if (!input || typeof input !== "object") return clip(input, 120);
  switch (name) {
    case "Bash":
      return clip(input.command, 160);
    case "Read":
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return clip(input.file_path, 120);
    case "Agent":
    case "Task":
      return clip(input.description || input.prompt, 140);
    case "Grep":
    case "Glob":
      return clip(input.pattern, 100);
    case "WebFetch":
    case "WebSearch":
      return clip(input.url || input.query, 120);
    case "Skill":
      return clip(input.skill, 60);
    default:
      return clip(JSON.stringify(input), 120);
  }
}

const ACK_START = /^(ok(ay)?|yes|yep|yeah|no|nope|go|go ahead|do it|continue|proceed|sure|thanks|thank you|ty|k|cool|great|nice|perfect|done|next|fine|please do|approved|merge(d)?|lgtm)\b/i;

// A short message that answers the agent rather than starting new work stays
// inside the current turn, so "yes, do it" does not become a task of its own.
export function isContinuation(text) {
  const t = text.replace(/\[Image[^\]]*\]/g, " ").trim();
  if (t.startsWith("[Request interrupted")) return true;
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words <= 3) return true;
  if (words < 8 && ACK_START.test(t)) return true;
  return false;
}

function userText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text);
    return texts.join("\n");
  }
  return "";
}

// A slash command arrives as its expanded skill text. The ask is the command
// the user typed, not the skill body, so reduce it to "/name args".
export function commandPrompt(text) {
  const name = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(text)?.[1];
  if (!name) return null;
  const args = /<command-args>\s*([^<]*?)\s*<\/command-args>/.exec(text)?.[1] ?? "";
  return `${name.startsWith("/") ? name : "/" + name} ${args}`.trim();
}

// A pasted message arrives wrapped in <pasted_content> tags, and reminders
// ride along in <system-reminder> blocks. Keep what the user typed or pasted,
// drop the rest.
export function unwrapPrompt(text) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ")
    .replace(/<pasted_content[^>]*>([\s\S]*?)<\/pasted_content[^>]*>/g, "$1")
    .trim();
}

// Text Claude Code injects around a real prompt: system reminders, hook
// output, skill bodies. None of it is something the user typed.
function isSyntheticPrompt(text) {
  const t = text.trimStart();
  return t === "" || t.startsWith("<") || t.startsWith("Base directory for this skill");
}

export function parseSession(filePath, meta = {}) {
  const raw = fs.readFileSync(filePath, "utf8");
  const session = {
    path: filePath,
    sessionId: meta.sessionId ?? path.basename(filePath, ".jsonl"),
    project: meta.project ?? projectName(path.basename(path.dirname(filePath))),
    turns: [],
    models: new Set(),
    startedAt: null,
    endedAt: null,
  };
  let turn = null;
  const closeTurn = () => {
    if (turn) session.turns.push(turn);
    turn = null;
  };
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.isSidechain) continue;
    // isMeta marks text Claude Code injected on the user's behalf: skill bodies,
    // hook output, context. Tool results never carry it.
    if (o.isMeta) continue;
    const type = o.type;
    if (type !== "user" && type !== "assistant") continue;
    const ts = o.timestamp ? Date.parse(o.timestamp) : null;
    if (ts) {
      session.startedAt ??= ts;
      session.endedAt = ts;
    }
    const msg = o.message || {};
    const content = msg.content;
    if (type === "user") {
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b && b.type === "tool_result" && turn) {
            const last = turn.steps[turn.steps.length - 1];
            if (b.is_error) {
              turn.toolErrors++;
              if (last) {
                last.error = true;
                last.errorText = clip(typeof b.content === "string" ? b.content : JSON.stringify(b.content), 160);
              }
            }
          }
        }
      }
      let text = userText(content);
      const cmd = text && commandPrompt(text);
      if (cmd) text = cmd;
      else {
        text = text ? unwrapPrompt(text) : "";
        if (!text || isSyntheticPrompt(text)) continue;
      }
      if (isContinuation(text)) {
        if (turn) turn.followups.push(clip(text, 300));
        continue;
      }
      closeTurn();
      turn = {
        index: session.turns.length + 1,
        prompt: text,
        branch: o.gitBranch || null,
        cwd: o.cwd ? path.basename(o.cwd) : null,
        lastStop: null,
        followups: [],
        steps: [],
        toolErrors: 0,
        lastText: "",
        models: new Set(),
        startedAt: ts,
        endedAt: ts,
        usage: { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 },
      };
    } else {
      if (!turn) continue;
      if (msg.model && !msg.model.startsWith("<")) {
        turn.models.add(msg.model);
        session.models.add(msg.model);
      }
      // Cache reads re-count the whole context on every message, so they are
      // kept apart: "new" tokens are what each message actually added.
      if (msg.usage) {
        turn.usage.input += msg.usage.input_tokens || 0;
        turn.usage.cacheCreate += msg.usage.cache_creation_input_tokens || 0;
        turn.usage.cacheRead += msg.usage.cache_read_input_tokens || 0;
        turn.usage.output += msg.usage.output_tokens || 0;
      }
      if (ts) turn.endedAt = ts;
      if (msg.stop_reason) turn.lastStop = msg.stop_reason;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (!b) continue;
        if (b.type === "tool_use") {
          turn.steps.push({ i: turn.steps.length + 1, tool: b.name, what: summarizeInput(b.name, b.input), error: false });
        } else if (b.type === "text" && b.text && b.text.trim()) {
          turn.lastText = b.text;
        }
      }
    }
  }
  closeTurn();
  for (const t of session.turns) t.models = [...t.models];
  session.models = [...session.models];
  return session;
}

export function promptWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Worth a grade when the agent actually did something for a real ask.
export function isGradeable(turn) {
  if (!turn.lastText) return false;
  if (turn.steps.length >= 2) return true;
  return turn.steps.length >= 1 && promptWords(turn.prompt) >= 6;
}

// A turn is over when the model stopped without asking for a tool, or when a
// later prompt exists. The watcher grades only closed turns.
export function isClosed(turn, isLast) {
  if (!isLast) return true;
  return turn.lastStop === "end_turn" || turn.lastStop === "stop_sequence";
}
