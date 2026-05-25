/* ============================================
   narrator.js — AI Narrator System
   ============================================
   Plays voice-over audio during key game events
   using the VideoDB OmniVoice API.
   ============================================ */
const Narrator = (() => {
    const BASE_URL = window.location.origin;

    // -----------------------------------------------------------------------
    // Narration lines — keyed by game event
    // -----------------------------------------------------------------------
    const NARRATION_LINES = {
        zone_forest: 'You enter the Enchanted Forest. Ancient trees whisper of forgotten battles.',
        zone_cave: 'Darkness engulfs you as you descend into the Crystal Caves. Shadow bats circle overhead.',
        zone_volcano: 'The ground shakes beneath your feet. Welcome to the Volcanic Depths, warrior.',
        zone_sky: 'You ascend to the Sky Castle. Wind howls through floating ruins.',
        zone_space: 'The final frontier. Deep Space awaits. Only the strongest survive here.',
        boss_intro: 'A powerful guardian emerges! Prepare for battle!',
        player_death: 'The arena claims another warrior. But legends never truly die.',
        combo_godlike: 'Incredible! An unstoppable force of nature!',
        game_start: 'Welcome to the Adaptive Arena. Your legend begins now.',
    };

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    const audioCache = {};          // key -> { url, id, length }
    let currentAudio = null;        // currently playing <audio> element
    let volume = 0.8;               // default narration volume
    let pendingRequests = {};       // key -> Promise (dedup in-flight requests)

    // -----------------------------------------------------------------------
    // Internal: request narration audio from the backend
    // -----------------------------------------------------------------------
    async function _requestNarration(key) {
        const text = NARRATION_LINES[key];
        if (!text) {
            console.warn('[Narrator] Unknown narration key:', key);
            return null;
        }

        // Already cached
        if (audioCache[key]) {
            const cachedVal = audioCache[key];
            return typeof cachedVal === 'object' ? cachedVal.url : cachedVal;
        }

        // De-duplicate concurrent requests for the same key
        if (pendingRequests[key]) return pendingRequests[key];

        const sandboxId = (typeof API !== 'undefined') ? API.sandboxId : null;

        pendingRequests[key] = (async () => {
            try {
                const response = await fetch(`${BASE_URL}/api/generate-narration`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: text,
                        sandbox_id: sandboxId,
                    }),
                    signal: AbortSignal.timeout(90000),
                });

                if (!response.ok) {
                    console.warn('[Narrator] Server responded with', response.status);
                    return null;
                }

                const data = await response.json();
                const url = data.audio_url || null;

                if (url) {
                    audioCache[text] = {
                        url: url,
                        id: data.audio_id || null,
                        length: data.audio_length || 5.0
                    };
                    audioCache[key] = audioCache[text]; // Support lookup by both key and raw text
                    console.log('[Narrator] Cached narration for', key, 'ID:', data.audio_id);
                }
                return url;
            } catch (err) {
                // Silently skip if server is unavailable
                console.warn('[Narrator] Request failed for', key, '—', err.message);
                return null;
            } finally {
                delete pendingRequests[key];
            }
        })();

        return pendingRequests[key];
    }

    // -----------------------------------------------------------------------
    // Internal: fade in audio element over duration (ms)
    // -----------------------------------------------------------------------
    function _fadeIn(audioEl, duration = 300) {
        audioEl.volume = 0;
        const steps = 15;
        const stepTime = duration / steps;
        const targetVol = volume;
        let step = 0;

        const interval = setInterval(() => {
            step++;
            audioEl.volume = Math.min(targetVol, (step / steps) * targetVol);
            if (step >= steps) {
                clearInterval(interval);
                audioEl.volume = targetVol;
            }
        }, stepTime);
    }

    // -----------------------------------------------------------------------
    // Public: play a narration by key
    // -----------------------------------------------------------------------
    async function play(key) {
        if (!NARRATION_LINES[key]) {
            console.warn('[Narrator] Unknown key:', key);
            return;
        }

        // Stop any currently playing narration
        stop();

        const url = await _requestNarration(key);
        if (!url) return;

        try {
            const audio = new Audio(url);
            audio.crossOrigin = 'anonymous';
            currentAudio = audio;

            _fadeIn(audio, 300);
            await audio.play();

            audio.addEventListener('ended', () => {
                if (currentAudio === audio) {
                    currentAudio = null;
                }
            });
        } catch (err) {
            console.warn('[Narrator] Playback failed for', key, '—', err.message);
            currentAudio = null;
        }
    }

    // -----------------------------------------------------------------------
    // Public: stop currently playing narration
    // -----------------------------------------------------------------------
    function stop() {
        if (currentAudio) {
            try {
                currentAudio.pause();
                currentAudio.currentTime = 0;
            } catch (_) { /* ignore */ }
            currentAudio = null;
        }
    }

    // -----------------------------------------------------------------------
    // Public: pre-generate and cache a single narration
    // -----------------------------------------------------------------------
    async function pregenerate(key) {
        if (!NARRATION_LINES[key]) {
            console.warn('[Narrator] Cannot pregenerate unknown key:', key);
            return null;
        }
        console.log('[Narrator] Pre-generating narration for:', key);
        return _requestNarration(key);
    }

    // -----------------------------------------------------------------------
    // Public: pre-generate all narration lines
    // -----------------------------------------------------------------------
    async function pregenerateAll() {
        console.log('[Narrator] Pre-generating all narration lines...');
        const keys = Object.keys(NARRATION_LINES);
        const results = await Promise.allSettled(
            keys.map(key => _requestNarration(key))
        );

        const succeeded = results.filter(r => r.status === 'fulfilled' && r.value).length;
        console.log(`[Narrator] Pre-generation complete: ${succeeded}/${keys.length} cached.`);
        return succeeded;
    }

    // -----------------------------------------------------------------------
    // Public: set narration volume (0–1)
    // -----------------------------------------------------------------------
    function setVolume(vol) {
        volume = Math.max(0, Math.min(1, vol));
        if (currentAudio) {
            currentAudio.volume = volume;
        }
    }

    // -----------------------------------------------------------------------
    // Module API
    // -----------------------------------------------------------------------
    return {
        play,
        pregenerate,
        pregenerateAll,
        stop,
        setVolume,
        get audioCache() { return audioCache; }
    };
})();
