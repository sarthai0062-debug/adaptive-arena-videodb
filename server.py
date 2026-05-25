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
    from videodb.job import GenerationJob
    from videodb.image import Image
    from videodb.audio import Audio

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


def _sandbox_status_str(sandbox) -> str:
    status = getattr(sandbox, "status", "unknown")
    if hasattr(status, "value"):
        return str(status.value).lower()
    return str(status).lower()


def _ensure_sandbox_ready(sandbox_id: str):
    """Return an active sandbox, waiting briefly if still provisioning."""
    conn = connect()
    sandbox = conn.get_sandbox(sandbox_id)
    if getattr(sandbox, "is_active", False) or _sandbox_status_str(sandbox) == "active":
        return sandbox
    logger.info("Sandbox %s not active yet. Waiting for ready state...", sandbox_id)
    sandbox.wait_for_ready(timeout=180, interval=3)
    return sandbox


def _optional_url(asset):
    """Best-effort signed URL; timeline stitching only needs asset ids."""
    try:
        return asset.generate_url()
    except Exception as exc:
        logger.info("generate_url skipped (asset id is sufficient): %s", exc)
        return None


def _resolve_generation_job(job_id: str, result_type: str) -> dict:
    """Poll a VideoDB generation job and return a JSON-serializable status payload."""
    conn = connect()
    job = GenerationJob(conn, job_id, result_type=result_type)
    job.refresh()

    if job.status in ("processing", "pending", "queued"):
        return {"status": "processing", "job_id": job_id}

    if job.status == "failed":
        return {"status": "failed", "job_id": job_id, "error": "Generation job failed"}

    try:
        asset = job._to_asset()
    except Exception as exc:
        logger.warning("Could not resolve asset for job %s: %s", job_id, exc)
        return {"status": "failed", "job_id": job_id, "error": str(exc)}

    if isinstance(asset, Image):
        payload = {
            "status": "completed",
            "job_id": job_id,
            "image_id": asset.id,
        }
        url = _optional_url(asset)
        if url:
            payload["image_url"] = url
        return payload

    if isinstance(asset, Audio):
        payload = {
            "status": "completed",
            "job_id": job_id,
            "audio_id": asset.id,
            "audio_length": float(asset.length) if hasattr(asset, "length") else 5.0,
        }
        url = _optional_url(asset)
        if url:
            payload["audio_url"] = url
        return payload

    # Fallback: read id from raw job payload
    data = job.data or {}
    asset_id = data.get("id")
    if asset_id and asset_id.startswith("img-"):
        return {"status": "completed", "job_id": job_id, "image_id": asset_id}
    if asset_id and asset_id.startswith("a-"):
        return {
            "status": "completed",
            "job_id": job_id,
            "audio_id": asset_id,
            "audio_length": float(data.get("length", 5.0)),
        }

    return {"status": "failed", "job_id": job_id, "error": "Unknown generation result"}


# Zone content for on-demand trailer asset generation (VideoDB sandbox guide pattern)
ZONE_CONTENT = {
    "forest": {
        "prompt": (
            "A mystical enchanted forest at twilight with glowing mushrooms, fireflies, "
            "ancient trees with luminous vines, fantasy game art, panoramic wide landscape, vibrant colors"
        ),
        "narration": "You enter the Enchanted Forest. Ancient trees whisper of forgotten battles.",
    },
    "cave": {
        "prompt": (
            "A vast crystal cave with bioluminescent crystals, underground lake reflections, "
            "purple and blue glowing formations, fantasy game art, panoramic wide landscape"
        ),
        "narration": "Darkness engulfs you as you descend into the Crystal Caves. Shadow bats circle overhead.",
    },
    "volcano": {
        "prompt": (
            "An erupting volcano landscape with rivers of flowing lava, dark red sky, obsidian rocks, "
            "fire embers floating, dramatic fantasy game art, panoramic wide landscape"
        ),
        "narration": "The ground shakes beneath your feet. Welcome to the Volcanic Depths, warrior.",
    },
    "sky": {
        "prompt": (
            "A floating castle in the sky above clouds at golden hour, majestic towers, birds flying, "
            "rainbow light rays, fantasy game art, panoramic wide landscape"
        ),
        "narration": "You ascend to the Sky Castle. Wind howls through floating ruins.",
    },
    "space": {
        "prompt": (
            "A colorful deep space nebula with distant galaxies, alien planet surfaces, cosmic dust clouds, "
            "neon colors, sci-fi game art, panoramic wide landscape"
        ),
        "narration": "The final frontier. Deep Space awaits. Only the strongest survive here.",
    },
}


