"""Command line entry point.

    python -m adapticache serve [--port 8000] [--no-browser]
    python -m adapticache simulate --preset mixed [--frames 8] [--seed 7]
    python -m adapticache simulate --refs "7 0 1 2 0 3 0 4" --frames 3
    python -m adapticache verify
"""

import argparse
import sys

from .collector import simulate
from .engines import ORDER
from .server import serve
from .verify import run_all
from .workloads import PRESETS, generate, parse_reference_text


def _simulate(args):
    if args.refs:
        refs, phases = parse_reference_text(args.refs), None
    else:
        refs, phases = generate(args.preset, args.seed)
    frames = args.frames or (PRESETS[args.preset]["frames"] if not args.refs else 3)
    result = simulate(refs, frames, phases=phases)
    print(f"{len(refs)} references, {frames} frames\n")
    print(f"{'algorithm':<13}{'faults':>8}{'hits':>8}{'hit ratio':>11}")
    for key in ORDER:
        e = result["engines"][key]
        s = e["summary"]
        print(f"{e['name']:<13}{s['faults']:>8}{s['hits']:>8}{s['hit_ratio']:>11.1%}")
    h = result["headline"]
    print(f"\nAdaptiCache makes {h['arc_vs_lru_pct']}% fewer faults than LRU", end="")
    print(f" and closes {h['gap_closed_pct']}% of the gap to OPT." if h["gap_closed_pct"] is not None else ".")


def _verify(_args):
    results = run_all()
    encoding = getattr(sys.stdout, "encoding", None) or "ascii"
    for r in results:
        line = f"[{'PASS' if r['passed'] else 'FAIL'}] {r['name']}: {r['detail']}"
        try:
            line.encode(encoding)
        except UnicodeEncodeError:  # older Windows consoles (cp1252) cannot print the maths symbols
            line = line.replace("≤", "<=")
        print(line)
    return 0 if all(r["passed"] for r in results) else 1


def main(argv=None):
    parser = argparse.ArgumentParser(prog="adapticache")
    sub = parser.add_subparsers(dest="cmd")
    s = sub.add_parser("serve", help="start the web app")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--no-browser", action="store_true")
    s.add_argument("--verbose", action="store_true")
    m = sub.add_parser("simulate", help="print a comparison table")
    m.add_argument("--preset", choices=list(PRESETS), default="mixed")
    m.add_argument("--refs")
    m.add_argument("--frames", type=int)
    m.add_argument("--seed", type=int, default=7)
    sub.add_parser("verify", help="run the correctness checks")
    args = parser.parse_args(argv)

    if args.cmd == "simulate":
        return _simulate(args)
    if args.cmd == "verify":
        return _verify(args)
    serve(getattr(args, "host", "127.0.0.1"), getattr(args, "port", 8000),
          not getattr(args, "no_browser", False), getattr(args, "verbose", False))


if __name__ == "__main__":
    sys.exit(main())
