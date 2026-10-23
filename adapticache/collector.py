"""Module 4: trace and metrics collector.

All engines are measured here by identical rules, never inside the engines themselves.
"""

import csv
import io

from .engines import ENGINES, ORDER, run_engine


def simulate(refs, frames, ghost=None, phases=None):
    runs = {key: run_engine(key, refs, frames, ghost) for key in ORDER}
    return collect(refs, runs, frames, ghost, phases)


def _summary(steps):
    n = len(steps)
    faults = sum(not s["hit"] for s in steps)
    return {
        "faults": faults,
        "hits": n - faults,
        "hit_ratio": round((n - faults) / n, 4) if n else 0.0,
        "fault_ratio": round(faults / n, 4) if n else 0.0,
    }


def _cumulative(steps):
    out, total = [], 0
    for s in steps:
        total += not s["hit"]
        out.append(total)
    return out


def _crossings(lead):
    """Indices where AdaptiCache moves ahead of LRU (lead > 0) or falls back (lead <= 0)."""
    events, ahead = [], False
    for t, gap in enumerate(lead):
        if gap > 0 and not ahead:
            events.append({"t": t, "kind": "ahead", "text": f"AdaptiCache pulls ahead of LRU at step {t + 1}."})
            ahead = True
        elif gap <= 0 and ahead:
            events.append({"t": t, "kind": "behind", "text": f"LRU draws level again at step {t + 1}."})
            ahead = False
    return events


def collect(refs, runs, frames, ghost=None, phases=None):
    engines = {}
    for key in ORDER:
        steps = runs[key]
        engines[key] = {
            "key": key,
            "name": ENGINES[key]["name"],
            "blurb": ENGINES[key]["blurb"],
            "steps": steps,
            "cum_faults": _cumulative(steps),
            "summary": _summary(steps),
        }

    lru_cum, arc_cum = engines["lru"]["cum_faults"], engines["arc"]["cum_faults"]
    lead = [l - a for l, a in zip(lru_cum, arc_cum)]
    arc_steps = engines["arc"]["steps"]
    ghost_hits = [{"t": s["t"], "case": s["case"], "page": s["page"], "dp": s["dp"]}
                  for s in arc_steps if s["case"].endswith("ghost hit")]

    phases = phases or [{"start": 0, "end": len(refs), "label": "Whole trace", "kind": "fixed"}]
    for ph in phases:
        ph["faults"] = {
            key: engines[key]["cum_faults"][ph["end"] - 1] -
                 (engines[key]["cum_faults"][ph["start"] - 1] if ph["start"] else 0)
            for key in ORDER
        } if ph["end"] > ph["start"] else {key: 0 for key in ORDER}

    f = {key: engines[key]["summary"]["faults"] for key in ORDER}
    gap = f["lru"] - f["opt"]
    headline = {
        "faults": f,
        "arc_vs_lru_pct": round(100 * (f["lru"] - f["arc"]) / f["lru"], 1) if f["lru"] else 0.0,
        "gap_closed_pct": round(100 * (f["lru"] - f["arc"]) / gap, 1) if gap > 0 else None,
        "best_practical": min(("fifo", "lru", "arc"), key=lambda k: (f[k], k != "arc")),
    }

    return {
        "refs": refs,
        "frames": frames,
        "ghost": frames if ghost is None else ghost,
        "order": ORDER,
        "engines": engines,
        "lead": lead,
        "phases": phases,
        "events": {"crossings": _crossings(lead), "ghost_hits": ghost_hits},
        "headline": headline,
    }


def _frames_text(frames):
    return " ".join("-" if p is None else str(p) for p in frames)


def trace_csv(result):
    buf = io.StringIO()
    w = csv.writer(buf)
    header = ["step", "page"]
    for key in ORDER:
        name = result["engines"][key]["name"]
        header += [f"{name} result", f"{name} evicted", f"{name} frames"]
    header += ["AdaptiCache case", "AdaptiCache p", "T1", "T2", "B1", "B2"]
    w.writerow(header)
    for t, page in enumerate(result["refs"]):
        row = [t + 1, page]
        for key in ORDER:
            s = result["engines"][key]["steps"][t]
            row += ["HIT" if s["hit"] else "FAULT", "" if s["evicted"] is None else s["evicted"],
                    _frames_text(s["frames"])]
        a = result["engines"]["arc"]["steps"][t]
        row += [a["case"], a["p"]] + [" ".join(map(str, a[k])) for k in ("t1", "t2", "b1", "b2")]
        w.writerow(row)
    return buf.getvalue()


def summary_csv(result):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["algorithm", "faults", "hits", "hit ratio", "fault ratio", "references", "frames"])
    for key in ORDER:
        e = result["engines"][key]
        s = e["summary"]
        w.writerow([e["name"], s["faults"], s["hits"], s["hit_ratio"], s["fault_ratio"],
                    len(result["refs"]), result["frames"]])
    w.writerow([])
    w.writerow(["phase", "start step", "end step"] + [result["engines"][k]["name"] + " faults" for k in ORDER])
    for ph in result["phases"]:
        w.writerow([ph["label"], ph["start"] + 1, ph["end"]] + [ph["faults"][k] for k in ORDER])
    return buf.getvalue()
