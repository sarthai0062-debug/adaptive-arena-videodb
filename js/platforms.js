// ============================================================
//  Platforms – floating platform system for all 5 zones
//  Module pattern (IIFE) – communicates through Game orchestrator
// ============================================================

const Platforms = (() => {
    // ----- constants -----
    const GROUND_Y = 500;
    const CANVAS_W = 1280;
    const CANVAS_H = 720;
    const WORLD_W = 10000;
    const ZONE_W = 2000;
    const ZONES = ['forest', 'cave', 'volcano', 'sky', 'space'];

    const PLATFORM_Y_MIN = 200;
    const PLATFORM_Y_MAX = 440;
    const MAX_JUMP_GAP = 120;          // vertical reachability limit
    const COLLISION_SURFACE_H = 6;     // one-way top-surface height

    const CRUMBLE_DELAY = 2.0;         // seconds before crumble
    const CRUMBLE_REGEN = 5.0;         // seconds to regenerate

    // ----- state -----
    let platforms = [];
    let time = 0;                      // running clock for sinusoidal motion

    // ----- seeded-ish deterministic random (for reproducibility) -----
    let _seed = 42;
    function seededRandom() {
        _seed = (_seed * 16807 + 0) % 2147483647;
        return (_seed & 0x7fffffff) / 0x7fffffff;
    }
    function randRange(lo, hi) {
        return lo + seededRandom() * (hi - lo);
    }
    function randInt(lo, hi) {
        return Math.floor(randRange(lo, hi + 1));
    }

    // =========================================================
    //  INIT – generate platforms for every zone
    // =========================================================
    function init() {
        _seed = 42;
        platforms = [];
        time = 0;

        for (let z = 0; z < ZONES.length; z++) {
            const zone = ZONES[z];
            const zoneStart = z * ZONE_W;
            const count = randInt(5, 8);

            // Divide the zone into roughly equal horizontal slices
            const sliceW = ZONE_W / count;

            // Collect candidate Y positions for reachability check
            let lastY = GROUND_Y; // player starts on the ground

            for (let i = 0; i < count; i++) {
                const x = zoneStart + sliceW * i + randRange(20, sliceW - 120);
                const width = randRange(80, 200);
                const height = randRange(12, 20);

                // Pick a y that is reachable from lastY (within MAX_JUMP_GAP above)
                let yMin = Math.max(PLATFORM_Y_MIN, lastY - MAX_JUMP_GAP);
                let yMax = PLATFORM_Y_MAX;
                if (yMin > yMax) yMin = PLATFORM_Y_MIN;
                let y = randRange(yMin, yMax);

                // Determine platform type
                let type = 'static';
                if (zone === 'sky' && seededRandom() < 0.45) {
                    type = 'moving';
                } else if (zone === 'volcano' && seededRandom() < 0.35) {
                    type = 'crumbling';
                } else if (zone === 'space' && seededRandom() < 0.25) {
                    type = 'moving';
                }

                const plat = {
                    x: x,
                    y: Math.round(y),
                    baseX: x,               // original x (for moving platforms)
                    baseY: Math.round(y),
                    width: Math.round(width),
                    height: Math.round(height),
                    zone: zone,
                    type: type,

                    // moving
                    moveRange: type === 'moving' ? randRange(40, 120) : 0,
                    moveSpeed: type === 'moving' ? randRange(0.8, 2.0) : 0,
                    movePhase: type === 'moving' ? randRange(0, Math.PI * 2) : 0,
                    vx: 0,                  // current horizontal velocity (computed)

                    // crumbling
                    crumbleTimer: 0,
                    isCrumbling: false,
                    isGone: false,
                    regenTimer: 0,
                    opacity: 1,
                    shakeOffset: 0,

                    // space rotation (visual only)
                    rotation: zone === 'space' ? randRange(0, Math.PI * 2) : 0,
                    rotationSpeed: zone === 'space' ? randRange(-0.3, 0.3) : 0,
                };

                platforms.push(plat);
                lastY = plat.y;
            }
        }
    }

    // =========================================================
    //  UPDATE
    // =========================================================
    function update(dt) {
        time += dt;

        for (let i = 0; i < platforms.length; i++) {
            const p = platforms[i];

            // --- moving platforms ---
            if (p.type === 'moving') {
                const prevX = p.x;
                p.x = p.baseX + Math.sin(time * p.moveSpeed + p.movePhase) * p.moveRange;
                p.vx = (p.x - prevX) / dt;
            }

            // --- space visual rotation ---
            if (p.zone === 'space') {
                p.rotation += p.rotationSpeed * dt;
            }

            // --- crumbling ---
            if (p.type === 'crumbling') {
                if (p.isGone) {
                    p.regenTimer -= dt;
                    if (p.regenTimer <= 0) {
                        // regenerate
                        p.isGone = false;
                        p.isCrumbling = false;
                        p.crumbleTimer = 0;
                        p.opacity = 1;
                        p.shakeOffset = 0;
                        p.y = p.baseY;
                    }
                } else if (p.isCrumbling) {
                    p.crumbleTimer += dt;
                    // shake
                    p.shakeOffset = (Math.random() - 0.5) * (p.crumbleTimer / CRUMBLE_DELAY) * 8;

                    if (p.crumbleTimer >= CRUMBLE_DELAY) {
                        // start falling / fading
                        p.opacity -= dt * 2.0;
                        p.y += 200 * dt; // fall speed
                        if (p.opacity <= 0) {
                            p.opacity = 0;
                            p.isGone = true;
                            p.regenTimer = CRUMBLE_REGEN;
                        }
                    }
                }
            }
        }
    }

    // =========================================================
    //  RENDER
    // =========================================================
    function render(ctx, cameraX) {
        const viewLeft = cameraX - 100;
        const viewRight = cameraX + CANVAS_W + 100;

        for (let i = 0; i < platforms.length; i++) {
            const p = platforms[i];
            if (p.isGone) continue;
            if (p.x + p.width < viewLeft || p.x > viewRight) continue;

            const sx = p.x - cameraX + p.shakeOffset;
            const sy = p.y;

            ctx.save();
            ctx.globalAlpha = p.opacity;

            switch (p.zone) {
                case 'forest':  _drawForest(ctx, sx, sy, p);  break;
                case 'cave':    _drawCave(ctx, sx, sy, p);    break;
                case 'volcano': _drawVolcano(ctx, sx, sy, p); break;
                case 'sky':     _drawSky(ctx, sx, sy, p);     break;
                case 'space':   _drawSpace(ctx, sx, sy, p);   break;
            }

            ctx.restore();
        }
    }

    // ------- zone renderers -------

    function _drawForest(ctx, x, y, p) {
        const w = p.width;
        const h = p.height;

        // Wood body
        const woodGrad = ctx.createLinearGradient(x, y, x, y + h);
        woodGrad.addColorStop(0, '#8B5E3C');
        woodGrad.addColorStop(0.3, '#6B3F1F');
        woodGrad.addColorStop(1, '#4A2A10');
        ctx.fillStyle = woodGrad;
        _roundRect(ctx, x, y, w, h, 4);
        ctx.fill();

        // Wood grain lines
        ctx.strokeStyle = 'rgba(40,20,5,0.3)';
        ctx.lineWidth = 1;
        for (let g = 0; g < 3; g++) {
            const gy = y + 4 + g * (h / 4);
            ctx.beginPath();
            ctx.moveTo(x + 4, gy);
            ctx.bezierCurveTo(x + w * 0.3, gy - 1.5, x + w * 0.6, gy + 1.5, x + w - 4, gy);
            ctx.stroke();
        }

        // Moss patches on top
        ctx.fillStyle = '#4A7A3B';
        for (let m = 0; m < 4; m++) {
            const mx = x + 8 + m * (w / 4.5);
            const mw = 12 + (m % 2) * 10;
            ctx.beginPath();
            ctx.ellipse(mx + mw / 2, y + 1, mw / 2, 3, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        // Lighter moss highlights
        ctx.fillStyle = '#6BAF56';
        for (let m = 0; m < 3; m++) {
            const mx = x + 15 + m * (w / 3.5);
            ctx.beginPath();
            ctx.ellipse(mx, y, 4, 2, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function _drawCave(ctx, x, y, p) {
        const w = p.width;
        const h = p.height;

        // Crystal body
        const crystalGrad = ctx.createLinearGradient(x, y, x + w, y + h);
        crystalGrad.addColorStop(0, '#5B3A8C');
        crystalGrad.addColorStop(0.5, '#7B52B5');
        crystalGrad.addColorStop(1, '#4A2A6E');
        ctx.fillStyle = crystalGrad;
        _roundRect(ctx, x, y, w, h, 3);
        ctx.fill();

        // Glowing edge
        ctx.shadowColor = '#A86EDB';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#C9A0F0';
        ctx.lineWidth = 1.5;
        _roundRect(ctx, x, y, w, h, 3);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Crystal facet highlights
        ctx.fillStyle = 'rgba(200,170,255,0.25)';
        ctx.beginPath();
        ctx.moveTo(x + 4, y + 2);
        ctx.lineTo(x + w * 0.35, y + 2);
        ctx.lineTo(x + w * 0.25, y + h * 0.5);
        ctx.lineTo(x + 4, y + h * 0.4);
        ctx.closePath();
        ctx.fill();

        // Small crystal protrusions on top
        ctx.fillStyle = '#9B6FD4';
        for (let c = 0; c < 3; c++) {
            const cx = x + 15 + c * (w / 3.5);
            const ch = 5 + (c % 2) * 4;
            ctx.beginPath();
            ctx.moveTo(cx, y);
            ctx.lineTo(cx + 4, y - ch);
            ctx.lineTo(cx + 8, y);
            ctx.closePath();
            ctx.fill();
        }
    }

    function _drawVolcano(ctx, x, y, p) {
        const w = p.width;
        const h = p.height;

        // Obsidian body
        const obsGrad = ctx.createLinearGradient(x, y, x, y + h);
        obsGrad.addColorStop(0, '#2A2A2A');
        obsGrad.addColorStop(0.5, '#1A1A1A');
        obsGrad.addColorStop(1, '#111111');
        ctx.fillStyle = obsGrad;
        _roundRect(ctx, x, y, w, h, 2);
        ctx.fill();

        // Orange lava cracks
        ctx.strokeStyle = '#FF6A00';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#FF4500';
        ctx.shadowBlur = 4;
        for (let c = 0; c < 4; c++) {
            const cx = x + 10 + c * (w / 4.5);
            ctx.beginPath();
            ctx.moveTo(cx, y + 2);
            ctx.lineTo(cx + 3, y + h * 0.5);
            ctx.lineTo(cx - 2, y + h - 2);
            ctx.stroke();
        }
        ctx.shadowBlur = 0;

        // Ember particles (top edge glow)
        for (let e = 0; e < 5; e++) {
            const ex = x + 8 + e * (w / 5.5);
            const ey = y - 2 - Math.sin(time * 3 + e) * 3;
            const er = 1.2 + Math.sin(time * 5 + e * 2) * 0.5;
            ctx.fillStyle = `rgba(255, ${100 + Math.floor(Math.sin(time * 4 + e) * 55)}, 0, ${0.6 + Math.sin(time * 3 + e) * 0.3})`;
            ctx.beginPath();
            ctx.arc(ex, ey, er, 0, Math.PI * 2);
            ctx.fill();
        }

        // Crumbling indicator: red tint when active
        if (p.type === 'crumbling' && p.isCrumbling) {
            const intensity = Math.min(p.crumbleTimer / CRUMBLE_DELAY, 1);
            ctx.fillStyle = `rgba(255, 60, 0, ${intensity * 0.35})`;
            _roundRect(ctx, x, y, w, h, 2);
            ctx.fill();
        }
    }

    function _drawSky(ctx, x, y, p) {
        const w = p.width;
        const h = p.height;

        // Soft cloud shape
        const cloudGrad = ctx.createRadialGradient(
            x + w / 2, y + h / 2, w * 0.1,
            x + w / 2, y + h / 2, w * 0.55
        );
        cloudGrad.addColorStop(0, 'rgba(255,255,255,0.95)');
        cloudGrad.addColorStop(0.6, 'rgba(230,240,255,0.85)');
        cloudGrad.addColorStop(1, 'rgba(200,220,255,0.5)');

        ctx.fillStyle = cloudGrad;

        // Build the cloud with overlapping ellipses
        ctx.beginPath();
        // main body
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2 + 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // puffs
        ctx.beginPath();
        ctx.ellipse(x + w * 0.25, y + h * 0.35, w * 0.2, h * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x + w * 0.72, y + h * 0.4, w * 0.22, h * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // subtle inner highlight
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.ellipse(x + w * 0.4, y + h * 0.3, w * 0.18, h * 0.25, -0.2, 0, Math.PI * 2);
        ctx.fill();
    }

    function _drawSpace(ctx, x, y, p) {
        const w = p.width;
        const h = p.height;
        const cx = x + w / 2;
        const cy = y + h / 2;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(p.rotation * 0.15); // subtle visual rotation
        ctx.translate(-cx, -cy);

        // Asteroid body
        const astGrad = ctx.createLinearGradient(x, y, x + w, y + h);
        astGrad.addColorStop(0, '#6A7B8D');
        astGrad.addColorStop(0.4, '#4E5D6B');
        astGrad.addColorStop(1, '#3A4550');
        ctx.fillStyle = astGrad;

        // Irregular asteroid shape
        ctx.beginPath();
        ctx.moveTo(x + 4, y + h * 0.3);
        ctx.lineTo(x + w * 0.15, y + 2);
        ctx.lineTo(x + w * 0.45, y);
        ctx.lineTo(x + w * 0.8, y + 1);
        ctx.lineTo(x + w - 2, y + h * 0.35);
        ctx.lineTo(x + w, y + h * 0.7);
        ctx.lineTo(x + w * 0.85, y + h - 1);
        ctx.lineTo(x + w * 0.5, y + h);
        ctx.lineTo(x + w * 0.15, y + h - 2);
        ctx.lineTo(x, y + h * 0.65);
        ctx.closePath();
        ctx.fill();

        // Craters
        ctx.fillStyle = 'rgba(30,40,50,0.4)';
        ctx.beginPath();
        ctx.ellipse(x + w * 0.3, y + h * 0.45, 6, 4, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x + w * 0.65, y + h * 0.35, 4, 3, -0.2, 0, Math.PI * 2);
        ctx.fill();

        // Metallic highlight
        ctx.fillStyle = 'rgba(180,200,220,0.25)';
        ctx.beginPath();
        ctx.moveTo(x + w * 0.2, y + 3);
        ctx.lineTo(x + w * 0.55, y + 2);
        ctx.lineTo(x + w * 0.45, y + h * 0.35);
        ctx.lineTo(x + w * 0.15, y + h * 0.25);
        ctx.closePath();
        ctx.fill();

        // Edge highlight
        ctx.strokeStyle = 'rgba(160,185,210,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.15, y + 2);
        ctx.lineTo(x + w * 0.8, y + 1);
        ctx.stroke();

        ctx.restore();
    }

    // ------- utility: rounded rectangle path -------
    function _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    // =========================================================
    //  COLLISION – one-way, top-surface only
    // =========================================================
    function checkCollision(playerX, playerY, playerVY, playerWidth, playerHeight) {
        // playerX, playerY = top-left of the player bounding box
        const playerBottom = playerY + playerHeight;
        const playerCenterX = playerX + playerWidth / 2;

        let result = { landed: false, platformY: 0, platformVX: 0 };

        // Only check when falling (or exactly zero – standing)
        if (playerVY < 0) return result;

        for (let i = 0; i < platforms.length; i++) {
            const p = platforms[i];
            if (p.isGone) continue;

            // Horizontal overlap check (player center must be on platform)
            if (playerX + playerWidth < p.x || playerX > p.x + p.width) continue;

            // One-way: player bottom must be near the platform top
            const platTop = p.y;
            const tolerance = Math.max(playerVY * 0.03, 8); // scale tolerance with speed

            if (playerBottom >= platTop && playerBottom <= platTop + COLLISION_SURFACE_H + tolerance) {
                // Verify player was above last frame (allow landing, not phasing from below)
                result.landed = true;
                result.platformY = platTop;
                result.platformVX = p.vx || 0;

                // Trigger crumble
                if (p.type === 'crumbling' && !p.isCrumbling && !p.isGone) {
                    p.isCrumbling = true;
                    p.crumbleTimer = 0;
                }

                return result;
            }
        }

        return result;
    }

    // =========================================================
    //  RESET
    // =========================================================
    function reset() {
        init();
    }

    // =========================================================
    //  PUBLIC API
    // =========================================================
    return {
        init,
        update,
        render,
        checkCollision,
        reset,
    };
})();
