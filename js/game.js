/* ============================================
   game.js — Main Game Orchestrator & Loop
   ============================================ */
const Game = (() => {
    let canvas = null;
    let ctx = null;
    let lastTime = 0;
    let gameActive = false;
    let isGameOver = false;
    let isPaused = false;
    let cameraX = 0;
    let activeZone = 'forest';
    const ZONE_ORDER = ['forest','cave','volcano','sky','space'];
    let zoneIndex = 0;
    let zoneTimer = null;
    const ZONE_DURATION_MS = 30000;

    // Stats, Wave, and Highlights systems
    let killCombo = 0;
    let killComboTimer = 0;
    let enemiesDefeated = 0;
    let maxCombo = 0;
    let survivalStartTime = 0;
    let currentWave = 1;
    let zonesVisited = new Set();

    // DOM Elements
    let startScreen = null;
    let loadingScreen = null;
    let gameOverScreen = null;
    let hud = null;
    let healthFill = null;
    let scoreValue = null;
    let zoneValue = null;
    let zoneToast = null;
    let connectionDot = null;
    let connectionText = null;
    let startButton = null;
    let restartButton = null;
    let loadingText = null;
    let performanceModal = null;
    let modalThemeValue = null;
    let modalRankValue = null;
    let modalRankDesc = null;
    let userTheme = "Retro Cyberpunk City";
    let lastPopupShownAt = 0;
    const MIN_POPUP_TIME = 2500;

    async function init() {
        console.log('[Game] Initializing...');

        // 1. Get DOM elements
        canvas = document.getElementById('game-canvas');
        if (!canvas) {
            console.error('[Game] Canvas element not found!');
            return;
        }
        ctx = canvas.getContext('2d');

        startScreen = document.getElementById('start-screen');
        loadingScreen = document.getElementById('loading-screen');
        gameOverScreen = document.getElementById('game-over-screen');
        hud = document.getElementById('hud');
        healthFill = document.getElementById('health-fill');
        scoreValue = document.getElementById('score-value');
        zoneValue = document.getElementById('zone-value');
        zoneToast = document.getElementById('zone-toast');
        connectionDot = document.getElementById('connection-dot');
        connectionText = document.getElementById('connection-text');
        startButton = document.getElementById('start-btn');
        restartButton = document.getElementById('restart-btn');
        loadingText = document.getElementById('loading-text');
        performanceModal = document.getElementById('performance-modal');
        modalThemeValue = document.getElementById('modal-theme-value');
        modalRankValue = document.getElementById('modal-rank-value');
        modalRankDesc = document.getElementById('modal-rank-desc');

        // 2. Initialize Game Entities
        Player.init();
        Background.init(canvas);
        Enemies.reset();
        if (typeof Platforms !== 'undefined') Platforms.init();
        if (typeof Collectibles !== 'undefined') Collectibles.reset();

        // 3. Event Listeners
        startButton.addEventListener('click', startGame);
        restartButton.addEventListener('click', restartGame);

        // Pause Menu Event Listeners
        const resumeBtn = document.getElementById('pause-resume-btn');
        const pauseRestartBtn = document.getElementById('pause-restart-btn');
        if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);
        if (pauseRestartBtn) {
            pauseRestartBtn.addEventListener('click', () => {
                resumeGame();
                restartGame();
            });
        }

        window.addEventListener('keydown', e => {
            if (e.code === 'Escape') {
                togglePause();
            }
        });

        // Highlights Trailer Click Listener
        const generateTrailerBtn = document.getElementById('generate-trailer-btn');
        if (generateTrailerBtn) {
            generateTrailerBtn.addEventListener('click', handleTrailerGeneration);
        }

        // 4. Initial connection check (VideoDB API key + SDK on server)
        updateConnectionStatus(false, 'Connecting...');
        const status = await API.getStatus();
        if (status && status.mode === 'full') {
            updateConnectionStatus(true, 'VideoDB Ready');
        } else if (status && !status.api_key_set) {
            updateConnectionStatus(false, 'Demo Mode — API Key Missing');
        } else if (status && !status.videodb_available) {
            updateConnectionStatus(false, 'Demo Mode — SDK Missing');
        } else {
            updateConnectionStatus(false, 'VideoDB Demo Mode');
        }

        // Set initial state
        resetHUD();
    }

    // Timer based zone management
    function startZoneTimer() {
        if (zoneTimer) clearTimeout(zoneTimer);
        zoneTimer = setTimeout(advanceZone, ZONE_DURATION_MS);
    }

    function advanceZone() {
        zoneIndex = (zoneIndex + 1) % ZONE_ORDER.length;
        const newZone = ZONE_ORDER[zoneIndex];
        activeZone = newZone;
        
        // Track visited zone
        zonesVisited.add(newZone);

        // Increment Wave
        currentWave++;
        const waveValueEl = document.getElementById('wave-value');
        if (waveValueEl) waveValueEl.textContent = currentWave;

        // Warp the player to the new zone's start area
        const newX = zoneIndex * 2000 + 200;
        Player.warp(newX);

        // Update background and player theme
        Background.setZone(newZone, userTheme);
        Player.setTheme(`${userTheme}-${newZone}`);
        
        showZoneToast(Background.ZONES[newZone] ? Background.ZONES[newZone].name : newZone);
        
        // Audio and Narration
        if (typeof Narrator !== 'undefined') Narrator.play('zone_' + newZone);
        if (typeof Sound !== 'undefined') Sound.startAmbient(newZone);

        startZoneTimer();
    }

    function clearZoneTimer() {
        if (zoneTimer) { clearTimeout(zoneTimer); zoneTimer = null; }
    }

    function updateConnectionStatus(connected, text) {
        if (!connectionDot || !connectionText) return;
        if (connected) {
            connectionDot.className = 'connection-dot connected';
        } else {
            connectionDot.className = 'connection-dot disconnected';
        }
        connectionText.textContent = text;
    }

    async function startGame() {
        console.log('[Game] Starting Game Session...');

        const themeInput = document.getElementById('theme-input');
        if (themeInput && themeInput.value) {
            userTheme = themeInput.value.trim();
        }
        Player.setTheme(userTheme);

        // Show loading screen
        startScreen.classList.add('hidden');
        loadingScreen.classList.remove('hidden');

        if (loadingText) {
            loadingText.textContent = 'Starting VideoDB Sandbox...';
        }

        // Initialize sandbox connection
        updateConnectionStatus(false, 'Starting Sandbox...');
        const sandboxSession = await API.startSandbox();

        if (sandboxSession && sandboxSession.status === 'demo_mode') {
            updateConnectionStatus(false, 'Demo Mode (Offline)');
            console.warn('[Game] VideoDB backend in demo mode:', sandboxSession.message);
        } else if (API.sandboxId) {
            const label = sandboxSession.status === 'provisioning'
                ? 'Sandbox Warming Up'
                : 'Sandbox Active';
            updateConnectionStatus(true, label);
            console.log('[Game] VideoDB Sandbox:', API.sandboxId, sandboxSession.status);
        } else {
            updateConnectionStatus(false, 'Demo Mode (Offline)');
            console.warn('[Game] VideoDB Sandbox not started. Falling back to procedural Demo Mode.');
        }

        // Load the initial Forest background
        if (loadingText) {
            loadingText.textContent = 'Generating Enchanted Forest...';
        }
        Background.prefetchZone('forest', userTheme);

        // Wait a tiny bit for prefetch to start, then fade out loading screen
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            hud.classList.remove('hidden');
            gameActive = true;
            isGameOver = false;
            isPaused = false;
            
            // Stats initialization
            killCombo = 0;
            enemiesDefeated = 0;
            maxCombo = 0;
            currentWave = 1;
            zonesVisited = new Set(['forest']);
            survivalStartTime = Date.now();

            // Reset trailer UI elements
            resetTrailerUI();

            lastTime = performance.now();
            requestAnimationFrame(gameLoop);
            startZoneTimer();
            showZoneToast('Enchanted Forest');

            // Play voice-over and ambient sounds
            if (typeof Narrator !== 'undefined') {
                Narrator.play('game_start');
                Narrator.pregenerateAll();
            }
            if (typeof Sound !== 'undefined') {
                Sound.startAmbient('forest');
            }
        }, 1500);
    }

    function restartGame() {
        console.log('[Game] Restarting...');
        gameOverScreen.classList.add('hidden');
        
        Player.reset();
        Enemies.reset();
        if (typeof Platforms !== 'undefined') Platforms.reset();
        if (typeof Collectibles !== 'undefined') Collectibles.reset();

        Background.setZone('forest', userTheme);
        activeZone = 'forest';
        zoneIndex = 0;
        clearZoneTimer();
        startZoneTimer();
        resetHUD();

        killCombo = 0;
        enemiesDefeated = 0;
        maxCombo = 0;
        currentWave = 1;
        zonesVisited = new Set(['forest']);
        survivalStartTime = Date.now();

        // Reset trailer UI elements
        resetTrailerUI();

        isGameOver = false;
        isPaused = false;
        gameActive = true;
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
        showZoneToast('Enchanted Forest');

        // Play sounds
        if (typeof Narrator !== 'undefined') Narrator.play('game_start');
        if (typeof Sound !== 'undefined') Sound.startAmbient('forest');
    }

    function showZoneToast(zoneName) {
        if (!zoneToast) return;
        zoneToast.textContent = zoneName;
        zoneToast.classList.add('visible');
        if (typeof Sound !== 'undefined') Sound.playTransition();

        // Remove after 2.5 seconds
        setTimeout(() => {
            zoneToast.classList.remove('visible');
        }, 2500);
    }

    function resetHUD() {
        if (healthFill) {
            healthFill.style.width = '100%';
            healthFill.classList.remove('low');
        }
        if (scoreValue) scoreValue.textContent = '0000';
        if (zoneValue) zoneValue.textContent = 'Enchanted Forest';
        
        const comboDisplay = document.getElementById('combo-display');
        if (comboDisplay) comboDisplay.classList.add('hidden');
        
        const waveValueEl = document.getElementById('wave-value');
        if (waveValueEl) waveValueEl.textContent = '1';
    }

    function resetTrailerUI() {
        const trailerBox = document.getElementById('trailer-player-box');
        const trailerLoader = document.getElementById('trailer-loader');
        const generateTrailerBtn = document.getElementById('generate-trailer-btn');
        const trailerIframe = document.getElementById('trailer-iframe');
        if (trailerBox) trailerBox.classList.add('hidden');
        if (trailerLoader) trailerLoader.classList.add('hidden');
        if (generateTrailerBtn) {
            generateTrailerBtn.classList.remove('hidden');
            generateTrailerBtn.textContent = 'Stitch highlights video';
        }
        if (trailerIframe) trailerIframe.src = '';
    }

    // Main Game Loop
    function gameLoop(time) {
        if (!gameActive) return;

        const dt = Math.min((time - lastTime) / 1000, 0.1); // Cap delta time to prevent large physics jumps
        lastTime = time;

        if (!isPaused) {
            update(dt);
        }
        render();

        if (!isGameOver) {
            requestAnimationFrame(gameLoop);
        }
    }

    function update(dt) {
        // Decay active kill combo timer
        if (killComboTimer > 0) {
            killComboTimer -= dt;
            if (killComboTimer <= 0) {
                killCombo = 0;
                const comboDisplay = document.getElementById('combo-display');
                if (comboDisplay) comboDisplay.classList.add('hidden');
            }
        }

        // 1. Update background particles and transition state
        Background.update(dt);

        // 2. Update player movement and physics
        Player.update(dt);

        // Update Platforms
        if (typeof Platforms !== 'undefined') Platforms.update(dt);

        // Update Collectibles
        if (typeof Collectibles !== 'undefined') Collectibles.update(dt);

        // 3. Update active zone based on player position
        const currentZone = Background.getZoneForX(Player.x);
        if (currentZone !== activeZone) {
            console.log(`[Game] Zone Transition: ${activeZone} -> ${currentZone}`);
            activeZone = currentZone;
            zoneIndex = ZONE_ORDER.indexOf(currentZone);

            // Track visited zone
            zonesVisited.add(currentZone);

            // Increment Wave
            currentWave++;
            const waveValueEl = document.getElementById('wave-value');
            if (waveValueEl) waveValueEl.textContent = currentWave;

            // Update background and player theme
            Background.setZone(currentZone, userTheme);
            Player.setTheme(`${userTheme}-${currentZone}`);

            // Update UI
            const zoneInfo = Background.ZONES[currentZone];
            if (zoneValue && zoneInfo) {
                zoneValue.textContent = zoneInfo.name;
            }
            showZoneToast(zoneInfo ? zoneInfo.name : currentZone);
            
            // Audio and Voice Narration
            if (typeof Narrator !== 'undefined') Narrator.play('zone_' + currentZone);
            if (typeof Sound !== 'undefined') Sound.startAmbient(currentZone);

            startZoneTimer(); // Reset timer for the new zone
        }

        // Smart pre-fetching system: when player gets close to next boundary, generate background
        handleBackgroundPrefetching();

        // 4. Update enemies and spawn triggers
        Enemies.update(dt, Player.x, activeZone);

        // 5. Collision checks
        handleCollisions();

        // 6. Camera system (Scroll following player)
        cameraX = Player.x - canvas.width / 2;
        cameraX = Math.max(0, Math.min(10000 - canvas.width, cameraX));

        // 7. Update HUD metrics
        updateHUD();

        // 8. Death check
        if (Player.isDead && !isGameOver) {
            triggerGameOver();
        }
    }

    function handleBackgroundPrefetching() {
        if (activeZone === 'forest' && Player.x > 1400) {
            Background.prefetchZone('cave', userTheme);
        } else if (activeZone === 'cave' && Player.x > 3400) {
            Background.prefetchZone('volcano', userTheme);
        } else if (activeZone === 'volcano' && Player.x > 5400) {
            Background.prefetchZone('sky', userTheme);
        } else if (activeZone === 'sky' && Player.x > 7400) {
            Background.prefetchZone('space', userTheme);
        }
    }

    function showPerformancePopup() {
        if (!performanceModal) return;

        // Calculate player performance rank
        const hp = Player.health;
        const score = Player.score;
        let rank = "AVERAGE";
        let desc = "Combat efficiency is steady. Keep pushing forward!";
        
        if (score === 0) {
            rank = "AVERAGE (SURVIVOR)";
            desc = "Your combat stats and scoring rate are perfectly on track.";
        } else {
            const performanceRating = score * (hp / 100);
            if (performanceRating < 15) {
                rank = "WEAK (VULNERABLE)";
                desc = "Warning: High damage detected. Evasive maneuvers required!";
            } else if (performanceRating >= 15 && performanceRating < 60) {
                rank = "AVERAGE (SURVIVOR)";
                desc = "Combat efficiency is steady. Keep pushing forward!";
            } else if (performanceRating >= 60 && performanceRating < 150) {
                rank = "GOOD (EXCEPTIONAL)";
                desc = "Excellent combat performance! You're dominating the arena.";
            } else {
                rank = "GOD-LIKE (LEGEND)";
                desc = "UNSTOPPABLE! You are a legendary warrior of the arena!";
            }
        }

        if (modalThemeValue) modalThemeValue.textContent = userTheme;
        if (modalRankValue) modalRankValue.textContent = rank;
        if (modalRankDesc) modalRankDesc.textContent = desc;

        performanceModal.classList.remove('hidden');
        lastPopupShownAt = Date.now();
        console.log(`[Game] Performance Rating Popup triggered: ${rank}`);
    }

    function hidePerformancePopup() {
        if (!performanceModal) return;
        const elapsed = Date.now() - lastPopupShownAt;
        const remaining = Math.max(0, MIN_POPUP_TIME - elapsed);
        setTimeout(() => {
            performanceModal.classList.add('hidden');
            console.log('[Game] Performance Rating Popup hidden.');
        }, remaining);
    }

    function handleCollisions() {
        if (Player.isDead) return;

        const playerHitBox = Player.getHitBox();
        const playerAttackBox = Player.isAttacking ? Player.getAttackBox() : null;

        const { enemiesHit, playerHit, totalDamage } = Enemies.checkCollisions(playerAttackBox, playerHitBox, Player.x);

        // 1. Process enemies defeated
        if (enemiesHit.length > 0 && typeof Sound !== 'undefined') {
            Sound.playDefeat();
        }
        for (let enemy of enemiesHit) {
            const multiplier = (typeof Collectibles !== 'undefined') ? Collectibles.scoreMultiplier : 1;
            Player.addScore(enemy.score * multiplier);
            enemiesDefeated++;

            // Increment kill streak
            killCombo++;
            killComboTimer = 4.0;
            if (killCombo > maxCombo) maxCombo = killCombo;

            // Update combo HUD indicator
            const comboDisplay = document.getElementById('combo-display');
            const comboCountEl = document.getElementById('combo-count');
            if (comboDisplay && comboCountEl) {
                comboCountEl.textContent = killCombo;
                comboDisplay.classList.remove('hidden');
                comboDisplay.classList.remove('pulse');
                void comboDisplay.offsetWidth; // force reflow
                comboDisplay.classList.add('pulse');
            }

            // Streak check
            if (killCombo === 2) {
                showKillStreak("DOUBLE KILL!");
                if (typeof Sound !== 'undefined') Sound.playComboAnnounce(1);
            } else if (killCombo === 3) {
                showKillStreak("TRIPLE KILL!");
                if (typeof Sound !== 'undefined') Sound.playComboAnnounce(2);
            } else if (killCombo >= 5) {
                showKillStreak("GODLIKE!");
                if (typeof Sound !== 'undefined') Sound.playComboAnnounce(3);
                if (typeof Narrator !== 'undefined') Narrator.play('combo_godlike');
            }

            console.log(`[Game] Defeated ${enemy.name}! +${enemy.score * multiplier} points.`);
        }

        // 2. Process player damage
        if (playerHit && totalDamage > 0) {
            Player.takeDamage(totalDamage);
            if (typeof Sound !== 'undefined') Sound.playHit();
            console.log(`[Game] Player took ${totalDamage} damage! Health: ${Player.health}`);
        }

        // 3. Process collectible pickups
        if (typeof Collectibles !== 'undefined') {
            const item = Collectibles.checkCollection(playerHitBox);
            if (item) {
                if (typeof Sound !== 'undefined') Sound.playPickup(item.type);
                if (item.type === 'health') {
                    Player.takeDamage(-item.value); // negative damage heals!
                }
                console.log(`[Game] Collected ${item.type} power-up!`);
            }
        }
    }

    function updateHUD() {
        if (healthFill) {
            const healthPct = (Player.health / Player.maxHealth) * 100;
            healthFill.style.width = `${healthPct}%`;

            if (healthPct < 30) {
                healthFill.classList.add('low');
            } else {
                healthFill.classList.remove('low');
            }
        }

        if (scoreValue) {
            scoreValue.textContent = String(Player.score).padStart(4, '0');
        }
    }

    function render() {
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 1. Render Layered Dynamic Background
        Background.render(ctx, canvas);

        // 2. Render Platforms
        if (typeof Platforms !== 'undefined') Platforms.render(ctx, cameraX);

        // 3. Render Collectibles
        if (typeof Collectibles !== 'undefined') Collectibles.render(ctx, cameraX);

        // Draw ground grid lines to give player a sense of movement/speed
        drawGround();

        // Draw zone boundary markers
        drawZoneMarkers();

        // 4. Render Enemies and Particles
        Enemies.render(ctx, cameraX);

        // 5. Render Player and attack trails
        Player.render(ctx, cameraX);
    }

    function drawGround() {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 2;

        const groundY = 500;
        ctx.beginPath();
        ctx.moveTo(0, groundY);
        ctx.lineTo(canvas.width, groundY);
        ctx.stroke();

        // Ground grid lines moving relative to cameraX
        const gridSpacing = 80;
        const startGridX = Math.floor(cameraX / gridSpacing) * gridSpacing;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 1;
        for (let gx = startGridX; gx < startGridX + canvas.width + gridSpacing; gx += gridSpacing) {
            const screenX = gx - cameraX;
            ctx.beginPath();
            ctx.moveTo(screenX, groundY);
            ctx.lineTo(screenX, canvas.height);
            ctx.stroke();
        }

        ctx.restore();
    }

    function drawZoneMarkers() {
        const boundaries = [2000, 4000, 6000, 8000];
        const zoneNames = ['Crystal Cave', 'Volcano Depths', 'Sky Castle', 'Deep Space'];

        ctx.save();
        ctx.setLineDash([8, 8]);
        ctx.lineWidth = 2;

        boundaries.forEach((bx, idx) => {
            if (bx > cameraX && bx < cameraX + canvas.width) {
                const screenX = bx - cameraX;

                // Portal/Boundary line
                ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
                ctx.beginPath();
                ctx.moveTo(screenX, 50);
                ctx.lineTo(screenX, 500);
                ctx.stroke();

                // Boundary label
                ctx.font = '10px "Orbitron", sans-serif';
                ctx.fillStyle = 'rgba(0, 240, 255, 0.7)';
                ctx.textAlign = 'center';
                ctx.fillText(`ENTERING: ${zoneNames[idx].toUpperCase()}`, screenX, 40);
            }
        });

        ctx.restore();
    }

    function triggerGameOver() {
        console.log('[Game] Game Over!');
        isGameOver = true;
        clearZoneTimer();
        gameActive = false;
        
        if (typeof Sound !== 'undefined') Sound.playGameOver();
        if (typeof Narrator !== 'undefined') Narrator.play('player_death');

        // Show Game Over screen with stats
        if (gameOverScreen) {
            const elapsedSeconds = Math.floor((Date.now() - survivalStartTime) / 1000);
            const minutes = Math.floor(elapsedSeconds / 60);
            const seconds = elapsedSeconds % 60;
            const survivalTimeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;

            document.getElementById('final-score').textContent = Player.score;
            document.getElementById('final-kills').textContent = enemiesDefeated;
            document.getElementById('final-combo').textContent = maxCombo;
            document.getElementById('final-time').textContent = survivalTimeStr;

            gameOverScreen.classList.remove('hidden');
        }

        // Note: Do not immediately stop the sandbox so the player can compile their highlights trailer!
        // The sandbox will auto-release after 10 minutes of idle time.
    }

    // Pause Menu Controllers
    function togglePause() {
        if (isGameOver || !gameActive) return;
        isPaused = !isPaused;
        const pauseMenu = document.getElementById('pause-menu');
        if (!pauseMenu) return;

        if (isPaused) {
            pauseMenu.classList.remove('hidden');
            // Populate stats
            const pScore = document.getElementById('pause-score');
            const pHealth = document.getElementById('pause-health');
            const pZone = document.getElementById('pause-zone');
            if (pScore) pScore.textContent = Player.score;
            if (pHealth) pHealth.textContent = Player.health;
            if (pZone) pZone.textContent = activeZone.charAt(0).toUpperCase() + activeZone.slice(1);
        } else {
            pauseMenu.classList.add('hidden');
        }
    }

    function resumeGame() {
        isPaused = false;
        const pauseMenu = document.getElementById('pause-menu');
        if (pauseMenu) pauseMenu.classList.add('hidden');
    }

    function showKillStreak(text) {
        const el = document.getElementById('kill-streak');
        const txtEl = document.getElementById('kill-streak-text');
        if (!el || !txtEl) return;
        txtEl.textContent = text;
        el.classList.remove('visible');
        void el.offsetWidth; // force reflow
        el.classList.add('visible');

        setTimeout(() => {
            el.classList.remove('visible');
        }, 2000);
    }

    async function handleTrailerGeneration() {
        const btn = document.getElementById('generate-trailer-btn');
        const loader = document.getElementById('trailer-loader');
        const playerBox = document.getElementById('trailer-player-box');
        const iframe = document.getElementById('trailer-iframe');

        if (!btn || !loader || !playerBox || !iframe) return;

        btn.classList.add('hidden');
        loader.classList.remove('hidden');

        try {
            const visitedArray = Array.from(zonesVisited);
            console.log('[Game] Requesting highlights video composition for zones:', visitedArray);

            const res = await API.generateTrailer(visitedArray, userTheme);
            loader.classList.add('hidden');

            if (res && res.success && res.player_url) {
                iframe.src = res.player_url;
                playerBox.classList.remove('hidden');
            } else {
                alert(res && res.error ? `Stitching failed: ${res.error}` : "Highlights stitching failed. Ensure VideoDB Sandbox is online.");
                btn.classList.remove('hidden');
            }
        } catch (err) {
            console.error('[Game] Highlights generation error:', err);
            loader.classList.add('hidden');
            btn.classList.remove('hidden');
            alert("Error assembling cinematic highlights.");
        }
    }

    return {
        init,
        startGame,
        restartGame,
        showPerformancePopup,
        hidePerformancePopup,
        get activeZone() { return activeZone; },
        get cameraX() { return cameraX; }
    };
})();

// Bootstrap Game on DOM load
window.addEventListener('DOMContentLoaded', () => {
    Game.init();
});
