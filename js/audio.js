// ============================================================================
// PROCEDURAL AUDIO SYSTEM — Web Audio API
// All sounds synthesized from oscillators, noise, and filters. No audio files.
// ============================================================================

const Sound = (() => {
    // ── State ───────────────────────────────────────────────────────────
    let ctx = null;           // AudioContext (created on first user gesture)
    let masterGain = null;    // final output gain
    let sfxGain = null;       // SFX bus
    let ambientGain = null;   // ambient / music bus
    let enabled = true;
    let initialized = false;

    // ambient bookkeeping
    let currentAmbientNodes = [];   // { osc?, source?, gain, filter? }
    let currentZone = null;
    let ambientFading = false;

    const SFX_VOLUME    = 0.12;
    const AMBIENT_VOLUME = 0.04;

    // ── Helpers ─────────────────────────────────────────────────────────

    /** Lazily create / resume the AudioContext. */
    function ensureCtx() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain  = ctx.createGain();
            sfxGain     = ctx.createGain();
            ambientGain = ctx.createGain();

            sfxGain.gain.value     = SFX_VOLUME;
            ambientGain.gain.value = AMBIENT_VOLUME;

            sfxGain.connect(masterGain);
            ambientGain.connect(masterGain);
            masterGain.connect(ctx.destination);
            initialized = true;
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    /** Create a white-noise AudioBuffer (1 s mono). */
    function createNoiseBuffer(duration = 1) {
        const c = ensureCtx();
        const len = c.sampleRate * duration;
        const buf = c.createBuffer(1, len, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        return buf;
    }

    /** Create a brown-noise AudioBuffer (integrated white noise). */
    function createBrownNoiseBuffer(duration = 1) {
        const c = ensureCtx();
        const len = c.sampleRate * duration;
        const buf = c.createBuffer(1, len, c.sampleRate);
        const data = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {
            const white = Math.random() * 2 - 1;
            last = (last + 0.02 * white) / 1.02;
            data[i] = last * 3.5;           // normalise-ish
        }
        return buf;
    }

    /**
     * Play a simple frequency-sweep oscillator.
     * Returns the oscillator node (already scheduled to stop).
     */
    function playSweep({
        type = 'sine',
        startFreq = 440,
        endFreq = 220,
        duration = 0.15,
        gain = 0.5,
        dest = null,
        startTime = null,
    } = {}) {
        const c = ensureCtx();
        const t = startTime ?? c.currentTime;
        dest = dest ?? sfxGain;

        const osc = c.createOscillator();
        const g   = c.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(startFreq, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), t + duration);

        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + duration);

        osc.connect(g).connect(dest);
        osc.start(t);
        osc.stop(t + duration + 0.05);
        return osc;
    }

    /** Play a burst of filtered noise. */
    function playNoiseBurst({
        duration = 0.15,
        gain = 0.3,
        filterType = 'lowpass',
        filterFreqStart = 4000,
        filterFreqEnd = 200,
        dest = null,
        startTime = null,
        brown = false,
    } = {}) {
        const c = ensureCtx();
        const t = startTime ?? c.currentTime;
        dest = dest ?? sfxGain;

        const buf = brown ? createBrownNoiseBuffer(duration + 0.1)
                          : createNoiseBuffer(duration + 0.1);
        const src = c.createBufferSource();
        src.buffer = buf;

        const flt = c.createBiquadFilter();
        flt.type = filterType;
        flt.frequency.setValueAtTime(filterFreqStart, t);
        flt.frequency.exponentialRampToValueAtTime(Math.max(filterFreqEnd, 1), t + duration);

        const g = c.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + duration);

        src.connect(flt).connect(g).connect(dest);
        src.start(t);
        src.stop(t + duration + 0.05);
        return src;
    }

    /** Simple convolver-style "reverb" via feedback delay. */
    function createReverb(dest, delayTime = 0.08, feedback = 0.25, wetGain = 0.3) {
        const c = ensureCtx();
        dest = dest ?? sfxGain;

        const wet   = c.createGain();
        const delay = c.createDelay(1);
        const fb    = c.createGain();

        wet.gain.value   = wetGain;
        delay.delayTime.value = delayTime;
        fb.gain.value    = feedback;

        // input → delay → fb → delay (loop)
        // input → wet → dest
        delay.connect(fb);
        fb.connect(delay);
        delay.connect(wet);
        wet.connect(dest);

        // Return the node to connect *into* (acts as input)
        return delay;
    }

    /** Play a note at a specific frequency for a given duration (for arpeggios). */
    function playNote({
        freq = 440,
        type = 'sine',
        duration = 0.12,
        gain = 0.4,
        dest = null,
        startTime = null,
        attack = 0.005,
        release = 0,
    } = {}) {
        const c = ensureCtx();
        const t = startTime ?? c.currentTime;
        dest = dest ?? sfxGain;
        release = release || duration * 0.4;

        const osc = c.createOscillator();
        const g   = c.createGain();
        osc.type = type;
        osc.frequency.value = freq;

        const peakTime = t + attack;
        const releaseStart = t + duration - release;

        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(gain, peakTime);
        g.gain.setValueAtTime(gain, Math.max(releaseStart, peakTime));
        g.gain.exponentialRampToValueAtTime(0.001, t + duration);

        osc.connect(g).connect(dest);
        osc.start(t);
        osc.stop(t + duration + 0.05);
        return osc;
    }

    // ── Musical frequencies (C4 = middle C) ─────────────────────────────
    const NOTE = {
        C3: 130.81, D3: 146.83, Eb3: 155.56, E3: 164.81, F3: 174.61,
        G3: 196.00, Ab3: 207.65, A3: 220.00, Bb3: 233.08, B3: 246.94,
        C4: 261.63, D4: 293.66, Eb4: 311.13, E4: 329.63, F4: 349.23,
        G4: 392.00, Ab4: 415.30, A4: 440.00, Bb4: 466.16, B4: 493.88,
        C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, C6: 1046.50,
    };

    // ====================================================================
    //  PUBLIC SFX
    // ====================================================================

    /** Attack slash — escalates with combo hit number (1-3). */
    function playSlash(comboHit = 1) {
        if (!enabled) return;
        const c = ensureCtx();
        const t = c.currentTime;

        // optional reverb bus
        const reverb = createReverb(sfxGain, 0.06 + comboHit * 0.02, 0.2 + comboHit * 0.05, 0.15);

        switch (comboHit) {
            case 1: // quick metallic slash — downward sweep
                playSweep({ type: 'triangle', startFreq: 800, endFreq: 200, duration: 0.10, gain: 0.5, dest: reverb });
                playNoiseBurst({ duration: 0.06, gain: 0.15, filterFreqStart: 6000, filterFreqEnd: 1000, dest: sfxGain });
                break;

            case 2: // upward slash — higher pitch
                playSweep({ type: 'triangle', startFreq: 600, endFreq: 1200, duration: 0.12, gain: 0.5, dest: reverb });
                playNoiseBurst({ duration: 0.07, gain: 0.12, filterFreqStart: 8000, filterFreqEnd: 2000, dest: sfxGain });
                break;

            default: // heavy slam — bass impact + noise
                playSweep({ type: 'sawtooth', startFreq: 100, endFreq: 30, duration: 0.20, gain: 0.55, dest: reverb });
                playNoiseBurst({ duration: 0.15, gain: 0.35, filterFreqStart: 3000, filterFreqEnd: 80, dest: sfxGain });
                // extra sub-bass thud
                playSweep({ type: 'sine', startFreq: 60, endFreq: 20, duration: 0.18, gain: 0.4, dest: sfxGain });
                break;
        }
    }

    /** Bouncy jump sound. */
    function playJump() {
        if (!enabled) return;
        playSweep({ type: 'triangle', startFreq: 160, endFreq: 580, duration: 0.15, gain: 0.35 });
    }

    /** Higher-pitched double jump with sparkle chime. */
    function playDoubleJump() {
        if (!enabled) return;
        const c = ensureCtx();
        const t = c.currentTime;
        playSweep({ type: 'sine', startFreq: 400, endFreq: 900, duration: 0.15, gain: 0.30, startTime: t });
        // sparkle chime
        playNote({ freq: 1800, type: 'sine', duration: 0.10, gain: 0.15, startTime: t + 0.03 });
        playNote({ freq: 2400, type: 'sine', duration: 0.08, gain: 0.10, startTime: t + 0.07 });
    }

    /** Dash whoosh — filtered noise sweep high→low. */
    function playDash() {
        if (!enabled) return;
        playNoiseBurst({
            duration: 0.20,
            gain: 0.30,
            filterType: 'bandpass',
            filterFreqStart: 6000,
            filterFreqEnd: 300,
        });
    }

    /** Player taking damage — low distorted thud. */
    function playHit() {
        if (!enabled) return;
        const c = ensureCtx();
        const t = c.currentTime;
        playSweep({ type: 'sawtooth', startFreq: 80, endFreq: 30, duration: 0.25, gain: 0.45, startTime: t });
        playNoiseBurst({ duration: 0.12, gain: 0.30, filterFreqStart: 1500, filterFreqEnd: 60, startTime: t });
    }

    /** Enemy death — ascending C-E-G arpeggio. */
    function playDefeat() {
        if (!enabled) return;
        const c = ensureCtx();
        const t = c.currentTime;
        const notes = [NOTE.C5, NOTE.E5, NOTE.G5];
        const dur = 0.25 / notes.length;
        notes.forEach((freq, i) => {
            playNote({ freq, type: 'sine', duration: dur + 0.06, gain: 0.30, startTime: t + i * dur });
        });
    }

    /** Zone transition — C major chord arpeggio with reverb tail. */
    function playTransition() {
        if (!enabled) return;
        const c = ensureCtx();
        const t = c.currentTime;
        const reverb = createReverb(sfxGain, 0.12, 0.35, 0.4);

        const notes = [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5];
        notes.forEach((freq, i) => {
            playNote({ freq, type: 'sine', duration: 0.35, gain: 0.25, startTime: t + i * 0.12, dest: reverb });
        });
    }

    /** Game over — dramatic descending minor key (sawtooth). */
    function playGameOver() {
        if (!enabled) return;
        const c = ensureCtx();
        const t = c.currentTime;
        const notes = [NOTE.C4, NOTE.Ab3, NOTE.Eb3, NOTE.C3];
        const dur = 0.20;
        notes.forEach((freq, i) => {
            playNote({ freq, type: 'sawtooth', duration: dur + 0.10, gain: 0.25, startTime: t + i * dur });
        });
    }

    /** Pickup sounds by type. */
    function playPickup(type) {
        if (!enabled) return;
        const c = ensureCtx();
        const t = c.currentTime;

        switch (type) {
            case 'health':
                playNote({ freq: NOTE.E5, type: 'sine', duration: 0.08, gain: 0.35, startTime: t });
                playNote({ freq: NOTE.C6, type: 'sine', duration: 0.12, gain: 0.30, startTime: t + 0.06 });
                break;

            case 'multiplier':
                playNote({ freq: 1400, type: 'triangle', duration: 0.06, gain: 0.30, startTime: t });
                playNote({ freq: 1800, type: 'triangle', duration: 0.06, gain: 0.25, startTime: t + 0.05 });
                playNote({ freq: 2200, type: 'triangle', duration: 0.08, gain: 0.20, startTime: t + 0.10 });
                break;

            case 'shield': {
                // power-up hum with LFO vibrato
                const osc = c.createOscillator();
                const g   = c.createGain();
                const lfo = c.createOscillator();
                const lfoG = c.createGain();

                osc.type = 'sine';
                osc.frequency.value = 180;
                lfo.type = 'sine';
                lfo.frequency.value = 8;
                lfoG.gain.value = 30;          // ±30 Hz vibrato

                lfo.connect(lfoG).connect(osc.frequency);
                g.gain.setValueAtTime(0.35, t);
                g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

                osc.connect(g).connect(sfxGain);
                osc.start(t);
                osc.stop(t + 0.40);
                lfo.start(t);
                lfo.stop(t + 0.40);
                break;
            }

            case 'speed':
                playSweep({ type: 'sawtooth', startFreq: 200, endFreq: 1600, duration: 0.15, gain: 0.30 });
                break;

            default:
                playNote({ freq: NOTE.G5, type: 'sine', duration: 0.10, gain: 0.30 });
                break;
        }
    }

    /** Kill streak announcement sound. */
    function playComboAnnounce(level) {
        if (!enabled) return;
        const c = ensureCtx();
        const t = c.currentTime;
        const reverb = createReverb(sfxGain, 0.10, 0.30, 0.30);

        if (level <= 1) {
            // double kill — 2-note ascending
            playNote({ freq: NOTE.C5, type: 'triangle', duration: 0.10, gain: 0.30, startTime: t, dest: reverb });
            playNote({ freq: NOTE.E5, type: 'triangle', duration: 0.12, gain: 0.30, startTime: t + 0.08, dest: reverb });
        } else if (level === 2) {
            // triple kill — 3-note ascending chord
            playNote({ freq: NOTE.C5, type: 'triangle', duration: 0.10, gain: 0.30, startTime: t, dest: reverb });
            playNote({ freq: NOTE.E5, type: 'triangle', duration: 0.10, gain: 0.30, startTime: t + 0.07, dest: reverb });
            playNote({ freq: NOTE.G5, type: 'triangle', duration: 0.14, gain: 0.30, startTime: t + 0.14, dest: reverb });
        } else {
            // godlike — dramatic 5-note fanfare + bass
            const fanfare = [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5, NOTE.E5];
            fanfare.forEach((freq, i) => {
                playNote({ freq, type: 'triangle', duration: 0.14, gain: 0.30, startTime: t + i * 0.07, dest: reverb });
            });
            // bass underline
            playSweep({ type: 'sawtooth', startFreq: 80, endFreq: 50, duration: 0.40, gain: 0.30, startTime: t, dest: sfxGain });
        }
    }

    /** Boss intro — deep ominous drone + dramatic hit. */
    function playBossIntro() {
        if (!enabled) return;
        const c = ensureCtx();
        const t = c.currentTime;

        // ominous drone (2 detuned low sines)
        const droneDur = 1.2;
        const d1 = c.createOscillator();
        const d2 = c.createOscillator();
        const dg = c.createGain();
        d1.type = 'sine'; d1.frequency.value = 55;
        d2.type = 'sine'; d2.frequency.value = 57;   // slight detune
        dg.gain.setValueAtTime(0.001, t);
        dg.gain.linearRampToValueAtTime(0.35, t + 0.4);
        dg.gain.setValueAtTime(0.35, t + 0.7);
        dg.gain.exponentialRampToValueAtTime(0.001, t + droneDur);

        d1.connect(dg);
        d2.connect(dg);
        dg.connect(sfxGain);
        d1.start(t); d1.stop(t + droneDur + 0.1);
        d2.start(t); d2.stop(t + droneDur + 0.1);

        // dramatic impact hit at 0.6 s
        const hitTime = t + 0.6;
        playSweep({ type: 'sawtooth', startFreq: 120, endFreq: 25, duration: 0.30, gain: 0.50, startTime: hitTime });
        playNoiseBurst({ duration: 0.20, gain: 0.40, filterFreqStart: 4000, filterFreqEnd: 100, startTime: hitTime });
    }

    // ====================================================================
    //  AMBIENT MUSIC — per-zone procedural textures
    // ====================================================================

    /** Internal: tear down current ambient nodes. */
    function destroyAmbientNodes() {
        currentAmbientNodes.forEach(n => {
            try { if (n.osc)    n.osc.stop();    } catch (_) { /* already stopped */ }
            try { if (n.source) n.source.stop();  } catch (_) { /* already stopped */ }
            try { if (n.lfo)    n.lfo.stop();     } catch (_) { /* already stopped */ }
            try { if (n.gain)   n.gain.disconnect(); } catch (_) { /* ok */ }
        });
        currentAmbientNodes = [];
    }

    /** Start procedural ambient music for the given zone name. */
    function startAmbient(zone) {
        if (!enabled) return;
        if (zone === currentZone && currentAmbientNodes.length > 0) return;

        const c = ensureCtx();
        const t = c.currentTime;
        const fadeDur = 1.0;

        // ── Crossfade out old ambient ─────────────────────────────
        if (currentAmbientNodes.length > 0) {
            const oldNodes = currentAmbientNodes;
            // fade them out via their individual gain nodes
            oldNodes.forEach(n => {
                if (n.gain) {
                    n.gain.gain.setValueAtTime(n.gain.gain.value, t);
                    n.gain.gain.linearRampToValueAtTime(0, t + fadeDur);
                }
            });
            // schedule cleanup
            setTimeout(() => {
                oldNodes.forEach(n => {
                    try { if (n.osc)    n.osc.stop();    } catch (_) {}
                    try { if (n.source) n.source.stop();  } catch (_) {}
                    try { if (n.lfo)    n.lfo.stop();     } catch (_) {}
                    try { if (n.gain)   n.gain.disconnect(); } catch (_) {}
                });
            }, (fadeDur + 0.2) * 1000);
            currentAmbientNodes = [];
        }

        currentZone = zone;

        // ── Build new ambient layers ──────────────────────────────
        // Helper: create an oscillator node feeding into ambientGain
        function makeOsc(type, freq, vol, detune = 0) {
            const osc = c.createOscillator();
            const g   = c.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            if (detune) osc.detune.value = detune;
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(vol, t + fadeDur);
            osc.connect(g).connect(ambientGain);
            osc.start(t);
            currentAmbientNodes.push({ osc, gain: g });
            return { osc, gain: g };
        }

        // Helper: create a looping noise source
        function makeNoise(vol, filterType, filterFreq, brown = false) {
            const buf = brown ? createBrownNoiseBuffer(2) : createNoiseBuffer(2);
            const src = c.createBufferSource();
            src.buffer = buf;
            src.loop = true;

            const flt = c.createBiquadFilter();
            flt.type = filterType;
            flt.frequency.value = filterFreq;

            const g = c.createGain();
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(vol, t + fadeDur);

            src.connect(flt).connect(g).connect(ambientGain);
            src.start(t);
            currentAmbientNodes.push({ source: src, gain: g, filter: flt });
            return { source: src, gain: g, filter: flt };
        }

        // Helper: schedule repeating random "ping" sounds
        function schedulePings(baseFreq, freqRange, interval, vol, count = 30) {
            for (let i = 0; i < count; i++) {
                const pingTime = t + fadeDur + Math.random() * interval * count;
                const freq = baseFreq + Math.random() * freqRange;
                const osc = c.createOscillator();
                const g   = c.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                const dur = 0.05 + Math.random() * 0.08;
                g.gain.setValueAtTime(0, pingTime);
                g.gain.linearRampToValueAtTime(vol, pingTime + 0.01);
                g.gain.exponentialRampToValueAtTime(0.001, pingTime + dur);
                osc.connect(g).connect(ambientGain);
                osc.start(pingTime);
                osc.stop(pingTime + dur + 0.05);
                currentAmbientNodes.push({ osc, gain: g });
            }
        }

        switch (zone) {
            case 'forest':
                // gentle filtered wind
                makeNoise(0.5, 'lowpass', 800, false);
                // soft C minor pad (C4 + Eb4 + G4)
                makeOsc('sine', NOTE.C4, 0.20);
                makeOsc('sine', NOTE.Eb4, 0.15);
                makeOsc('sine', NOTE.G4, 0.12);
                break;

            case 'cave':
                // deep reverberant drone
                makeOsc('sine', 65, 0.25);
                makeOsc('sine', 67, 0.20);        // detuned
                // filtered noise (echo-ish feel)
                makeNoise(0.20, 'lowpass', 400, true);
                // water drip pings
                schedulePings(2000, 1500, 1.2, 0.15, 40);
                break;

            case 'volcano':
                // low rumble (brown noise)
                makeNoise(0.55, 'lowpass', 200, true);
                // sub bass drone
                makeOsc('sine', 45, 0.25);
                // crackling — scheduled noise bursts
                for (let i = 0; i < 35; i++) {
                    const burstTime = t + fadeDur + Math.random() * 30;
                    const dur = 0.03 + Math.random() * 0.05;
                    const src = c.createBufferSource();
                    src.buffer = createNoiseBuffer(dur + 0.02);
                    const flt = c.createBiquadFilter();
                    flt.type = 'highpass';
                    flt.frequency.value = 2000 + Math.random() * 3000;
                    const g = c.createGain();
                    g.gain.setValueAtTime(0.15 + Math.random() * 0.15, burstTime);
                    g.gain.exponentialRampToValueAtTime(0.001, burstTime + dur);
                    src.connect(flt).connect(g).connect(ambientGain);
                    src.start(burstTime);
                    src.stop(burstTime + dur + 0.05);
                    currentAmbientNodes.push({ source: src, gain: g });
                }
                break;

            case 'sky':
                // airy pad — high sine harmonics
                makeOsc('sine', NOTE.C5, 0.15);
                makeOsc('sine', NOTE.E5, 0.10);
                makeOsc('sine', NOTE.G5, 0.08);
                // subtle shimmer detune
                makeOsc('sine', NOTE.C5 * 1.003, 0.08);
                // gentle wind noise
                makeNoise(0.30, 'bandpass', 1200, false);
                break;

            case 'space':
                // deep space drone — very low sine + harmonic
                makeOsc('sine', 36, 0.30);             // ~C1-ish
                makeOsc('sine', 36 * 1.5, 0.12);       // fifth above
                makeOsc('sine', 36 * 2, 0.08);         // octave
                // subtle filtered noise bed
                makeNoise(0.12, 'lowpass', 300, true);
                // cosmic pings — high ethereal tones
                schedulePings(3000, 2000, 1.5, 0.10, 35);
                break;

            default:
                // fallback — light pad
                makeOsc('sine', NOTE.C4, 0.15);
                makeNoise(0.20, 'lowpass', 600, false);
                break;
        }
    }

    /** Fade out and stop all ambient audio. */
    function stopAmbient() {
        const c = ensureCtx();
        const t = c.currentTime;
        const fadeDur = 1.0;

        currentAmbientNodes.forEach(n => {
            if (n.gain) {
                n.gain.gain.setValueAtTime(n.gain.gain.value, t);
                n.gain.gain.linearRampToValueAtTime(0, t + fadeDur);
            }
        });

        const old = currentAmbientNodes;
        currentAmbientNodes = [];
        currentZone = null;

        setTimeout(() => {
            old.forEach(n => {
                try { if (n.osc)    n.osc.stop();    } catch (_) {}
                try { if (n.source) n.source.stop();  } catch (_) {}
                try { if (n.lfo)    n.lfo.stop();     } catch (_) {}
                try { if (n.gain)   n.gain.disconnect(); } catch (_) {}
            });
        }, (fadeDur + 0.2) * 1000);
    }

    // ====================================================================
    //  INIT / TOGGLE
    // ====================================================================

    function init() {
        ensureCtx();
    }

    function toggle() {
        enabled = !enabled;
        if (!enabled) {
            if (masterGain) masterGain.gain.setValueAtTime(0, ctx.currentTime);
            stopAmbient();
        } else {
            if (masterGain) masterGain.gain.setValueAtTime(1, ctx.currentTime);
        }
        return enabled;
    }

    // ── Public API ──────────────────────────────────────────────────────
    return {
        init,
        playSlash,
        playJump,
        playDoubleJump,
        playDash,
        playHit,
        playDefeat,
        playTransition,
        playGameOver,
        playPickup,
        playComboAnnounce,
        playBossIntro,
        startAmbient,
        stopAmbient,
        toggle,
        get enabled() { return enabled; },
    };
})();
