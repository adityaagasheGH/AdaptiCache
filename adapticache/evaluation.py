"""Experiments that back the project's central claim with more than one lucky run.

    evaluate   everything below, applied to one reference string the user supplies
    profile    what a reference string looks like: one-off pages, hot set, scans, reuse distance
    sweep      faults against memory size, for one reference string (miss-ratio curve)
    benchmark  every synthetic workload over many seeds, with win/tie/loss counts
    ablation   AdaptiCache with its ghost lists shrunk or switched off
    belady     FIFO and LRU across frame counts, flagging Belady's anomaly
"""

from collections import Counter
from statistics import mean, median

from . import verify
from .engines import ORDER, run_engine
from .workloads import PRESETS, generate

MAX_SWEEP_POINTS = 24

GENERATED = [k for k in PRESETS if "gen" in PRESETS[k]]


def _faults(key, refs, frames, ghost=None):
    return sum(not s["hit"] for s in run_engine(key, refs, frames, ghost))


def sweep(refs, frame_counts, ghost_ratio=1.0):
    series = {key: [] for key in ORDER}
    for f in frame_counts:
        ghost = round(f * ghost_ratio)
        for key in ORDER:
            series[key].append(_faults(key, refs, f, ghost))
    return {"frames": list(frame_counts), "series": series, "n": len(refs)}


def benchmark(seeds=range(10), frames=8):
    rows = []
    for preset in GENERATED:
        per = {key: [] for key in ORDER}
        n = 0
        for seed in seeds:
            refs, _ = generate(preset, seed)
            n = len(refs)
            for key in ORDER:
                per[key].append(_faults(key, refs, frames))
        wins = sum(a < l for a, l in zip(per["arc"], per["lru"]))
        ties = sum(a == l for a, l in zip(per["arc"], per["lru"]))
        m = {key: mean(v) for key, v in per.items()}
        gap = m["lru"] - m["opt"]
        rows.append({
            "preset": preset,
            "name": PRESETS[preset]["name"],
            "refs": n,
            "mean_faults": {k: round(v, 1) for k, v in m.items()},
            "mean_fault_ratio": {k: round(v / n, 4) for k, v in m.items()},
            "min_faults": {k: min(v) for k, v in per.items()},
            "max_faults": {k: max(v) for k, v in per.items()},
            "arc_vs_lru_pct": round(100 * (m["lru"] - m["arc"]) / m["lru"], 1),
            "gap_closed_pct": round(100 * (m["lru"] - m["arc"]) / gap, 1) if gap > 0 else None,
            "wins": wins, "ties": ties, "losses": len(per["arc"]) - wins - ties,
        })
    return {"frames": frames, "seeds": len(list(seeds)), "rows": rows}


