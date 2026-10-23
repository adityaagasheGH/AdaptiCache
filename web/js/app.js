// Entry point: loads presets, runs the default mixed workload, and switches views by URL hash.

import { $, $$, api, esc, store } from "./util.js";
import { initCase } from "./case.js";
import { initSimulator } from "./simulator.js";
import { initResults, render as renderResults } from "./results.js";
import { initEvaluation, showEvaluation } from "./evaluation.js";

const ROUTES = ["case", "simulate", "results", "evaluation"];
const DEFAULT_RUN = { preset: "mixed", seed: 7, length: 600, frames: 8, ghost: 8 };

function route() {
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1];
  const view = ROUTES.includes(name) ? name : "case";
  for (const r of ROUTES) $(`#view-${r}`).classList.toggle("hidden", r !== view);
  $$(".nav a").forEach((a) => (a.getAttribute("aria-current") === "page" && a.removeAttribute("aria-current"),
    a.dataset.route === view && a.setAttribute("aria-current", "page")));
  if (view === "results" && renderResults.pending !== false) renderResults();
  if (view === "evaluation") showEvaluation();
  if (!location.hash.startsWith("#/") || name) window.scrollTo(0, 0);
}

async function main() {
  // In-page anchors (like "#how") scroll within The case instead of changing view.
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]:not([href^="#/"])');
    if (!a) return;
    e.preventDefault();
    if (!location.hash.startsWith("#/case") && location.hash) location.hash = "#/case";
    setTimeout(() => document.querySelector(a.getAttribute("href"))?.scrollIntoView(), 0);
  });
  window.addEventListener("hashchange", route);

  try {
    store.presets = await api("/api/presets");
    const mixed = await api("/api/simulate", DEFAULT_RUN);
    initSimulator();
    initResults();
    initEvaluation();
    store.set({ run: mixed, request: DEFAULT_RUN });
    route();
    await initCase(mixed);
  } catch (err) {
    $("main").insertAdjacentHTML("afterbegin",
      `<div class="wrap" style="padding-top:24px"><p class="error-note">${esc(err.message)}</p></div>`);
    route();
  }
}

main();
