"""
Adaptive Arena — Stateless & Resilient Flask Backend Server
===========================================================
Serves the static frontend and provides API endpoints for VideoDB sandbox
management, FLUX image generation, OmniVoice narration, and trailer stitching.

Highly optimized and hardened to be 100% compatible with Vercel Serverless Functions,
utilizing stateless dynamic resolution and robust Demo Mode fallback policies.
"""

import logging
import os
import time
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from dotenv import load_dotenv
load_dotenv()

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("adaptive-arena")

# ---------------------------------------------------------------------------
# VideoDB SDK — optional import
# ---------------------------------------------------------------------------
VIDEODB_AVAILABLE = False
try:
    from videodb import connect, SandboxModel, SandboxTier

    VIDEODB_AVAILABLE = True
    logger.info("VideoDB SDK loaded successfully.")
except ImportError:
    logger.warning(
        "VideoDB SDK not installed. Running in demo mode — "
        "image/audio/trailer generation will return placeholder responses."
    )

VIDEODB_API_KEY = os.environ.get("VIDEO_DB_API_KEY") or os.environ.get("VIDEODB_API_KEY") or os.environ.get("api_key")
if VIDEODB_API_KEY:
    os.environ["VIDEO_DB_API_KEY"] = VIDEODB_API_KEY
    os.environ["VIDEODB_API_KEY"] = VIDEODB_API_KEY
    logger.info("VideoDB API Key loaded and set in environment.")
else:
    if VIDEODB_AVAILABLE:
        logger.warning(
            "VideoDB API Key (VIDEO_DB_API_KEY, VIDEODB_API_KEY, or api_key) is not set in environment or .env. "
            "Inference services will be unavailable."
        )

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
STATIC_DIR = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")
CORS(app)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_ready() -> bool:
    """Return True when the VideoDB SDK is available and the API key is set."""
    return VIDEODB_AVAILABLE and bool(VIDEODB_API_KEY)


def _demo_error_message() -> str:
    if not VIDEODB_AVAILABLE:
        return "VideoDB SDK is not installed. Install it to enable sandbox workloads."
    if not VIDEODB_API_KEY:
        return "VIDEODB_API_KEY environment variable is not set."
    return "Unknown configuration issue."


def _is_invalid_sandbox(sandbox_id) -> bool:
    """Check if the provided sandbox_id is missing or represented as null/undefined by frontend."""
    if not sandbox_id:
        return True
    if str(sandbox_id).strip().lower() in ("null", "undefined", "none", ""):
        return True
    return False

# ---------------------------------------------------------------------------
# Routes — Static files
# ---------------------------------------------------------------------------

@app.route("/")
def serve_index():
    return send_from_directory(str(STATIC_DIR), "index.html")


@app.route("/<path:filepath>")
def serve_static(filepath: str):
    return send_from_directory(str(STATIC_DIR), filepath)

# ---------------------------------------------------------------------------
# Routes — API
# ---------------------------------------------------------------------------

@app.route("/api/start-sandbox", methods=["POST"])
def start_sandbox():
    """Create a new VideoDB sandbox or reuse an existing active/provisioning sandbox of medium tier."""
    if not _is_ready():
        return jsonify({
            "sandbox_id": None,
            "status": "demo_mode",
            "message": _demo_error_message(),
        }), 200

    try:
        conn = connect()
        
        # Look for an existing active or provisioning medium sandbox to reuse and avoid limit errors
        existing_sandbox = None
        try:
            for sb in conn.list_sandboxes():
                tier_val = sb.tier.value if hasattr(sb.tier, "value") else str(sb.tier)
                status_val = sb.status.value if hasattr(sb.status, "value") else str(sb.status)
                
                if tier_val.lower() == "medium" and status_val.lower() in ("active", "provisioning"):
                    existing_sandbox = sb
                    break
        except Exception as list_exc:
            logger.warning("Failed to list existing sandboxes: %s", str(list_exc))

        if existing_sandbox:
            status_val = existing_sandbox.status.value if hasattr(existing_sandbox.status, "value") else str(existing_sandbox.status)
            logger.info("Reusing existing sandbox %s in status %s.", existing_sandbox.id, status_val)
            return jsonify({
                "sandbox_id": existing_sandbox.id,
                "status": "ready" if status_val.lower() == "active" else "provisioning",
            }), 200

        # No active/provisioning sandbox found, create a new one
        sandbox = conn.create_sandbox(
            tier=SandboxTier.medium
        )
        logger.info("Sandbox %s provisioned asynchronously.", sandbox.id)

        return jsonify({
            "sandbox_id": sandbox.id,
            "status": "provisioning",
        }), 200

    except Exception as exc:
        logger.exception("Failed to start sandbox.")
        return jsonify({
            "sandbox_id": None,
            "status": "error",
            "error": str(exc),
        }), 500