def ablation(seeds=range(10), frames=8):
    """Mean faults of AdaptiCache with ghost capacity 0, c/4, c/2 and c, beside LRU."""
    caps = sorted({0, frames // 4, frames // 2, frames})
    rows = []
    for preset in GENERATED:
        lru, by_cap = [], {c: [] for c in caps}
        for seed in seeds:
            refs, _ = generate(preset, seed)
            lru.append(_faults("lru", refs, frames))
            for c in caps:
                by_cap[c].append(_faults("arc", refs, frames, c))
        rows.append({
            "preset": preset,
            "name": PRESETS[preset]["name"],
            "lru": round(mean(lru), 1),
            "arc": {str(c): round(mean(v), 1) for c, v in by_cap.items()},
        })
    return {"frames": frames, "caps": caps, "rows": rows}


def belady(refs, max_frames=7):
    counts = list(range(1, max_frames + 1))
    out = {"frames": counts, "fifo": [], "lru": [], "anomalies": []}
    for f in counts:
        out["fifo"].append(_faults("fifo", refs, f))
        out["lru"].append(_faults("lru", refs, f))
    for i in range(1, len(counts)):
        if out["fifo"][i] > out["fifo"][i - 1]:
            out["anomalies"].append({"from": counts[i - 1], "to": counts[i],
                                     "faults_from": out["fifo"][i - 1], "faults_to": out["fifo"][i]})
    return out


# ---------- evaluating one user-supplied reference string ----------

def frame_grid(frames, distinct):
    """Memory sizes to sweep: 1 up to well past the chosen size, at most MAX_SWEEP_POINTS of them.

    Sizes beyond the number of distinct pages are pointless (only first-touch faults remain),
    so the sweep stops one past that. The chosen size is always included.
    """
    hi = max(frames, min(64, max(2 * frames, 16), distinct + 1))
    if hi <= MAX_SWEEP_POINTS:
        grid = set(range(1, hi + 1))
    else:
        step = (hi - 1) / (MAX_SWEEP_POINTS - 1)
        grid = {round(1 + i * step) for i in range(MAX_SWEEP_POINTS)}
    grid.add(frames)
    return sorted(grid)


def profile(refs, frames):
    """Describe the string in the terms that decide which policy wins."""
    n = len(refs)
    counts = Counter(refs)
    distinct = len(counts)
    one_off_pages = sum(1 for v in counts.values() if v == 1)

    top = max(1, round(distinct * 0.1))
    hot_share = sum(v for _, v in counts.most_common(top)) / n

    # LRU stack distance of every re-reference: how many other pages were touched in between.
    stack, dists = [], []
    for p in refs:
        try:
            d = stack.index(p)
            dists.append(d)
            del stack[d]
        except ValueError:
            pass
        stack.insert(0, p)
    near = sum(d < frames for d in dists)

    # Sequential runs of fresh pages (each page +1 from the last): the signature of a scan.
    longest = run = 1
    long_runs = 0
    for a, b in zip(refs, refs[1:]):
        run = run + 1 if b == a + 1 else 1
        if run == frames + 1:
            long_runs += 1
        longest = max(longest, run)

    hints = []
    if long_runs:
        hints.append(f"It contains {long_runs} sequential {'run' if long_runs == 1 else 'runs'} longer than "
                     f"{frames} frames. Each one flushes LRU's working set; AdaptiCache lets it pass through T1.")
    if one_off_pages / max(distinct, 1) >= 0.3 and distinct > frames:
        hints.append(f"{one_off_pages} of its {distinct} pages are used only once. Protecting pages that are "
                     "used repeatedly pays off, which favours AdaptiCache.")
    if hot_share >= 0.5 and distinct > frames:
        hints.append(f"The busiest {top} {'page carries' if top == 1 else 'pages carry'} {hot_share:.0%} of all "
                     "references: a hot set worth keeping in T2.")
    if dists and near / len(dists) >= 0.8 and not long_runs:
        hints.append(f"{near / len(dists):.0%} of re-references come back within {frames} other pages. "
                     "Recency alone predicts this string well, so LRU is hard to beat.")
    if distinct <= frames:
        hints.append(f"All {distinct} distinct pages fit in {frames} frames, so every policy only pays the "
                     "first-touch faults. Try fewer frames.")

    return {
        "length": n,
        "distinct": distinct,
        "one_off_pages": one_off_pages,
        "rereference_share": round(len(dists) / n, 4) if n else 0,
        "median_reuse_distance": median(dists) if dists else None,
        "near_reuse_share": round(near / len(dists), 4) if dists else None,
        "hot_pages": top,
        "hot_share": round(hot_share, 4),
        "longest_sequential_run": longest,
        "long_sequential_runs": long_runs,
        "hints": hints,
    }


def evaluate(refs, frames, ghost, label="your string"):
    """Every experiment on the user's own string, sharing one set of engine runs."""
    distinct = len(set(refs))
    ratio = ghost / frames if frames else 1.0
    grid = frame_grid(frames, distinct)
    runs = verify.make_runs(label, refs, grid, ratio)

    faults = {k: [sum(not s["hit"] for s in eng[k]) for _, _, eng in runs] for k in ORDER}
    wins = sum(a < l for a, l in zip(faults["arc"], faults["lru"]))
    ties = sum(a == l for a, l in zip(faults["arc"], faults["lru"]))

    anomalies = [{"from": grid[i - 1], "to": grid[i], "faults_from": faults["fifo"][i - 1], "faults_to": faults["fifo"][i]}
                 for i in range(1, len(grid)) if faults["fifo"][i] > faults["fifo"][i - 1]]

    caps = sorted({0, frames // 4, frames // 2, frames})
    ablation = {
        "lru": faults["lru"][grid.index(frames)],
        "caps": caps,
        "arc": {str(c): sum(not s["hit"] for s in run_engine("arc", refs, frames, c)) for c in caps},
    }

    return {
        "label": label,
        "frames": frames,
        "ghost": ghost,
        "profile": profile(refs, frames),
        "sweep": {"frames": grid, "series": faults, "wins": wins, "ties": ties, "losses": len(grid) - wins - ties},
        "belady": {"anomalies": anomalies},
        "ablation": ablation,
        "checks": verify.run_on_string(refs, frames, runs, label),
    }