def _wait_generation_job(job, timeout: int = 240):
    """Block until a GenerationJob completes and return the asset."""
    if isinstance(job, (Image, Audio)):
        return job
    return job.wait(timeout=timeout, interval=3)


def _generate_zone_assets(conn, coll, sandbox_id: str, zone: str, theme: str = "") -> dict:
    """Generate FLUX image + OmniVoice narration for one zone (hackathon combine-assets flow)."""
    info = ZONE_CONTENT.get(zone)
    if not info:
        raise ValueError(f"Unknown zone: {zone}")

    prompt = info["prompt"]
    if theme:
        prompt = f"{theme} style, {prompt}"

    _ensure_sandbox_ready(sandbox_id)

    image_job = coll.generate_image(
        prompt=prompt,
        model_name=SandboxModel.FLUX,
        sandbox_id=sandbox_id,
        aspect_ratio="16:9",
        wait=False,
        config={"size": "1280x720", "num_inference_steps": 28, "guidance_scale": 4.0},
    )
    image = _wait_generation_job(image_job, timeout=240)

    voice_job = coll.generate_voice(
        text=info["narration"],
        model_name=SandboxModel.OMNIVOICE,
        sandbox_id=sandbox_id,
        wait=False,
        config={
            "instructions": (
                "Epic male narrator voice, deep and dramatic, "
                "like a dungeon master narrating a fantasy game"
            ),
        },
    )
    audio = _wait_generation_job(voice_job, timeout=120)

    return {
        "image_id": image.id,
        "image_url": _optional_url(image),
        "audio_id": audio.id,
        "audio_url": _optional_url(audio),
        "audio_length": float(audio.length) if hasattr(audio, "length") else 5.0,
    }

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
            tier=SandboxTier.medium,
            idle_timeout=600,
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


