/* ============================================
   api.js — VideoDB Backend API Client
   ============================================ */
const API = (() => {
    const BASE_URL = window.location.origin;
    let sandboxId = null;
    let isConnected = false;
    let backendMode = 'unknown';
    const imageCache = {};

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    /**
     * Poll a VideoDB generation job until complete (serverless-safe).
     */
    async function pollGenerationJob(jobId, type = 'image', maxWaitMs = 300000) {
        const started = Date.now();
        while (Date.now() - started < maxWaitMs) {
            const response = await fetch(
                `${BASE_URL}/api/generation-status?job_id=${encodeURIComponent(jobId)}&type=${encodeURIComponent(type)}`,
                { signal: AbortSignal.timeout(15000) }
            );
            if (!response.ok) {
                console.warn('[API] generation-status failed:', response.status);
                return null;
            }
            const data = await response.json();
            if (data.status === 'completed') {
                return data;
            }
            if (data.status === 'failed' || data.status === 'error' || data.status === 'demo_mode') {
                console.warn('[API] Generation job ended:', data.status, data.error || data.message);
                return null;
            }
            await sleep(3000);
        }
        console.warn('[API] Generation job timed out:', jobId);
        return null;
    }

    /**
     * Start a new sandbox session.
     * POST /api/start-sandbox
     */
    async function startSandbox() {
        console.log('[API] Starting sandbox...');
        try {
            const response = await fetch(`${BASE_URL}/api/start-sandbox`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(180000)
            });
            if (!response.ok) {
                console.error('[API] startSandbox failed:', response.status);
                return null;
            }
            const data = await response.json();
            sandboxId = data.sandbox_id || data.sandboxId || null;
            console.log('[API] Sandbox created (ID: ' + sandboxId + '), status: ' + data.status);

            if (data.status === 'demo_mode') {
                sandboxId = null;
                console.warn('[API] Backend in demo mode:', data.message);
                return data;
            }

            if (!sandboxId) {
                console.warn('[API] No sandbox_id returned.');
                return null;
            }

            if (data.status === 'ready' || data.status === 'active' || data.status === 'success') {
                console.log('[API] Sandbox is ready.');
                return data;
            }

            if (data.status === 'provisioning') {
                const loadingTextEl = document.getElementById('loading-text');
                let isReady = false;
                let pollAttempts = 0;

                while (!isReady && pollAttempts < 60) {
                    pollAttempts++;
                    if (loadingTextEl) {
                        loadingTextEl.textContent = `Waking up VideoDB Sandbox (attempt ${pollAttempts}/60)...`;
                    }
                    console.log(`[API] Polling sandbox status (attempt ${pollAttempts})...`);
                    await sleep(3000);

                    try {
                        const statusResp = await fetch(
                            `${BASE_URL}/api/sandbox-status?sandbox_id=${encodeURIComponent(sandboxId)}`,
                            { signal: AbortSignal.timeout(15000) }
                        );
                        if (statusResp.ok) {
                            const statusData = await statusResp.json();
                            console.log('[API] Sandbox status poll:', statusData.status);
                            if (
                                statusData.status === 'ready' ||
                                statusData.status === 'active' ||
                                statusData.status === 'success'
                            ) {
                                isReady = true;
                                data.status = 'ready';
                                console.log('[API] Sandbox is now fully ready.');
                                break;
                            }
                            if (statusData.status === 'demo_mode') {
                                console.log('[API] Sandbox status returned demo_mode.');
                                sandboxId = null;
                                return statusData;
                            }
                        }
                    } catch (pollErr) {
                        console.warn('[API] Poll attempt error:', pollErr.message);
                    }
                }

                if (!isReady) {
                    console.warn('[API] Sandbox still provisioning after polling; keeping sandbox id for later jobs.');
                    data.status = 'provisioning';
                }
            }

            return data;
        } catch (err) {
            console.error('[API] startSandbox error:', err.message);
            return null;
        }
    }

    async function generateBackground(zoneName, prompt, theme = "") {
        const cacheKey = theme ? `${zoneName}_${theme}` : zoneName;
        if (imageCache[cacheKey]) {
            console.log('[API] Cache hit for zone (theme-specific):', cacheKey);
            return imageCache[cacheKey];
        }

        if (!sandboxId) {
            console.warn('[API] generateBackground skipped — no sandbox id.');
            return null;
        }

        console.log('[API] Generating background for zone:', zoneName, 'theme:', theme);
        try {
            const response = await fetch(`${BASE_URL}/api/generate-background`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    zone_name: zoneName,
                    prompt: prompt,
                    sandbox_id: sandboxId,
                    theme: theme
                }),
                signal: AbortSignal.timeout(30000)
            });
            if (!response.ok) {
                console.error('[API] generateBackground failed:', response.status);
                return null;
            }
            let data = await response.json();

            if (data.status === 'processing' && data.job_id) {
                const polled = await pollGenerationJob(data.job_id, 'image', 300000);
                if (!polled) return null;
                data = { ...data, ...polled };
            }

            const url = data.url || data.image_url || null;
            const resObj = url ? { url: url, id: data.image_id || null } : null;
            if (resObj) {
                imageCache[cacheKey] = resObj;
                console.log('[API] Background generated for', cacheKey, ':', url, 'ID:', data.image_id);
            } else if (data.message) {
                console.warn('[API] Background fallback:', data.message);
            }
            return resObj;
        } catch (err) {
            console.error('[API] generateBackground error:', err.message);
            return null;
        }
    }

    /**
     * Get current backend status.
     * GET /api/status
     */
    async function getStatus() {
        console.log('[API] Checking status...');
        try {
            const response = await fetch(`${BASE_URL}/api/status`, {
                signal: AbortSignal.timeout(5000)
            });
            if (!response.ok) {
                console.warn('[API] getStatus non-ok:', response.status);
                return null;
            }
            const data = await response.json();
            backendMode = data.mode || 'unknown';
            isConnected = data.mode === 'full';
            console.log('[API] Status:', data);
            return data;
        } catch (err) {
            console.warn('[API] getStatus error:', err.message);
            isConnected = false;
            backendMode = 'offline';
            return null;
        }
    }

    /**
     * Stop the current sandbox.
     * POST /api/stop-sandbox
     */
    async function stopSandbox() {
        if (!sandboxId) return null;
        console.log('[API] Stopping sandbox:', sandboxId);
        try {
            const response = await fetch(`${BASE_URL}/api/stop-sandbox`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sandbox_id: sandboxId }),
                signal: AbortSignal.timeout(30000)
            });
            if (!response.ok) {
                console.error('[API] stopSandbox failed:', response.status);
                return null;
            }
            const data = await response.json();
            console.log('[API] Sandbox stopped.');
            sandboxId = null;
            return data;
        } catch (err) {
            console.error('[API] stopSandbox error:', err.message);
            return null;
        }
    }

    /**
     * Check if backend is reachable and VideoDB is configured.
     */
    async function checkConnection() {
        const status = await getStatus();
        isConnected = !!(status && status.mode === 'full');
        console.log('[API] Connection:', isConnected ? 'CONNECTED (full mode)' : 'OFFLINE/DEMO');
        return isConnected;
    }

    async function generateTrailer(zonesVisited, theme = "") {
        console.log('[API] Compiling cinematic highlights trailer for zones:', zonesVisited);

        if (!sandboxId) {
            return {
                success: false,
                error: 'Sandbox is not active. Finish a game session with Sandbox Active before stitching highlights.'
            };
        }

        const assets = {};
        const narrationTexts = {
            forest: 'You enter the Enchanted Forest. Ancient trees whisper of forgotten battles.',
            cave: 'Darkness engulfs you as you descend into the Crystal Caves. Shadow bats circle overhead.',
            volcano: 'The ground shakes beneath your feet. Welcome to the Volcanic Depths, warrior.',
            sky: 'You ascend to the Sky Castle. Wind howls through floating ruins.',
            space: 'The final frontier. Deep Space awaits. Only the strongest survive here.',
        };

        for (const zone of zonesVisited) {
            const cacheKey = theme ? `${zone}_${theme}` : zone;
            const img = imageCache[cacheKey] || imageCache[zone];
            const text = narrationTexts[zone];
            const aud =
                (typeof Narrator !== 'undefined')
                    ? (Narrator.audioCache['zone_' + zone] || Narrator.audioCache[text])
                    : null;

            if (img && img.id && aud && aud.id) {
                assets[zone] = {
                    image_id: img.id,
                    audio_id: aud.id,
                    audio_length: aud.length || 5.0
                };
            }
        }

        if (Object.keys(assets).length === 0) {
            return {
                success: false,
                error: 'No generated FLUX/OmniVoice assets yet. Visit more zones and wait for backgrounds and narration to finish.'
            };
        }

        try {
            const response = await fetch(`${BASE_URL}/api/generate-trailer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sandbox_id: sandboxId,
                    zones_visited: zonesVisited,
                    theme: theme,
                    assets: assets
                }),
                signal: AbortSignal.timeout(180000)
            });
            if (!response.ok) {
                console.error('[API] generateTrailer failed:', response.status);
                return null;
            }
            const data = await response.json();
            return data;
        } catch (err) {
            console.error('[API] generateTrailer error:', err.message);
            return null;
        }
    }

    return {
        startSandbox,
        generateBackground,
        getStatus,
        stopSandbox,
        checkConnection,
        generateTrailer,
        pollGenerationJob,
        get isConnected() { return isConnected; },
        get backendMode() { return backendMode; },
        get sandboxId() { return sandboxId; },
        imageCache
    };
})();
