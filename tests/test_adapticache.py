"""Run with:  python -m unittest discover -s tests -v"""

import unittest

from adapticache import verify
from adapticache.collector import simulate, summary_csv, trace_csv
from adapticache.engines import ORDER, run_engine
from adapticache.engines.base import FrameTable
from adapticache.workloads import TEXTBOOK, generate, parse_reference_text


class VerificationChecks(unittest.TestCase):
    """The same checks the Verification panel runs live."""


for _name, _fn in verify.CHECKS:
    def _test(self, fn=_fn):
        passed, detail = fn()
        self.assertTrue(passed, detail)
    setattr(VerificationChecks, "test_" + _fn.__name__.removeprefix("check_"), _test)


class EngineBehaviour(unittest.TestCase):
    def test_frame_table_keeps_slots(self):
        t = FrameTable(3)
        self.assertEqual([t.load(5), t.load(6), t.load(7)], [0, 1, 2])
        self.assertEqual(t.load(9, victim=6), 1)
        self.assertEqual(t.snapshot(), [5, 9, 7])

    def test_lru_evicts_least_recent(self):
        steps = run_engine("lru", [1, 2, 3, 1, 4], 3)
        self.assertEqual(steps[-1]["evicted"], 2)

    def test_fifo_ignores_hits(self):
        steps = run_engine("fifo", [1, 2, 3, 1, 4], 3)
        self.assertEqual(steps[-1]["evicted"], 1)

    def test_opt_prefers_page_never_used_again(self):
        steps = run_engine("opt", [1, 2, 3, 4, 1, 2], 3)
        self.assertEqual(steps[3]["evicted"], 3)

    def test_arc_promotes_on_second_reference(self):
        steps = run_engine("arc", [1, 1], 2)
        self.assertEqual(steps[1]["case"], "T1 hit")
        self.assertEqual(steps[1]["t2"], [1])

    def test_arc_b1_hit_raises_p(self):
        steps = run_engine("arc", [1, 2, 2, 3, 1], 2)
        self.assertEqual(steps[3]["evicted"], 1)
        self.assertEqual(steps[4]["case"], "B1 ghost hit")
        self.assertGreater(steps[4]["p"], 0)

    def test_arc_resists_scan(self):
        hot = [1, 2, 3] * 10
        refs = hot + list(range(100, 140)) + hot
        f = {k: sum(not s["hit"] for s in run_engine(k, refs, 4)) for k in ("lru", "arc")}
        self.assertLess(f["arc"], f["lru"])


class CollectorAndInput(unittest.TestCase):
    def test_summary_and_exports(self):
        result = simulate(TEXTBOOK, 3)
        self.assertEqual(result["engines"]["opt"]["summary"]["faults"], 9)
        self.assertEqual(result["engines"]["lru"]["cum_faults"][-1], 12)
        self.assertEqual(len(trace_csv(result).strip().splitlines()), len(TEXTBOOK) + 1)
        self.assertIn("AdaptiCache", summary_csv(result))

    def test_phase_faults_add_up(self):
        refs, phases = generate("mixed", 3)
        result = simulate(refs, 8, phases=phases)
        for key in ORDER:
            total = sum(ph["faults"][key] for ph in result["phases"])
            self.assertEqual(total, result["engines"][key]["summary"]["faults"])

    def test_parse_plain_and_csv(self):
        self.assertEqual(parse_reference_text("7, 0 1\n2;0"), [7, 0, 1, 2, 0])
        self.assertEqual(parse_reference_text("time,page\n1,4\n2,9\n"), [4, 9])

    def test_parse_rejects_bad_input_first(self):
        with self.assertRaises(ValueError):
            parse_reference_text("1 2 3 4 999999")

    def test_parse_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            parse_reference_text("1 2 x")
        with self.assertRaises(ValueError):
            parse_reference_text("")


class EvaluateUserString(unittest.TestCase):
    """The Evaluation page runs everything on the string the user typed."""

    def test_all_checks_pass_on_a_user_string(self):
        from adapticache.evaluation import evaluate
        refs = parse_reference_text("1 2 3 4 1 2 3 4 20 21 22 23 24 25 26 27 1 2 3 4 1 2 30 31 32 33 1 2 3 4")
        ev = evaluate(refs, 4, 4)
        self.assertTrue(all(c["passed"] for c in ev["checks"]), ev["checks"])
        self.assertIn(4, ev["sweep"]["frames"])
        self.assertEqual(ev["sweep"]["wins"] + ev["sweep"]["ties"] + ev["sweep"]["losses"], len(ev["sweep"]["frames"]))

    def test_belady_found_in_user_string(self):
        from adapticache.evaluation import evaluate
        from adapticache.workloads import BELADY
        anomalies = evaluate(BELADY, 3, 3)["belady"]["anomalies"]
        self.assertIn({"from": 3, "to": 4, "faults_from": 9, "faults_to": 10}, anomalies)

    def test_profile_spots_scans(self):
        from adapticache.evaluation import profile
        p = profile([1, 2, 1, 2] + list(range(10, 20)) + [1, 2], 4)
        self.assertEqual(p["long_sequential_runs"], 1)
        self.assertEqual(p["longest_sequential_run"], 10)

    def test_sweep_grid_is_bounded(self):
        from adapticache.evaluation import MAX_SWEEP_POINTS, frame_grid
        grid = frame_grid(40, 3000)
        self.assertLessEqual(len(grid), MAX_SWEEP_POINTS + 1)
        self.assertIn(40, grid)
        self.assertEqual(frame_grid(3, 2), [1, 2, 3])


if __name__ == "__main__":
    unittest.main()
