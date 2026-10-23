"""Correctness checks that can be run live in front of an evaluator.

Every check works on a list of runs, where a run is (label, frames, {engine: steps}). The
Evaluation page applies them to the user's own reference string at every memory size it
sweeps; the unit tests apply the same functions to the built-in workloads, so the page and
the test suite can never disagree.
"""

from .engines import ORDER, run_engine
from .workloads import BELADY, PRESETS, TEXTBOOK, generate

SEEDS = range(5)


def _faults(steps):
    return sum(not s["hit"] for s in steps)


def make_runs(label, refs, frame_counts, ghost_ratio=1.0):
    return [(label, f, {k: run_engine(k, refs, f, round(f * ghost_ratio)) for k in ORDER})
            for f in frame_counts]


# ---------- checks on any set of runs ----------

def opt_lower_bound(runs):
    for label, f, eng in runs:
        opt = _faults(eng["opt"])
        for key in ("fifo", "lru", "arc"):
            if _faults(eng[key]) < opt:
                return False, f"{key} beat OPT on {label} with {f} frames"
    return True, f"OPT made the fewest faults in all {3 * len(runs)} comparisons"


def trace_consistency(runs):
    """Every engine: hit iff page was resident; no duplicates; never more pages than frames."""
    checked = 0
    for label, frames, eng in runs:
        for key in ORDER:
            resident = set()
            for s in eng[key]:
                if s["hit"] != (s["page"] in resident):
                    return False, f"{key} misreported a hit at step {s['t'] + 1} of {label} ({frames} frames)"
                pages = [p for p in s["frames"] if p is not None]
                if len(pages) != len(set(pages)) or len(pages) > frames or s["page"] not in pages:
                    return False, f"{key} produced an invalid frame table at step {s['t'] + 1} of {label}"
                resident = set(pages)
                checked += 1
    return True, f"{checked:,} steps checked across all engines"


def arc_invariants(runs):
    """ARC's published invariants hold after every single reference."""
    checked = 0
    for label, c, eng in runs:
        for s in eng["arc"]:
            t1, t2, b1, b2 = (len(s[k]) for k in ("t1", "t2", "b1", "b2"))
            resident = {p for p in s["frames"] if p is not None}
            if not (t1 + t2 <= c and t1 + b1 <= c and t1 + t2 + b1 + b2 <= 2 * c and 0 <= s["p"] <= c):
                return False, f"invariant broken at step {s['t'] + 1} of {label} with {c} frames"
            if resident != set(s["t1"]) | set(s["t2"]):
                return False, f"T1 and T2 disagree with the frames at step {s['t'] + 1} of {label}"
            checked += 1
    return True, f"|T1|+|T2| ≤ c, |T1|+|B1| ≤ c, total ≤ 2c, 0 ≤ p ≤ c over {checked:,} steps"


def lru_stack_property(runs):
    """LRU is a stack algorithm, so more frames can never mean more faults."""
    by_label = {}
    for label, f, eng in runs:
        by_label.setdefault(label, []).append((f, _faults(eng["lru"])))
    for label, pts in by_label.items():
        pts.sort()
        for (f1, a), (f2, b) in zip(pts, pts[1:]):
            if b > a:
                return False, f"LRU made more faults with {f2} frames than with {f1} on {label}"
    sizes = sorted({f for _, f, _ in runs})
    return True, f"LRU faults never increase across the {len(sizes)} memory sizes tested ({sizes[0]} to {sizes[-1]} frames)"


def ghost_off(refs, frames, label):
    if any(s["case"].endswith("ghost hit") for s in run_engine("arc", refs, frames, 0)):
        return False, f"ghost hits recorded with ghost capacity 0 on {label}"
    return True, "With ghost capacity 0 no ghost hits occur, so p never moves"


def deterministic(refs, frames, label):
    first = [[(s["hit"], s["evicted"]) for s in run_engine(k, refs, frames)] for k in ORDER]
    second = [[(s["hit"], s["evicted"]) for s in run_engine(k, refs, frames)] for k in ORDER]
    if first != second:
        return False, f"two runs of {label} gave different results"
    return True, f"Two runs of every engine on {label} gave identical decisions at every step"


def textbook_self_test():
    got = {k: _faults(run_engine(k, TEXTBOOK, 3)) for k in ("fifo", "lru", "opt")}
    want = {"fifo": 15, "lru": 12, "opt": 9}
    return got == want, f"3 frames: FIFO {got['fifo']}, LRU {got['lru']}, OPT {got['opt']} (expected 15, 12, 9)"


def _run(checks):
    results = []
    for name, fn in checks:
        try:
            passed, detail = fn()
        except Exception as exc:  # report, never crash the page
            passed, detail = False, f"raised {type(exc).__name__}: {exc}"
        results.append({"name": name, "passed": passed, "detail": detail})
    return results


def run_on_string(refs, frames, runs, label="your string"):
    """Checks for one reference string, reusing the runs the evaluation already computed."""
    return _run([
        ("OPT is a lower bound", lambda: opt_lower_bound(runs)),
        ("Trace consistency", lambda: trace_consistency(runs)),
        ("Adaptive engine invariants", lambda: arc_invariants(runs)),
        ("LRU stack property", lambda: lru_stack_property(runs)),
        ("Ghost lists drive adaptation", lambda: ghost_off(refs, frames, label)),
        ("Deterministic engines", lambda: deterministic(refs, frames, label)),
        ("Engine self-test (textbook string)", textbook_self_test),
    ])


# ---------- the same checks over the built-in workloads (unit tests and CLI) ----------

def _builtin_runs():
    runs = []
    for preset in PRESETS:
        for seed in SEEDS if "gen" in PRESETS[preset] else [0]:
            refs, _ = generate(preset, seed)
            runs += make_runs(f"{preset} seed {seed}", refs, (3, PRESETS[preset]["frames"], 12))
    return runs


def check_textbook():
    return textbook_self_test()


def check_belady():
    a, b = (_faults(run_engine("fifo", BELADY, f)) for f in (3, 4))
    return (a, b) == (9, 10), f"FIFO makes {a} faults with 3 frames and {b} with 4 (expected 9 and 10)"


def check_opt_lower_bound():
    return opt_lower_bound(_builtin_runs())


def check_trace_consistency():
    return trace_consistency(_builtin_runs())


def check_arc_invariants():
    return arc_invariants(_builtin_runs())


def check_lru_stack_property():
    runs = []
    for preset in PRESETS:
        refs, _ = generate(preset, 1)
        runs += [(preset, f, {"lru": run_engine("lru", refs, f)}) for f in range(1, 17)]
    return lru_stack_property(runs)


def check_ghost_ablation():
    for preset in PRESETS:
        refs, _ = generate(preset, 2)
        ok, detail = ghost_off(refs, 8, preset)
        if not ok:
            return ok, detail
    return True, "With ghost capacity 0 no ghost hits occur, so p never moves"


def check_determinism():
    for preset in PRESETS:
        if generate(preset, 11) != generate(preset, 11):
            return False, f"{preset} produced different output for the same seed"
    return True, "Every preset gives identical input for the same seed"


CHECKS = [
    ("Textbook reference values", check_textbook),
    ("Belady's anomaly reproduced", check_belady),
    ("OPT is a lower bound", check_opt_lower_bound),
    ("Trace consistency", check_trace_consistency),
    ("Adaptive engine invariants", check_arc_invariants),
    ("LRU stack property", check_lru_stack_property),
    ("Ghost lists drive adaptation", check_ghost_ablation),
    ("Reproducible workloads", check_determinism),
]


def run_all():
    return _run(CHECKS)
