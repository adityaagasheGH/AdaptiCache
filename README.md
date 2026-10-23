# AdaptiCache

A self-tuning adaptive page replacement simulator and visualizer. Operating Systems course project.

| Name | Registration number |
|---|---|
| Aditya Agashe | 24BYB0028 |
| Hemant Goyal | 24BYB0059 |
| Shiv Patel | 24BYB0002 |

AdaptiCache runs FIFO, LRU, OPT and an adaptive engine (after ARC, Megiddo and Modha) on the identical
reference string. It shows, step by step, why fixed policies fail on some workloads and how the adaptive engine
retunes itself using ghost-list feedback.

## Run it

Needs Python 3.9 or newer. There is nothing to install.

```bash
python run.py
```

The address is printed in the terminal (normally http://127.0.0.1:8000/) and opens in your browser. Stop it with Ctrl+C.

Other commands:

```bash
python -m adapticache simulate --preset mixed --frames 8
python -m adapticache simulate --refs "7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1" --frames 3
python -m adapticache verify
python -m unittest discover -s tests -v
```

The site loads two web fonts from Google Fonts. Offline, it falls back to system fonts and everything else still works.

## What is on the site

| Page | What it shows | Review 1 module |
|---|---|---|
| The case | A live run of the scan phase, why FIFO, LRU and OPT each fail, a 16-step walkthrough of how the adaptive engine decides, and faults broken down by workload phase | Story for the review |
| Simulator | Workload presets, seed, length, frames and ghost capacity, typed or imported traces, playback (play, pause, step back and forward, scrub, speed), jump to ghost hits, all four frame tables side by side, the adaptive engine's T1/T2/B1/B2 lists and p, and a plain-language reason for every decision | 1, 5 |
| Results | Headline claim, summary table, cumulative faults with phases and the crossover point, faults saved against LRU, p over time with ghost hits marked, faults by phase, CSV/JSON export, Save as PDF | 4, 6 |
| Evaluation | Type, paste or import any reference string and every test runs on it: a profile of the string (one-off pages, hot set, scans, reuse distance) with an explanation of which policy it favours, faults at every memory size, Belady's anomaly detection, the ghost-list ablation and the correctness checks. An optional button runs the 40-string built-in benchmark for comparison | Beyond Review 1 |

## Project layout

```
adapticache/
  workloads.py      Module 1  presets, seeded synthetic generators, trace parsing
  engines/
    base.py                   frame table and the uniform step record
    classical.py    Module 2  FIFO, LRU, OPT
    adaptive.py     Module 3  adaptive engine: T1, T2, B1, B2, p
  collector.py      Module 4  metrics, cumulative faults, crossover events, per-phase faults, CSV export
  evaluation.py               sweep, multi-seed benchmark, ablation, Belady check
  verify.py                   correctness checks shared by the site and the tests
  server.py                   controller (input validation) and JSON API, standard library only
web/                Modules 5 and 6  HTML, CSS and JavaScript front end (no framework, no chart library)
tests/                        unit tests
run.py                        starts the server
```

The architecture follows the five layers in the Review 1 report. The input layer is `workloads.py`, the
controller is `server.resolve_input`, the engine layer is `engines/`, the collector is `collector.py` and the
presentation layer is `web/`. Every engine returns the same step record, so the collector and the front end
never need to know which algorithm produced a trace.

## Results (8 frames, mean of 10 seeds)

| Workload | FIFO | LRU | AdaptiCache | OPT | vs LRU | Gap to OPT closed | Seeds beating LRU |
|---|---|---|---|---|---|---|---|
| Mixed, phase-changing | 210.9 | 192.7 | 170.8 | 151.5 | 11.4% fewer | 53.2% | 10 of 10 |
| Hot set under scans | 189.9 | 189.9 | 145.0 | 145.0 | 23.6% fewer | 100% | 10 of 10 |
| LFU-friendly | 254.9 | 229.5 | 176.8 | 162.3 | 23.0% fewer | 78.4% | 10 of 10 |
| LRU-friendly | 67.7 | 54.9 | 58.5 | 46.7 | 6.6% more | none | 0 of 10 |

The LRU-friendly row is reported on purpose. When recency really is the right bet, the adaptive engine pays a
small learning cost. That is the honest price of adaptivity.

Ghost-list ablation on the mixed workload: switching the ghost lists off raises mean faults from 170.8 to
226.2, worse than plain LRU. The feedback is what makes the engine adaptive.

## Correctness checks

The Evaluation page runs these checks on the user's own string, at every memory size it sweeps. `python -m adapticache verify` and the unit tests run the same check functions on the built-in workloads:

1. Textbook values: FIFO 15, LRU 12, OPT 9 faults on the Silberschatz string with 3 frames.
2. Belady's anomaly: FIFO makes 9 faults with 3 frames and 10 with 4.
3. OPT is never beaten by any engine, on every preset, seed and frame count tested.
4. Every trace is consistent: a hit if and only if the page was resident, no duplicates, never more pages than frames.
5. The adaptive engine's invariants hold after every reference: |T1|+|T2| ≤ c, |T1|+|B1| ≤ c, total ≤ 2c, 0 ≤ p ≤ c.
6. LRU's stack property: more frames never means more faults.
7. With ghost capacity 0, no ghost hits occur and p never moves.
8. Every workload is reproducible from its seed.
