"""Module 1: input and workload generator.

Synthetic workloads follow the CACHEUS taxonomy used in Review 1 (LRU-friendly,
LFU-friendly, scan, and a mixed phase-changing stream). Every generator is seeded, so the
same preset and seed always produce byte-identical input for all four engines.

Each generator returns (refs, phases); phases are labelled index ranges that the front end
shades on the timeline so the audience can see what the workload is doing.
"""

import csv
import io
import random
import re

MAX_REFS = 5000
MAX_PAGE = 99999


def _phase(start, end, label, kind):
    return {"start": start, "end": end, "label": label, "kind": kind}


def _locality(rng, n, base, span, keep=0.85, window=6):
    """LRU stack model: mostly re-touch one of the last few distinct pages, sometimes a new one."""
    refs, recent = [], []
    for _ in range(n):
        if recent and rng.random() < keep:
            page = rng.choice(recent[-window:])
        else:
            page = base + rng.randrange(span)
        refs.append(page)
        if page in recent:
            recent.remove(page)
        recent.append(page)
    return refs


def _hot_with_noise(rng, n, hot, cold_base, cold_span, hot_share):
    """A small hot set (skewed weights) mixed with cold pages that are mostly touched once."""
    weights = [1 / (i + 1) for i in range(len(hot))]
    refs = []
    for _ in range(n):
        if rng.random() < hot_share:
            refs.append(rng.choices(hot, weights)[0])
        else:
            refs.append(cold_base + rng.randrange(cold_span))
    return refs


def _hot_with_scans(rng, n, hot, scan_base, scan_len, gap):
    """Bursts on a hot set, interrupted by long one-pass sequential scans of fresh pages."""
    refs, next_scan = [], scan_base
    while len(refs) < n:
        refs.extend(rng.choice(hot) for _ in range(gap))
        refs.extend(range(next_scan, next_scan + scan_len))
        next_scan += scan_len
    return refs[:n]


def lru_friendly(seed, length=400):
    rng = random.Random(seed)
    refs = _locality(rng, length, base=0, span=60)
    return refs, [_phase(0, length, "Temporal locality", "locality")]


def lfu_friendly(seed, length=400):
    rng = random.Random(seed)
    hot = [1, 2, 3, 4, 5, 6]
    refs = _hot_with_noise(rng, length, hot, cold_base=100, cold_span=400, hot_share=0.6)
    return refs, [_phase(0, length, "Hot set + one-off pages", "frequency")]


def scan(seed, length=400):
    rng = random.Random(seed)
    hot = [1, 2, 3, 4, 5]
    refs = _hot_with_scans(rng, length, hot, scan_base=100, scan_len=14, gap=26)
    phases, i = [], 0
    while i < length:
        phases.append(_phase(i, min(i + 26, length), "Hot set", "frequency"))
        if i + 26 < length:
            phases.append(_phase(i + 26, min(i + 40, length), "Scan", "scan"))
        i += 40
    return refs, phases


def mixed(seed, length=600):
    """Four phases: locality, hot set under scans, a new hot set, locality again.

    Page ranges never overlap between phases: locality 0-39, hot sets 40-44 and 50-55,
    locality again 60-99, scan pages from 100, one-off noise pages 600-899.
    """
    rng = random.Random(seed)
    q = length // 4
    parts = [
        (_locality(rng, q, base=0, span=40), "Locality", "locality"),
        (_hot_with_scans(rng, q, [40, 41, 42, 43, 44], 100, 14, 22), "Hot set + scans", "scan"),
        (_hot_with_noise(rng, q, [50, 51, 52, 53, 54, 55], 600, 300, 0.65), "New hot set + noise", "frequency"),
        (_locality(rng, length - 3 * q, base=60, span=40), "Locality again", "locality"),
    ]
    refs, phases = [], []
    for chunk, label, kind in parts:
        phases.append(_phase(len(refs), len(refs) + len(chunk), label, kind))
        refs.extend(chunk)
    return refs, phases


TEXTBOOK = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1]
BELADY = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5]

PRESETS = {
    "mixed": {"name": "Mixed, phase-changing", "gen": mixed, "frames": 8, "length": 600,
              "about": "Locality, then a hot set under repeated scans, then a new hot set, then "
                       "locality again. No fixed policy suits every phase; this is where adaptivity pays."},
    "scan": {"name": "Hot set under scans", "gen": scan, "frames": 8, "length": 400,
             "about": "A small hot set is reused, then a long one-pass scan sweeps through. "
                      "LRU lets every scan flush the hot set."},
    "lfu": {"name": "LFU-friendly", "gen": lfu_friendly, "frames": 8, "length": 400,
            "about": "A few hot pages carry most references; the rest are touched once. "
                     "Frequency matters more than recency."},
    "lru": {"name": "LRU-friendly", "gen": lru_friendly, "frames": 8, "length": 400,
            "about": "Strong temporal locality: recently used pages are used again soon. "
                     "LRU's home ground, the fairness check for the adaptive engine."},
    "textbook": {"name": "Textbook string", "fixed": TEXTBOOK, "frames": 3,
                 "about": "The 20-reference string from Silberschatz. With 3 frames: FIFO 15, LRU 12, OPT 9 faults."},
    "belady": {"name": "Belady's anomaly", "fixed": BELADY, "frames": 3,
               "about": "FIFO makes 9 faults with 3 frames and 10 with 4. More memory, more faults."},
}


def generate(preset, seed=7, length=None):
    spec = PRESETS[preset]
    if "fixed" in spec:
        refs = list(spec["fixed"])
        return refs, [_phase(0, len(refs), spec["name"], "fixed")]
    return spec["gen"](seed, length or spec["length"])


def parse_reference_text(text):
    """Turn typed or uploaded text into a reference string.

    Accepts comma/space/newline separated integers, or a CSV whose header has a column named
    'page' (any other CSV uses its first column). Raises ValueError with a message meant for
    the person who supplied the input.
    """
    text = (text or "").strip()
    if not text:
        raise ValueError("The reference string is empty. Type page numbers such as 7 0 1 2 0 3.")
    first = text.splitlines()[0]
    if "," in first and re.search(r"[A-Za-z]", first):
        rows = list(csv.reader(io.StringIO(text)))
        header = [h.strip().lower() for h in rows[0]]
        col = header.index("page") if "page" in header else 0
        tokens = [r[col].strip() for r in rows[1:] if len(r) > col and r[col].strip()]
    else:
        tokens = [tok for tok in re.split(r"[\s,;]+", text) if tok]
    refs = []
    for pos, tok in enumerate(tokens, 1):
        if not re.fullmatch(r"\d+", tok):
            raise ValueError(f"Item {pos} ('{tok[:12]}') is not a page number. Use whole numbers from 0 to {MAX_PAGE}.")
        value = int(tok)
        if value > MAX_PAGE:
            raise ValueError(f"Page {value} at item {pos} is too large. Use page numbers from 0 to {MAX_PAGE}.")
        refs.append(value)
    if len(refs) > MAX_REFS:
        raise ValueError(f"The trace has {len(refs)} references. Trim it to {MAX_REFS} or fewer.")
    return refs
