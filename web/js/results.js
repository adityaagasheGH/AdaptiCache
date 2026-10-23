// Results view (Module 6): the claim, summary table, charts, phase breakdown, and exports.

import { $, ALGO, ORDER, algoChip, download, esc, pct, plural, saveBlob, store } from "./util.js";
import { lineChart } from "./charts.js";
import { phaseTable } from "./case.js";

export function initResults() {
  $("#x-trace").onclick = () => exportCsv("trace");
  $("#x-summary").onclick = () => exportCsv("summary");
  $("#x-json").onclick = () => {
    const blob = new Blob([JSON.stringify({ request: store.request, ...store.run }, null, 1)], { type: "application/json" });
    saveBlob(blob, "adapticache-run.json");
  };
  $("#x-print").onclick = () => {
    const view = $("#view-results");
    view.classList.add("printing");
    window.print();
    view.classList.remove("printing");
  };
  store.on((patch) => { if ("run" in patch) render(); });
}

async function exportCsv(kind) {
  const btn = $(kind === "trace" ? "#x-trace" : "#x-summary");
  btn.disabled = true;
  try {
    await download(`/api/export?kind=${kind}`, store.request, `adapticache-${kind}.csv`);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

export function render() {
  const r = store.run;
  if (!r) return;
  // Charts measure their container, so draw only while the view is on screen.
  if ($("#view-results").classList.contains("hidden")) { render.pending = true; return; }
  render.pending = false;
  $("#r-empty").classList.add("hidden");

  const n = r.refs.length;
  $("#r-title").textContent = r.label;
  $("#r-meta").textContent = `${n} references, ${plural(r.frames, "frame")}, ghost list capacity ${r.ghost}`;

  $("#r-claim").innerHTML = claimHtml(r);

  $("#r-summary").innerHTML = summaryTable(r);

  $("#r-legend").innerHTML = ORDER.map((k) => algoChip(k)).join("");
  const crossings = r.events.crossings.filter((c) => c.kind === "ahead").slice(0, 1);
  lineChart($("#r-cum"), {
    series: ORDER.map((k) => ({ key: k, label: ALGO[k].name, color: ALGO[k].color, dash: ALGO[k].dash, values: r.engines[k].cum_faults })),
    phases: r.phases,
    markers: crossings.map((c) => ({ x: c.t, label: `AdaptiCache ahead from step ${c.t + 1}` })),
    xLabel: "Reference (step)",
    yLabel: "Faults so far",
    height: 320,
    aria: "Cumulative page faults for all four algorithms",
  });

  lineChart($("#r-lead"), {
    series: [{ key: "arc", label: "Faults saved", color: ALGO.arc.color, values: r.lead }],
    phases: r.phases,
    zeroLine: true,
    xLabel: "Reference (step)",
    yLabel: "LRU minus AdaptiCache",
    height: 240,
    aria: "Faults saved by AdaptiCache compared with LRU over time",
  });

  lineChart($("#r-p"), {
    series: [{ key: "arc", label: "p", color: ALGO.arc.color, values: r.engines.arc.steps.map((s) => s.p), step: true }],
    phases: r.phases,
    ticks: r.events.ghost_hits.map((g) => ({ x: g.t, dir: g.dp > 0 ? 1 : -1 })),
    yMin: 0,
    yMax: r.frames,
    xLabel: "Reference (step)",
    yLabel: "p (T1 target)",
    height: 240,
    aria: "The tuning parameter p over time with ghost hits marked",
  });

  $("#r-phases").innerHTML = phaseTable(r);
}

// Shared with the Evaluation page.
export function claimHtml(r) {
  const f = Object.fromEntries(ORDER.map((k) => [k, r.engines[k].summary.faults]));
  const h = r.headline;
  const saved = f.lru - f.arc;
  if (saved > 0) {
    return `AdaptiCache made <em>${saved} fewer faults</em> than LRU (${h.arc_vs_lru_pct}%)` +
      (h.gap_closed_pct !== null ? ` and closed ${h.gap_closed_pct}% of the gap between LRU and the optimum.` : ".");
  }
  if (saved === 0) return "AdaptiCache and LRU made the same number of faults on this string.";
  return `On this string LRU made ${-saved} fewer faults than AdaptiCache (${-h.arc_vs_lru_pct}%). ` +
    "Recency is the right bet here, and the adaptive engine pays a small price to learn that.";
}

export function summaryTable(r) {
  const f = Object.fromEntries(ORDER.map((k) => [k, r.engines[k].summary.faults]));
  const max = Math.max(...Object.values(f), 1);
  return `
    <tr><th>Algorithm</th><th>What it does</th><th class="num">Faults</th><th style="width:28%"></th><th class="num">Hits</th><th class="num">Hit ratio</th><th class="num">vs LRU</th></tr>
    ${ORDER.map((k) => {
      const s = r.engines[k].summary;
      const d = f.lru - s.faults;
      return `<tr class="${k === "arc" ? "highlight" : ""}">
        <td>${algoChip(k)}</td>
        <td class="small muted">${esc(r.engines[k].blurb)}</td>
        <td class="num"><b>${s.faults}</b></td>
        <td><div class="bar c-${k}" style="width:${(s.faults / max) * 100}%;${k === "opt" ? "background:repeating-linear-gradient(90deg,var(--opt) 0 6px,transparent 6px 9px)" : ""}"></div></td>
        <td class="num">${s.hits}</td>
        <td class="num">${pct(s.hit_ratio)}</td>
        <td class="num ${k === "lru" ? "" : d > 0 ? "best" : d < 0 ? "worse" : ""}">${k === "lru" ? "" : d > 0 ? `${d} fewer` : d < 0 ? `${-d} more` : "level"}</td>
      </tr>`;
    }).join("")}`;
}
