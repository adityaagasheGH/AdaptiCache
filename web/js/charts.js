// A small SVG line chart. No library, so the site works offline on a lab machine.
//
// lineChart(el, {
//   series: [{ key, label, color, values, dash, width, step }],
//   x: [...] optional x values (defaults to 1..n),
//   phases: [{ start, end, label, kind }]   shaded bands, in step indices
//   markers: [{ x, label }]                 vertical annotations
//   ticks: [{ x, dir: 1 | -1 }]             small up/down ticks along the bottom
//   yLabel, xLabel, height, yMin, zeroLine, fmt
// })

import { esc, PHASE_FILL } from "./util.js";

const charts = new Map();
const ro = new ResizeObserver((entries) => {
  for (const e of entries) {
    const opts = charts.get(e.target);
    if (opts && Math.abs((opts._w || 0) - e.contentRect.width) > 4) draw(e.target, opts);
  }
});

export function lineChart(el, opts) {
  charts.set(el, opts);
  ro.observe(el);
  draw(el, opts);
}

function niceTicks(lo, hi, count = 5, integer = true) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => Math.max(m * mag, integer ? 1 : 0)).find((s) => span / s <= count) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function draw(el, o) {
  const W = Math.max(280, el.clientWidth || 800);
  o._w = W;
  const H = o.height || 280;
  const m = { t: o.phases?.length > 1 ? 24 : 12, r: 16, b: o.xLabel ? 44 : 28, l: o.yLabel ? 58 : 44 };
  const n = Math.max(...o.series.map((s) => s.values.length));
  const xs = o.x || Array.from({ length: n }, (_, i) => i + 1);
  const all = o.series.flatMap((s) => s.values);
  let yMin = o.yMin ?? Math.min(0, ...all);
  let yMax = Math.max(...all, yMin + 1);
  if (o.yMax !== undefined) yMax = o.yMax;
  const yt = niceTicks(yMin, yMax, 5, !o.fractional);
  yMax = Math.max(yMax, yt[yt.length - 1]);
  yMin = Math.min(yMin, yt[0]);

  const x0 = xs[0], x1 = xs[xs.length - 1];
  const sx = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const sy = (v) => H - m.b - ((v - yMin) / (yMax - yMin || 1)) * (H - m.t - m.b);
  const idxX = (i) => sx(xs[i]);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "Line chart")}">`;

  for (const ph of o.phases || []) {
    const a = idxX(ph.start), b = idxX(Math.min(ph.end, n) - 1);
    svg += `<rect x="${a}" y="${m.t}" width="${Math.max(1, b - a)}" height="${H - m.t - m.b}" style="fill:${PHASE_FILL[ph.kind] || "var(--ph-fixed)"}" opacity="0.38"/>`;
    if (o.phases.length > 1 && b - a > 60)
      svg += `<text class="phase-label" x="${a + 6}" y="${m.t - 8}">${esc(ph.label)}</text>`;
  }

  svg += `<g class="grid">${yt.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}"/>`).join("")}</g>`;
  svg += `<g class="axis">`;
  svg += yt.map((v) => `<text x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end">${o.fmt ? o.fmt(v) : v}</text>`).join("");
  const xt = o.x ? xs.filter((_, i) => xs.length <= 26 || i % Math.ceil(xs.length / 12) === 0) : niceTicks(x0, x1, 8).filter((v) => v >= x0);
  svg += xt.map((v) => `<text x="${sx(v)}" y="${H - m.b + 18}" text-anchor="middle">${v}</text>`).join("");
  svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
  if (o.zeroLine && yMin < 0) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}" stroke-dasharray="4 3"/>`;
  svg += `</g>`;
  if (o.yLabel) svg += `<text class="axis-title" transform="translate(14 ${(H - m.b + m.t) / 2}) rotate(-90)" text-anchor="middle">${esc(o.yLabel)}</text>`;
  if (o.xLabel) svg += `<text class="axis-title" x="${(W + m.l) / 2}" y="${H - 6}" text-anchor="middle">${esc(o.xLabel)}</text>`;

  for (const s of o.series) {
    let d = "";
    s.values.forEach((v, i) => {
      const X = idxX(i), Y = sy(v);
      if (i === 0) d += `M${X},${Y}`;
      else if (s.step) d += `H${X}V${Y}`;
      else d += `L${X},${Y}`;
    });
    svg += `<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="${s.width || 2.2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
    if (s.dots) s.values.forEach((v, i) => (svg += `<circle cx="${idxX(i)}" cy="${sy(v)}" r="3.5" style="fill:${s.color}"/>`));
  }

  for (const t of o.ticks || []) {
    const X = idxX(t.x), Y = H - m.b;
    svg += t.dir > 0
      ? `<path d="M${X - 4},${Y - 2} L${X},${Y - 9} L${X + 4},${Y - 2}Z" style="fill:var(--arc)"/>`
      : `<path d="M${X - 4},${Y - 9} L${X},${Y - 2} L${X + 4},${Y - 9}Z" style="fill:var(--lru)"/>`;
  }

  for (const mk of o.markers || []) {
    const X = idxX(mk.x);
    svg += `<line x1="${X}" x2="${X}" y1="${m.t}" y2="${H - m.b}" stroke="var(--hit)" stroke-width="1.5" stroke-dasharray="2 3" style="stroke:var(--hit)"/>`;
    if (mk.label) svg += `<text class="marker-label" x="${X + 6}" y="${m.t + 14}">${esc(mk.label)}</text>`;
    if (mk.dot !== undefined) svg += `<circle cx="${X}" cy="${sy(mk.dot)}" r="5" fill="none" stroke-width="2" style="stroke:var(--fault)"/>`;
  }

  svg += `<line class="cursor" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>`;
  svg += `<rect class="hover" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>`;
  svg += `</svg>`;
  el.innerHTML = svg + `<div class="tooltip" hidden></div>`;

  const svgEl = el.querySelector("svg");
  const cursor = el.querySelector(".cursor");
  const tip = el.querySelector(".tooltip");
  const hover = el.querySelector(".hover");
  hover.addEventListener("mousemove", (ev) => {
    const r = svgEl.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const v = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    let i = xs.findIndex((x) => x >= v);
    if (i < 0) i = xs.length - 1;
    if (i > 0 && Math.abs(xs[i - 1] - v) < Math.abs(xs[i] - v)) i--;
    const X = idxX(i);
    cursor.setAttribute("x1", X);
    cursor.setAttribute("x2", X);
    cursor.setAttribute("visibility", "visible");
    const head = o.tipHead ? o.tipHead(xs[i], i) : `${o.xName || "Step"} ${xs[i]}`;
    tip.innerHTML = `<b>${esc(head)}</b><br>` + o.series
      .filter((s) => s.values[i] !== undefined)
      .map((s) => `<span class="algo c-${s.key}${s.key === "opt" ? " opt" : ""}">${esc(s.label)}</span> ${o.fmt ? o.fmt(s.values[i]) : s.values[i]}`)
      .join("<br>");
    tip.hidden = false;
    const left = (X / W) * r.width;
    tip.style.left = `${left > r.width * 0.65 ? left - tip.offsetWidth - 24 : left}px`;
    tip.style.top = `${((ev.clientY - r.top) / r.height) * r.height}px`;
  });
  hover.addEventListener("mouseleave", () => {
    tip.hidden = true;
    cursor.setAttribute("visibility", "hidden");
  });
}
