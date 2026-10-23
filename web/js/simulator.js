// Simulator view (Module 5): input form, playback, side-by-side frame tables, and AdaptiCache's internals.

import { $, $$, ALGO, ORDER, algoChip, api, esc, fmtP, PHASE_FILL, pct, store } from "./util.js";
import { renderCacheLine, CACHELINE_LEGEND } from "./cacheline.js";

const WINDOW = 24;
let t = 0;
let playing = false;
let lastTick = 0;
let events = [];

export function initSimulator() {
  const sel = $("#f-preset");
  sel.innerHTML = store.presets.presets.map((p) => `<option value="${p.key}">${esc(p.name)}</option>`).join("")
    + `<option value="custom">Your own reference string</option>`;
  sel.value = "mixed";
  sel.onchange = onPresetChange;
  $("#f-frames").oninput = syncGhost;
  $("#f-ghost").oninput = syncGhost;
  $("#sim-form").onsubmit = (e) => { e.preventDefault(); run(); };
  $("#f-file").onchange = importFile;
  onPresetChange();

  $("#sim-cacheline").insertAdjacentHTML("afterend", CACHELINE_LEGEND);
  $("#p-play").onclick = () => setPlaying(!playing);
  $("#p-fwd").onclick = () => { setPlaying(false); seek(t + 1); };
  $("#p-back").onclick = () => { setPlaying(false); seek(t - 1); };
  $("#p-reset").onclick = () => { setPlaying(false); seek(0); };
  $("#p-scrub").oninput = (e) => { setPlaying(false); seek(+e.target.value); };
  $("#p-next-ghost").onclick = () => jumpGhost(1);
  $("#p-prev-ghost").onclick = () => jumpGhost(-1);
  $("#sim-events").onclick = (e) => { const b = e.target.closest("button[data-t]"); if (b) { setPlaying(false); seek(+b.dataset.t); } };
  document.addEventListener("keydown", onKey);
  requestAnimationFrame(loop);

  store.on((patch) => { if ("run" in patch) loadRun(); });
  if (store.run) loadRun();
}

function onPresetChange() {
  const key = $("#f-preset").value;
  const p = store.presets.presets.find((x) => x.key === key);
  const custom = key === "custom";
  $("#f-custom").classList.toggle("hidden", !custom);
  $("#f-seed-wrap").classList.toggle("hidden", custom || p?.fixed);
  $("#f-length-wrap").classList.toggle("hidden", custom || p?.fixed);
  if (p) {
    $("#f-frames").value = p.frames;
    if (p.length) $("#f-length").value = p.length;
  } else if (!$("#f-refs").value) {
    $("#f-refs").value = "7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1";
    $("#f-frames").value = 3;
  }
  $("#f-about").textContent = p ? p.about : "Type page numbers separated by spaces or commas, or import a trace file.";
  $("#f-ghost").value = $("#f-frames").value;
  syncGhost();
}

function syncGhost() {
  const frames = Math.max(1, Math.min(64, +$("#f-frames").value || 1));
  const g = $("#f-ghost");
  g.max = frames;
  if (+g.value > frames) g.value = frames;
  $("#f-ghost-out").textContent = +g.value === frames ? `${g.value} (standard)` : +g.value === 0 ? "0 (feedback off)" : g.value;
}

async function importFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2_000_000) return showError("That file is over 2 MB. Trim the trace and try again.");
  $("#f-refs").value = await file.text();
  $("#f-refs").dataset.label = file.name;
  showError("");
}

function showError(msg) {
  const el = $("#f-error");
  el.classList.toggle("hidden", !msg);
  el.innerHTML = msg ? `<p class="error-note">${esc(msg)}</p>` : "";
}

export function currentRequest() {
  const key = $("#f-preset").value;
  const req = { frames: +$("#f-frames").value, ghost: +$("#f-ghost").value };
  if (key === "custom") {
    req.refs_text = $("#f-refs").value;
    req.label = $("#f-refs").dataset.label || "Custom reference string";
  } else {
    req.preset = key;
    req.seed = +$("#f-seed").value;
    req.length = +$("#f-length").value;
  }
  return req;
}

export async function run(req = currentRequest()) {
  const btn = $("#f-run");
  btn.disabled = true;
  btn.textContent = "Running…";
  try {
    const result = await api("/api/simulate", req);
    showError("");
    store.set({ run: result, request: req });
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Run all four";
  }
}

