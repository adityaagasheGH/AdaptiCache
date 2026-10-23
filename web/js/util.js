// Small shared helpers: DOM, API calls, algorithm identity, and the shared run store.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const ORDER = ["fifo", "lru", "arc", "opt"];
export const ALGO = {
  fifo: { name: "FIFO", color: "var(--fifo)" },
  lru: { name: "LRU", color: "var(--lru)" },
  arc: { name: "AdaptiCache", color: "var(--arc)" },
  opt: { name: "OPT", color: "var(--opt)", dash: "5 4" },
};

export const algoChip = (key, label = ALGO[key].name) =>
  `<span class="algo c-${key}${key === "opt" ? " opt" : ""}">${esc(label)}</span>`;

export const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;
export const fmtP = (p) => (Math.round(p * 100) / 100).toString();
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export async function api(path, body) {
  const opts = body === undefined
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error("The AdaptiCache server is not reachable. Start it with: python run.py");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
}

export async function download(path, body, filename) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Export failed.");
  saveBlob(await res.blob(), filename);
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// One shared simulation run, read by the Simulator and Results views.
export const store = {
  presets: null,
  run: null,
  request: null,
  listeners: new Set(),
  set(patch) {
    Object.assign(this, patch);
    this.listeners.forEach((fn) => fn(patch));
  },
  on(fn) {
    this.listeners.add(fn);
  },
};

export const PHASE_CLASS = { locality: "ph-locality", scan: "ph-scan", frequency: "ph-frequency", fixed: "ph-fixed" };
export const PHASE_FILL = {
  locality: "var(--ph-locality)", scan: "var(--ph-scan)", frequency: "var(--ph-frequency)", fixed: "var(--ph-fixed)",
};
