// "The case" view: hero run, why the classic policies fail, the step-through explainer, and the phase evidence.

import { $, $$, ALGO, ORDER, algoChip, api, esc, fmtP, PHASE_CLASS, reducedMotion } from "./util.js";
import { lineChart } from "./charts.js";
import { renderCacheLine, CACHELINE_LEGEND } from "./cacheline.js";

const TEACH_REFS = "1 2 1 2 7 8 9 1 2 8 9 1 5 6 2 1";
const SCAN_REFS = "1 2 3 1 2 3 1 2 3 10 11 12 13 14 15 1 2 3 1 2 3";

// Hand-written commentary for the moments that matter in the teaching string (0-based steps).
const WHY = {
  3: "Pages 1 and 2 have each been used twice. Both now sit on the frequency side.",
  4: "A scan begins: 7, 8 and 9 are each used once. They enter T1, the side that is over its target, so they push each other out while 1 and 2 stay safe in T2.",
  6: "By now LRU has thrown out pages 1 and 2 to make room for the scan. AdaptiCache has not.",
  7: "LRU faults on page 1 here because the scan pushed it out. AdaptiCache still has it.",
  8: "The same for page 2: a second fault for LRU, a hit for AdaptiCache.",
  9: "This is the feedback loop. A ghost hit is proof of a wrong eviction, and p moves without any training or tuning by hand.",
  11: "Now the frequency side was short-changed, so p swings back toward T2.",
  15: "Final count: AdaptiCache 10 faults, LRU 14. OPT, with perfect knowledge of the future, makes 9.",
};

export async function initCase(mixedRun) {
  initHero(mixedRun);
  renderEvidence(mixedRun);
  await Promise.all([initBelady(), initScanDemo(), initOpt(), initExplainer()]).catch((err) => {
    $("#why").insertAdjacentHTML("beforeend", `<p class="error-note">${esc(err.message)}</p>`);
  });
}

/* ---------- Hero: the scan phase of the mixed workload, looping ---------- */