// Keep the form in step with the run on screen, even when another page started it.
function syncForm(req) {
  if (!req) return;
  if (req.preset) {
    if ($("#f-preset").value !== req.preset) { $("#f-preset").value = req.preset; onPresetChange(); }
    if (req.seed !== undefined) $("#f-seed").value = req.seed;
    if (req.length !== undefined) $("#f-length").value = req.length;
  } else {
    if ($("#f-preset").value !== "custom") { $("#f-preset").value = "custom"; onPresetChange(); }
    $("#f-refs").value = req.refs_text;
    $("#f-refs").dataset.label = req.label || "";
  }
  $("#f-frames").value = req.frames ?? store.run.frames;
  $("#f-ghost").max = $("#f-frames").value;
  $("#f-ghost").value = req.ghost ?? store.run.ghost;
  syncGhost();
}

function loadRun() {
  const r = store.run;
  syncForm(store.request);
  setPlaying(false);
  $("#sim-stage").classList.remove("hidden");
  $("#p-scrub").max = r.refs.length - 1;
  $("#p-total").textContent = r.refs.length;

  events = [
    ...r.events.ghost_hits.map((g) => ({ t: g.t, text: `${g.case === "B1 ghost hit" ? "B1" : "B2"} ghost hit on page ${g.page}: p ${g.dp > 0 ? "up" : "down"} by ${fmtP(Math.abs(g.dp))}`, ghost: true })),
    ...r.events.crossings.map((c) => ({ t: c.t, text: c.text })),
  ].sort((a, b) => a.t - b.t);
  $("#sim-events").innerHTML = events.length
    ? events.map((e) => `<button data-t="${e.t}"><b>Step ${e.t + 1}</b>&nbsp; ${esc(e.text)}</button>`).join("")
    : `<p class="small muted">No ghost hits in this run: with ghost capacity ${r.ghost} the tuner gets no feedback.</p>`;
  $("#p-next-ghost").disabled = $("#p-prev-ghost").disabled = !r.events.ghost_hits.length;

  const n = r.refs.length;
  $("#phase-strip").innerHTML = r.phases.map((p) => `<span style="width:${((p.end - p.start) / n) * 100}%;background:${PHASE_FILL[p.kind]}"></span>`).join("");
  $("#phase-strip-labels").innerHTML = r.phases.length > 1
    ? r.phases.map((p) => `<span style="width:${((p.end - p.start) / n) * 100}%">${esc(p.label)}</span>`).join("")
    : "";

  $("#lanes").innerHTML = ORDER.map((k) => `
    <div class="lane c-${k}" data-k="${k}">
      <div class="lane-head">
        ${algoChip(k)}<span class="outcome"></span>
        <span class="stats"><span>Faults <b class="f">0</b></span><span>Hit ratio <b class="h">0%</b></span></span>
      </div>
      <div class="tsd"></div>
    </div>`).join("");
  seek(0);
}

function seek(i) {
  const r = store.run;
  if (!r) return;
  t = Math.max(0, Math.min(r.refs.length - 1, i));
  render();
}

function render() {
  const r = store.run;
  const n = r.refs.length;
  const arcStep = r.engines.arc.steps[t];

  $("#p-scrub").value = t;
  $("#p-step").textContent = t + 1;
  $("#p-page").textContent = r.refs[t];
  const ph = r.phases.find((p) => t >= p.start && t < p.end);
  $("#p-phase").textContent = r.phases.length > 1 && ph ? `Phase: ${ph.label}` : "";

  const ghostAt = new Set(r.events.ghost_hits.map((g) => g.t));
  const lo = Math.max(0, t - 14), hi = Math.min(n, lo + 34);
  $("#reftape").innerHTML = r.refs.slice(lo, hi)
    .map((p, j) => `<span class="${lo + j === t ? "now" : ""}${ghostAt.has(lo + j) ? " ghosted" : ""}">${p}</span>`).join("");

  const w = Math.min(WINDOW, n);
  const start = Math.max(0, Math.min(t - Math.floor(w * 0.7), n - w));
  for (const k of ORDER) renderLane(k, start, w);

  renderCacheLine($("#sim-cacheline"), arcStep, r.frames, r.ghost);
  $("#sim-p").textContent = fmtP(arcStep.p);
  const caseTag = arcStep.hit ? "hit" : arcStep.case.includes("ghost") ? "ghost" : "fault";
  $("#sim-case").innerHTML = `<span class="tag ${caseTag}">${esc(arcStep.case)}</span>`
    + (arcStep.dp ? ` <span class="small muted">p ${arcStep.dp > 0 ? "+" : ""}${fmtP(arcStep.dp)}</span>` : "");

  $("#sim-notes").innerHTML = ORDER.map((k) => {
    const s = r.engines[k].steps[t];
    return `<div class="note-row">${algoChip(k)}<p>${esc(s.note)}</p></div>`;
  }).join("");
}

