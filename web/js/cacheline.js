// The adaptive engine drawn the way ARC is usually explained:
//
//   [ B1 ghosts ] [ T1 recency -> | <- T2 frequency ] [ B2 ghosts ]
//
// Both LRU ends point outward, so an evicted page visibly drops into the ghost list on its side.
// The marker under the bar is p, the target size of T1.

import { esc, fmtP } from "./util.js";

// The number shrinks with its digit count so 3-digit pages still fit a narrow tile.
const num = (pg) => `<b class="n" style="--n:${String(pg).length}">${esc(pg)}</b>`;

export function renderCacheLine(el, step, c, g, { prevEvicted = true } = {}) {
  const { t1, t2, b1, b2, p, page, hit, evicted } = step;
  const tiles = [];
  const ghostTile = (pg) =>
    pg === undefined
      ? `<div class="cl-tile ghost-empty"></div>`
      : `<div class="cl-tile ghost${prevEvicted && pg === evicted ? " just-evicted" : ""}" title="Ghost of page ${pg}">${num(pg)}</div>`;

  if (g > 0) {
    // B1: LRU at the far left, most recent next to T1.
    const pad = Math.max(0, g - b1.length);
    for (let i = 0; i < pad; i++) tiles.push(ghostTile());
    b1.slice(-g).forEach((pg) => tiles.push(ghostTile(pg)));
    tiles.push(`<div class="cl-divider"></div>`);
  }

  const now = (pg) => (pg === page ? (hit ? " now-hit" : " now-fault") : "");
  t1.forEach((pg) => tiles.push(`<div class="cl-tile t1${now(pg)}" title="Page ${pg} in T1">${num(pg)}</div>`));
  for (let i = 0; i < c - t1.length - t2.length; i++) tiles.push(`<div class="cl-tile slot-empty"></div>`);
  [...t2].reverse().forEach((pg) => tiles.push(`<div class="cl-tile t2${now(pg)}" title="Page ${pg} in T2">${num(pg)}</div>`));

  if (g > 0) {
    tiles.push(`<div class="cl-divider"></div>`);
    [...b2].reverse().slice(0, g).forEach((pg) => tiles.push(ghostTile(pg)));
    for (let i = 0; i < Math.max(0, g - b2.length); i++) tiles.push(ghostTile());
  }

  // Resident tiles get more width than ghosts, more so when the bar is crowded.
  const dense = 2 * g + c > 18;
  const scale = g > 0 ? (dense ? 1.6 : 1.25) : 1;
  const cols = g > 0
    ? `repeat(${g}, minmax(0, 1fr)) 2px repeat(${c}, minmax(0, ${scale}fr)) 2px repeat(${g}, minmax(0, 1fr))`
    : `repeat(${c}, minmax(0, 1fr))`;
  // Position of p: share of the track before the cache plus p/c of the cache region.
  const units = g > 0 ? 2 * g + scale * c : c;
  const before = g > 0 ? g : 0;
  const left = ((before + scale * p) / units) * 100;

  const cache = `<span style="grid-column: span ${c}; display:flex; justify-content:space-between; padding: 0 2px">
         <span>T1 <b>${t1.length}</b></span><span>T2 <b>${t2.length}</b></span></span>`;
  const labels = g > 0
    ? `<span style="grid-column: span ${g}">B1 <b>${b1.length}</b></span><span></span>${cache}<span></span>
       <span style="grid-column: span ${g}">B2 <b>${b2.length}</b></span>`
    : cache;

  el.innerHTML = `
    <div class="cacheline${dense ? " dense" : ""}" style="--cols:${cols}">
      <div class="cl-labels">${labels}</div>
      <div class="cl-track">
        ${tiles.join("")}
        <span class="cl-p" style="left:${left}%">p = ${fmtP(p)}</span>
      </div>
    </div>`;
}

export const CACHELINE_LEGEND = `
  <div class="cl-legend">
    <span><i style="background:var(--t1-bg);box-shadow:inset 0 0 0 1.5px var(--t1)"></i>T1, seen once</span>
    <span><i style="background:var(--t2)"></i>T2, seen twice or more</span>
    <span><i style="border:1.5px dashed var(--ghost)"></i>B1, B2: ghosts, page number only</span>
    <span style="color:var(--arc);font-weight:700">p: target size of T1</span>
  </div>`;
