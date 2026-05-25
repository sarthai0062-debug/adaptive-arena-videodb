import sys
import os

# Ensure the root directory is in the Python path so Vercel can import server.py
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import app
