"""Vercel Python serverless entrypoint — exposes Flask `app` for /api routes."""
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from server import app  # noqa: F401 — required WSGI name for Vercel