@app.route("/api/sandbox-status", methods=["GET"])
def sandbox_status():
    """Check the status of a provisioning sandbox from VideoDB on-the-fly."""
    sandbox_id = request.args.get("sandbox_id")
    if _is_invalid_sandbox(sandbox_id):
        return jsonify({"error": "'sandbox_id' query parameter is required."}), 400

    if not _is_ready():
        return jsonify({"status": "demo_mode"}), 200

    try:
        conn = connect()
        sandbox = conn.get_sandbox(sandbox_id)
        status = getattr(sandbox, "status", "unknown")
        
        # Normalize status to string if it is an enum or other type
        if hasattr(status, "value"):
            status_str = str(status.value)
        else:
            status_str = str(status)
        status_str = status_str.lower()
        
        # Check active properties
        if hasattr(sandbox, "is_active") and sandbox.is_active:
            status_str = "ready"
        elif status_str in ("active", "ready", "success"):
            status_str = "ready"
            
        logger.info("Checked status for sandbox %s: %s", sandbox_id, status_str)
        return jsonify({
            "sandbox_id": sandbox_id,
            "status": status_str
        }), 200
    except Exception as exc:
        logger.warning("Failed to check sandbox status for %s: %s", sandbox_id, str(exc))
        return jsonify({
            "sandbox_id": sandbox_id,
            "status": "error",
            "error": str(exc)
        }), 200


@app.route("/api/generate-background", methods=["POST"])
def generate_background():
    """Generate a background image using FLUX on the specified sandbox (with Demo fallback support)."""
    data = request.get_json(silent=True) or {}
    zone_name = data.get("zone_name")
    prompt = data.get("prompt")
    sandbox_id = data.get("sandbox_id")
    theme = data.get("theme", "")

    if not zone_name or not prompt:
        return jsonify({"error": "Both 'zone_name' and 'prompt' are required."}), 400

    # --- Resilient Fallback to Demo Mode ---
    if not _is_ready() or _is_invalid_sandbox(sandbox_id):
        logger.info("Background request for '%s' processed in Fallback Mode (Sandbox ID is null/undefined).", zone_name)
        return jsonify({
            "zone_name": zone_name,
            "image_url": None,
            "image_id": None,
            "cached": False,
            "message": "Running in Demo/Fallback Mode."
        }), 200

    try:
        conn = connect()
        coll = conn.get_collection()
        
        try:
            sandbox = conn.get_sandbox(sandbox_id)
        except Exception as sb_exc:
            logger.warning("Sandbox %s not found or expired. Falling back to Demo Mode: %s", sandbox_id, str(sb_exc))
            return jsonify({
                "zone_name": zone_name,
                "image_url": None,
                "image_id": None,
                "cached": False,
                "message": f"Sandbox not found. Running in Fallback Mode."
            }), 200

        # Check ready status and block if still provisioning
        if not getattr(sandbox, "is_active", False) and getattr(sandbox, "status", "") != "active":
            logger.info("Sandbox %s not active yet. Waiting for ready state in generate_background...", sandbox_id)
            sandbox.wait_for_ready(timeout=180, interval=3)

        logger.info("Generating FLUX image (sandbox=%s) ...", sandbox_id)
        job = coll.generate_image(
            prompt=prompt,
            model_name=SandboxModel.FLUX,
            sandbox_id=sandbox_id,
            aspect_ratio="16:9",
            config={
                "size": "1280x720",
                "num_inference_steps": 28,
                "guidance_scale": 4.0,
            },
        )
        image = job.wait(timeout=300, interval=3)
        url = image.generate_url()
        logger.info("Image ready: %s", url)

        return jsonify({
            "zone_name": zone_name,
            "image_url": url,
            "image_id": image.id,
            "cached": False,
        }), 200

    except Exception as exc:
        logger.exception("Image generation failed. Falling back to Demo Mode.")
        return jsonify({
            "zone_name": zone_name,
            "image_url": None,
            "image_id": None,
            "cached": False,
            "error": str(exc),
        }), 200


