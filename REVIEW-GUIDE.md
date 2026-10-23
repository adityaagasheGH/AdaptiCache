# Review guide

A suggested 6–8 minute demo, followed by questions evaluators are likely to ask.

## Before you start

1. Run `python run.py` and keep the terminal open.
2. Open the site and go once to each page so everything is loaded.
3. Have a second tab open on the Evaluation page. Its benchmark takes a few seconds the first time.

## Demo order

**1. The case, top of the page (about 1 minute).** The live bar is the adaptive engine during the
"hot set + scans" phase. Point at the two sides. T1 (light) holds pages seen once, T2 (dark) holds pages
seen twice or more, and the dashed tiles at each end are ghosts, page numbers only. The fault bars below
race through the phase. Let it reach the end: LRU 80, AdaptiCache 63, OPT 61.

**2. "Each classic policy bets on one assumption" (about 1.5 minutes).**
- FIFO: Belady's anomaly, 9 faults with 3 frames and 10 with 4.
- LRU: after the scan, LRU faults on 1, 2 and 3 again. AdaptiCache matches OPT.
- OPT: the eviction reason quotes a future step, which is why OPT can't be implemented and serves only as the yardstick.

**3. "How AdaptiCache decides" (about 2 minutes).** Click Next reference. Stop at:
- step 4: pages 1 and 2 are promoted to T2;
- steps 5–7: the scan stays in T1, and the matching rule lights up on the right;
- steps 8–9: AdaptiCache hits while LRU faults (watch the two fault counters);
- step 10: B1 ghost hit, p rises from 0 to 1. **This is the key moment: feedback with no training.**
- step 12: B2 ghost hit, p swings back.

**4. Simulator (about 1.5 minutes).** Mixed workload, press Play, then press `G` to jump to the next
ghost hit. Show the four frame tables and the plain-language reason for each decision. Step back with `←`
to show the step-back feature from Review 1.

**5. Results (about 1 minute).** Read the headline sentence. Point at the green dashed line in the
cumulative chart where AdaptiCache pulls ahead, and at the p chart, where p moves exactly when the phase changes.

**6. Evaluation (about 2 minutes).** Ask an evaluator for a reference string, or type one of your own,
and press Evaluate this string. Everything on the page is then about that string. Read out the profile
hints, which explain why a policy wins on it. Show the memory-size chart ("beat LRU at N of M sizes")
and the checks passing on their string. To show that the pattern holds in general, press Run the
40-string benchmark: 10 of 10 seeds on three workloads, and say the honest part yourselves, that it loses
6.6% on the LRU-friendly workload.

A string that shows off the adaptive engine well, at 4 frames:
`1 2 3 4 1 2 3 4 20 21 22 23 24 25 26 27 1 2 3 4 1 2 30 31 32 33 34 35 1 2 3 4`

## Likely questions

**Is this real ARC?** Yes. It follows Megiddo and Modha (FAST 2003): the same four lists, the same p update
(δ = max(1, |B2|/|B1|) on a B1 hit and the mirror on a B2 hit), and the same REPLACE rule. Ghost capacity is
an extra parameter we added for the ablation. At its default (equal to frames) it is standard ARC.

**Why does it lose on the LRU-friendly workload?** It starts with p = 0, which favours frequency, and has
to see B1 ghost hits before it gives recency more room. LRU starts with the right assumption for that
workload. The loss is small and bounded, while the wins elsewhere are much larger.

**Why is OPT shown if it can't be implemented?** It gives the lower bound. "Gap closed" tells you how much
of the distance between LRU and perfect AdaptiCache recovers: 53% on the mixed workload, 100% under scans.

**How do you know the engines are correct?** Eight checks run live on the Evaluation page, and as unit tests.
They include the textbook values, Belady's anomaly, the OPT lower bound, ARC's invariants at every step,
and LRU's stack property.

**Isn't one workload cherry-picked?** That is why there are 10 seeds per workload, a frame sweep from 3 to
24, and a workload where AdaptiCache loses.

**What does a ghost cost?** One page number, a few bytes. No page data is kept.

**Where is this used in practice?** ARC-style adaptive caching is used in ZFS (the ARC) and in storage
controllers. The Review 1 literature review covers the research line that followed: CACHEUS, LeCaR, SIEVE and S3-FIFO.

**What would you add next?** Real trace files (for example, SPC or MSR block traces), SIEVE and S3-FIFO
as extra baselines, and CLOCK-Pro, which is closer to what the Linux kernel does.
