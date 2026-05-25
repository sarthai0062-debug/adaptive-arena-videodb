/* ============================================
   api.js — VideoDB Backend API Client
   ============================================ */
const API = (() => {
    const BASE_URL = window.location.origin;
    let sandboxId = null;
    let isConnected = false;
    let backendMode = 'unknown';
    const imageCache = {};

    const ZONE_PROMPTS = {
        forest: 'A mystical enchanted forest at twilight with glowing mushrooms, fireflies, ancient trees with luminous vines, fantasy game art, panoramic wide landscape, vibrant colors',
        cave: 'A vast crystal cave with bioluminescent crystals, underground lake reflections, purple and blue glowing formations, fantasy game art, panoramic wide landscape',
        volcano: 'An erupting volcano landscape with rivers of flowing lava, dark red sky, obsidian rocks, fire embers floating, dramatic fantasy game art, panoramic wide landscape',
        sky: 'A floating castle in the sky above clouds at golden hour, majestic towers, birds flying, rainbow light rays, fantasy game art, panoramic wide landscape',
        space: 'A colorful deep space nebula with distant galaxies, alien planet surfaces, cosmic dust clouds, neon colors, sci-fi game art, panoramic wide landscape',
    };

    const ZONE_NARRATION = {
        forest: 'You enter the Enchanted Forest. Ancient trees whisper of forgotten battles.',
        cave: 'Darkness engulfs you as you descend into the Crystal Caves. Shadow bats circle overhead.',
        volcano: 'The ground shakes beneath your feet. Welcome to the Volcanic Depths, warrior.',
        sky: 'You ascend to the Sky Castle. Wind howls through floating ruins.',
        space: 'The final frontier. Deep Space awaits. Only the strongest survive here.',
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function buildPrompt(zoneName, theme = '') {
        let prompt = ZONE_PROMPTS[zoneName] || '';
        if (theme) {
            prompt = `${theme} style, ${prompt}`;
        }
        return prompt;
    }

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
            if (data.status === 'completed' && (data.image_id || data.audio_id)) {
                return data;
            }
            if (data.error && data.status !== 'processing') {
                console.warn('[API] Generation job error:', data.error);
                return null;
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
                    await sleep(3000);

                    try {
                        const statusResp = await fetch(
                            `${BASE_URL}/api/sandbox-status?sandbox_id=${encodeURIComponent(sandboxId)}`,
                            { signal: AbortSignal.timeout(15000) }
                        );
                        if (statusResp.ok) {
                            const statusData = await statusResp.json();
                            if (
                                statusData.status === 'ready' ||
                                statusData.status === 'active' ||
                                statusData.status === 'success'
                            ) {
                                isReady = true;
                                data.status = 'ready';
                                break;
                            }
                            if (statusData.status === 'demo_mode') {
                                sandboxId = null;
                                return statusData;
                            }
                        }
                    } catch (pollErr) {
                        console.warn('[API] Poll attempt error:', pollErr.message);
                    }
                }

                if (!isReady) {
                    data.status = 'provisioning';
                }
            }

            return data;
        } catch (err) {
            console.error('[API] startSandbox error:', err.message);
            return null;
        }
    }

    async function generateBackground(zoneName, prompt, theme = '', options = {}) {
        const waitForResult = options.wait !== false;
        const cacheKey = theme ? `${zoneName}_${theme}` : zoneName;

        if (imageCache[cacheKey]?.id) {
            return imageCache[cacheKey];
        }

        if (!sandboxId) {
            return null;
        }

        const finish = (data) => {
            if (!data.image_id) return null;
            const url = data.url || data.image_url || null;
            const resObj = { url, id: data.image_id };
            imageCache[cacheKey] = resObj;
            if (url && typeof Background !== 'undefined' && Background.onImageReady) {
                Background.onImageReady(zoneName, theme, resObj);
            }
            return resObj;
        };

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
            if (!response.ok) return null;

            let data = await response.json();

            if (data.status === 'processing' && data.job_id) {
                if (!waitForResult) {
                    pollGenerationJob(data.job_id, 'image', 300000).then((polled) => {
                        if (polled) finish({ ...data, ...polled });
                    });
                    return null;
                }
                const polled = await pollGenerationJob(data.job_id, 'image', 300000);
                if (!polled) return null;
                data = { ...data, ...polled };
            }

            return finish(data);
        } catch (err) {
            console.error('[API] generateBackground error:', err.message);
            return null;
        }
    }

    async function ensureNarration(zone) {
        const key = 'zone_' + zone;
        const text = ZONE_NARRATION[zone];
        if (!text || !sandboxId) return null;

        if (typeof Narrator !== 'undefined') {
            const cached = Narrator.audioCache[key] || Narrator.audioCache[text];
            if (cached?.id) return cached;
        }

        try {
            const response = await fetch(`${BASE_URL}/api/generate-narration`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, sandbox_id: sandboxId }),
                signal: AbortSignal.timeout(30000)
            });
            if (!response.ok) return null;

            let data = await response.json();
            if (data.status === 'processing' && data.job_id) {
                const polled = await pollGenerationJob(data.job_id, 'audio', 300000);
                if (!polled) return null;
                data = { ...data, ...polled };
            }

            if (!data.audio_id) return null;

            const entry = {
                url: data.audio_url || null,
                id: data.audio_id,
                length: data.audio_length || 5.0
            };
            if (typeof Narrator !== 'undefined') {
                Narrator.audioCache[text] = entry;
                Narrator.audioCache[key] = entry;
            }
            return entry;
        } catch (err) {
            console.warn('[API] ensureNarration error:', err.message);
            return null;
        }
    }

    async function ensureTrailerAssets(zones, theme = '', onProgress) {
        const assets = {};
        const ordered = zones.filter((z) => ZONE_PROMPTS[z]);

        for (let i = 0; i < ordered.length; i++) {
            const zone = ordered[i];
            const cacheKey = theme ? `${zone}_${theme}` : zone;
            onProgress?.(`Generating FLUX + OmniVoice for ${zone} (${i + 1}/${ordered.length})...`);

            let img = imageCache[cacheKey];
            if (!img?.id) {
                const seed = Math.floor(Math.random() * 1000000);
                const prompt = `${buildPrompt(zone, theme)}, unique seed #${seed}`;
                img = await generateBackground(zone, prompt, theme, { wait: true });
            }

            let aud = null;
            if (typeof Narrator !== 'undefined') {
                aud = Narrator.audioCache['zone_' + zone] || Narrator.audioCache[ZONE_NARRATION[zone]];
            }
            if (!aud?.id) {
                aud = await ensureNarration(zone);
            }

            if (img?.id && aud?.id) {
                assets[zone] = {
                    image_id: img.id,
                    audio_id: aud.id,
                    audio_length: aud.length || 5.0
                };
            }
        }

        return assets;
    }

    async function getStatus() {
        try {
            const response = await fetch(`${BASE_URL}/api/status`, {
                signal: AbortSignal.timeout(5000)
            });
            if (!response.ok) return null;
            const data = await response.json();
            backendMode = data.mode || 'unknown';
            isConnected = data.mode === 'full';
            return data;
        } catch (err) {
            isConnected = false;
            backendMode = 'offline';
            return null;
        }
    }

    async function stopSandbox() {
        if (!sandboxId) return null;
        try {
            const response = await fetch(`${BASE_URL}/api/stop-sandbox`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sandbox_id: sandboxId }),
                signal: AbortSignal.timeout(30000)
            });
            if (!response.ok) return null;
            const data = await response.json();
            sandboxId = null;
            return data;
        } catch (err) {
            return null;
        }
    }

    async function checkConnection() {
        const status = await getStatus();
        isConnected = !!(status && status.mode === 'full');
        return isConnected;
    }

    async function generateTrailer(zonesVisited, theme = '', onProgress) {
        if (!sandboxId) {
            return {
                success: false,
                error: 'Sandbox is not active. Start a game session with Sandbox Active first.'
            };
        }

        const zones = zonesVisited.filter((z) => ZONE_PROMPTS[z]);
        onProgress?.('Preparing zone assets for highlights...');
        const assets = await ensureTrailerAssets(zones, theme, onProgress);

        if (Object.keys(assets).length === 0) {
            return {
                success: false,
                error: 'Could not generate FLUX/OmniVoice assets. Ensure Sandbox Active, wait for jobs to finish, then retry.'
            };
        }

        onProgress?.('Stitching cinematic timeline...');

        try {
            const response = await fetch(`${BASE_URL}/api/generate-trailer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sandbox_id: sandboxId,
                    zones_visited: zones,
                    theme: theme,
                    assets: assets
                }),
                signal: AbortSignal.timeout(180000)
            });
            if (!response.ok) return null;
            return await response.json();
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
        ensureTrailerAssets,
        get isConnected() { return isConnected; },
        get backendMode() { return backendMode; },
        get sandboxId() { return sandboxId; },
        imageCache
    };
})();