@app.route("/api/generate-narration", methods=["POST"])
def generate_narration():
    """Generate a voice-over narration using OmniVoice on the specified sandbox (with Demo fallback support)."""
    data = request.get_json(silent=True) or {}
    text = data.get("text", "").strip()
    sandbox_id = data.get("sandbox_id")

    if not text:
        return jsonify({"error": "'text' is required."}), 400

    # --- Resilient Fallback to Demo Mode ---
    if not _is_ready() or _is_invalid_sandbox(sandbox_id):
        logger.info("Narration request processed in Fallback Mode (Sandbox ID is null/undefined).")
        return jsonify({
            "audio_url": None,
            "audio_id": None,
            "audio_length": 5.0,
            "cached": False,
            "message": "Running in Demo/Fallback Mode."
        }), 200

    try:
        conn = connect()
        coll = conn.get_collection()
        
        try:
            sandbox = conn.get_sandbox(sandbox_id)
        except Exception as sb_exc:
            logger.warning("Sandbox %s not found or expired. Falling back to Demo Mode: %s", sandbox_id, str(sb_exc))
            return jsonify({
                "audio_url": None,
                "audio_id": None,
                "audio_length": 5.0,
                "cached": False,
                "message": "Sandbox not found. Running in Fallback Mode."
            }), 200

        # Check ready status and block if still provisioning
        if not getattr(sandbox, "is_active", False) and getattr(sandbox, "status", "") != "active":
            logger.info("Sandbox %s not active yet. Waiting for ready state in generate_narration...", sandbox_id)
            sandbox.wait_for_ready(timeout=180, interval=3)

        logger.info("Generating narration (sandbox=%s) ...", sandbox_id)
        job = coll.generate_voice(
            text=text,
            model_name=SandboxModel.OMNIVOICE,
            sandbox_id=sandbox_id,
            config={
                "instructions": (
                    "Epic male narrator voice, deep and dramatic, "
                    "like a dungeon master narrating a fantasy game"
                ),
            },
        )
        audio = job.wait(timeout=300, interval=3)
        url = audio.generate_url()
        logger.info("Narration ready: %s", url)

        return jsonify({
            "audio_url": url,
            "audio_id": audio.id,
            "audio_length": float(audio.length) if hasattr(audio, "length") else 5.0,
            "cached": False,
        }), 200

    except Exception as exc:
        logger.exception("Narration generation failed. Falling back to Demo Mode.")
        return jsonify({
            "audio_url": None,
            "audio_id": None,
            "audio_length": 5.0,
            "cached": False,
            "error": str(exc),
        }), 200