function renderLane(k, start, w) {
  const r = store.run;
  const e = r.engines[k];
  const lane = $(`.lane[data-k="${k}"]`);
  const s = e.steps[t];
  lane.querySelector(".f").textContent = e.cum_faults[t];
  lane.querySelector(".h").textContent = pct((t + 1 - e.cum_faults[t]) / (t + 1));
  lane.querySelector(".outcome").innerHTML = s.hit
    ? `<span class="tag hit">Hit</span>`
    : `<span class="tag fault">Fault${s.evicted !== null ? `, evicted ${esc(s.evicted)}` : ""}</span>`;

  const rows = Math.min(r.frames, 16);
  const cols = [];
  let html = `<span class="rl"></span>`;
  for (let j = start; j < start + w; j++) {
    html += `<span class="h page${j === t ? " now" : ""}" style="${j > t ? "opacity:.35" : ""}">${r.refs[j]}</span>`;
    cols.push(j);
  }
  for (let row = 0; row < rows; row++) {
    html += `<span class="rl">Frame ${row}</span>`;
    for (const j of cols) {
      if (j > t) { html += `<span class="c e"></span>`; continue; }
      const st = e.steps[j];
      const pg = st.frames[row];
      let cls = pg === null ? "c e" : "c";
      if (st.slot === row) cls += st.hit ? " hh" : " f";
      if (j === t && st.slot === row) cls += " cur";
      html += `<span class="${cls}">${pg ?? ""}</span>`;
    }
  }
  html += `<span class="rl"></span>`;
  for (const j of cols) {
    html += j > t ? `<span class="mark"></span>` : `<span class="mark"><i class="${e.steps[j].hit ? "ok" : ""}"></i></span>`;
  }
  const tsd = lane.querySelector(".tsd");
  tsd.style.setProperty("--w", w);
  tsd.innerHTML = html;
  if (r.frames > rows && !lane.querySelector(".more")) {
    tsd.insertAdjacentHTML("afterend", `<p class="small muted more">Showing frames 0 to 15 of ${r.frames}.</p>`);
  }
}

function setPlaying(on) {
  if (on && store.run && t >= store.run.refs.length - 1) seek(0);
  playing = on && !!store.run;
  $("#p-play").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("#p-play-icon").innerHTML = playing
    ? `<path d="M6 4h3v12H6zM11 4h3v12h-3z" fill="currentColor"/>`
    : `<path d="M6 4v12l10-6z" fill="currentColor"/>`;
}

function loop(now) {
  if (playing && store.run) {
    const speed = +$("#p-speed").value;
    if (now - lastTick >= 1000 / speed) {
      lastTick = now;
      if (t >= store.run.refs.length - 1) setPlaying(false);
      else seek(t + 1);
    }
  }
  requestAnimationFrame(loop);
}

function jumpGhost(dir) {
  const hits = store.run?.events.ghost_hits.map((g) => g.t) || [];
  const target = dir > 0 ? hits.find((x) => x > t) : [...hits].reverse().find((x) => x < t);
  setPlaying(false);
  if (target !== undefined) seek(target);
}

function onKey(e) {
  if ($("#view-simulate").classList.contains("hidden") || !store.run || e.target.id === "p-speed") return;
  if (e.target.closest("input, textarea, select") && e.target.type !== "range") return;
  if (e.target.closest("button") && (e.key === " " || e.key === "Enter")) return;
  const keys = {
    " ": () => setPlaying(!playing),
    ArrowRight: () => { setPlaying(false); seek(t + 1); },
    ArrowLeft: () => { setPlaying(false); seek(t - 1); },
    Home: () => { setPlaying(false); seek(0); },
    End: () => { setPlaying(false); seek(store.run.refs.length - 1); },
    g: () => jumpGhost(1),
    G: () => jumpGhost(-1),
  };
  if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
}
