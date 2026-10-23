"""AdaptiCache: a self-tuning adaptive page replacement simulator.

Layers (see Review 1, Figure 2):
    workloads   -> Module 1, input and workload generator
    engines     -> Modules 2 and 3, FIFO / LRU / OPT and the adaptive (ARC) engine
    collector   -> Module 4, unified trace and metrics
    evaluation  -> experiments that back the project's claims (sweeps, benchmarks, ablation)
    server      -> controller + JSON API for the browser front end (Modules 5 and 6)
"""

__version__ = "1.0.0"
