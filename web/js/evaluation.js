// Evaluation view: every test runs on the reference string the user supplies.
// Evaluating here also switches the Simulator and Results to the same string, and a string
// run in the Simulator shows up here, so all pages always describe one input.

import { $, ALGO, ORDER, algoChip, api, esc, store } from "./util.js";
import { lineChart } from "./charts.js";
import { claimHtml, summaryTable } from "./results.js";

let evaluatedFor = null;   // the store.run the page currently describes
let ownUpdate = false;     // true while this page is the one changing store.run
let busy = false;

export function initEvaluation() {
  $("#ev-example").insertAdjacentHTML("beforeend", store.presets.presets
    .map((p) => `<option value="${p.key}">${esc(p.name)}</option>`).join(""));
  $("#ev-example").onchange = (e) => {
    const p = store.presets.presets.find((x) => x.key === e.target.value);
    if (p) evaluate({ preset: p.key, frames: p.frames, ghost: p.frames, seed: 7 });
    e.target.value = "";
  };
  $("#ev-frames").oninput = syncGhost;
  $("#ev-ghost").oninput = syncGhost;
  $("#ev-file").onchange = importFile;
  $("#ev-form").onsubmit = (e) => { e.preventDefault(); evaluate(formRequest()); };
  $("#ev-bench-run").onclick = runBenchmark;
  $("#ev-sweep-legend").innerHTML = ORDER.map((k) => algoChip(k)).join("");

  store.on((patch) => {
    if (!("run" in patch)) return;
    fillForm();
    if (ownUpdate) return;
    if (!$("#view-evaluation").classList.contains("hidden")) evaluate(store.request);
  });
  if (store.run) fillForm();
}

export function showEvaluation() {
  if (store.run && store.run !== evaluatedFor && !busy) evaluate(store.request);
}

/* ---------- input ---------- */

function fillForm() {
  const r = store.run;
  $("#ev-refs").value = r.refs.join(" ");
  $("#ev-refs").dataset.label = r.label;
  $("#ev-frames").value = r.frames;
  $("#ev-ghost").max = r.frames;
  $("#ev-ghost").value = r.ghost;
  syncGhost();
}

function syncGhost() {
  const frames = Math.max(1, Math.min(64, +$("#ev-frames").value || 1));
  const g = $("#ev-ghost");
  const wasFull = +g.value === +g.max;
  g.max = frames;
  if (wasFull || +g.value > frames) g.value = frames;
  $("#ev-ghost-out").textContent = +g.value === frames ? `${g.value} (standard)` : +g.value === 0 ? "0 (feedback off)" : g.value;
}

async function importFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2_000_000) return showError("That file is over 2 MB. Trim the trace and try again.");
  $("#ev-refs").value = await file.text();
  $("#ev-refs").dataset.label = file.name;
  e.target.value = "";
  evaluate(formRequest());
}

function formRequest() {
  const frames = +$("#ev-frames").value;
  const ghost = +$("#ev-ghost").value;
  const text = $("#ev-refs").value;
  const unchanged = store.run && text.trim().split(/[\s,;]+/).join(" ") === store.run.refs.join(" ");
  // An unedited preset keeps its phases and name; anything typed becomes the user's own string.
  if (unchanged && store.request) return { ...store.request, frames, ghost };
  const label = $("#ev-refs").dataset.label;
  return { refs_text: text, frames, ghost, label: label && !store.presets.presets.some((p) => p.name === label) ? label : "Your reference string" };
}

function showError(msg) {
  const el = $("#ev-error");
  el.classList.toggle("hidden", !msg);
  el.innerHTML = msg ? `<p class="error-note">${esc(msg)}</p>` : "";
}

/* ---------- run ---------- */

async function evaluate(req) {
  if (!req || busy) return;
  busy = true;
  const btn = $("#ev-run");
  btn.disabled = true;
  btn.textContent = "Evaluating…";
  const t0 = performance.now();
  try {
    const current = req === store.request && store.run;
    const [run, ev] = await Promise.all([current || api("/api/simulate", req), api("/api/evaluate", req)]);
    showError("");
    if (run !== store.run) {
      ownUpdate = true;
      store.set({ run, request: req });
      ownUpdate = false;
    }
    evaluatedFor = store.run;
    render(store.run, ev, performance.now() - t0);
  } catch (err) {
    showError(err.message);
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = "Evaluate this string";
  }
}

/* ---------- render ---------- */

