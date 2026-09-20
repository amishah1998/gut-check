import { VERDICTS, words } from "./policy.js";

const E = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (v) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
const bar = (v, cls = "") => `<span class="bar ${cls}"><i style="width:${Math.round((v ?? 0) * 100)}%"></i></span>`;
const day = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : "");

const CSS = `
:root{--ink:#1a1917;--muted:#6f6a62;--line:#e4dfd5;--paper:#faf8f3;--card:#fff;--ok:#2a7a3e;--bad:#a5302a;--warn:#b0641b;--accent:#0f5f6b;
--display:"Avenir Next","Avenir","Helvetica Neue",Helvetica,sans-serif;--mono:"SF Mono",ui-monospace,Menlo,monospace}
*{box-sizing:border-box} body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 var(--display);-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:36px 28px 80px}
h1{font:600 1.7rem/1.2 var(--display);margin:0 0 4px} .sub{color:var(--muted);margin:0 0 22px}
.top{display:grid;grid-template-columns:420px 1fr;gap:26px;align-items:start;margin-bottom:30px}
.rc{border-radius:14px;background:#1d1c1a;color:#ebe6dc;padding:22px 26px;box-shadow:0 8px 30px rgba(0,0,0,.18)}
.rc .t{font:600 11px/1 var(--display);letter-spacing:.16em;text-transform:uppercase;color:#9c968c}
.rc .big{font:700 44px/1.05 var(--display);letter-spacing:-.02em;margin:10px 0 2px} .rc .s{font-size:14px;color:#c9c3b8;margin-bottom:14px}
.rc .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px} .rc .k{font:700 22px/1.1 var(--display)} .rc .l{font-size:12px;color:#9c968c;margin-top:2px}
.rc .foot{margin-top:14px;font:600 11px var(--mono);color:#8fd0d9;letter-spacing:.04em}
.how{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;font-size:15px}
.how h2{font:600 12px/1 var(--display);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.how ul{margin:0;padding-left:18px} .how li{margin:5px 0}
h2.sec{font:600 1.1rem var(--display);margin:26px 0 10px}
table{border-collapse:collapse;width:100%;font-size:14px;margin:6px 0 18px;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line)} th{font:600 10.5px/1.3 var(--display);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
td.num{font-variant-numeric:tabular-nums}
.sess{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--line);border-radius:12px;padding:16px 20px;margin:0 0 14px}
.sess.gap{border-left-color:var(--bad)} .sess.finished{border-left-color:var(--ok)} .sess.honest{border-left-color:var(--accent)} .sess.unclear{border-left-color:var(--warn)}
.head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.proj{font-weight:600} .sid{font:12px var(--mono);color:var(--muted);margin-left:6px}
.badge{font:700 11px/1 var(--display);letter-spacing:.08em;text-transform:uppercase;padding:6px 10px;border-radius:999px;border:1.5px solid;white-space:nowrap}
.badge.gap{color:var(--bad);border-color:var(--bad)} .badge.finished{color:var(--ok);border-color:var(--ok)} .badge.honest{color:var(--accent);border-color:var(--accent)} .badge.unclear{color:var(--warn);border-color:var(--warn)}
.task{margin:10px 0 8px;font-size:15px;color:#3a3733}
.miss{margin:6px 0 10px;padding:8px 12px;background:#fbf1ef;border-left:3px solid var(--bad);border-radius:6px;font-size:14px}
.miss b{color:var(--bad)} .miss ul{margin:4px 0 0;padding-left:18px}
.wrong{margin:6px 0 10px;padding:8px 12px;background:#fdf6ec;border-left:3px solid var(--warn);border-radius:6px;font-size:14px}
.grades{display:grid;grid-template-columns:1fr 1fr;gap:6px 28px}
.g{display:grid;grid-template-columns:190px 1fr auto;align-items:center;gap:10px;font-size:14px}
.q{color:var(--muted)} .v{font:12.5px var(--mono);color:var(--muted);white-space:nowrap} .w{font-weight:600}
.bar{display:block;height:8px;background:#eee9df;border-radius:999px;overflow:hidden} .bar i{display:block;height:100%;background:#9c968c} .bar.c i{background:var(--accent)}
details{margin-top:12px;font-size:14px} summary{cursor:pointer;color:var(--accent);font-weight:600}
.lab{font:600 11px/1 var(--display);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:12px 0 4px}
.steps,.fu{margin:0;padding-left:20px;font:13px/1.5 var(--mono);color:#3a3733} .steps li,.fu li{margin:2px 0;word-break:break-word}
.final{margin:4px 0 0;color:#3a3733;font-size:14px;border-left:2px solid var(--line);padding-left:10px}
.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;font-size:13px;color:var(--muted)}
.actions button{font:600 12px var(--display);border:1px solid var(--line);background:var(--card);border-radius:999px;padding:5px 11px;cursor:pointer;color:var(--ink)}
.actions button.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.actions code{font:12px var(--mono);background:#f1ede4;padding:2px 6px;border-radius:4px}
.meta{font:12px var(--mono);color:var(--muted)}
.note{color:var(--muted);font-size:13px;margin:18px 0 0}
@media (max-width:820px){.top,.grades{grid-template-columns:1fr}}
`;