function initHero(run) {
  const phase = run.phases.find((p) => p.kind === "scan") || run.phases[0];
  const arc = run.engines.arc.steps;
  const c = run.frames, g = run.ghost;
  const totals = Object.fromEntries(ORDER.map((k) => [k, phase.faults[k]]));
  const max = Math.max(...Object.values(totals));
  const base = Object.fromEntries(ORDER.map((k) => [k, phase.start ? run.engines[k].cum_faults[phase.start - 1] : 0]));

  $("#hero-caption").textContent = `${run.label}, "${phase.label}" phase, ${c} frames`;
  $("#hero-race").innerHTML = ORDER.map((k) => `
    <div class="race-row c-${k}">
      ${algoChip(k)}
      <div class="race-bar"><span style="width:0"></span></div>
      <b>0</b>
    </div>`).join("") + `<p class="small muted">Faults during this phase so far</p>`;
  const rows = $$("#hero-race .race-row");

  let t = phase.start;
  const show = (i) => {
    renderCacheLine($("#hero-cacheline"), arc[i], c, g);
    $("#hero-step").textContent = `Step ${i + 1}, page ${arc[i].page}`;
    ORDER.forEach((k, j) => {
      const f = run.engines[k].cum_faults[i] - base[k];
      rows[j].querySelector(".race-bar span").style.width = `${(f / max) * 100}%`;
      rows[j].querySelector("b").textContent = f;
    });
  };

  if (reducedMotion()) return show(phase.end - 1);

  let visible = true, last = 0;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe($("#hero-stage"));
  const tick = (now) => {
    if (visible && !document.hidden && now - last > 150) {
      last = now;
      show(t);
      t = t + 1 >= phase.end ? phase.start : t + 1;
      if (t === phase.start) last = now + 1600; // hold the final tally before looping
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------- FIFO: Belady's anomaly ---------- */

async function initBelady() {
  const b = await api("/api/belady", { preset: "belady", max_frames: 6 });
  const an = b.anomalies[0];
  lineChart($("#belady-chart"), {
    x: b.frames,
    xName: "Frames",
    series: [
      { key: "fifo", label: "FIFO", color: ALGO.fifo.color, values: b.fifo, dots: true },
      { key: "lru", label: "LRU", color: ALGO.lru.color, values: b.lru, dots: true, width: 1.6 },
    ],
    markers: an ? [{ x: b.frames.indexOf(an.to), dot: an.faults_to }] : [],
    xLabel: "Frames",
    yLabel: "Faults",
    height: 200,
    aria: "Faults against number of frames for FIFO and LRU on the Belady string",
  });
  $("#belady-verdict").textContent = an
    ? `With ${an.from} frames FIFO makes ${an.faults_from} faults. With ${an.to} it makes ${an.faults_to}. More memory, more faults.`
    : "";
}

/* ---------- LRU: a scan flushes the hot set ---------- */

async function initScanDemo() {
  const r = await api("/api/simulate", { refs_text: SCAN_REFS, frames: 4 });
  const n = r.refs.length;
  const row = (cells) => `<div style="display:grid;grid-template-columns:repeat(${n},minmax(0,1fr));gap:2px">${cells}</div>`;
  const strip = (k) => row(r.engines[k].steps
    .map((s) => `<span title="Step ${s.t + 1}: ${s.hit ? "hit" : "fault"}" style="height:14px;border-radius:2px;background:${s.hit ? "var(--hit-bg)" : "var(--fault)"};box-shadow:inset 0 0 0 1px ${s.hit ? "var(--hit)" : "var(--fault)"}"></span>`)
    .join(""));
  const refs = row(r.refs.map((p) => `<span style="text-align:center;font-size:11px;color:var(--ink-2)">${p > 9 ? "s" : p}</span>`).join(""));
  $("#scan-demo").innerHTML = `
    <div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 10px;align-items:center">
      <span class="small muted">Page</span>${refs}
      ${algoChip("lru")}${strip("lru")}
      ${algoChip("arc", "Adapti­Cache")}${strip("arc")}
    </div>
    <p class="small muted" style="margin-top:10px">4 frames. Red is a fault, green a hit; "s" marks scan pages used once.</p>`;
  const f = (k) => r.engines[k].summary.faults;
  $("#scan-verdict").textContent =
    `After the scan, LRU faults on pages 1, 2 and 3 all over again: ${f("lru")} faults. AdaptiCache kept them: ${f("arc")}, the same as OPT.`;
}

/* ---------- OPT: needs the future ---------- */

async function initOpt() {
  const r = await api("/api/simulate", { preset: "textbook" });
  const s = r.engines.opt.steps.find((x) => x.note.includes("furthest in the future"));
  $("#opt-note").innerHTML = s ? `Step ${s.t + 1}, page ${s.page}: ${esc(s.note)}` : "";
  const f = (k) => r.engines[k].summary.faults;
  $("#opt-verdict").textContent =
    `OPT makes ${f("opt")} faults where LRU makes ${f("lru")} and FIFO ${f("fifo")}. That gap is the room a real policy can still win back.`;
}

/* ---------- Step-through explainer ---------- */

async function initExplainer() {
  const r = await api("/api/simulate", { refs_text: TEACH_REFS, frames: 3 });
  const arc = r.engines.arc.steps, lru = r.engines.lru.steps;
  const n = r.refs.length;
  let t = -1;

  $("#ex-tape").innerHTML = r.refs.map((p, i) => `<span role="listitem" data-i="${i}" title="Go to step ${i + 1}">${p}</span>`).join("");
  $("#ex-cacheline").insertAdjacentHTML("afterend", CACHELINE_LEGEND);

  const empty = { t1: [], t2: [], b1: [], b2: [], p: 0, page: null, hit: false, evicted: null };
  const render = () => {
    $$("#ex-tape span").forEach((el, i) => (el.className = i < t ? "past" : i === t ? "now" : ""));
    renderCacheLine($("#ex-cacheline"), t >= 0 ? arc[t] : empty, 3, 3);
    const frames = t >= 0 ? lru[t].frames : [null, null, null];
    $("#ex-lru-frames").innerHTML = frames.map((p, slot) => {
      const touched = t >= 0 && lru[t].slot === slot;
      const cls = touched ? (lru[t].hit ? "is-hit" : "is-fault") : "";
      return `<span class="${cls}">${p ?? ""}</span>`;
    }).join("");
    $("#ex-arc-faults").textContent = t >= 0 ? r.engines.arc.cum_faults[t] : 0;
    $("#ex-lru-faults").textContent = t >= 0 ? r.engines.lru.cum_faults[t] : 0;
    if (t < 0) {
      $("#ex-note").innerHTML = `Memory starts empty. Press <b>Next reference</b> to feed in page ${r.refs[0]}.`;
    } else {
      const s = arc[t];
      const tag = s.hit ? `<span class="tag hit">${esc(s.case)}</span>` :
        s.case.includes("ghost") ? `<span class="tag ghost">${esc(s.case)}</span>` : `<span class="tag fault">Fault</span>`;
      $("#ex-note").innerHTML = `${tag} ${esc(s.note)}${WHY[t] ? `<span class="why">${esc(WHY[t])}</span>` : ""}`;
    }
    $$("#ex-rules li").forEach((li) => li.classList.toggle("on", t >= 0 && li.dataset.case === arc[t].case));
    $("#ex-pos").textContent = t < 0 ? `${n} references` : `Step ${t + 1} of ${n}`;
    $("#ex-prev").disabled = t < 0;
    $("#ex-next").disabled = t >= n - 1;
  };

  $("#ex-next").onclick = () => { if (t < n - 1) { t++; render(); } };
  $("#ex-prev").onclick = () => { if (t >= 0) { t--; render(); } };
  $("#ex-reset").onclick = () => { t = -1; render(); };
  $("#ex-tape").onclick = (e) => { const i = e.target.dataset?.i; if (i !== undefined) { t = +i; render(); } };
  render();
}

/* ---------- Evidence: faults by phase ---------- */

export function phaseTable(run) {
  const head = `<tr><th>Phase</th><th class="num">Steps</th>${ORDER.map((k) => `<th class="num">${algoChip(k)}</th>`).join("")}<th class="num">AdaptiCache vs LRU</th></tr>`;
  const body = run.phases.map((ph) => {
    const f = ph.faults;
    const diff = f.lru - f.arc;
    const best = Math.min(f.fifo, f.lru, f.arc);
    const cell = (k) => `<td class="num${k !== "opt" && f[k] === best ? " best" : ""}">${f[k]}</td>`;
    return `<tr><td><span class="phase-dot ${PHASE_CLASS[ph.kind] || ""}"></span>${esc(ph.label)}</td>
      <td class="num">${ph.start + 1} to ${ph.end}</td>${ORDER.map(cell).join("")}
      <td class="num ${diff > 0 ? "best" : diff < 0 ? "worse" : ""}">${diff > 0 ? `${diff} fewer` : diff < 0 ? `${-diff} more` : "level"}</td></tr>`;
  }).join("");
  const s = Object.fromEntries(ORDER.map((k) => [k, run.engines[k].summary.faults]));
  const total = `<tr class="highlight"><td><b>Whole run</b></td><td class="num">${run.refs.length}</td>${ORDER.map((k) => `<td class="num"><b>${s[k]}</b></td>`).join("")}<td class="num best">${s.lru - s.arc > 0 ? `${s.lru - s.arc} fewer` : `${s.arc - s.lru} more`}</td></tr>`;
  return head + body + (run.phases.length > 1 ? total : "");
}

function renderEvidence(run) {
  $("#phase-table").innerHTML = phaseTable(run);
  const lost = run.phases.filter((p) => p.faults.arc > p.faults.lru);
  const won = run.phases.filter((p) => p.faults.arc < p.faults.lru);
  const sum = (list, f) => list.reduce((a, p) => a + f(p), 0);
  const gained = sum(won, (p) => p.faults.lru - p.faults.arc);
  const given = sum(lost, (p) => p.faults.arc - p.faults.lru);
  $("#phase-callout").innerHTML =
    `<b>Read it honestly.</b> In ${lost.map((p) => `"${esc(p.label)}"`).join(" and ") || "no phase"} LRU is ahead by ${given} ${given === 1 ? "fault" : "faults"} in total:
     that is LRU's home ground, and AdaptiCache spends a few faults learning it. In the scan and hot-set phases AdaptiCache saves ${gained}.
     No single fixed policy is best in every phase; the adaptive one is never far from the best and wins overall.`;
}
