# Adaptive Arena — AI-Driven 2D Sandbox Combat Game

Adaptive Arena is an immersive, retro-futuristic 2D side-scrolling action game where the visual context, opponent dynamics, and visual backgrounds adapt in real-time based on the player's movement and progression. 

The game uses **VideoDB's Sandbox FLUX Image Generation API** to dynamically generate and stream high-fidelity theme-specific backgrounds in real-time as the player advances through different zones.

---

## 🎮 Game Universe & Adaptive Elements

The game is divided into **5 progressive zones** along a 10,000px wide game world. Each zone triggers an immediate transition of all combat dynamics and requests a new AI background:

| Zone | Range (X) | Theme & Atmosphere | Enemy Type | Aesthetics |
| :--- | :--- | :--- | :--- | :--- |
| **Forest** | `0px - 2000px` | Enchanted Forest, glowing mushrooms | Green Slimes | Emerald `#0a3d0a` |
| **Cave** | `2000px - 4000px` | Bioluminescent Crystal Cave | Shadow Bats | Neon Purple `#1a0a3d` |
| **Volcano** | `4000px - 6000px` | Lava Rivers, erupting obsidian crater | Fire Elementals | Lava Red `#3d0a0a` |
| **Sky Castle** | `6000px - 8000px` | Floating Castle above golden-hour clouds | Sky Knights | Sky Blue `#0a1a3d` |
| **Deep Space** | `8000px - 10000px`| Cosmic Nebula, alien planet surface | Alien Ships | Deep Space `#0a0a1a` |

---

## 🛠️ Technology Stack

### Backend (Python)
* **Flask Server**: Manages sessions, handles client requests, caches URLs, and coordinates the VideoDB lifecycle.
* **VideoDB Python SDK**: Orchestrates dedicated medium-tier sandboxes, invokes the **FLUX** image generation model, and generates signed image URLs.
* **Demo-Mode Fallback**: If the SDK is missing or no `VIDEODB_API_KEY` is provided, the server gracefully runs in **Demo Mode**, utilizing gorgeous custom CSS gradients and floating parallax particles so the game is immediately playable anywhere.

### Advanced Frontend (HTML5 / Vanilla CSS / JS)
* **HTML5 Canvas**: High-performance rendering engine executing game physics, collision detection, sprite animations, and particles at 60fps.
* **Modern CSS System**: Styled using a premium, retro-futuristic dark mode theme with glassmorphic panels, HUD progress bars, and glowing animations.
* **Modular JavaScript**: Organized into distinct, single-responsibility modules:
  * `js/audio.js`: Programmatic retro sound effects generator utilizing the **Web Audio API**.
  * `js/api.js`: VideoDB backend client with timeouts and caching.
  * `js/background.js`: 3-layer parallax particle & crossfade rendering system.
  * `js/player.js`: Player physics, controls, trails, attack arcs, and sound trigger calls.
  * `js/enemies.js`: Unique zone-specific enemy behavioral AI and rendering.
  * `js/game.js`: Orchestrator driving the delta-time game loop, scroll camera, and visual toasts.

---

## 🚀 Getting Started

### 1. Prerequisites
Ensure you have **Python 3.10+** and **Git** installed on your system.

### 2. Set Up Virtual Environment & Dependencies
Clone or navigate to the project directory and run:

```bash
# Create a virtual environment
python3 -m venv .venv

# Activate the virtual environment
source .venv/bin/activate  # On macOS/Linux
# .venv\Scripts\activate   # On Windows

# Install the dependencies (including VideoDB SDK from the hackathon branch)
pip install -r requirements.txt
```

### 3. Set Up VideoDB API Key (Optional for Full Mode)
To experience the live AI image generation, set your VideoDB API key in your environment variables. Get one from [console.videodb.io](https://console.videodb.io/dashboard).

```bash
export VIDEODB_API_KEY="your_videodb_api_key_here"
```
*Note: If this variable is omitted, the game automatically runs in **Demo Mode** with fully functional gameplay and beautiful animated procedural backgrounds.*

### 4. Start the Server
Run the Flask server:
```bash
python server.py
```
The server will start on `http://localhost:5050` and serve all static files.

### 5. Play the Game!
Open your web browser and navigate to:
👉 **[http://localhost:5050](http://localhost:5050)**

---

## 🕹️ Controls

* **Move Left / Right**: <kbd>A</kbd> / <kbd>D</kbd> or <kbd>◀</kbd> / <kbd>▶</kbd>
* **Jump**: <kbd>W</kbd> or <kbd>▲</kbd>
* **Cyber-Slash Attack**: <kbd>Spacebar</kbd> (defeats zone enemies and adds score)

---

## ⚡ Smart Optimization: Pre-Fetching Strategy

FLUX image generation takes between 5 to 15 seconds to complete. To maintain a smooth, uninterrupted gameplay flow, Adaptive Arena employs a **smart pre-fetching strategy**:

1. While the player is running through the middle of their current zone (e.g. at `x = 1500px` in the Forest), the frontend detects that they are approaching the Cave boundary (`x = 2000px`).
2. The game proactively makes a background API call to pre-generate the Cave background *before* the player actually crosses the boundary.
3. When the player crosses the boundary, if the image has already completed, it **crossfades** in seamlessly using an alpha transition over 2 seconds.
4. If the image is still generating, the game displays a beautiful animated procedural gradient of the new zone's theme, swapping in the FLUX background the instant it resolves.

---

## 🛡️ Sandbox Credit Preservation

Dedicated GPU sandboxes are active billing resources. To ensure that compute credits are preserved:
* The backend configures an automatic `idle_timeout` of 10 minutes (`600s`) when provisioning the sandbox.
* When the game ends (Player Health reaches 0), the frontend sends a stop request (`POST /api/stop-sandbox`) to immediately shut down the sandbox compute resource.

---

## 🔬 Codebase Map

* [server.py](file:///Users/sarthakmac/Desktop/projects/dorahacks/videodb/test2/server.py): Flask backend server & VideoDB FLUX integration.
* [index.html](file:///Users/sarthakmac/Desktop/projects/dorahacks/videodb/test2/index.html): Semantic layout, HUD, start/game-over screens.
* [index.css](file:///Users/sarthakmac/Desktop/projects/dorahacks/videodb/test2/index.css): Full design system, neon styles, glassmorphism.
* [js/audio.js](file:///Users/sarthakmac/Desktop/projects/dorahacks/videodb/test2/js/audio.js): Real-time programmatic synthesiser module (Web Audio).
* [js/api.js](file:///Users/sarthakmac/Desktop/projects/dorahacks/videodb/test2/js/api.js): REST client for Flask endpoints.
* [js/background.js](file:///Users/sarthakmac/Desktop/projects/dorahacks/videodb/test2/js/background.js): Animated gradients, crossfading, pre-fetching.
* [js/player.js](file:///Users/sarthakmac/Desktop/projects/dorahacks/videodb/test2/js/player.js): Controls, movement physics, cyber trails.
* [js/enemies.js](file:///Users/sarthakmac/Desktop/projects/dorahacks/videodb/test2/js/enemies.js): Procedural enemy shapes, stats, and zone AI.
* [js/game.js](file:///Users/sarthakmac/Desktop/projects/dorahacks/videodb/test2/js/game.js): Main delta-time loop, scroll camera, HUD.
