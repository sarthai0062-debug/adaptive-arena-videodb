/* ============================================
   player.js — Production-Quality Player Entity
   Procedural sci-fi warrior with full animation,
   combo attacks, dash, double-jump, coyote time.
   ============================================ */
const Player = (() => {
    // ── Position & Velocity ──────────────────
    let x = 200, y = 400;
    let vx = 0, vy = 0;

    // ── Physics Constants ────────────────────
    const SPEED = 320;
    const GRAVITY = 900;
    const JUMP_FORCE = -480;
    const ACCEL_RATE = 1800;       // px/s²
    const GROUND_FRICTION = 0.85;
    const AIR_FRICTION = 0.95;
    const GROUND_Y = 500;
    const WORLD_MIN_X = 20;
    const WORLD_MAX_X = 9980;

    // ── Dimensions (hitbox) ──────────────────
    const width = 40, height = 56;

    // ── Health & Score ───────────────────────
    let maxHealth = 100;
    let health = 100;
    let score = 0;

    // ── State Flags ──────────────────────────
    let facingRight = true;
    let isGrounded = false;
    let isDead = false;
    let isMoving = false;

    // ── Theme / Weapon ───────────────────────
    let currentTheme = "Retro Cyberpunk City";
    let themeHash = 0;
    let weaponClass = 0;   // 0: Cyber laser, 1: Candy, 2: Steampunk, 3: Void
    let themeHue = 190;

    // ── Double Jump ──────────────────────────
    let jumpsLeft = 2;
    const MAX_JUMPS = 2;
    let doubleJumpParticles = [];

    // ── Coyote Time ──────────────────────────
    const COYOTE_TIME = 0.08;      // 80ms
    let coyoteTimer = 0;

    // ── Dash ─────────────────────────────────
    let isDashing = false;
    const DASH_SPEED = 600;
    const DASH_DURATION = 0.15;
    const DASH_COOLDOWN = 1.5;
    let dashTimer = 0;
    let dashCooldown = 0;
    let afterimages = [];          // { x, y, facingRight, alpha, animTime }

    // ── Wall Slide ───────────────────────────
    let isWallSliding = false;

    // ── Combo Attack System ──────────────────
    let isAttacking = false;
    let comboCount = 0;            // 0 = not attacking, 1-3 = hit #
    let comboTimer = 0;            // time within current hit animation
    let comboWindow = 0;           // time left to chain next hit
    let comboCooldown = 0;         // post-combo cooldown
    let comboQueued = false;       // whether Space was pressed during a hit
    const COMBO_HITS = [
        { duration: 0.20, window: 0.40, damage: 20, boxW: 55, boxH: 56, name: 'slash' },
        { duration: 0.20, window: 0.40, damage: 25, boxW: 60, boxH: 60, name: 'uppercut' },
        { duration: 0.25, window: 0.00, damage: 40, boxW: 70, boxH: 65, name: 'slam' }
    ];

    // ── Damage ───────────────────────────────
    let damageFlash = 0;
    let knockbackVx = 0;

    // ── Death ────────────────────────────────
    let deathTimer = 0;
    const DEATH_DURATION = 1.0;

    // ── Screen Shake ─────────────────────────
    let screenShakeTimer = 0;

    // ── Animation Timers ─────────────────────
    let animTime = 0;              // global animation clock
    let runCycle = 0;              // 0–1 repeating run cycle
    let breathCycle = 0;           // breathing bob

    // ── Trail Particles ──────────────────────
    let trail = [];

    // ── Input ────────────────────────────────
    const keys = {};
    let spacePressed = false;      // edge detect for combo
    let shiftPressed = false;      // edge detect for dash

    // ═══════════════════════════════════════════
    //  UTILITY
    // ═══════════════════════════════════════════
    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return Math.abs(hash);
    }

    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    function easeOutQuad(t) { return t * (2 - t); }
    function easeInOutSine(t) { return 0.5 * (1 - Math.cos(Math.PI * t)); }

    function roundRect(ctx, rx, ry, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(rx + r, ry);
        ctx.lineTo(rx + w - r, ry);
        ctx.quadraticCurveTo(rx + w, ry, rx + w, ry + r);
        ctx.lineTo(rx + w, ry + h - r);
        ctx.quadraticCurveTo(rx + w, ry + h, rx + w - r, ry + h);
        ctx.lineTo(rx + r, ry + h);
        ctx.quadraticCurveTo(rx, ry + h, rx, ry + h - r);
        ctx.lineTo(rx, ry + r);
        ctx.quadraticCurveTo(rx, ry, rx + r, ry);
        ctx.closePath();
    }

    // ═══════════════════════════════════════════
    //  THEME
    // ═══════════════════════════════════════════
    function setTheme(theme) {
        if (!theme) return;
        currentTheme = theme;
        themeHash = hashString(theme);
        weaponClass = themeHash % 4;
        themeHue = themeHash % 360;
        console.log(`[Player] Theme set to: "${theme}" (weaponClass=${weaponClass}, themeHue=${themeHue})`);
    }

    // ═══════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════
    function init() {
        window.addEventListener('keydown', e => {
            keys[e.code] = true;
            if (e.code === 'Space') { e.preventDefault(); spacePressed = true; }
            if (e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftPressed = true;
        });
        window.addEventListener('keyup', e => {
            keys[e.code] = false;
        });
    }

    // ═══════════════════════════════════════════
    //  UPDATE
    // ═══════════════════════════════════════════
    function update(dt) {
        animTime += dt;

        // ── Death fade-out ──
        if (isDead) {
            deathTimer += dt;
            damageFlash = 0;
            return;
        }

        // ── Screen shake decay ──
        if (screenShakeTimer > 0) screenShakeTimer -= dt;

        // ── Determine desired horizontal direction ──
        let inputDir = 0;
        if (keys['ArrowLeft'] || keys['KeyA']) { inputDir = -1; facingRight = false; }
        if (keys['ArrowRight'] || keys['KeyD']) { inputDir = 1; facingRight = true; }

        // ── Dash trigger (edge) ──
        if (shiftPressed && dashCooldown <= 0 && !isDashing) {
            isDashing = true;
            dashTimer = DASH_DURATION;
            dashCooldown = DASH_COOLDOWN;
            afterimages = [];
        }
        shiftPressed = false;

        // ── Dash update ──
        if (isDashing) {
            dashTimer -= dt;
            const dashDir = facingRight ? 1 : -1;
            vx = dashDir * DASH_SPEED;
            vy = 0; // freeze vertical during dash

            // Store afterimage snapshot
            afterimages.push({ x, y, facingRight, alpha: 0.8, animTime });
            if (afterimages.length > 5) afterimages.shift();

            if (dashTimer <= 0) {
                isDashing = false;
            }
        } else {
            // ── Normal horizontal movement with acceleration ──
            if (inputDir !== 0) {
                vx += inputDir * ACCEL_RATE * dt;
                const currentMaxSpeed = SPEED * (typeof Collectibles !== 'undefined' ? Collectibles.speedMultiplier : 1);
                if (Math.abs(vx) > currentMaxSpeed) vx = inputDir * currentMaxSpeed;
            } else {
                // Apply friction
                vx *= isGrounded ? GROUND_FRICTION : AIR_FRICTION;
                if (Math.abs(vx) < 5) vx = 0;
            }

            // ── Knockback decay ──
            if (knockbackVx !== 0) {
                vx += knockbackVx;
                knockbackVx *= 0.85;
                if (Math.abs(knockbackVx) < 2) knockbackVx = 0;
            }
        }

        isMoving = Math.abs(vx) > 20;

        // ── Coyote time ──
        if (isGrounded) {
            coyoteTimer = COYOTE_TIME;
            jumpsLeft = MAX_JUMPS;
        } else {
            coyoteTimer -= dt;
        }

        // ── Jump (edge detect via coyote or double-jump) ──
        if (keys['ArrowUp'] || keys['KeyW']) {
            if (!keys['_jumpConsumed']) {
                keys['_jumpConsumed'] = true;
                if (coyoteTimer > 0 && jumpsLeft === MAX_JUMPS) {
                    // First jump (ground or coyote)
                    vy = JUMP_FORCE;
                    isGrounded = false;
                    coyoteTimer = 0;
                    jumpsLeft = MAX_JUMPS - 1;
                    if (typeof Sound !== 'undefined') Sound.playJump();
                } else if (jumpsLeft > 0 && !isGrounded) {
                    // Double jump
                    vy = JUMP_FORCE * 0.9;
                    jumpsLeft--;
                    spawnDoubleJumpParticles();
                    if (typeof Sound !== 'undefined') Sound.playJump();
                }
            }
        } else {
            keys['_jumpConsumed'] = false;
        }

        // ── Gravity ──
        if (!isDashing) {
            // Wall slide check
            isWallSliding = false;
            if (!isGrounded && vy > 0) {
                if (x <= WORLD_MIN_X + 2 || x >= WORLD_MAX_X - 2) {
                    isWallSliding = true;
                    vy += GRAVITY * 0.3 * dt;
                } else {
                    vy += GRAVITY * dt;
                }
            } else {
                vy += GRAVITY * dt;
            }
        }

        // ── Position update ──
        x += vx * dt;
        y += vy * dt;

        // ── Platform and Ground collision ──
        let landedOnPlatform = false;
        if (typeof Platforms !== 'undefined' && vy >= 0) {
            const col = Platforms.checkCollision(x - width / 2, y - height, vy, width, height);
            if (col.landed) {
                y = col.platformY;
                vy = 0;
                isGrounded = true;
                landedOnPlatform = true;
                x += col.platformVX * dt; // Ride moving platforms
            }
        }

        if (!landedOnPlatform) {
            if (y >= GROUND_Y) {
                y = GROUND_Y;
                vy = 0;
                isGrounded = true;
            } else {
                isGrounded = false;
            }
        }

        // ── World bounds ──
        x = clamp(x, WORLD_MIN_X, WORLD_MAX_X);

        // ── Combo Attack System ──
        if (spacePressed && comboCooldown <= 0) {
            if (comboCount === 0) {
                // Start combo — hit 1
                startComboHit(1);
            } else if (comboCount >= 1 && comboCount < 3) {
                // Queue next hit if currently animating
                comboQueued = true;
            }
        }
        spacePressed = false;

        // Update combo timers
        if (comboCount > 0) {
            const hit = COMBO_HITS[comboCount - 1];
            comboTimer += dt;

            if (comboTimer >= hit.duration) {
                // Current hit animation done
                isAttacking = false;

                if (comboCount < 3 && hit.window > 0) {
                    // Enter combo window
                    comboWindow = hit.window;
                    if (comboQueued) {
                        comboQueued = false;
                        startComboHit(comboCount + 1);
                    }
                } else {
                    // Combo finished (hit 3 done or no window)
                    endCombo();
                }
            }
        }

        // Combo window countdown (waiting for next press)
        if (comboCount > 0 && !isAttacking && comboWindow > 0) {
            comboWindow -= dt;
            if (comboQueued) {
                comboQueued = false;
                startComboHit(comboCount + 1);
            }
            if (comboWindow <= 0) {
                endCombo();
            }
        }

        if (comboCooldown > 0) comboCooldown -= dt;
        if (dashCooldown > 0) dashCooldown -= dt;

        // ── Damage flash decay ──
        if (damageFlash > 0) damageFlash -= dt;

        // ── Animation cycles ──
        breathCycle = Math.sin(animTime * 2.5) * 2;
        if (isMoving && isGrounded) {
            runCycle += dt * 10; // ~8 frames at 60fps with varying dt
            if (runCycle > Math.PI * 2) runCycle -= Math.PI * 2;
        }

        // ── Trail particles ──
        updateTrailParticles(dt);

        // ── Double-jump particles ──
        for (let p of doubleJumpParticles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 200 * dt;
            p.life -= dt;
        }
        doubleJumpParticles = doubleJumpParticles.filter(p => p.life > 0);

        // ── Afterimage decay ──
        for (let a of afterimages) {
            a.alpha -= dt * 3;
        }
        afterimages = afterimages.filter(a => a.alpha > 0.05);
    }

    function startComboHit(hitNum) {
        comboCount = hitNum;
        comboTimer = 0;
        comboWindow = 0;
        comboQueued = false;
        isAttacking = true;

        if (typeof Sound !== 'undefined') Sound.playSlash();

        // Hit 3 = slam → screen shake
        if (hitNum === 3) {
            screenShakeTimer = 0.25;
        }
    }

    function endCombo() {
        comboCount = 0;
        comboTimer = 0;
        comboWindow = 0;
        comboQueued = false;
        isAttacking = false;
        comboCooldown = 0.3;
    }

    function spawnDoubleJumpParticles() {
        for (let i = 0; i < 8; i++) {
            doubleJumpParticles.push({
                x: x + (Math.random() - 0.5) * 20,
                y: y,
                vx: (Math.random() - 0.5) * 80,
                vy: Math.random() * -60 + 20,
                life: 0.35,
                maxLife: 0.35,
                size: 2 + Math.random() * 3
            });
        }
    }

    function updateTrailParticles(dt) {
        if (isMoving && isGrounded) {
            trail.push({
                x: x + (Math.random() - 0.5) * 10,
                y: y,
                life: 0.3, maxLife: 0.3,
                size: 2 + Math.random() * 3, hue: themeHue
            });
        }
        if (!isGrounded) {
            trail.push({
                x: x + (Math.random() - 0.5) * 6,
                y: y + Math.random() * 10,
                life: 0.2, maxLife: 0.2,
                size: 1.5 + Math.random() * 2, hue: themeHue
            });
        }
        for (let t of trail) t.life -= dt;
        trail = trail.filter(t => t.life > 0);
        if (trail.length > 30) trail = trail.slice(-30);
    }

    // ═══════════════════════════════════════════
    //  RENDER
    // ═══════════════════════════════════════════
    function render(ctx, cameraX) {
        // ── Screen shake offset ──
        let shakeX = 0, shakeY = 0;
        if (screenShakeTimer > 0) {
            const intensity = screenShakeTimer * 20;
            shakeX = (Math.random() - 0.5) * intensity;
            shakeY = (Math.random() - 0.5) * intensity;
            ctx.save();
            ctx.translate(shakeX, shakeY);
        }

        const screenX = x - cameraX;
        const screenY = y - height;

        // ── Trail particles ──
        renderTrailParticles(ctx, cameraX);

        // ── Double-jump puff particles ──
        for (let p of doubleJumpParticles) {
            const px = p.x - cameraX;
            const alpha = (p.life / p.maxLife) * 0.6;
            ctx.beginPath();
            ctx.arc(px, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${themeHue}, 80%, 80%, ${alpha})`;
            ctx.fill();
        }

        // ── Dash afterimages ──
        for (let a of afterimages) {
            renderCharacterBody(ctx, a.x - cameraX, GROUND_Y - height, a.facingRight, a.alpha * 0.5, true);
        }

        // ── Death state ──
        if (isDead) {
            const deathProgress = clamp(deathTimer / DEATH_DURATION, 0, 1);
            const fadeAlpha = 1 - deathProgress;
            const fallAngle = deathProgress * (Math.PI / 2) * (facingRight ? 1 : -1);
            const fallY = screenY + deathProgress * 20;

            ctx.save();
            ctx.globalAlpha = fadeAlpha;
            ctx.translate(screenX, fallY + height);
            ctx.rotate(fallAngle);
            ctx.translate(-screenX, -(fallY + height));
            renderCharacterBody(ctx, screenX, fallY, facingRight, fadeAlpha, false);
            ctx.restore();

            if (screenShakeTimer > 0) ctx.restore();
            return;
        }

        // ── Main character render ──
        renderCharacterBody(ctx, screenX, screenY, facingRight, 1.0, false);

        // ── Weapon / Attack visual ──
        if (isAttacking && comboCount > 0) {
            renderAttack(ctx, screenX, screenY, cameraX);
        }

        // ── Shield glow when idle ──
        if (!isAttacking && comboCooldown <= 0) {
            ctx.beginPath();
            ctx.arc(screenX, screenY + height / 2, width * 0.8, 0, Math.PI * 2);
            ctx.strokeStyle = `hsla(${themeHue}, 100%, 55%, 0.06)`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // ── Active collectible power-up effects ──
        if (typeof Collectibles !== 'undefined') {
            Collectibles.renderPlayerEffects(ctx, screenX - width / 2, screenY, width, height);
        }

        if (screenShakeTimer > 0) ctx.restore();
    }

    // ─────────────────────────────────────────
    //  RENDER: Character Body (procedural)
    // ─────────────────────────────────────────
    function renderCharacterBody(ctx, sx, sy, facing, alpha, isGhost) {
        ctx.save();
        ctx.globalAlpha = alpha;

        const flashActive = damageFlash > 0 && Math.sin(damageFlash * 40) > 0 && !isGhost;
        const dir = facing ? 1 : -1;

        // ── Animation offsets ──
        let bodyBob = 0;
        let armLAngle = 0, armRAngle = 0;
        let legLAngle = 0, legRAngle = 0;
        let bodyLean = 0;
        let legTuck = 0;

        const currentState = getAnimState();

        switch (currentState) {
            case 'idle':
                bodyBob = breathCycle;
                armLAngle = -0.15;
                armRAngle = 0.15;
                break;
            case 'running':
                bodyBob = Math.abs(Math.sin(runCycle * 2)) * 3;
                armLAngle = Math.sin(runCycle) * 0.7;
                armRAngle = -Math.sin(runCycle) * 0.7;
                legLAngle = Math.sin(runCycle) * 0.8;
                legRAngle = -Math.sin(runCycle) * 0.8;
                bodyLean = dir * 0.06;
                break;
            case 'jumping':
                legTuck = -8;
                legLAngle = -0.4;
                legRAngle = 0.4;
                armLAngle = -0.5;
                armRAngle = 0.5;
                break;
            case 'falling':
                armLAngle = -0.8;
                armRAngle = 0.8;
                legLAngle = 0.2 + Math.sin(animTime * 3) * 0.1;
                legRAngle = -0.2 + Math.cos(animTime * 3) * 0.1;
                break;
            case 'wallslide':
                bodyLean = -dir * 0.1;
                armLAngle = -0.3;
                armRAngle = 0.3;
                legLAngle = 0.15;
                legRAngle = -0.15;
                break;
            case 'attacking':
                bodyBob = breathCycle * 0.5;
                if (comboCount === 1) {
                    armRAngle = -1.2 + (comboTimer / 0.2) * 2.4;
                    bodyLean = dir * 0.08;
                } else if (comboCount === 2) {
                    armRAngle = 1.0 - (comboTimer / 0.2) * 2.0;
                    bodyLean = -0.05;
                } else if (comboCount === 3) {
                    armRAngle = -1.5 + (comboTimer / 0.25) * 3.0;
                    bodyBob = easeOutQuad(comboTimer / 0.25) * 5;
                    bodyLean = dir * 0.12;
                }
                armLAngle = -0.3;
                break;
            case 'dashing':
                bodyLean = dir * 0.2;
                armLAngle = -dir * 0.8;
                armRAngle = dir * 0.8;
                break;
        }

        const bobY = sy + bodyBob;

        // ── Apply body lean ──
        ctx.save();
        ctx.translate(sx, bobY + height);
        ctx.rotate(bodyLean);
        ctx.translate(-sx, -(bobY + height));

        // ── Colors ──
        const baseH = themeHue;
        const bodyColorLight = flashActive ? '#ff5577' : `hsl(${baseH}, 60%, 55%)`;
        const bodyColorDark = flashActive ? '#cc2244' : `hsl(${baseH}, 70%, 30%)`;
        const bodyColorMid = flashActive ? '#ff3355' : `hsl(${baseH}, 65%, 42%)`;
        const metalLight = flashActive ? '#ff7799' : `hsl(${baseH}, 40%, 65%)`;
        const metalDark = flashActive ? '#cc3355' : `hsl(${baseH}, 50%, 25%)`;
        const visorColor = flashActive ? '#ff9999' : `hsl(${(baseH + 150) % 360}, 90%, 60%)`;
        const skinColor = flashActive ? '#ffaaaa' : '#e8c4a0';
        const bootColor = flashActive ? '#cc2244' : `hsl(${baseH}, 50%, 22%)`;

        // ── Shadow on ground ──
        if (!isGhost && isGrounded) {
            ctx.beginPath();
            ctx.ellipse(sx, GROUND_Y + 2, 18, 4, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fill();
        }

        // ── Glow ──
        if (!isGhost) {
            ctx.shadowColor = flashActive ? 'rgba(255, 50, 80, 0.6)' : `hsla(${baseH}, 100%, 50%, 0.35)`;
            ctx.shadowBlur = 14;
        }

        // ── LEGS ──
        const legOriginY = bobY + 40;
        const legLength = 14 + legTuck;
        ctx.lineCap = 'round';
        ctx.lineWidth = 5;

        // Left leg
        ctx.save();
        ctx.translate(sx - 7, legOriginY);
        ctx.rotate(legLAngle);
        // Thigh
        ctx.strokeStyle = bodyColorDark;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, legLength * 0.6);
        ctx.stroke();
        // Shin
        ctx.strokeStyle = metalDark;
        ctx.beginPath();
        ctx.moveTo(0, legLength * 0.6);
        ctx.lineTo(0, legLength);
        ctx.stroke();
        // Boot
        ctx.fillStyle = bootColor;
        roundRect(ctx, -4, legLength - 2, 8, 6, 2);
        ctx.fill();
        ctx.restore();

        // Right leg
        ctx.save();
        ctx.translate(sx + 7, legOriginY);
        ctx.rotate(legRAngle);
        ctx.strokeStyle = bodyColorDark;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, legLength * 0.6);
        ctx.stroke();
        ctx.strokeStyle = metalDark;
        ctx.beginPath();
        ctx.moveTo(0, legLength * 0.6);
        ctx.lineTo(0, legLength);
        ctx.stroke();
        ctx.fillStyle = bootColor;
        roundRect(ctx, -4, legLength - 2, 8, 6, 2);
        ctx.fill();
        ctx.restore();

        // ── TORSO (armored) ──
        const torsoX = sx - 16;
        const torsoY = bobY + 16;
        const torsoW = 32;
        const torsoH = 26;

        // Chest plate
        const chestGrad = ctx.createLinearGradient(torsoX, torsoY, torsoX, torsoY + torsoH);
        chestGrad.addColorStop(0, bodyColorLight);
        chestGrad.addColorStop(0.5, bodyColorMid);
        chestGrad.addColorStop(1, bodyColorDark);
        ctx.fillStyle = chestGrad;
        roundRect(ctx, torsoX, torsoY, torsoW, torsoH, 4);
        ctx.fill();

        // Armor center line
        ctx.strokeStyle = metalLight;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, torsoY + 3);
        ctx.lineTo(sx, torsoY + torsoH - 3);
        ctx.stroke();

        // Chest emblem (small diamond)
        ctx.fillStyle = visorColor;
        ctx.beginPath();
        ctx.moveTo(sx, torsoY + 6);
        ctx.lineTo(sx + 4, torsoY + 10);
        ctx.lineTo(sx, torsoY + 14);
        ctx.lineTo(sx - 4, torsoY + 10);
        ctx.closePath();
        ctx.fill();

        // Belt
        ctx.fillStyle = metalDark;
        ctx.fillRect(torsoX + 2, torsoY + torsoH - 4, torsoW - 4, 4);
        ctx.fillStyle = visorColor;
        ctx.fillRect(sx - 3, torsoY + torsoH - 4, 6, 4); // buckle

        // ── SHOULDER PADS ──
        // Left shoulder
        ctx.fillStyle = metalLight;
        ctx.beginPath();
        ctx.ellipse(sx - 18, torsoY + 4, 8, 6, -0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = bodyColorDark;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Right shoulder
        ctx.beginPath();
        ctx.ellipse(sx + 18, torsoY + 4, 8, 6, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // ── ARMS ──
        const armOriginY = torsoY + 6;
        const armLength = 18;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';

        // Left arm
        ctx.save();
        ctx.translate(sx - 18, armOriginY);
        ctx.rotate(armLAngle);
        // Upper arm
        ctx.strokeStyle = bodyColorMid;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, armLength * 0.55);
        ctx.stroke();
        // Forearm
        ctx.strokeStyle = metalLight;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(0, armLength * 0.55);
        ctx.lineTo(0, armLength);
        ctx.stroke();
        // Fist/gauntlet
        ctx.fillStyle = metalDark;
        ctx.beginPath();
        ctx.arc(0, armLength, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Right arm
        ctx.save();
        ctx.translate(sx + 18, armOriginY);
        ctx.rotate(armRAngle);
        ctx.strokeStyle = bodyColorMid;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, armLength * 0.55);
        ctx.stroke();
        ctx.strokeStyle = metalLight;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(0, armLength * 0.55);
        ctx.lineTo(0, armLength);
        ctx.stroke();
        ctx.fillStyle = metalDark;
        ctx.beginPath();
        ctx.arc(0, armLength, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // ── SCARF / CAPE (visible in jump/fall) ──
        if (!isGrounded && !isDashing && !isGhost) {
            const scarfDir = -dir;
            ctx.strokeStyle = `hsla(${(baseH + 30) % 360}, 70%, 55%, 0.6)`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(sx + scarfDir * 2, torsoY);
            const wave1 = Math.sin(animTime * 5) * 5;
            const wave2 = Math.sin(animTime * 7 + 1) * 3;
            ctx.quadraticCurveTo(
                sx + scarfDir * 14 + wave1, torsoY + 8,
                sx + scarfDir * 22 + wave2, torsoY + 16
            );
            ctx.stroke();
            ctx.strokeStyle = `hsla(${(baseH + 30) % 360}, 70%, 55%, 0.3)`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(sx + scarfDir * 2, torsoY + 3);
            ctx.quadraticCurveTo(
                sx + scarfDir * 12 + wave2, torsoY + 12,
                sx + scarfDir * 20 + wave1, torsoY + 22
            );
            ctx.stroke();
        }

        // ── HEAD ──
        const headCenterX = sx;
        const headCenterY = bobY + 8;
        const headRadius = 12;

        // Helmet base
        const headGrad = ctx.createRadialGradient(headCenterX - 2, headCenterY - 3, 2, headCenterX, headCenterY, headRadius);
        headGrad.addColorStop(0, metalLight);
        headGrad.addColorStop(1, bodyColorDark);
        ctx.fillStyle = headGrad;
        ctx.beginPath();
        ctx.arc(headCenterX, headCenterY, headRadius, 0, Math.PI * 2);
        ctx.fill();

        // Helmet ridge (top crest)
        ctx.strokeStyle = metalLight;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(headCenterX, headCenterY - 1, headRadius - 1, -Math.PI * 0.8, -Math.PI * 0.2);
        ctx.stroke();

        // Visor
        const visorY = headCenterY + 1;
        const visorW = 18;
        const visorH = 6;
        ctx.fillStyle = visorColor;
        ctx.shadowColor = visorColor;
        ctx.shadowBlur = isGhost ? 0 : 8;
        roundRect(ctx, headCenterX - visorW / 2, visorY - visorH / 2, visorW, visorH, 3);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Visor shine
        ctx.fillStyle = `hsla(${(baseH + 150) % 360}, 100%, 85%, 0.5)`;
        ctx.fillRect(headCenterX - visorW / 2 + 3, visorY - visorH / 2 + 1, visorW * 0.3, 2);

        // Eyes behind visor
        if (!isGhost) {
            const eyeOff = facing ? 2 : -2;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(headCenterX + eyeOff - 3, visorY, 2, 0, Math.PI * 2);
            ctx.arc(headCenterX + eyeOff + 3, visorY, 2, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#0a0a2f';
            ctx.beginPath();
            ctx.arc(headCenterX + eyeOff - 3 + (facing ? 0.5 : -0.5), visorY, 1, 0, Math.PI * 2);
            ctx.arc(headCenterX + eyeOff + 3 + (facing ? 0.5 : -0.5), visorY, 1, 0, Math.PI * 2);
            ctx.fill();
        }

        // Chin guard
        ctx.fillStyle = bodyColorDark;
        ctx.beginPath();
        ctx.moveTo(headCenterX - 8, headCenterY + 6);
        ctx.lineTo(headCenterX + 8, headCenterY + 6);
        ctx.lineTo(headCenterX + 5, headCenterY + 12);
        ctx.lineTo(headCenterX - 5, headCenterY + 12);
        ctx.closePath();
        ctx.fill();

        // ── End lean transform ──
        ctx.restore();

        ctx.restore(); // alpha
    }

    function getAnimState() {
        if (isDashing) return 'dashing';
        if (isAttacking) return 'attacking';
        if (isWallSliding) return 'wallslide';
        if (!isGrounded && vy < 0) return 'jumping';
        if (!isGrounded && vy >= 0) return 'falling';
        if (isMoving) return 'running';
        return 'idle';
    }

    // ─────────────────────────────────────────
    //  RENDER: Attack Visuals
    // ─────────────────────────────────────────
    function renderAttack(ctx, sx, sy, cameraX) {
        if (comboCount < 1 || comboCount > 3) return;
        const hit = COMBO_HITS[comboCount - 1];
        const progress = clamp(comboTimer / hit.duration, 0, 1);
        const dir = facingRight ? 1 : -1;

        ctx.save();
        ctx.translate(sx + dir * (width / 2), sy + 28);

        // ── Weapon colors by class ──
        let trailHue, trailSat, trailLum;
        switch (weaponClass) {
            case 0: trailHue = themeHue; trailSat = 100; trailLum = 55; break;     // Cyber laser
            case 1: trailHue = 330; trailSat = 100; trailLum = 75; break;          // Candy
            case 2: trailHue = 28; trailSat = 85; trailLum = 50; break;            // Steampunk
            default: trailHue = 275; trailSat = 100; trailLum = 40; break;         // Void
        }

        const trailColor = `hsla(${trailHue}, ${trailSat}%, ${trailLum}%, ${0.8 - progress * 0.6})`;
        const solidColor = `hsl(${trailHue}, ${trailSat}%, ${trailLum}%)`;

        ctx.shadowColor = trailColor;
        ctx.shadowBlur = 16;

        if (comboCount === 1) {
            // ── Hit 1: Quick horizontal slash ──
            const slashAngle = progress * Math.PI * 0.8;
            const startAngle = facingRight ? -Math.PI * 0.5 : Math.PI * 0.5;
            const endAngle = startAngle + dir * slashAngle;
            const swordLen = 48;

            // Arc trail
            ctx.beginPath();
            ctx.arc(0, 0, swordLen, startAngle, endAngle, !facingRight);
            ctx.strokeStyle = trailColor;
            ctx.lineWidth = 5;
            ctx.stroke();

            // Weapon shaft
            const tipAngle = startAngle + dir * slashAngle;
            const tx = Math.cos(tipAngle) * swordLen;
            const ty = Math.sin(tipAngle) * swordLen;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(tx, ty);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Weapon tip
            renderWeaponTip(ctx, tx, ty, tipAngle, solidColor);

        } else if (comboCount === 2) {
            // ── Hit 2: Upward slash ──
            const slashAngle = progress * Math.PI * 0.9;
            const startAngle = facingRight ? Math.PI * 0.3 : Math.PI * 0.7;
            const endAngle = startAngle - dir * slashAngle;
            const swordLen = 52;

            ctx.beginPath();
            ctx.arc(0, -5, swordLen, startAngle, endAngle, facingRight);
            ctx.strokeStyle = trailColor;
            ctx.lineWidth = 6;
            ctx.stroke();

            const tipAngle = startAngle - dir * slashAngle;
            const tx = Math.cos(tipAngle) * swordLen;
            const ty = -5 + Math.sin(tipAngle) * swordLen;
            ctx.beginPath();
            ctx.moveTo(0, -5);
            ctx.lineTo(tx, ty);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3.5;
            ctx.stroke();

            renderWeaponTip(ctx, tx, ty, tipAngle, solidColor);

        } else if (comboCount === 3) {
            // ── Hit 3: Heavy downward slam ──
            const slamProgress = easeOutQuad(progress);
            const swordLen = 55;
            const slamAngle = facingRight
                ? lerp(-Math.PI * 0.7, Math.PI * 0.3, slamProgress)
                : lerp(Math.PI * 0.7, -Math.PI * 0.3, slamProgress);

            // Wide arc trail
            const startAngle = facingRight ? -Math.PI * 0.7 : Math.PI * 0.7;
            ctx.beginPath();
            ctx.arc(0, 0, swordLen, startAngle, slamAngle, !facingRight);
            ctx.strokeStyle = trailColor;
            ctx.lineWidth = 8;
            ctx.stroke();

            // Weapon shaft
            const tx = Math.cos(slamAngle) * swordLen;
            const ty = Math.sin(slamAngle) * swordLen;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(tx, ty);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4;
            ctx.stroke();

            renderWeaponTip(ctx, tx, ty, slamAngle, solidColor);

            // Ground impact sparks at end of slam
            if (progress > 0.8) {
                const sparkAlpha = (progress - 0.8) / 0.2;
                for (let i = 0; i < 5; i++) {
                    const sparkX = tx + (Math.random() - 0.5) * 30;
                    const sparkY = ty + Math.random() * 10;
                    ctx.beginPath();
                    ctx.arc(sparkX, sparkY, 2 + Math.random() * 2, 0, Math.PI * 2);
                    ctx.fillStyle = `hsla(${trailHue}, 100%, 70%, ${sparkAlpha * (1 - Math.random() * 0.5)})`;
                    ctx.fill();
                }
            }
        }

        ctx.restore();
    }

    function renderWeaponTip(ctx, tx, ty, angle, color) {
        ctx.shadowBlur = 10;
        ctx.shadowColor = color;

        switch (weaponClass) {
            case 0: // Cyber Laser
                ctx.beginPath();
                ctx.arc(tx, ty, 5, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                // Glow ring
                ctx.beginPath();
                ctx.arc(tx, ty, 8, 0, Math.PI * 2);
                ctx.strokeStyle = `hsla(${themeHue}, 100%, 70%, 0.3)`;
                ctx.lineWidth = 1;
                ctx.stroke();
                break;

            case 1: // Candy Lollipop
                ctx.beginPath();
                ctx.arc(tx, ty, 9, 0, Math.PI * 2);
                ctx.fillStyle = '#ffb3cc';
                ctx.fill();
                ctx.strokeStyle = '#ff3388';
                ctx.lineWidth = 2;
                ctx.stroke();
                // Swirl
                ctx.beginPath();
                ctx.arc(tx, ty, 5, 0, Math.PI);
                ctx.stroke();
                break;

            case 2: // Steampunk Cog
                ctx.save();
                ctx.translate(tx, ty);
                ctx.rotate(animTime * 6);
                ctx.beginPath();
                ctx.arc(0, 0, 8, 0, Math.PI * 2);
                ctx.fillStyle = '#d46a00';
                ctx.fill();
                ctx.strokeStyle = '#f5b041';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                for (let i = 0; i < 8; i++) {
                    ctx.rotate(Math.PI / 4);
                    ctx.fillRect(-2, -11, 4, 3.5);
                }
                ctx.restore();
                break;

            default: // Void Spear
                ctx.save();
                ctx.translate(tx, ty);
                ctx.rotate(angle + Math.PI / 4);
                ctx.beginPath();
                ctx.moveTo(0, -9);
                ctx.lineTo(5, 0);
                ctx.lineTo(0, 9);
                ctx.lineTo(-5, 0);
                ctx.closePath();
                ctx.fillStyle = '#4a235a';
                ctx.fill();
                ctx.strokeStyle = '#bb8fce';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.restore();
                break;
        }
        ctx.shadowBlur = 0;
    }

    // ─────────────────────────────────────────
    //  RENDER: Trail Particles
    // ─────────────────────────────────────────
    function renderTrailParticles(ctx, cameraX) {
        for (let t of trail) {
            const tx = t.x - cameraX;
            const alpha = (t.life / t.maxLife) * 0.4;
            ctx.beginPath();
            ctx.arc(tx, t.y, t.size, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${t.hue || themeHue}, 100%, 60%, ${alpha})`;
            ctx.fill();
        }
    }

    // ═══════════════════════════════════════════
    //  GAMEPLAY METHODS
    // ═══════════════════════════════════════════
    function takeDamage(amount) {
        if (isDead) return;

        // Shield active prevents taking positive damage
        if (amount > 0 && typeof Collectibles !== 'undefined' && Collectibles.hasShield) {
            return;
        }

        health -= amount;

        if (amount > 0) {
            damageFlash = 0.4;
            // Knockback stagger (pushed backward 30px equivalent velocity)
            const kbDir = facingRight ? -1 : 1;
            knockbackVx = kbDir * 150;
        } else {
            // Healing
            health = Math.min(maxHealth, health);
        }

        if (health <= 0) {
            health = 0;
            isDead = true;
            deathTimer = 0;
        }
    }

    function addScore(points) {
        score += points;
    }

    function getAttackBox() {
        const dir = facingRight ? 1 : -1;
        if (comboCount >= 1 && comboCount <= 3) {
            const hit = COMBO_HITS[comboCount - 1];
            return {
                x: x + dir * 10,
                y: y - height + 5,
                width: hit.boxW,
                height: hit.boxH
            };
        }
        // Fallback
        return {
            x: x + dir * 10,
            y: y - height + 10,
            width: 55,
            height: height - 10
        };
    }

    function getHitBox() {
        return {
            x: x - width / 2,
            y: y - height,
            width: width,
            height: height
        };
    }

    function reset() {
        x = 200;
        y = 400;
        vx = 0;
        vy = 0;
        health = 100;
        score = 0;
        isDead = false;
        deathTimer = 0;
        isAttacking = false;
        comboCount = 0;
        comboTimer = 0;
        comboWindow = 0;
        comboCooldown = 0;
        comboQueued = false;
        facingRight = true;
        isGrounded = false;
        isMoving = false;
        damageFlash = 0;
        knockbackVx = 0;
        isDashing = false;
        dashTimer = 0;
        dashCooldown = 0;
        jumpsLeft = MAX_JUMPS;
        coyoteTimer = 0;
        isWallSliding = false;
        screenShakeTimer = 0;
        animTime = 0;
        runCycle = 0;
        breathCycle = 0;
        trail = [];
        afterimages = [];
        doubleJumpParticles = [];
    }

    function warp(newX, newY = 400) {
        x = newX;
        y = newY;
        vx = 0;
        vy = 0;
        trail = [];
        afterimages = [];
        doubleJumpParticles = [];
    }

    function triggerScreenShake(duration = 0.2) {
        screenShakeTimer = duration;
    }

    // ═══════════════════════════════════════════
    //  PUBLIC API
    // ═══════════════════════════════════════════
    return {
        init, update, render, takeDamage, addScore,
        getAttackBox, getHitBox, reset, setTheme, warp,
        triggerScreenShake,
        get x() { return x; },
        get y() { return y; },
        get health() { return health; },
        get maxHealth() { return maxHealth; },
        get score() { return score; },
        get isDead() { return isDead; },
        get isAttacking() { return isAttacking; },
        get facingRight() { return facingRight; },
        get themeHue() { return themeHue; },
        get weaponClass() { return weaponClass; },
        get comboCount() { return comboCount; },
        get isDashing() { return isDashing; },
        get isGrounded() { return isGrounded; }
    };
})();
