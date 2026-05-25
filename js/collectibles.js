// ============================================================
//  Collectibles — power-up / pickup system
//  Types: health (green), multiplier (gold), shield (blue), speed (yellow-orange)
// ============================================================

const Collectibles = (() => {
    // ── Constants ──────────────────────────────────────────────
    const DESPAWN_TIME   = 15;      // seconds before auto-despawn
    const BOB_SPEED      = 3;       // vertical oscillation speed
    const BOB_AMPLITUDE  = 6;       // vertical oscillation pixels
    const ROTATION_SPEED = 1.2;     // radians per second
    const COLLECT_RADIUS = 28;      // px – hitbox radius for pickup
    const PARTICLE_COUNT_MIN = 8;
    const PARTICLE_COUNT_MAX = 12;
    const PARTICLE_LIFE  = 0.6;     // seconds

    // Drop chances on enemy defeat
    const DROP_TABLE = [
        { type: 'health',     chance: 0.30 },
        { type: 'multiplier', chance: 0.10 },
        { type: 'shield',     chance: 0.05 },
        { type: 'speed',      chance: 0.05 },
    ];

    // Effect durations (seconds)
    const EFFECT_DURATIONS = {
        multiplier: 10,
        shield:     3,
        speed:      5,
    };

    // Palette per type
    const PALETTE = {
        health:     { primary: '#22ee66', glow: 'rgba(34,238,102,0.55)',  particle: '#88ffaa' },
        multiplier: { primary: '#ffd633', glow: 'rgba(255,214,51,0.50)',  particle: '#fff4a3' },
        shield:     { primary: '#44aaff', glow: 'rgba(68,170,255,0.50)', particle: '#99ddff' },
        speed:      { primary: '#ffaa22', glow: 'rgba(255,170,34,0.50)', particle: '#ffe066' },
    };

    // ── State ──────────────────────────────────────────────────
    let items = [];
    let pickupParticles = [];
    let activeEffects = { multiplier: 0, shield: 0, speed: 0 };

    // ── Helpers ────────────────────────────────────────────────
    function randRange(min, max) {
        return min + Math.random() * (max - min);
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    // ── Spawn a specific collectible ──────────────────────────
    function spawnItem(x, y, type) {
        items.push({
            x,
            y,
            type,
            animTimer: Math.random() * Math.PI * 2,  // randomise start phase
            life: DESPAWN_TIME,
            active: true,
        });
    }

    // ── Public: roll RNG and maybe spawn a drop ───────────────
    function spawnDrop(x, y) {
        const roll = Math.random();
        let cumulative = 0;
        for (const entry of DROP_TABLE) {
            cumulative += entry.chance;
            if (roll < cumulative) {
                spawnItem(x, y, entry.type);
                return;
            }
        }
        // No drop this time
    }

    // ── Burst particles on pickup ─────────────────────────────
    function emitPickupBurst(x, y, type) {
        const count = Math.floor(randRange(PARTICLE_COUNT_MIN, PARTICLE_COUNT_MAX + 1));
        const color = PALETTE[type].particle;
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 / count) * i + randRange(-0.2, 0.2);
            const speed = randRange(80, 180);
            pickupParticles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: PARTICLE_LIFE,
                maxLife: PARTICLE_LIFE,
                radius: randRange(2.5, 5),
                color,
            });
        }
    }

    // ── Update ─────────────────────────────────────────────────
    function update(dt) {
        // Advance collectible timers
        for (let i = items.length - 1; i >= 0; i--) {
            const it = items[i];
            it.animTimer += dt;
            it.life -= dt;
            if (it.life <= 0 || !it.active) {
                items.splice(i, 1);
            }
        }

        // Advance pickup particles
        for (let i = pickupParticles.length - 1; i >= 0; i--) {
            const p = pickupParticles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 120 * dt;          // slight gravity on particles
            p.life -= dt;
            if (p.life <= 0) {
                pickupParticles.splice(i, 1);
            }
        }

        // Tick active effects
        for (const key of Object.keys(activeEffects)) {
            if (activeEffects[key] > 0) {
                activeEffects[key] = Math.max(0, activeEffects[key] - dt);
            }
        }
    }

    // ── Collection check ──────────────────────────────────────
    function checkCollection(playerHitBox) {
        // playerHitBox: { x, y, width, height }
        const pcx = playerHitBox.x + playerHitBox.width  / 2;
        const pcy = playerHitBox.y + playerHitBox.height / 2;

        for (let i = items.length - 1; i >= 0; i--) {
            const it = items[i];
            if (!it.active) continue;

            const bobY = it.y + Math.sin(it.animTimer * BOB_SPEED) * BOB_AMPLITUDE;
            const dx = pcx - it.x;
            const dy = pcy - bobY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < COLLECT_RADIUS + Math.max(playerHitBox.width, playerHitBox.height) / 2) {
                it.active = false;
                emitPickupBurst(it.x, bobY, it.type);

                // Apply effect
                let result = { type: it.type, value: 0 };
                switch (it.type) {
                    case 'health':
                        result.value = 15;
                        break;
                    case 'multiplier':
                        activeEffects.multiplier = EFFECT_DURATIONS.multiplier;
                        result.value = EFFECT_DURATIONS.multiplier;
                        break;
                    case 'shield':
                        activeEffects.shield = EFFECT_DURATIONS.shield;
                        result.value = EFFECT_DURATIONS.shield;
                        break;
                    case 'speed':
                        activeEffects.speed = EFFECT_DURATIONS.speed;
                        result.value = EFFECT_DURATIONS.speed;
                        break;
                }
                return result;
            }
        }
        return null;
    }

    // ── Render helpers ─────────────────────────────────────────

    // Shared halo / glow disc behind every collectible
    function drawGlow(ctx, x, y, color, radius, pulse) {
        const r = radius + pulse * 4;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // ── Type-specific icon renderers ──────────────────────────

    function drawHealthOrb(ctx, x, y, t) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 4);

        // Glow halo
        drawGlow(ctx, x, y, PALETTE.health.glow, 22, pulse);

        // Orb body
        const grad = ctx.createRadialGradient(x - 3, y - 4, 2, x, y, 14);
        grad.addColorStop(0, '#aaffcc');
        grad.addColorStop(0.6, '#22ee66');
        grad.addColorStop(1, '#0a8830');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.fill();

        // Highlight
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.ellipse(x - 3, y - 5, 6, 4, -0.3, 0, Math.PI * 2);
        ctx.fill();

        // Cross symbol
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x, y + 5);
        ctx.moveTo(x - 5, y);
        ctx.lineTo(x + 5, y);
        ctx.stroke();
    }

    function drawMultiplierStar(ctx, x, y, t) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 5);
        const rot   = t * ROTATION_SPEED;

        // Glow
        drawGlow(ctx, x, y, PALETTE.multiplier.glow, 24, pulse);

        // Sparkle particles (4 small orbiting dots)
        for (let i = 0; i < 4; i++) {
            const a  = rot * 2 + (Math.PI / 2) * i;
            const sr = 18 + pulse * 4;
            const sx = x + Math.cos(a) * sr;
            const sy = y + Math.sin(a) * sr;
            ctx.fillStyle = 'rgba(255,255,200,' + (0.5 + pulse * 0.5) + ')';
            ctx.beginPath();
            ctx.arc(sx, sy, 1.5 + pulse, 0, Math.PI * 2);
            ctx.fill();
        }

        // Star body
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);

        const spikes = 5;
        const outerR = 12;
        const innerR = 5;
        ctx.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
            const r = i % 2 === 0 ? outerR : innerR;
            const a = (Math.PI / spikes) * i - Math.PI / 2;
            if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
            else         ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();

        const grad = ctx.createRadialGradient(0, -3, 1, 0, 0, outerR);
        grad.addColorStop(0, '#fffde0');
        grad.addColorStop(0.5, '#ffd633');
        grad.addColorStop(1, '#cc9900');
        ctx.fillStyle = grad;
        ctx.fill();

        // "2x" text
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('2×', 0, 1);

        ctx.restore();
    }

    function drawShieldDiamond(ctx, x, y, t) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 3.5);
        const rot   = t * ROTATION_SPEED * 0.6;

        // Glow
        drawGlow(ctx, x, y, PALETTE.shield.glow, 24, pulse);

        // Pulsing energy ring
        ctx.strokeStyle = 'rgba(68,170,255,' + (0.3 + pulse * 0.4) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 18 + pulse * 3, 0, Math.PI * 2);
        ctx.stroke();

        // Diamond body
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot * 0.3);

        const s = 13;
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.7, 0);
        ctx.lineTo(0, s);
        ctx.lineTo(-s * 0.7, 0);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, -s, 0, s);
        grad.addColorStop(0, '#99ddff');
        grad.addColorStop(0.5, '#44aaff');
        grad.addColorStop(1, '#1166aa');
        ctx.fillStyle = grad;
        ctx.fill();

        // Shield icon (small chevron)
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(-4, -4);
        ctx.lineTo(-4, 2);
        ctx.quadraticCurveTo(-4, 6, 0, 8);
        ctx.quadraticCurveTo(4, 6, 4, 2);
        ctx.lineTo(4, -4);
        ctx.closePath();
        ctx.stroke();

        ctx.restore();
    }

    function drawSpeedBolt(ctx, x, y, t) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 6);
        const rot   = t * ROTATION_SPEED * 0.4;

        // Glow
        drawGlow(ctx, x, y, PALETTE.speed.glow, 22, pulse);

        // Electric crackle particles (small bright dots jittering)
        for (let i = 0; i < 3; i++) {
            const a  = t * 8 + (Math.PI * 2 / 3) * i;
            const cr = 14 + Math.random() * 6;
            const cx2 = x + Math.cos(a) * cr + (Math.random() - 0.5) * 4;
            const cy2 = y + Math.sin(a) * cr + (Math.random() - 0.5) * 4;
            ctx.fillStyle = 'rgba(255,255,150,' + (0.5 + Math.random() * 0.5) + ')';
            ctx.beginPath();
            ctx.arc(cx2, cy2, 1 + Math.random() * 1.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // Lightning bolt
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot * 0.2);

        ctx.beginPath();
        ctx.moveTo(-2, -13);
        ctx.lineTo(5, -13);
        ctx.lineTo(1, -3);
        ctx.lineTo(6, -3);
        ctx.lineTo(-3, 13);
        ctx.lineTo(0, 2);
        ctx.lineTo(-5, 2);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, -13, 0, 13);
        grad.addColorStop(0, '#fff4a3');
        grad.addColorStop(0.4, '#ffaa22');
        grad.addColorStop(1, '#cc6600');
        ctx.fillStyle = grad;
        ctx.fill();

        // Bright inner stroke
        ctx.strokeStyle = 'rgba(255,255,220,0.7)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
    }

    // ── Despawn flash (last 3 seconds blink) ──────────────────
    function shouldRender(item) {
        if (item.life > 3) return true;
        // Blink faster as life runs out
        const freq = lerp(4, 12, 1 - item.life / 3);
        return Math.sin(item.life * freq * Math.PI) > 0;
    }

    // ── Main render ───────────────────────────────────────────
    function render(ctx, cameraX) {
        // Pickup particles first (behind collectibles)
        for (const p of pickupParticles) {
            const sx = p.x - cameraX;
            const alpha = (p.life / p.maxLife);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.arc(sx, p.y, p.radius * alpha, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Collectibles
        for (const it of items) {
            if (!it.active) continue;
            if (!shouldRender(it)) continue;

            const sx  = it.x - cameraX;
            const bobY = it.y + Math.sin(it.animTimer * BOB_SPEED) * BOB_AMPLITUDE;

            // Culling – skip if off screen
            if (sx < -40 || sx > 1320) continue;

            ctx.save();
            ctx.shadowColor = PALETTE[it.type].primary;
            ctx.shadowBlur  = 10;

            switch (it.type) {
                case 'health':     drawHealthOrb(ctx, sx, bobY, it.animTimer);      break;
                case 'multiplier': drawMultiplierStar(ctx, sx, bobY, it.animTimer);  break;
                case 'shield':     drawShieldDiamond(ctx, sx, bobY, it.animTimer);   break;
                case 'speed':      drawSpeedBolt(ctx, sx, bobY, it.animTimer);       break;
            }

            ctx.restore();
        }
    }

    // ── Render active effects on the player sprite ────────────
    function renderPlayerEffects(ctx, screenX, screenY, width, height) {
        const cx = screenX + width / 2;
        const cy = screenY + height / 2;
        const now = performance.now() / 1000;

        // Shield bubble
        if (activeEffects.shield > 0) {
            const pulse = 0.5 + 0.5 * Math.sin(now * 6);
            const r = Math.max(width, height) * 0.65 + pulse * 4;

            ctx.save();
            // Outer ring
            ctx.strokeStyle = 'rgba(68,170,255,' + (0.4 + pulse * 0.3) + ')';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();

            // Inner glow fill
            const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
            grad.addColorStop(0, 'rgba(100,200,255,0.08)');
            grad.addColorStop(0.7, 'rgba(68,170,255,0.12)');
            grad.addColorStop(1, 'rgba(68,170,255,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();

            // Hex-pattern highlights rotating around
            for (let i = 0; i < 6; i++) {
                const a = now * 2 + (Math.PI / 3) * i;
                const hx = cx + Math.cos(a) * r;
                const hy = cy + Math.sin(a) * r;
                ctx.fillStyle = 'rgba(150,220,255,' + (0.3 + pulse * 0.4) + ')';
                ctx.beginPath();
                ctx.arc(hx, hy, 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // Speed boost lines
        if (activeEffects.speed > 0) {
            ctx.save();
            const pulse = 0.5 + 0.5 * Math.sin(now * 10);
            ctx.globalAlpha = 0.35 + pulse * 0.25;

            for (let i = 0; i < 5; i++) {
                const ly = screenY + height * 0.15 + (height * 0.7 / 4) * i;
                const lx = screenX - 8 - Math.random() * 12;
                const lw = 12 + Math.random() * 18;

                const grad = ctx.createLinearGradient(lx, ly, lx + lw, ly);
                grad.addColorStop(0, 'rgba(255,170,34,0)');
                grad.addColorStop(0.3, 'rgba(255,200,60,0.8)');
                grad.addColorStop(1, 'rgba(255,170,34,0)');

                ctx.strokeStyle = grad;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(lx, ly);
                ctx.lineTo(lx + lw, ly);
                ctx.stroke();
            }
            ctx.restore();
        }

        // Score multiplier glow (subtle gold outline)
        if (activeEffects.multiplier > 0) {
            ctx.save();
            const pulse = 0.5 + 0.5 * Math.sin(now * 4);
            ctx.shadowColor = 'rgba(255,214,51,0.7)';
            ctx.shadowBlur  = 8 + pulse * 6;
            ctx.strokeStyle = 'rgba(255,214,51,' + (0.25 + pulse * 0.2) + ')';
            ctx.lineWidth = 2;
            ctx.strokeRect(screenX - 2, screenY - 2, width + 4, height + 4);
            ctx.restore();
        }
    }

    // ── Reset ─────────────────────────────────────────────────
    function reset() {
        items.length = 0;
        pickupParticles.length = 0;
        activeEffects.multiplier = 0;
        activeEffects.shield     = 0;
        activeEffects.speed      = 0;
    }

    // ── Public API ────────────────────────────────────────────
    return {
        update,
        render,
        spawnDrop,
        spawnItem,                  // direct spawn (for fixed-location collectibles)
        checkCollection,
        reset,
        renderPlayerEffects,
        get activeEffects()    { return activeEffects; },
        get hasShield()        { return activeEffects.shield > 0; },
        get scoreMultiplier()  { return activeEffects.multiplier > 0 ? 2 : 1; },
        get speedMultiplier()  { return activeEffects.speed > 0 ? 1.5 : 1; },
    };
})();