function render(run, ev, ms) {
  $("#ev-body").classList.remove("hidden");
  const p = ev.profile;
  $("#ev-title").textContent = run.label;
  $("#ev-meta").textContent = `${p.length} references, ${p.distinct} distinct pages, ${run.frames} frames, ghost list capacity ${run.ghost}`;
  $("#ev-claim").innerHTML = claimHtml(run);
  $("#ev-summary").innerHTML = summaryTable(run);
  renderProfile(p);
  renderSweep(ev);
  renderAblation(ev);
  renderChecks(ev.checks);
  $("#ev-time").textContent = `All of the above computed for this string in ${Math.round(ms)} ms.`;
}

function renderProfile(p) {
  const pctOf = (x) => `${Math.round(x * 100)}%`;
  const facts = [
    ["References", p.length],
    ["Distinct pages", p.distinct],
    ["Pages used only once", p.one_off_pages, p.distinct ? `of ${p.distinct}` : ""],
    ["References that revisit a page", pctOf(p.rereference_share)],
    ["Typical reuse distance", p.median_reuse_distance ?? "none", p.median_reuse_distance !== null ? "other pages in between" : ""],
    [`Busiest ${p.hot_pages} ${p.hot_pages === 1 ? "page" : "pages"} carry`, pctOf(p.hot_share), "of references"],
    ["Longest sequential run", p.longest_sequential_run, p.longest_sequential_run > 1 ? "pages in a row" : ""],
  ];
  $("#ev-profile").innerHTML = facts.map(([dt, dd, unit]) =>
    `<div><dt>${esc(dt)}</dt><dd>${esc(dd)}${unit ? `<small>${esc(unit)}</small>` : ""}</dd></div>`).join("");
  $("#ev-hints").innerHTML = (p.hints.length ? p.hints : [
    "No single pattern dominates: there are no long scans, few one-off pages and no strong hot set. Expect the policies to finish close together.",
  ]).map((h) => `<li>${esc(h)}</li>`).join("");
}

function renderSweep(ev) {
  const s = ev.sweep;
  const at = s.frames.indexOf(ev.frames);
  lineChart($("#ev-sweep"), {
    x: s.frames,
    xName: "Frames",
    series: ORDER.map((k) => ({ key: k, label: ALGO[k].name, color: ALGO[k].color, dash: ALGO[k].dash, values: s.series[k] })),
    markers: at >= 0 ? [{ x: at, label: `${ev.frames} frames` }] : [],
    xLabel: "Frames of memory",
    yLabel: "Page faults",
    height: 320,
    aria: "Faults against memory size for all four algorithms on this string",
  });
  const n = s.frames.length;
  let text = `<b>AdaptiCache beat LRU at ${s.wins} of ${n} memory sizes</b>` +
    (s.ties ? `, tied at ${s.ties}` : "") + (s.losses ? ` and lost at ${s.losses}` : "") +
    ` (from ${s.frames[0]} to ${s.frames[n - 1]} frames).`;
  if (s.losses > s.wins) text += " On this string recency is mostly the right bet, so LRU's fixed assumption happens to hold.";
  const an = ev.belady.anomalies;
  text += an.length
    ? ` FIFO shows Belady's anomaly here: ${an[0].faults_from} faults with ${an[0].from} frames but ${an[0].faults_to} with ${an[0].to}${an.length > 1 ? `, and ${an.length - 1} more such ${an.length === 2 ? "jump" : "jumps"}` : ""}.`
    : " FIFO shows no Belady's anomaly on this string within these sizes.";
  $("#ev-sweep-note").innerHTML = text;
}

function renderAblation(ev) {
  const a = ev.ablation;
  const label = (c) => (c === 0 ? "No ghosts" : c === ev.frames ? `${c} (standard)` : `${c}`);
  const vals = a.caps.map((c) => a.arc[String(c)]);
  const best = Math.min(...vals);
  $("#ev-ablation").innerHTML = `
    <tr><th>Ghost list capacity</th><th class="num">${algoChip("lru")}</th>${a.caps.map((c) => `<th class="num">${label(c)}</th>`).join("")}</tr>
    <tr><td><b>Faults with ${ev.frames} frames</b></td><td class="num">${a.lru}</td>
      ${vals.map((v) => `<td class="num ${v === best ? "best" : v > a.lru ? "worse" : ""}">${v}</td>`).join("")}</tr>`;
  const off = a.arc["0"], std = a.arc[String(ev.frames)];
  $("#ev-ablation-note").innerHTML = off > std
    ? `<b>The ghosts are what make it adaptive.</b> Switching them off costs ${off - std} extra ${off - std === 1 ? "fault" : "faults"} on your string (${std} to ${off})${off > a.lru ? `, worse than plain LRU (${a.lru})` : ""}. Without feedback, p is stuck at 0 and the engine can only protect frequent pages.`
    : off === std
      ? `<b>Here the ghosts make no difference.</b> p's starting point already suits this string, so the feedback never needs to move it far.`
      : `<b>On this string the engine does better without feedback</b> (${off} against ${std} faults). Protecting frequent pages is right throughout, and ghost hits pull p the wrong way for a while.`;
}

