"""Controller and JSON API (Review 1, layer 2), plus the static site.

Standard library only, so the project runs on any lab machine with Python 3.9+.
"""

import json
import mimetypes
import threading
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import evaluation, verify
from .collector import simulate, summary_csv, trace_csv
from .engines import ENGINES, ORDER
from .workloads import MAX_REFS, PRESETS, generate, parse_reference_text

WEB_ROOT = Path(__file__).resolve().parent.parent / "web"
MAX_FRAMES = 64


class BadRequest(ValueError):
    pass


def _int(body, name, default, lo, hi):
    value = body.get(name, default)
    try:
        value = int(value)
    except (TypeError, ValueError):
        raise BadRequest(f"{name} must be a whole number.")
    if not lo <= value <= hi:
        raise BadRequest(f"{name} must be between {lo} and {hi}.")
    return value


def resolve_input(body):
    """Controller: turn a request into a validated reference string and configuration."""
    preset = body.get("preset")
    if body.get("refs_text") is not None and not preset:
        try:
            refs = parse_reference_text(body["refs_text"])
        except ValueError as exc:
            raise BadRequest(str(exc))
        phases = None
        label = body.get("label") or "Custom reference string"
        default_frames = 4
    elif preset in PRESETS:
        seed = _int(body, "seed", 7, 0, 10**6)
        length = _int(body, "length", PRESETS[preset].get("length", 0), 20, MAX_REFS) \
            if "gen" in PRESETS[preset] else None
        refs, phases = generate(preset, seed, length)
        label = PRESETS[preset]["name"]
        default_frames = PRESETS[preset]["frames"]
    else:
        raise BadRequest("Choose a preset workload or supply a reference string.")
    frames = _int(body, "frames", default_frames, 1, MAX_FRAMES)
    ghost = _int(body, "ghost", frames, 0, frames)
    return refs, phases, frames, ghost, label


@lru_cache(maxsize=8)
def _benchmark(frames, seeds):
    return evaluation.benchmark(range(seeds), frames)


def api_presets(_body):
    return {
        "presets": [{"key": k, "name": v["name"], "about": v["about"], "frames": v["frames"],
                     "length": v.get("length"), "fixed": "fixed" in v} for k, v in PRESETS.items()],
        "engines": [{"key": k, "name": ENGINES[k]["name"], "blurb": ENGINES[k]["blurb"]} for k in ORDER],
        "limits": {"max_refs": MAX_REFS, "max_frames": MAX_FRAMES},
    }


def api_simulate(body):
    refs, phases, frames, ghost, label = resolve_input(body)
    result = simulate(refs, frames, ghost, phases)
    result["label"] = label
    return result


def api_belady(body):
    refs, *_ = resolve_input(body)
    return evaluation.belady(refs, _int(body, "max_frames", 7, 2, 16))


def api_benchmark(body):
    return _benchmark(_int(body, "frames", 8, 2, 32), _int(body, "seeds", 10, 1, 30))


def api_verify(_body):
    return {"checks": verify.run_all()}


def api_evaluate(body):
    refs, _, frames, ghost, label = resolve_input(body)
    result = evaluation.evaluate(refs, frames, ghost, label)
    result["refs"] = refs
    return result


ROUTES = {
    "/api/presets": api_presets,
    "/api/simulate": api_simulate,
    "/api/belady": api_belady,
    "/api/benchmark": api_benchmark,
    "/api/verify": api_verify,
    "/api/evaluate": api_evaluate,
}


class Handler(BaseHTTPRequestHandler):
    server_version = "AdaptiCache/1.0"

    def log_message(self, fmt, *args):
        if getattr(self.server, "verbose", False):
            super().log_message(fmt, *args)

    def _send(self, status, body, ctype, extra=None):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _json(self, status, payload):
        self._send(status, json.dumps(payload, separators=(",", ":")), "application/json")

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 2_000_000:
            raise BadRequest("The request is too large. Keep traces under 2 MB.")
        if not length:
            return {}
        try:
            body = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            raise BadRequest("The request body is not valid JSON.")
        if not isinstance(body, dict):
            raise BadRequest("The request body must be a JSON object.")
        return body

    def _dispatch(self, body):
        url = urlparse(self.path)
        path = url.path
        query = parse_qs(url.query)
        if "route" in query:  # on Vercel, vercel.json rewrites /api/<route> to /api/index?route=<route>
            path = "/api/" + query["route"][0]
        if path == "/api/export":
            kind = query.get("kind", ["trace"])[0]
            result = api_simulate(body)
            text = trace_csv(result) if kind == "trace" else summary_csv(result)
            name = f"adapticache-{kind}.csv"
            return self._send(200, text, "text/csv; charset=utf-8",
                              {"Content-Disposition": f'attachment; filename="{name}"'})
        if path in ROUTES:
            return self._json(200, ROUTES[path](body))
        if path.startswith("/api/"):
            return self._json(404, {"error": "Unknown API route."})
        return self._static(path)

    def _handle(self, body_reader):
        try:
            self._dispatch(body_reader())
        except BadRequest as exc:
            self._json(400, {"error": str(exc)})
        except Exception as exc:  # keep the demo alive and say what broke
            self._json(500, {"error": f"Server error: {type(exc).__name__}: {exc}"})

    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        self._handle(lambda: {k: v[0] for k, v in query.items()})

    def do_POST(self):
        self._handle(self._body)

    def _static(self, path):
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        target = (WEB_ROOT / rel).resolve()
        if WEB_ROOT not in target.parents or not target.is_file():
            target = WEB_ROOT / "index.html"
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype)


def serve(host="127.0.0.1", port=8000, open_browser=True, verbose=False):
    for candidate in range(port, port + 20):
        try:
            httpd = ThreadingHTTPServer((host, candidate), Handler)
            break
        except OSError:
            continue
    else:
        raise SystemExit(f"Ports {port}-{port + 19} are all busy. Pass --port to pick another.")
    httpd.verbose = verbose
    url = f"http://{host}:{httpd.server_address[1]}/"
    print(f"AdaptiCache is running at {url}  (Ctrl+C to stop)")
    if open_browser:
        import webbrowser
        threading.Timer(0.6, webbrowser.open, [url]).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        httpd.server_close()