@app.route("/api/generation-status", methods=["GET"])
def generation_status():
    """Poll a FLUX/OmniVoice generation job (client-side polling for serverless timeouts)."""
    job_id = request.args.get("job_id")
    result_type = request.args.get("type", "image")

    if not job_id:
        return jsonify({"error": "'job_id' query parameter is required."}), 400

    if not _is_ready():
        return jsonify({"status": "demo_mode", "message": _demo_error_message()}), 200

    try:
        payload = _resolve_generation_job(job_id, result_type)
        return jsonify(payload), 200
    except Exception as exc:
        logger.warning("Failed to resolve generation job %s: %s", job_id, str(exc))
        err_msg = str(exc)
        return jsonify({
            "status": "failed",
            "job_id": job_id,
            "error": err_msg,
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
            _ensure_sandbox_ready(sandbox_id)
        except Exception as sb_exc:
            logger.warning("Sandbox %s not found or expired. Falling back to Demo Mode: %s", sandbox_id, str(sb_exc))
            return jsonify({
                "zone_name": zone_name,
                "image_url": None,
                "image_id": None,
                "cached": False,
                "message": "Sandbox not found. Running in Fallback Mode."
            }), 200

        logger.info("Submitting FLUX image job (sandbox=%s) ...", sandbox_id)
        result = coll.generate_image(
            prompt=prompt,
            model_name=SandboxModel.FLUX,
            sandbox_id=sandbox_id,
            aspect_ratio="16:9",
            wait=False,
            config={
                "size": "1280x720",
                "num_inference_steps": 28,
                "guidance_scale": 4.0,
            },
        )

        if isinstance(result, Image):
            payload = {
                "zone_name": zone_name,
                "status": "completed",
                "image_id": result.id,
                "cached": False,
            }
            url = _optional_url(result)
            if url:
                payload["image_url"] = url
                logger.info("Image ready immediately: %s", url)
            else:
                logger.info("Image ready (id=%s), url skipped due to plan limits.", result.id)
            return jsonify(payload), 200

        return jsonify({
            "zone_name": zone_name,
            "status": "processing",
            "job_id": result.job_id,
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
            _ensure_sandbox_ready(sandbox_id)
        except Exception as sb_exc:
            logger.warning("Sandbox %s not found or expired. Falling back to Demo Mode: %s", sandbox_id, str(sb_exc))
            return jsonify({
                "audio_url": None,
                "audio_id": None,
                "audio_length": 5.0,
                "cached": False,
                "message": "Sandbox not found. Running in Fallback Mode."
            }), 200

        logger.info("Submitting OmniVoice job (sandbox=%s) ...", sandbox_id)
        result = coll.generate_voice(
            text=text,
            model_name=SandboxModel.OMNIVOICE,
            sandbox_id=sandbox_id,
            wait=False,
            config={
                "instructions": (
                    "Epic male narrator voice, deep and dramatic, "
                    "like a dungeon master narrating a fantasy game"
                ),
            },
        )

        if isinstance(result, Audio):
            payload = {
                "status": "completed",
                "audio_id": result.id,
                "audio_length": float(result.length) if hasattr(result, "length") else 5.0,
                "cached": False,
            }
            url = _optional_url(result)
            if url:
                payload["audio_url"] = url
                logger.info("Narration ready immediately: %s", url)
            return jsonify(payload), 200

        return jsonify({
            "status": "processing",
            "job_id": result.job_id,
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


@app.route("/api/prepare-zone-assets", methods=["POST"])
def prepare_zone_assets():
    """Generate FLUX + OmniVoice for a single zone (used when stitching highlights)."""
    data = request.get_json(silent=True) or {}
    sandbox_id = data.get("sandbox_id")
    zone = data.get("zone")
    theme = data.get("theme", "")

    if not zone or zone not in ZONE_CONTENT:
        return jsonify({"error": "Valid 'zone' is required."}), 400

    if not _is_ready() or _is_invalid_sandbox(sandbox_id):
        return jsonify({"success": False, "error": _demo_error_message()}), 200

    try:
        conn = connect()
        coll = conn.get_collection()
        payload = _generate_zone_assets(conn, coll, sandbox_id, zone, theme)
        return jsonify({"success": True, "zone": zone, **payload}), 200
    except Exception as exc:
        logger.exception("Failed to prepare zone assets for %s", zone)
        return jsonify({"success": False, "zone": zone, "error": str(exc)}), 200


@app.route("/api/generate-trailer", methods=["POST"])
def generate_trailer():
    """Stitch FLUX background images and OmniVoice voice clips into a compiled highlights trailer using VideoDB timeline editor."""
    data = request.get_json(silent=True) or {}
    sandbox_id = data.get("sandbox_id")
    zones_visited = data.get("zones_visited", ["forest", "cave", "volcano", "sky", "space"])
    theme = data.get("theme", "")
    assets = dict(data.get("assets") or {})

    # --- Resilient Fallback to Demo Mode ---
    if not _is_ready() or _is_invalid_sandbox(sandbox_id):
        logger.info("Trailer request processed in Fallback Mode (Sandbox ID is null/undefined).")
        return jsonify({
            "stream_url": None,
            "player_url": None,
            "success": False,
            "error": "Running in Demo/Fallback Mode. Start a game session with Sandbox Active first."
        }), 200

    try:
        from videodb.editor import Timeline, Track, Clip, ImageAsset, AudioAsset, Fit
        
        conn = connect()
        coll = conn.get_collection()
        
        try:
            _ensure_sandbox_ready(sandbox_id)
        except Exception as sb_exc:
            logger.warning("Sandbox %s not found or expired. Falling back to Demo Mode: %s", sandbox_id, str(sb_exc))
            return jsonify({
                "stream_url": None,
                "player_url": None,
                "success": False,
                "error": "Sandbox expired. Running in Fallback Mode."
            }), 200

        timeline = Timeline(conn)
        timeline.resolution = "1280x720"
        timeline.background = "#0b0b0f"

        image_track = Track()
        audio_track = Track()
        
        current_time = 0.0

        for zone in zones_visited:
            zone_assets = assets.get(zone) or {}
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
                "error": (
                    "No FLUX/OmniVoice assets found for this session. "
                    "Play through zones with Sandbox Active so backgrounds and narration can finish generating."
                ),
                "success": False
            }), 200

    except Exception as exc:
        logger.exception("Failed to generate trailer video.")
        return jsonify({
            "stream_url": None,
            "player_url": None,
            "success": False,
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
