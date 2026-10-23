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
run.py                        starts the server locally
api/index.py                  Vercel entry point, reusing the same request handler
vercel.json                   Vercel config: serves web/ and routes /api/* to api/index.py
```

The architecture follows the five layers in the Review 1 report. The input layer is `workloads.py`, the
controller is `server.resolve_input`, the engine layer is `engines/`, the collector is `collector.py` and the
presentation layer is `web/`. Every engine returns the same step record, so the collector and the front end
never need to know which algorithm produced a trace.