@app.route("/api/generate-trailer", methods=["POST"])
def generate_trailer():
    """Stitch FLUX background images and OmniVoice voice clips into a compiled highlights trailer using VideoDB timeline editor."""
    data = request.get_json(silent=True) or {}
    sandbox_id = data.get("sandbox_id")
    zones_visited = data.get("zones_visited", ["forest", "cave", "volcano", "sky", "space"])
    theme = data.get("theme", "")
    assets = data.get("assets", {}) # Stateless metadata passed by the client

    # --- Resilient Fallback to Demo Mode ---
    if not _is_ready() or _is_invalid_sandbox(sandbox_id):
        logger.info("Trailer request processed in Fallback Mode (Sandbox ID is null/undefined).")
        return jsonify({
            "stream_url": None,
            "player_url": None,
            "success": True,
            "error": "Running in Demo/Fallback Mode."
        }), 200

    try:
        from videodb.editor import Timeline, Track, Clip, ImageAsset, AudioAsset, Fit
        
        conn = connect()
        
        try:
            sandbox = conn.get_sandbox(sandbox_id)
        except Exception as sb_exc:
            logger.warning("Sandbox %s not found or expired. Falling back to Demo Mode: %s", sandbox_id, str(sb_exc))
            return jsonify({
                "stream_url": None,
                "player_url": None,
                "success": True,
                "error": "Sandbox expired. Running in Fallback Mode."
            }), 200

        # Check ready status and block if still provisioning
        if not getattr(sandbox, "is_active", False) and getattr(sandbox, "status", "") != "active":
            logger.info("Sandbox %s not active yet. Waiting for ready state in generate_trailer...", sandbox_id)
            sandbox.wait_for_ready(timeout=180, interval=3)

        timeline = Timeline(conn)
        timeline.resolution = "1280x720"
        timeline.background = "#0b0b0f"

        image_track = Track()
        audio_track = Track()
        
        current_time = 0.0

        for zone in zones_visited:
            zone_assets = assets.get(zone)
            if not zone_assets:
                continue

            img_id = zone_assets.get("image_id")
            aud_id = zone_assets.get("audio_id")
            aud_len = float(zone_assets.get("audio_length", 5.0))
            
            if img_id and aud_id:
                image_track.add_clip(current_time, Clip(asset=ImageAsset(id=img_id), duration=aud_len, fit=Fit.crop))
                audio_track.add_clip(current_time, Clip(asset=AudioAsset(id=aud_id), duration=aud_len))
                current_time += aud_len

        if current_time > 0:
            timeline.add_track(image_track)
            timeline.add_track(audio_track)
            
            stream_url = timeline.generate_stream()
            player_url = getattr(timeline, "player_url", None) or f"https://player.videodb.io/watch?v={stream_url}"
            
            logger.info("Compiled highlights trailer: %s", player_url)
            return jsonify({
                "stream_url": stream_url,
                "player_url": player_url,
                "success": True
            }), 200
        else:
            return jsonify({
                "error": "No matching generated assets were found in this session to stitch.",
                "success": False
            }), 200

    except Exception as exc:
        logger.exception("Failed to generate trailer video. Falling back to Demo Mode.")
        return jsonify({
            "stream_url": None,
            "player_url": None,
            "success": True,
            "error": f"Stitching failed: {str(exc)}"
        }), 200


@app.route("/api/status", methods=["GET"])
def get_status():
    """Return the general API availability status."""
    return jsonify({
        "videodb_available": VIDEODB_AVAILABLE,
        "api_key_set": bool(VIDEODB_API_KEY),
        "mode": "full" if _is_ready() else "demo",
    }), 200


@app.route("/api/stop-sandbox", methods=["POST"])
def stop_sandbox():
    """Stop a running sandbox."""
    data = request.get_json(silent=True) or {}
    sandbox_id = data.get("sandbox_id")

    if _is_invalid_sandbox(sandbox_id):
        return jsonify({"error": "'sandbox_id' is required."}), 400

    if not _is_ready():
        return jsonify({
            "sandbox_id": sandbox_id,
            "status": "demo_mode",
            "message": _demo_error_message(),
        }), 200

    try:
        conn = connect()
        sandbox = conn.get_sandbox(sandbox_id)
        logger.info("Stopping sandbox %s …", sandbox_id)
        sandbox.stop()
        
        return jsonify({
            "sandbox_id": sandbox_id,
            "status": "stopped",
        }), 200

    except Exception as exc:
        logger.exception("Failed to stop sandbox %s.", sandbox_id)
        return jsonify({
            "sandbox_id": sandbox_id,
            "status": "error",
            "error": str(exc),
        }), 500

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logger.info("Starting Adaptive Arena server on http://0.0.0.0:5050")
    app.run(host="0.0.0.0", port=5050, debug=True, use_reloader=False)
