"""Vercel entry point.

Vercel runs this file as a serverless function: vercel.json rewrites every /api/<route> request
here, and the static site in web/ is served directly. It reuses the exact request handler that
`python run.py` uses, so the API behaves the same locally and in production.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adapticache.server import Handler  # noqa: E402


class handler(Handler):  # Vercel looks for a class with exactly this name
    pass