export function renderCard(summary, meta) {
  const cost = (summary.gradeTokens * meta.pricePerMtok) / 1e6;
  return `<div class="rc">
  <div class="t">gut-check · Claude Code report card</div>
  <div class="big">${summary.gaps} of ${summary.turns}</div>
  <div class="s">tasks where the agent said "done" and the evidence said otherwise</div>
  <div class="grid">
    <div><div class="k">${pct(summary.finished / Math.max(1, summary.turns))}</div><div class="l">of tasks actually finished (${summary.finished} of ${summary.turns})</div></div>
    <div><div class="k">${summary.avgCorrections == null ? "n/a" : summary.avgCorrections.toFixed(1)} / 3</div><div class="l">how hard you had to correct it (0 none, 3 gave up)</div></div>
    <div><div class="k">${pct(summary.avgDoneShare)}</div><div class="l">of what you asked for got delivered, on average</div></div>
    <div><div class="k">$${cost.toFixed(3)}</div><div class="l">what grading ${summary.turns} tasks across ${summary.sessions} sessions cost</div></div>
  </div>
  <div class="foot">npx gut-check · graded locally with ${E(meta.model)} · ${E(meta.date)}</div>
</div>`;
}

const tok = (v) => (v == null ? "n/a" : Math.round(v).toLocaleString("en-US"));

function groupTable(title, groups, keyLabel) {
  const keys = Object.keys(groups).sort();
  if (!keys.length) return "";
  const hasTokens = keys.some((k) => groups[k].avgTokens != null);
  return `<h2 class="sec">${E(title)}</h2>
<table><thead><tr><th>${E(keyLabel)}</th><th>Tasks</th><th>Finished</th><th>Said done, was not</th><th>Corrections (0 to 3)</th>${hasTokens ? "<th>New Claude tokens per task</th>" : ""}</tr></thead><tbody>
${keys.map((k) => { const g = groups[k]; return `<tr><td>${E(k)}</td><td class="num">${g.turns}</td><td class="num">${g.finished} (${pct(g.finished / g.turns)})</td><td class="num">${g.gaps}</td><td class="num">${g.avgCorrections == null ? "n/a" : g.avgCorrections.toFixed(1)}</td>${hasTokens ? `<td class="num">${tok(g.avgTokens)}</td>` : ""}</tr>`; }).join("\n")}
</tbody></table>`;
}

function tokensLine(summary) {
  if (summary.tokensPerFinished == null && summary.tokensPerGap == null) return "";
  return `<p class="note">New Claude tokens per task (fresh input, cache writes and output; cache reads excluded), from the transcript's own usage counts: ${tok(summary.tokensPerFinished)} on tasks that finished, ${tok(summary.tokensPerGap)} on tasks that said done but were not.</p>`;
}

function turnBox(r) {
  const missing = r.missing.length
    ? `<div class="miss"><b>Asked for ${r.requirements.length} things, ${r.requirements.length - r.missing.length} delivered.</b> Missing:<ul>${r.missing.map((m) => `<li>${E(m)}</li>`).join("")}</ul></div>`
    : "";
  const wrong = r.firstWrong
    ? `<div class="wrong"><b>First step that should not have happened</b> (${pct(r.firstWrong.confidence)} sure): step ${r.firstWrong.from}${r.firstWrong.to !== r.firstWrong.from ? ` to ${r.firstWrong.to}` : ""}, ${E(r.firstWrong.what)}</div>`
    : "";
  const id = `${r.sessionId}:${r.turn}`;
  return `<article class="sess ${r.verdict}" data-id="${E(id)}">
  <div class="head">
    <div><span class="proj">${E(r.project)}</span> <span class="sid">${E(r.sessionId.slice(0, 8))} · turn ${r.turn}</span> <span class="meta">${E(day(r.startedAt))} · ${E(r.models.join(", ") || "model unknown")}</span></div>
    <span class="badge ${r.verdict}">${E(r.verdictLabel)}</span>
  </div>
  <p class="task"><b>You asked:</b> ${E(r.task.length > 320 ? r.task.slice(0, 320) + "…" : r.task)}</p>
  ${missing}${wrong}
  <div class="grades">
    <div class="g"><span class="q">Actually finished?</span>${bar(r.completed, "c")}<span class="v">${pct(r.completed)} · ${words("finished", r.completed)}</span></div>
    <div class="g"><span class="q">Said it was done?</span>${bar(r.claimedDone, "c")}<span class="v">${pct(r.claimedDone)}</span></div>
    <div class="g"><span class="q">How much got delivered</span>${bar(r.doneShare)}<span class="v">${pct(r.doneShare)}</span></div>
    <div class="g"><span class="q">Steps in a sensible order?</span>${bar(r.sequenceOk)}<span class="v">${pct(r.sequenceOk)}</span></div>
    <div class="g"><span class="q">Stayed on the task?</span>${bar(r.inScope)}<span class="v">${pct(r.inScope)}</span></div>
    <div class="g"><span class="q">You had to correct it</span><span class="w">${E(words("corrections", r.corrections))}</span><span class="v">${r.followups} follow-up messages</span></div>
    <div class="g"><span class="q">Wasted effort</span><span class="w">${E(words("wasted", r.wasted))}</span><span class="v">${r.steps} steps, ${r.toolErrors} tool errors</span></div>
  </div>
  <details><summary>Show the diary this was graded from</summary>
    <p class="lab">First steps the agent took</p>
    <ol class="steps">${r.firstSteps.map((s) => `<li>${E(s)}</li>`).join("")}</ol>
    <p class="lab">Things you said later</p>
    <ul class="fu">${r.followupSamples.length ? r.followupSamples.map((s) => `<li>${E(s)}</li>`).join("") : "<li>none</li>"}</ul>
    <p class="lab">Its last message</p>
    <p class="final">${E(r.finalText)}</p>
  </details>
  <div class="actions">
    <span>Was this grade right?</span>
    <button data-label="right" type="button">Yes</button><button data-label="wrong" type="button">No</button>
    <span>Reopen: <code>claude --resume ${E(r.sessionId)}</code></span>
  </div>
</article>`;
}

