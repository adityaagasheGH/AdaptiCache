"""Module 3: the adaptive replacement engine (after Megiddo and Modha's ARC).

State
    T1  resident pages referenced once recently      (recency side)
    T2  resident pages referenced at least twice     (frequency side)
    B1  ghost ids recently evicted from T1           (ids only, no page contents)
    B2  ghost ids recently evicted from T2
    p   target size of T1, a real number in [0, c]; T2's target is c - p

Feedback
    A miss that finds the page in B1 means a recency page was dropped too early, so p grows.
    A miss that finds it in B2 means a frequency page was dropped too early, so p shrinks.

`ghost` caps each ghost list. ghost = frames is standard ARC; ghost = 0 switches the
feedback off entirely, which is the ablation used in the evaluation.
"""

from collections import OrderedDict

from .base import FrameTable, make_step


def _fmt(x):
    return f"{x:.2f}".rstrip("0").rstrip(".")


def run_arc(refs, frames, ghost=None):
    c = frames
    g = c if ghost is None else max(0, min(ghost, c))
    t1, t2, b1, b2 = OrderedDict(), OrderedDict(), OrderedDict(), OrderedDict()  # LRU end first
    p = 0.0
    table = FrameTable(c)
    steps = []

    def replace(x_in_b2):
        """Make room in the cache by demoting the LRU page of T1 or T2 into its ghost list."""
        if t1 and (len(t1) > p or (x_in_b2 and len(t1) == p)):
            victim, _ = t1.popitem(last=False)
            b1[victim] = None
            return victim, "T1"
        victim, _ = t2.popitem(last=False)
        b2[victim] = None
        return victim, "T2"

    for t, x in enumerate(refs):
        p_before = p
        victim, side = None, None

        if x in t1 or x in t2:
            case = "T1 hit" if x in t1 else "T2 hit"
            (t1 if x in t1 else t2).pop(x)
            t2[x] = None
            hit = True
            if case == "T1 hit":
                note = (f"Hit in T1. Page {x} had been seen once; this second reference proves "
                        "reuse, so it is promoted to T2, the frequency side.")
            else:
                note = f"Hit in T2. Page {x} is a proven frequent page; it moves to the fresh end of T2."
        else:
            hit = False
            if x in b1:
                case = "B1 ghost hit"
                delta = max(1.0, len(b2) / len(b1))
                p = min(float(c), p + delta)
                victim, side = replace(False)
                b1.pop(x)
                t2[x] = None
                note = (f"Fault, but page {x} is in ghost list B1: it was evicted from T1 not long ago. "
                        f"That eviction was a mistake, so p rises from {_fmt(p_before)} to {_fmt(p)}, and "
                        f"recency gets more room. Page {victim} leaves {side} to make space.")
            elif x in b2:
                case = "B2 ghost hit"
                delta = max(1.0, len(b1) / len(b2))
                p = max(0.0, p - delta)
                victim, side = replace(True)
                b2.pop(x)
                t2[x] = None
                note = (f"Fault, but page {x} is in ghost list B2: a frequent page was evicted too early. "
                        f"p falls from {_fmt(p_before)} to {_fmt(p)}, so frequency gets more room. "
                        f"Page {victim} leaves {side} to make space.")
            else:
                case = "cold miss"
                if len(t1) + len(b1) == c:
                    if len(t1) < c:
                        b1.popitem(last=False)
                        victim, side = replace(False)
                    else:
                        victim, _ = t1.popitem(last=False)
                        side = "T1 (discarded, B1 is full)"
                elif len(t1) + len(t2) + len(b1) + len(b2) >= c:
                    if len(t1) + len(t2) + len(b1) + len(b2) >= 2 * c and b2:
                        b2.popitem(last=False)
                    if table.full:
                        victim, side = replace(False)
                t1[x] = None
                if victim is None:
                    note = f"Fault. Page {x} is new; a frame is free, so it enters T1 without an eviction."
                else:
                    reason = (f"T1 held {len(t1)} pages, above its target p = {_fmt(p)}"
                              if side == "T1" else
                              f"T1 is within its target p = {_fmt(p)}, so T2 gives up its oldest page"
                              if side == "T2" else "T1 alone fills the cache")
                    note = (f"Fault. Page {x} has not been seen recently, so it enters T1. "
                            f"Evicted page {victim} from {side.split(' ')[0]}: {reason}.")

            while len(b1) > g:
                b1.popitem(last=False)
            while len(b2) > g:
                b2.popitem(last=False)
            slot = table.load(x, victim)

        steps.append(make_step(
            t, x, hit, table,
            evicted=victim,
            slot=table.slot_of(x),
            note=note,
            case=case,
            p=round(p, 4),
            dp=round(p - p_before, 4),
            from_side=side.split(" ")[0] if side else None,
            t1=list(t1), t2=list(t2), b1=list(b1), b2=list(b2),
        ))
    return steps
