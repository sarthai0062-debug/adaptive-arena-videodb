/* ============================================
   api.js — VideoDB Backend API Client
   ============================================ */
const API = (() => {
    const BASE_URL = window.location.origin;
    let sandboxId = null;
    let isConnected = false;
    const imageCache = {};

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
            
            // If the sandbox is provisioning, poll until it is active/ready!
            if (sandboxId && data.status === 'provisioning') {
                const loadingTextEl = document.getElementById('loading-text');
                let isReady = false;
                let pollAttempts = 0;
                
                while (!isReady && pollAttempts < 40) {
                    pollAttempts++;
                    if (loadingTextEl) {
                        loadingTextEl.textContent = `Waking up VideoDB Sandbox (attempt ${pollAttempts}/40)...`;
                    }
                    console.log(`[API] Polling sandbox status (attempt ${pollAttempts})...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                    try {
                        const statusResp = await fetch(`${BASE_URL}/api/sandbox-status?sandbox_id=${sandboxId}`, {
                            signal: AbortSignal.timeout(10000)
                        });
                        if (statusResp.ok) {
                            const statusData = await statusResp.json();
                            console.log('[API] Sandbox status poll:', statusData.status);
                            if (statusData.status === 'ready' || statusData.status === 'active' || statusData.status === 'success') {
                                isReady = true;
                                data.status = 'ready';
                                console.log('[API] Sandbox is now fully ready.');
                                break;
                            }
                        }
                    } catch (pollErr) {
                        console.warn('[API] Poll attempt error:', pollErr.message);
                    }
                }
                
                if (!isReady) {
                    console.warn('[API] Sandbox polling timed out or failed. Falling back to Demo Mode.');
                    sandboxId = null;
                    return null;
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
                signal: AbortSignal.timeout(90000)
            });
            if (!response.ok) {
                console.error('[API] generateBackground failed:', response.status);
                return null;
            }
            const data = await response.json();
            const url = data.url || data.image_url || null;
            const resObj = url ? { url: url, id: data.image_id || null } : null;
            if (resObj) {
                imageCache[cacheKey] = resObj;
                console.log('[API] Background generated for', cacheKey, ':', url, 'ID:', data.image_id);
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
                signal: AbortSignal.timeout(3000)
            });
            if (!response.ok) {
                console.warn('[API] getStatus non-ok:', response.status);
                return null;
            }
            const data = await response.json();
            console.log('[API] Status:', data);
            return data;
        } catch (err) {
            console.warn('[API] getStatus error:', err.message);
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
     * Check if backend is reachable.
     */
    async function checkConnection() {
        try {
            const response = await fetch(`${BASE_URL}/api/status`, {
                signal: AbortSignal.timeout(3000)
            });
            isConnected = response.ok;
        } catch {
            isConnected = false;
        }
        console.log('[API] Connection:', isConnected ? 'CONNECTED' : 'OFFLINE');
        return isConnected;
    }

    async function generateTrailer(zonesVisited, theme = "") {
        console.log('[API] Compiling cinematic highlights trailer for zones:', zonesVisited);
        
        // Construct stateless assets payload from frontend caches
        const assets = {};
        for (const zone of zonesVisited) {
            const cacheKey = theme ? `${zone}_theme` : zone; // Handle key formats consistently
            let img = imageCache[cacheKey] || imageCache[zone];
            
            const narrationTexts = {
                "forest": "You enter the Enchanted Forest. Ancient trees whisper of forgotten battles.",
                "cave": "Darkness engulfs you as you descend into the Crystal Caves. Shadow bats circle overhead.",
                "volcano": "The ground shakes beneath your feet. Welcome to the Volcanic Depths, warrior.",
                "sky": "You ascend to the Sky Castle. Wind howls through floating ruins.",
                "space": "The final frontier. Deep Space awaits. Only the strongest survive here.",
            };
            const text = narrationTexts[zone];
            const aud = (typeof Narrator !== 'undefined') ? Narrator.audioCache[text] : null;
            
            if (img && aud) {
                assets[zone] = {
                    image_id: img.id,
                    audio_id: aud.id,
                    audio_length: aud.length
                };
            }
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
                signal: AbortSignal.timeout(120000)
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
        get isConnected() { return isConnected; },
        get sandboxId() { return sandboxId; },
        imageCache
    };
})();
