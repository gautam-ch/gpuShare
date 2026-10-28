"""
Root entrypoint for FastAPI CLI / FastAPI Cloud.
Points to backend.main:app.
"""
import sys
import os

# Add backend directory to sys.path so backend internal imports (auth, database, models) resolve
backend_dir = os.path.join(os.path.dirname(__file__), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from backend.main import app  # noqa: F401