export function renderReport(rows, summary, meta) {
  const order = { gap: 0, unclear: 1, honest: 2, finished: 3 };
  const sorted = [...rows].sort((a, b) => order[a.verdict] - order[b.verdict] || (b.claimedDone - b.completed) - (a.claimedDone - a.completed));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>gut-check report: ${summary.turns} tasks</title>
<style>${CSS}</style></head><body><div class="wrap">
<h1>Your Claude Code report card</h1>
<p class="sub">${summary.turns} tasks across ${summary.sessions} sessions, graded ${E(meta.date)} by <code>gut-check</code>. Every number is a probability from ${E(meta.model)}; every box shows the diary it was graded from.</p>
<div class="top">
  ${renderCard(summary, meta)}
  <div class="how">
    <h2>How to read this</h2>
    <ul>
      <li>Each box is one task: what you asked, and what the agent's own diary says happened.</li>
      <li>Percentages are how sure the grader is that the answer is yes.</li>
      <li><b style="color:var(--bad)">${VERDICTS.gap}</b> is the one to reopen: the last message claimed completion, but the diary does not show your ask finished.</li>
      <li><b style="color:var(--accent)">${VERDICTS.honest}</b> is fine: it stopped and told you.</li>
      <li>Mark grades right or wrong; the "Copy my labels" button exports them so thresholds can be tuned on your data.</li>
    </ul>
    <div class="actions"><button id="copylabels" type="button">Copy my labels</button><span id="labelcount"></span></div>
  </div>
</div>
${tokensLine(summary)}
${groupTable("By model", summary.byModel, "Model")}
${groupTable("By week", summary.byWeek, "Week starting")}
<h2 class="sec">Every task, one box each</h2>
${sorted.map(turnBox).join("\n")}
<p class="note">Grader: ${E(meta.model)} via TypeSafe. Thresholds live in src/policy.js. "Used the right tools" is recorded in results.json but not shown until it is validated against labelled tasks. A task is one user prompt plus everything the agent did until the next prompt; short replies like "yes, go ahead" stay inside the task.</p>
</div>
<script>
(function(){
  var KEY='gutcheck:labels'; var st={}; try{st=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
  function save(){try{localStorage.setItem(KEY,JSON.stringify(st))}catch(e){} var n=Object.keys(st).length; document.getElementById('labelcount').textContent=n?n+' labelled':'';}
  document.querySelectorAll('.sess').forEach(function(box){
    var id=box.dataset.id;
    box.querySelectorAll('button[data-label]').forEach(function(b){
      b.classList.toggle('on',st[id]===b.dataset.label);
      b.addEventListener('click',function(){ st[id]=b.dataset.label; save(); box.querySelectorAll('button[data-label]').forEach(function(x){x.classList.toggle('on',x===b)}); });
    });
  });
  document.getElementById('copylabels').addEventListener('click',function(){
    var out=[]; document.querySelectorAll('.sess').forEach(function(box){ var id=box.dataset.id; if(st[id]) out.push(id+'\\t'+box.querySelector('.badge').textContent+'\\t'+st[id]); });
    var b=this; navigator.clipboard.writeText(out.join('\\n')).then(function(){var t=b.textContent;b.textContent='Copied';setTimeout(function(){b.textContent=t},1500)});
  });
  save();
})();
</script>
</body></html>`;
}

export function renderCardPage(summary, meta) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>gut-check card</title><style>${CSS} body{padding:40px} .rc{max-width:520px}</style></head><body>${renderCard(summary, meta)}</body></html>`;
}