function renderChecks(checks) {
  const passed = checks.filter((c) => c.passed).length;
  $("#ev-checks").innerHTML = checks.map((c) => `
    <li><span class="${c.passed ? "ok" : "bad"}" aria-label="${c.passed ? "Passed" : "Failed"}">${c.passed ? "✓" : "✗"}</span>
      <b>${esc(c.name)}</b><span class="detail">${esc(c.detail)}</span></li>`).join("")
    + `<li><span></span><b>${passed} of ${checks.length} passed</b><span></span></li>`;
}

/* ---------- optional built-in benchmark ---------- */

async function runBenchmark() {
  const btn = $("#ev-bench-run");
  btn.disabled = true;
  btn.textContent = "Running 40 strings × 4 engines…";
  try {
    renderBench(await api("/api/benchmark", { frames: 8, seeds: 10 }));
    $("#ev-bench").classList.remove("hidden");
    btn.textContent = "Benchmark complete";
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Run the 40-string benchmark";
    showError(err.message);
  }
}

function renderBench(b) {
  const head = `<tr><th>Workload</th>${ORDER.map((k) => `<th class="num">${algoChip(k)}</th>`).join("")}
    <th>Where AdaptiCache lands <span class="muted" style="font-weight:400">(OPT left, worst right)</span></th>
    <th class="num">vs LRU</th><th class="num">Gap to OPT closed</th><th class="num">Seeds beating LRU</th></tr>`;
  const rows = b.rows.map((r) => {
    const m = r.mean_faults;
    const lo = m.opt, hi = Math.max(m.fifo, m.lru, m.arc);
    const pos = (v) => 6 + ((v - lo) / (hi - lo || 1)) * 88;
    const dots = ["fifo", "lru", "opt", "arc"]
      .map((k) => `<i class="c-${k}${k === "opt" ? " opt" : ""}" style="left:${pos(m[k])}%" title="${ALGO[k].name}: ${m[k]} faults"></i>`).join("");
    const span = `<span class="span" style="left:${pos(Math.min(m.arc, m.lru))}%;width:${Math.abs(pos(m.lru) - pos(m.arc))}%"></span>`;
    const better = r.arc_vs_lru_pct > 0;
    return `<tr>
      <td><b>${esc(r.name)}</b><br><span class="small muted">${r.refs} references</span></td>
      ${ORDER.map((k) => `<td class="num">${m[k]}</td>`).join("")}
      <td><div class="dotplot"><span class="axis-line"></span>${span}${dots}</div></td>
      <td class="num ${better ? "best" : "worse"}">${better ? `${r.arc_vs_lru_pct}% fewer` : `${-r.arc_vs_lru_pct}% more`}</td>
      <td class="num">${r.gap_closed_pct !== null && r.gap_closed_pct > 0 ? `${r.gap_closed_pct}%` : "none"}</td>
      <td class="num wtl"><b>${r.wins}</b> of ${r.wins + r.ties + r.losses}${r.losses ? `, <s>${r.losses} lost</s>` : ""}</td>
    </tr>`;
  }).join("");
  $("#e-bench").innerHTML = head + rows;

  const weak = b.rows.find((r) => r.arc_vs_lru_pct < 0);
  const strong = b.rows.filter((r) => r.arc_vs_lru_pct > 0);
  $("#e-honest").innerHTML = (weak && strong.length
    ? `<b>Where it loses.</b> On the ${esc(weak.name)} workload AdaptiCache makes ${-weak.arc_vs_lru_pct}% more faults than LRU.
       Recency is simply the right bet there, and the adaptive engine has to see a few ghost hits before it learns that.
       That cost is small next to the ${Math.min(...strong.map((r) => r.arc_vs_lru_pct))}% to
       ${Math.max(...strong.map((r) => r.arc_vs_lru_pct))}% it saves when LRU's assumption breaks. `
    : "") + `Mean faults over ${b.seeds} seeds at ${b.frames} frames.`;
}
