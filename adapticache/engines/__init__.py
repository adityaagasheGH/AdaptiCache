"""Engine registry. Every engine takes (refs, frames, **options) and returns a list of steps."""

from .adaptive import run_arc
from .classical import run_fifo, run_lru, run_opt

ENGINES = {
    "fifo": {"name": "FIFO", "run": run_fifo,
             "blurb": "Evicts the oldest arrival. Ignores how pages are used."},
    "lru": {"name": "LRU", "run": run_lru,
            "blurb": "Evicts the page unused for the longest time. Trusts recency only."},
    "arc": {"name": "AdaptiCache", "run": run_arc,
            "blurb": "Balances recency and frequency, retuned by ghost-list feedback."},
    "opt": {"name": "OPT", "run": run_opt,
            "blurb": "Evicts the page needed furthest in the future. Needs to see the future."},
}

ORDER = ["fifo", "lru", "arc", "opt"]


def run_engine(key, refs, frames, ghost=None):
    if key == "arc":
        return run_arc(refs, frames, ghost)
    return ENGINES[key]["run"](refs, frames)
