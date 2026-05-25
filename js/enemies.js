/* ============================================
   enemies.js — Enemy System
   ============================================ */
const Enemies = (() => {
    let enemies = [];
    let spawnTimer = 0;
    let hitParticles = [];
    let projectiles = [];
    let damageNumbers = [];
    let bossSpawned = { cave: false, space: false };

    // Enemy type definitions per zone
    const TYPES = {
        forest: { name: 'Slime', color: '#44ff44', glowColor: 'rgba(68,255,68,', size: 30, speed: 80, health: 30, damage: 8, score: 10, shape: 'blob' },
        cave: { name: 'Shadow Bat', color: '#b388ff', glowColor: 'rgba(179,136,255,', size: 25, speed: 150, health: 20, damage: 12, score: 15, shape: 'bat' },
        volcano: { name: 'Fire Elemental', color: '#ff6633', glowColor: 'rgba(255,102,51,', size: 35, speed: 120, health: 50, damage: 15, score: 25, shape: 'flame' },
        sky: { name: 'Sky Knight', color: '#66bbff', glowColor: 'rgba(102,187,255,', size: 40, speed: 100, health: 60, damage: 18, score: 30, shape: 'knight' },
        space: { name: 'Alien Ship', color: '#ff44ff', glowColor: 'rgba(255,68,255,', size: 35, speed: 180, health: 40, damage: 20, score: 40, shape: 'ship' }
    };

    function createEnemy(zone, playerX) {
        const type = TYPES[zone];
        if (!type) return null;
        const spawnSide = Math.random() > 0.5 ? 1 : -1;
        const isFlying = type.shape === 'bat' || type.shape === 'ship';
        const zoneStart = getZoneStart(zone);
        const zoneEnd = zoneStart + 2000;
        let spawnX = playerX + spawnSide * (400 + Math.random() * 200);
        spawnX = Math.max(zoneStart + 50, Math.min(zoneEnd - 50, spawnX));

        return {
            x: spawnX,
            y: isFlying ? (300 - Math.random() * 150) : 500 - type.size,
            baseY: isFlying ? (300 - Math.random() * 150) : 500 - type.size,
            name: type.name,
            color: type.color,
            glowColor: type.glowColor,
            size: type.size,
            speed: type.speed,
            health: type.health,
            damage: type.damage,
            score: type.score,
            shape: type.shape,
            currentHealth: type.health,
            zone: zone,
            animTimer: Math.random() * Math.PI * 2,
            hitFlash: 0,
            damageCooldown: 0
        };
    }

    function getZoneStart(zone) {
        switch (zone) {
            case 'forest': return 0;
            case 'cave': return 2000;
            case 'volcano': return 4000;
            case 'sky': return 6000;
            case 'space': return 8000;
            default: return 0;
        }
    }

    function update(dt, playerX, playerZone) {
        spawnTimer -= dt;

        // Calculate dynamic difficulty based on player actions (score progression)
        const score = (typeof Player !== 'undefined') ? Player.score : 0;
        const difficultyMultiplier = Math.min(2.0, 1 + (score / 150) * 0.12);
        const maxEnemies = Math.min(12, 6 + Math.floor(score / 100));

        // ── Boss Spawning Logic ──
        if (playerZone === 'cave' && playerX > 3400 && !bossSpawned.cave) {
            bossSpawned.cave = true;
            enemies.push({
                x: 3800,
                y: 500 - 80,
                baseY: 500 - 80,
                name: 'Crystal Golem (Mini-Boss)',
                color: '#00f0ff',
                size: 80,
                health: 400,
                currentHealth: 400,
                damage: 22,
                score: 150,
                shape: 'boss_cave',
                isBoss: true,
                animTimer: 0,
                hitFlash: 0,
                damageCooldown: 0,
                attackTimer: 2.0,
            });
            if (typeof Sound !== 'undefined') Sound.playBossIntro();
            if (typeof Narrator !== 'undefined') Narrator.play('boss_intro');
        }

        if (playerZone === 'space' && playerX > 9200 && !bossSpawned.space) {
            bossSpawned.space = true;
            enemies.push({
                x: 9600,
                y: 200,
                baseY: 200,
                name: 'Void Overlord (Final Boss)',
                color: '#ff00ff',
                size: 100,
                health: 800,
                currentHealth: 800,
                damage: 30,
                score: 500,
                shape: 'boss_space',
                isBoss: true,
                animTimer: 0,
                hitFlash: 0,
                damageCooldown: 0,
                attackTimer: 2.5,
                phase: 1,
            });
            if (typeof Sound !== 'undefined') Sound.playBossIntro();
            if (typeof Narrator !== 'undefined') Narrator.play('boss_intro');
        }

        // Spawn new standard enemies (only if no boss is currently active)
        const bossActive = enemies.find(e => e.isBoss);
        if (!bossActive && spawnTimer <= 0 && enemies.length < maxEnemies) {
            const e = createEnemy(playerZone, playerX);
            if (e) {
                e.speed *= difficultyMultiplier;
                e.health = Math.floor(e.health * difficultyMultiplier);
                e.currentHealth = e.health;
                e.damage = Math.floor(e.damage * (1 + (difficultyMultiplier - 1) * 0.4));
                enemies.push(e);
            }
            spawnTimer = (2 + Math.random()) / difficultyMultiplier;
        }

        // Update standard and boss enemies
        for (let e of enemies) {
            e.animTimer += dt * 3;
            if (e.hitFlash > 0) e.hitFlash -= dt;
            if (e.damageCooldown > 0) e.damageCooldown -= dt;

            // Boss AI
            if (e.isBoss) {
                e.attackTimer -= dt;
                
                if (e.shape === 'boss_cave') {
                    // Cave Golem slow walking AI
                    const dx = playerX - e.x;
                    const dir = dx > 0 ? 1 : -1;
                    e.x += dir * 40 * dt;
                    
                    if (e.attackTimer <= 0) {
                        e.attackTimer = 3.5 + Math.random() * 2;
                        if (typeof Player !== 'undefined') Player.triggerScreenShake(0.4);
                        if (typeof Sound !== 'undefined') Sound.playSlash(3);
                        // Launch crystals left and right
                        projectiles.push({ x: e.x - 20, y: 500 - 20, vx: -250, vy: 0, radius: 10, color: '#00f0ff', damage: 16, type: 'crystal' });
                        projectiles.push({ x: e.x + 20, y: 500 - 20, vx: 250, vy: 0, radius: 10, color: '#00f0ff', damage: 16, type: 'crystal' });
                    }
                } else if (e.shape === 'boss_space') {
                    // Space Overlord phase and attack AI
                    if (e.currentHealth > 500) e.phase = 1;
                    else if (e.currentHealth > 200) e.phase = 2;
                    else e.phase = 3;

                    // Hovering movement
                    e.y = e.baseY + Math.sin(e.animTimer * 1.5) * 35;
                    const dx = playerX - e.x;
                    if (Math.abs(dx) > 200) {
                        e.x += (dx > 0 ? 1 : -1) * 80 * dt;
                    }

                    // Phase specific teleport
                    if (e.phase >= 2) {
                        if (e.teleportTimer === undefined) e.teleportTimer = 4.0;
                        e.teleportTimer -= dt;
                        if (e.teleportTimer <= 0) {
                            e.teleportTimer = e.phase === 3 ? 2.5 : 4.0;
                            const teleportSide = Math.random() > 0.5 ? 1 : -1;
                            e.x = playerX + teleportSide * 200;
                            e.y = e.baseY;
                            spawnHitParticles(e.x, e.y, '#ff00ff');
                            if (typeof Sound !== 'undefined') Sound.playDash();
                        }
                    }

                    if (e.attackTimer <= 0) {
                        if (e.phase === 1) {
                            e.attackTimer = 1.6;
                            const angle = Math.atan2(500 - 30 - e.y, playerX - e.x);
                            projectiles.push({ x: e.x, y: e.y, vx: Math.cos(angle) * 320, vy: Math.sin(angle) * 320, radius: 12, color: '#ff00ff', damage: 18, type: 'void' });
                            if (typeof Sound !== 'undefined') Sound.playPickup('shield');
                        } else if (e.phase === 2) {
                            e.attackTimer = 2.0;
                            for (let offset = -60; offset <= 60; offset += 40) {
                                projectiles.push({ x: e.x + offset, y: e.y + 20, vx: 0, vy: 400, radius: 6, color: '#00ffff', damage: 20, type: 'laser' });
                            }
                            if (typeof Sound !== 'undefined') Sound.playDash();
                        } else {
                            e.attackTimer = 2.0;
                            // Radial 8-direction burst
                            for (let i = 0; i < 8; i++) {
                                const angle = (Math.PI / 4) * i;
                                projectiles.push({ x: e.x, y: e.y, vx: Math.cos(angle) * 250, vy: Math.sin(angle) * 250, radius: 10, color: '#ff0055', damage: 22, type: 'void' });
                            }
                            if (typeof Sound !== 'undefined') Sound.playDoubleJump();
                        }
                    }
                }
                continue;
            }

            // Normal enemies AI
            const dx = playerX - e.x;
            const dir = dx > 0 ? 1 : -1;

            switch (e.shape) {
                case 'blob':
                    if (e.hopTimer === undefined) e.hopTimer = 0.5;
                    if (e.vy === undefined) e.vy = 0;
                    if (e.vx === undefined) e.vx = 0;
                    e.hopTimer -= dt;

                    if (e.hopTimer <= 0 && e.y >= 500 - e.size) {
                        e.vy = -230 - Math.random() * 60;
                        e.vx = dir * (100 + Math.random() * 40);
                        e.hopTimer = 1.2 + Math.random() * 1.0;
                    }

                    if (e.y < 500 - e.size) {
                        e.vy += 650 * dt;
                        e.y += e.vy * dt;
                        e.x += e.vx * dt;
                    } else {
                        e.y = 500 - e.size;
                        e.vy = 0;
                        e.vx = 0;
                    }
                    break;

                case 'bat':
                    if (e.swoopTimer === undefined) e.swoopTimer = 2.0 + Math.random() * 3;
                    if (e.vx === undefined) e.vx = 0;
                    if (e.vy === undefined) e.vy = 0;
                    e.swoopTimer -= dt;

                    if (e.swooping) {
                        e.x += e.vx * dt;
                        e.y += e.vy * dt;
                        if (e.y >= 450 || Math.abs(playerX - e.x) < 20) {
                            e.swooping = false;
                            e.swoopTimer = 3.0 + Math.random() * 2;
                        }
                    } else {
                        e.x += dir * e.speed * 0.4 * dt;
                        const targetY = e.baseY + Math.sin(e.animTimer) * 15;
                        e.y += (targetY - e.y) * dt * 2;

                        if (e.swoopTimer <= 0) {
                            e.swooping = true;
                            e.vx = (playerX - e.x) * 1.5;
                            e.vy = 350;
                        }
                    }
                    break;

                case 'flame':
                    if (e.shootTimer === undefined) e.shootTimer = 1.0 + Math.random() * 2;
                    e.shootTimer -= dt;

                    const dist = Math.abs(dx);
                    if (dist > 300) {
                        e.x += dir * e.speed * dt;
                    } else if (dist < 180) {
                        e.x -= dir * e.speed * dt;
                    }
                    e.y = e.baseY + Math.sin(e.animTimer * 1.8) * 15;

                    if (e.shootTimer <= 0) {
                        e.shootTimer = 2.2 + Math.random() * 1.5;
                        const angle = Math.atan2(500 - 30 - e.y, playerX - e.x);
                        projectiles.push({ x: e.x, y: e.y, vx: Math.cos(angle) * 280, vy: Math.sin(angle) * 280, radius: 7, color: '#ff6633', damage: e.damage, type: 'fireball' });
                        if (typeof Sound !== 'undefined') Sound.playSlash(1);
                    }
                    break;

                case 'knight':
                    if (e.lungeTimer === undefined) e.lungeTimer = 2.0 + Math.random() * 2;
                    if (e.lungeCharge === undefined) e.lungeCharge = 0;
                    if (e.lungeActive === undefined) e.lungeActive = 0;

                    if (e.lungeCharge > 0) {
                        e.lungeCharge -= dt;
                        if (e.lungeCharge <= 0) {
                            e.lungeActive = 0.4;
                        }
                    } else if (e.lungeActive > 0) {
                        e.lungeActive -= dt;
                        e.x += e.lungeDir * e.speed * 2.8 * dt;
                    } else {
                        e.x += dir * e.speed * dt;
                        e.y = e.baseY + Math.abs(Math.sin(e.animTimer)) * 4;

                        e.lungeTimer -= dt;
                        if (e.lungeTimer <= 0) {
                            e.lungeTimer = 3.0 + Math.random() * 2.5;
                            e.lungeCharge = 0.5;
                            e.lungeDir = dir;
                        }
                    }
                    break;

                case 'ship':
                    if (e.shootTimer === undefined) e.shootTimer = 0.8;
                    e.shootTimer -= dt;

                    e.x += dir * e.speed * dt;
                    e.y = e.baseY + Math.sin(e.animTimer * 1.5) * 20;

                    if (e.shootTimer <= 0) {
                        e.shootTimer = 0.9 + Math.random() * 0.9;
                        projectiles.push({ x: e.x, y: e.y + 15, vx: 0, vy: 380, radius: 4, color: '#ff44ff', damage: e.damage, type: 'laser' });
                        if (typeof Sound !== 'undefined') Sound.playPickup('multiplier');
                    }
                    break;

                default:
                    e.x += dir * e.speed * dt;
            }
        }

        // Update Projectiles
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.x < playerX - 1000 || p.x > playerX + 1000 || p.y < 0 || p.y > 600) {
                projectiles.splice(i, 1);
            }
        }

        // Update Damage Numbers
        for (let i = damageNumbers.length - 1; i >= 0; i--) {
            const d = damageNumbers[i];
            d.y -= 45 * dt;
            d.life -= dt;
            d.opacity = d.life / d.maxLife;
            if (d.life <= 0) {
                damageNumbers.splice(i, 1);
            }
        }

        // Remove dead or distant enemies
        enemies = enemies.filter(e => {
            const isDead = e.currentHealth <= 0;
            if (isDead) {
                if (typeof Collectibles !== 'undefined') {
                    Collectibles.spawnDrop(e.x, e.y);
                }
            }
            return !isDead && Math.abs(e.x - playerX) < 1000;
        });

        // Update hit particles
        for (let p of hitParticles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 300 * dt;
            p.life -= dt;
        }
        hitParticles = hitParticles.filter(p => p.life > 0);
    }

    function renderBossCave(ctx, sx, sy, s, color, e) {
        ctx.save();
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 20;
        ctx.fillStyle = '#2f3e46';
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 3;
        
        ctx.beginPath();
        ctx.moveTo(sx - s/2, sy + s/2);
        ctx.lineTo(sx - s/3, sy - s/2);
        ctx.lineTo(sx + s/3, sy - s/2);
        ctx.lineTo(sx + s/2, sy + s/2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#00f0ff';
        ctx.beginPath();
        ctx.moveTo(sx - s/2, sy - s/3);
        ctx.lineTo(sx - s*0.7, sy - s*0.6);
        ctx.lineTo(sx - s/3, sy - s/2);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(sx + s/2, sy - s/3);
        ctx.lineTo(sx + s*0.7, sy - s*0.6);
        ctx.lineTo(sx + s/3, sy - s/2);
        ctx.closePath();
        ctx.fill();

        const pulse = Math.sin(e.animTimer * 4) * 0.2 + 0.8;
        ctx.fillStyle = `rgba(0, 240, 255, ${pulse})`;
        ctx.fillRect(sx - s/5, sy - s/3, s * 0.4, 8);

        ctx.restore();
    }

    function renderBossSpace(ctx, sx, sy, s, color, e) {
        ctx.save();
        ctx.strokeStyle = '#ff00ff';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#ff00ff';
        ctx.shadowBlur = 15;
        
        ctx.beginPath();
        ctx.ellipse(sx, sy, s * 0.8, s * 0.3, e.animTimer * 0.5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#00ffff';
        ctx.beginPath();
        ctx.ellipse(sx, sy, s * 0.6, s * 0.2, -e.animTimer * 0.7, 0, Math.PI * 2);
        ctx.stroke();

        const coreGrad = ctx.createRadialGradient(sx - s/10, sy - s/10, s/10, sx, sy, s/3);
        coreGrad.addColorStop(0, '#ffffff');
        coreGrad.addColorStop(0.3, '#ff00ff');
        coreGrad.addColorStop(1, '#0a0114');
        ctx.fillStyle = coreGrad;
        
        ctx.beginPath();
        ctx.arc(sx, sy, s/3 + Math.sin(e.animTimer * 5) * 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#aa00ff';
        ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
            const angle = e.animTimer * 0.2 + (i * Math.PI / 3);
            const dist = s * 0.4 + Math.sin(e.animTimer * 3 + i) * 6;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + Math.cos(angle) * dist, sy + Math.sin(angle) * dist);
            ctx.stroke();
        }

        ctx.restore();
    }

    function render(ctx, cameraX) {
        // Draw Projectiles
        for (let p of projectiles) {
            const px = p.x - cameraX;
            ctx.save();
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 10;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(px, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Draw Damage Numbers
        for (let d of damageNumbers) {
            ctx.save();
            ctx.font = '900 13px "Orbitron", sans-serif';
            ctx.fillStyle = d.color;
            ctx.shadowColor = d.color;
            ctx.shadowBlur = 6;
            ctx.globalAlpha = Math.max(0, d.opacity);
            ctx.textAlign = 'center';
            ctx.fillText(d.value, d.x - cameraX, d.y);
            ctx.restore();
        }
        ctx.globalAlpha = 1;

        // Hit particles
        for (let p of hitParticles) {
            const px = p.x - cameraX;
            ctx.beginPath();
            ctx.arc(px, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Enemies
        for (let e of enemies) {
            const sx = e.x - cameraX;
            const sy = e.y;
            const s = e.size;
            const flashActive = e.hitFlash > 0 && Math.sin(e.hitFlash * 30) > 0;
            const color = flashActive ? '#ffffff' : e.color;

            ctx.save();
            ctx.shadowColor = e.color;
            ctx.shadowBlur = 12;

            if (e.shape === 'boss_cave') {
                renderBossCave(ctx, sx, sy, s, color, e);
            } else if (e.shape === 'boss_space') {
                renderBossSpace(ctx, sx, sy, s, color, e);
            } else {
                switch (e.shape) {
                    case 'blob': renderBlob(ctx, sx, sy, s, color, e); break;
                    case 'bat': renderBat(ctx, sx, sy, s, color, e); break;
                    case 'flame': renderFlame(ctx, sx, sy, s, color, e); break;
                    case 'knight': renderKnight(ctx, sx, sy, s, color, e); break;
                    case 'ship': renderShip(ctx, sx, sy, s, color, e); break;
                }
            }

            ctx.restore();

            // Health bar
            if (e.currentHealth < e.health) {
                const barW = s * 1.2;
                const barH = 5;
                const barX = sx - barW / 2;
                const barY = sy - s - 12;
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.fillRect(barX, barY, barW, barH);
                ctx.fillStyle = e.isBoss ? '#00f0ff' : '#ff3355';
                ctx.fillRect(barX, barY, barW * (e.currentHealth / e.health), barH);
                ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                ctx.lineWidth = 1;
                ctx.strokeRect(barX, barY, barW, barH);

                if (e.isBoss) {
                    ctx.font = 'bold 9px "Orbitron", sans-serif';
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.fillText(e.name.toUpperCase(), sx, barY - 6);
                }
            }
        }
    }

    function renderBlob(ctx, sx, sy, s, color, e) {
        const wClass = (typeof Player !== 'undefined') ? Player.weaponClass : 0;
        const tHue = (typeof Player !== 'undefined') ? Player.themeHue : 190;
        
        ctx.save();
        
        if (wClass === 0) { // Cyber: Neon matrix block / glitchy vector cube
            ctx.shadowColor = `hsla(${(tHue + 180) % 360}, 100%, 50%, 0.8)`;
            ctx.shadowBlur = 10;
            
            // Draw a spinning glitchy cube outline
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(e.animTimer * 0.5);
            ctx.strokeStyle = `hsla(${tHue}, 100%, 60%, 1)`;
            ctx.lineWidth = 2;
            
            // Outer square
            ctx.strokeRect(-s/2, -s/2, s, s);
            
            // Inner square
            ctx.strokeStyle = `hsla(${(tHue + 120) % 360}, 100%, 60%, 0.8)`;
            ctx.strokeRect(-s/4, -s/4, s/2, s/2);
            
            // Connecting corners
            ctx.beginPath();
            ctx.moveTo(-s/2, -s/2); ctx.lineTo(-s/4, -s/4);
            ctx.moveTo(s/2, -s/2); ctx.lineTo(s/4, -s/4);
            ctx.moveTo(s/2, s/2); ctx.lineTo(s/4, s/4);
            ctx.moveTo(-s/2, s/2); ctx.lineTo(-s/4, s/4);
            ctx.stroke();
            ctx.restore();
            
            // Neon glowing eyes inside
            ctx.beginPath();
            ctx.arc(sx - 5, sy - 2, 3, 0, Math.PI * 2);
            ctx.arc(sx + 5, sy - 2, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        } 
        else if (wClass === 1) { // Candy: Wrapped hard candy or sweet pink jelly drop
            ctx.shadowColor = '#ff66aa';
            ctx.shadowBlur = 8;
            
            // Sweets wrapper twists on sides
            ctx.fillStyle = '#ff99cc';
            ctx.beginPath();
            // Left twist
            ctx.moveTo(sx - s/2, sy);
            ctx.lineTo(sx - s * 0.8, sy - s/4);
            ctx.lineTo(sx - s * 0.8, sy + s/4);
            ctx.closePath();
            ctx.fill();
            // Right twist
            ctx.beginPath();
            ctx.moveTo(sx + s/2, sy);
            ctx.lineTo(sx + s * 0.8, sy - s/4);
            ctx.lineTo(sx + s * 0.8, sy + s/4);
            ctx.closePath();
            ctx.fill();
            
            // Main round candy
            ctx.beginPath();
            ctx.arc(sx, sy, s/2, 0, Math.PI * 2);
            const grad = ctx.createRadialGradient(sx - 3, sy - 3, 2, sx, sy, s/2);
            grad.addColorStop(0, '#fff0f5');
            grad.addColorStop(1, '#ff3388');
            ctx.fillStyle = grad;
            ctx.fill();
            
            // Candy swirl lines
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(sx, sy, s/3, 0, Math.PI);
            ctx.stroke();
            
            // Cute eyes
            ctx.fillStyle = '#111';
            ctx.beginPath();
            ctx.arc(sx - 4, sy - 2, 2, 0, Math.PI * 2);
            ctx.arc(sx + 4, sy - 2, 2, 0, Math.PI * 2);
            ctx.fill();
        } 
        else if (wClass === 2) { // Steampunk: Rolling brass wheel / clockwork gear
            ctx.shadowColor = '#d46a00';
            ctx.shadowBlur = 8;
            
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(e.animTimer);
            
            // Draw bronze outer gear rim
            ctx.beginPath();
            ctx.arc(0, 0, s/2, 0, Math.PI * 2);
            ctx.fillStyle = '#b35900';
            ctx.fill();
            ctx.strokeStyle = '#f5b041';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            
            // Gear teeth
            ctx.fillStyle = '#804000';
            for (let i = 0; i < 6; i++) {
                ctx.rotate(Math.PI / 3);
                ctx.fillRect(-3, -s/2 - 2, 6, 4);
            }
            
            // Copper center hub
            ctx.beginPath();
            ctx.arc(0, 0, s/4, 0, Math.PI * 2);
            ctx.fillStyle = '#e67e22';
            ctx.fill();
            ctx.stroke();
            ctx.restore();
            
            // Rivet eyes
            ctx.fillStyle = '#ffd700';
            ctx.beginPath();
            ctx.arc(sx - 5, sy, 2, 0, Math.PI * 2);
            ctx.arc(sx + 5, sy, 2, 0, Math.PI * 2);
            ctx.fill();
        } 
        else { // Void: Dark shifting amorphous blackhole cloud
            ctx.shadowColor = '#6c3483';
            ctx.shadowBlur = 12;
            
            // Shifting void cloud layers
            const wobble1 = Math.sin(e.animTimer * 4) * 4;
            const wobble2 = Math.cos(e.animTimer * 3) * 4;
            
            ctx.fillStyle = '#1a052e';
            ctx.beginPath();
            ctx.ellipse(sx, sy, s/2 + wobble1, s/2 - wobble2, 0, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = 'rgba(108, 52, 131, 0.4)';
            ctx.beginPath();
            ctx.ellipse(sx, sy, s/2.5 - wobble2, s/2.5 + wobble1, 0, 0, Math.PI * 2);
            ctx.fill();
            
            // Dark core
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(sx, sy, s/4, 0, Math.PI * 2);
            ctx.fill();
            
            // Shimmering purple eyes
            ctx.fillStyle = '#ff00ff';
            ctx.beginPath();
            ctx.arc(sx - 4, sy - 2, 2.5, 0, Math.PI * 2);
            ctx.arc(sx + 4, sy - 2, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore();
    }
 
    function drawHeart(ctx, x, y, size, fill) {
        ctx.save();
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(x, y + size * 0.3);
        ctx.bezierCurveTo(x - size * 0.5, y - size * 0.5, x - size, y, x, y + size);
        ctx.bezierCurveTo(x + size, y, x + size * 0.5, y - size * 0.5, x, y + size * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function renderBat(ctx, sx, sy, s, color, e) {
        const wClass = (typeof Player !== 'undefined') ? Player.weaponClass : 0;
        const tHue = (typeof Player !== 'undefined') ? Player.themeHue : 190;
        const flapAngle = Math.sin(e.animTimer * 6) * 0.5;
        
        ctx.save();
        
        if (wClass === 0) { // Cyber: Digital glitched vector bat
            ctx.shadowColor = `hsla(${tHue}, 100%, 50%, 0.8)`;
            ctx.shadowBlur = 10;
            
            // Draw a diamond body representing a digital bat
            ctx.beginPath();
            ctx.moveTo(sx, sy - s/2);
            ctx.lineTo(sx - s/3, sy);
            ctx.lineTo(sx, sy + s/2);
            ctx.lineTo(sx + s/3, sy);
            ctx.closePath();
            ctx.fillStyle = `hsla(${tHue}, 100%, 20%, 0.7)`;
            ctx.fill();
            ctx.strokeStyle = `hsla(${tHue}, 100%, 60%, 1)`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
            // Left vector wing
            ctx.save();
            ctx.translate(sx - s/3, sy);
            ctx.rotate(-flapAngle);
            ctx.strokeStyle = `hsla(${(tHue + 120) % 360}, 100%, 50%, 1)`;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-s, -s/3);
            ctx.lineTo(-s * 0.7, s/4);
            ctx.lineTo(0, 0);
            ctx.stroke();
            ctx.restore();
            
            // Right vector wing
            ctx.save();
            ctx.translate(sx + s/3, sy);
            ctx.rotate(flapAngle);
            ctx.strokeStyle = `hsla(${(tHue + 120) % 360}, 100%, 50%, 1)`;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(s, -s/3);
            ctx.lineTo(s * 0.7, s/4);
            ctx.lineTo(0, 0);
            ctx.stroke();
            ctx.restore();
            
            // Scanning eyes
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(sx - 4, sy - 3, 8, 2);
        }
        else if (wClass === 1) { // Candy: Sweet pink lollipop/heart bat
            ctx.shadowColor = '#ff66bb';
            ctx.shadowBlur = 8;
            
            // Cute round candy body
            ctx.beginPath();
            ctx.arc(sx, sy, s/3, 0, Math.PI * 2);
            ctx.fillStyle = '#ffccff';
            ctx.fill();
            ctx.strokeStyle = '#ff33aa';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Cute heart-shaped wings
            // Left wing
            ctx.save();
            ctx.translate(sx - s/4, sy);
            ctx.rotate(-flapAngle - Math.PI / 4);
            drawHeart(ctx, 0, 0, s * 0.5, '#ff80df');
            ctx.restore();
            
            // Right wing
            ctx.save();
            ctx.translate(sx + s/4, sy);
            ctx.rotate(flapAngle + Math.PI / 4);
            ctx.scale(-1, 1);
            drawHeart(ctx, 0, 0, s * 0.5, '#ff80df');
            ctx.restore();
            
            // Black cute dots for eyes
            ctx.fillStyle = '#111';
            ctx.beginPath();
            ctx.arc(sx - 3, sy - 2, 2.5, 0, Math.PI * 2);
            ctx.arc(sx + 3, sy - 2, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
        else if (wClass === 2) { // Steampunk: Clockwork metallic gear bat
            ctx.shadowColor = '#d46a00';
            ctx.shadowBlur = 8;
            
            // Body made of a small central gear
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(e.animTimer * 1.5);
            ctx.beginPath();
            ctx.arc(0, 0, s/3, 0, Math.PI * 2);
            ctx.fillStyle = '#7a3d00';
            ctx.fill();
            ctx.strokeStyle = '#d46a00';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
            
            // Leather-canvas styled wings with brass struts
            // Left wing
            ctx.save();
            ctx.translate(sx - s/3, sy);
            ctx.rotate(-flapAngle);
            ctx.fillStyle = '#8a5a36';
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-s * 0.8, -s/4);
            ctx.quadraticCurveTo(-s * 0.6, s/4, -s * 0.4, 0);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#ffd27f';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
            
            // Right wing
            ctx.save();
            ctx.translate(sx + s/3, sy);
            ctx.rotate(flapAngle);
            ctx.fillStyle = '#8a5a36';
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(s * 0.8, -s/4);
            ctx.quadraticCurveTo(s * 0.6, s/4, s * 0.4, 0);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#ffd27f';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
            
            // Glowing yellow steam eyes
            ctx.fillStyle = '#ffff00';
            ctx.beginPath();
            ctx.arc(sx - 3, sy - 3, 2, 0, Math.PI * 2);
            ctx.arc(sx + 3, sy - 3, 2, 0, Math.PI * 2);
            ctx.fill();
        }
        else { // Void: Deep space dark shadow bat
            ctx.shadowColor = '#6c3483';
            ctx.shadowBlur = 12;
            
            // Ethereal particle smoke body
            ctx.fillStyle = '#0f051c';
            ctx.beginPath();
            ctx.arc(sx, sy, s/3, 0, Math.PI * 2);
            ctx.fill();
            
            // Shadowy amorphous wings
            // Left wing
            ctx.save();
            ctx.translate(sx - s/4, sy);
            ctx.rotate(-flapAngle);
            ctx.fillStyle = 'rgba(108, 52, 131, 0.6)';
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-s * 0.9, -s * 0.3);
            ctx.bezierCurveTo(-s * 0.7, s * 0.5, -s * 0.3, s * 0.2, 0, 0);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            
            // Right wing
            ctx.save();
            ctx.translate(sx + s/4, sy);
            ctx.rotate(flapAngle);
            ctx.fillStyle = 'rgba(108, 52, 131, 0.6)';
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(s * 0.9, -s * 0.3);
            ctx.bezierCurveTo(s * 0.7, s * 0.5, s * 0.3, s * 0.2, 0, 0);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            
            // Dark violet glowing dots for eyes
            ctx.fillStyle = '#ff00ff';
            ctx.beginPath();
            ctx.arc(sx - 3, sy - 2, 2.5, 0, Math.PI * 2);
            ctx.arc(sx + 3, sy - 2, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore();
    }

    function renderFlame(ctx, sx, sy, s, color, e) {
        const wClass = (typeof Player !== 'undefined') ? Player.weaponClass : 0;
        const tHue = (typeof Player !== 'undefined') ? Player.themeHue : 190;
        const flicker = Math.sin(e.animTimer * 8) * 3;
        const flicker2 = Math.cos(e.animTimer * 6) * 4;
        
        ctx.save();
        
        if (wClass === 0) { // Cyber: Glitchy digital grid flame
            ctx.shadowColor = `hsla(${tHue}, 100%, 55%, 0.8)`;
            ctx.shadowBlur = 12;
            
            // Vertical bar matrices simulating fire
            ctx.fillStyle = `hsla(${tHue}, 100%, 50%, 0.8)`;
            ctx.fillRect(sx - s/3, sy - s/2 + flicker, s/5, s + flicker2);
            ctx.fillRect(sx - s/15, sy - s * 0.8 + flicker2, s/5, s*1.2 - flicker);
            ctx.fillRect(sx + s/5, sy - s/2.5 - flicker, s/5, s*0.8 + flicker2);
            
            ctx.fillStyle = `hsla(${(tHue + 120) % 360}, 100%, 65%, 0.9)`;
            ctx.fillRect(sx - s/7, sy - s/2 + flicker2, s/4, s*0.7);
            
            // Matrix dot eyes
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(sx - 4, sy - 2, 2.5, 2.5);
            ctx.fillRect(sx + 2, sy - 2, 2.5, 2.5);
        }
        else if (wClass === 1) { // Candy: Fluffy cotton candy fire / marshmallow sparkler
            ctx.shadowColor = '#ffb3d9';
            ctx.shadowBlur = 10;
            
            // Draw overlapping fluffy circles representing cotton candy
            ctx.fillStyle = '#ff80bf';
            ctx.beginPath();
            ctx.arc(sx, sy + 8, s/2.5, 0, Math.PI * 2);
            ctx.arc(sx - s/4, sy - s/6 + flicker, s/3.5, 0, Math.PI * 2);
            ctx.arc(sx + s/4, sy - s/6 + flicker2, s/3.5, 0, Math.PI * 2);
            ctx.arc(sx, sy - s/2 + flicker, s/3, 0, Math.PI * 2);
            ctx.fill();
            
            // Center sugary bright core
            ctx.fillStyle = '#fff0f5';
            ctx.beginPath();
            ctx.arc(sx, sy - s/8, s/4, 0, Math.PI * 2);
            ctx.fill();
            
            // Black dot eyes
            ctx.fillStyle = '#111';
            ctx.beginPath();
            ctx.arc(sx - 4, sy - 4, 2.5, 0, Math.PI * 2);
            ctx.arc(sx + 4, sy - 4, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
        else if (wClass === 2) { // Steampunk: Orange fire escaping from brass valves / venting steam
            ctx.shadowColor = '#ff6600';
            ctx.shadowBlur = 10;
            
            // Draw a tiny brass valve at the base
            ctx.fillStyle = '#804000';
            ctx.fillRect(sx - s/4, sy + s/4, s/2, 6);
            ctx.fillStyle = '#d46a00';
            ctx.fillRect(sx - 4, sy + s/4 + 6, 8, 8);
            
            // Flame blast out of the valve
            ctx.beginPath();
            ctx.moveTo(sx, sy + s/4);
            ctx.bezierCurveTo(sx - s/2 - flicker, sy, sx - s/3, sy - s * 0.8, sx, sy - s - flicker2);
            ctx.bezierCurveTo(sx + s/3, sy - s * 0.8, sx + s/2 + flicker, sy, sx, sy + s/4);
            ctx.closePath();
            
            const grad = ctx.createLinearGradient(sx, sy + s/4, sx, sy - s);
            grad.addColorStop(0, '#d46a00');
            grad.addColorStop(0.5, '#ff4400');
            grad.addColorStop(1, '#ffcc00');
            ctx.fillStyle = grad;
            ctx.fill();
            
            // Rivet detailing
            ctx.fillStyle = '#ffff66';
            ctx.beginPath();
            ctx.arc(sx - 3, sy + s/4 + 3, 1, 0, Math.PI * 2);
            ctx.arc(sx + 3, sy + s/4 + 3, 1, 0, Math.PI * 2);
            ctx.fill();
        }
        else { // Void: Dark purple shifting plasma vortex
            ctx.shadowColor = '#6c3483';
            ctx.shadowBlur = 12;
            
            // Shifting void flame
            ctx.beginPath();
            ctx.moveTo(sx, sy + s/2);
            ctx.bezierCurveTo(sx - s/2 + flicker, sy, sx - s/3 - flicker2, sy - s, sx, sy - s * 1.2 - Math.abs(flicker));
            ctx.bezierCurveTo(sx + s/3 + flicker2, sy - s, sx + s/2 - flicker, sy, sx, sy + s/2);
            ctx.closePath();
            
            const grad = ctx.createLinearGradient(sx, sy + s/2, sx, sy - s);
            grad.addColorStop(0, '#2e0854');
            grad.addColorStop(0.6, '#6c3483');
            grad.addColorStop(1, '#ff00ff');
            ctx.fillStyle = grad;
            ctx.fill();
            
            // Dark void center
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.ellipse(sx, sy - s/5 + flicker2 * 0.5, s/6, s/4, 0, 0, Math.PI * 2);
            ctx.fill();
            
            // Glowing white slit eyes
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(sx - 6, sy - s * 0.1);
            ctx.lineTo(sx - 1, sy - s * 0.1);
            ctx.moveTo(sx + 1, sy - s * 0.1);
            ctx.lineTo(sx + 6, sy - s * 0.1);
            ctx.stroke();
        }
        
        ctx.restore();
    }

    function renderKnight(ctx, sx, sy, s, color, e) {
        const wClass = (typeof Player !== 'undefined') ? Player.weaponClass : 0;
        const tHue = (typeof Player !== 'undefined') ? Player.themeHue : 190;
        const legAnim = Math.sin(e.animTimer * 2) * 4;
        const swordBob = Math.sin(e.animTimer * 2) * 5;
        const bodyW = s * 0.6;
        const bodyH = s * 0.7;
        
        ctx.save();
        
        if (wClass === 0) { // Cyber: Cybernetic block robot / grid gladiator
            ctx.shadowColor = `hsla(${tHue}, 100%, 55%, 0.8)`;
            ctx.shadowBlur = 10;
            
            // Cyber block torso
            ctx.fillStyle = `hsla(${tHue}, 100%, 25%, 0.85)`;
            ctx.strokeStyle = `hsla(${tHue}, 100%, 65%, 1)`;
            ctx.lineWidth = 2;
            ctx.fillRect(sx - bodyW/2, sy - bodyH/2, bodyW, bodyH);
            ctx.strokeRect(sx - bodyW/2, sy - bodyH/2, bodyW, bodyH);
            
            // Visor Scanner
            ctx.fillStyle = `hsla(${(tHue + 120) % 360}, 100%, 60%, 1)`;
            ctx.fillRect(sx - bodyW/2.5, sy - bodyH/4, bodyW * 0.8, 4);
            
            // Laser beam blade sword
            ctx.strokeStyle = `hsla(${(tHue + 120) % 360}, 100%, 50%, 1)`;
            ctx.shadowColor = `hsla(${(tHue + 120) % 360}, 100%, 50%, 1)`;
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(sx + bodyW/2 + 3, sy - 5 + swordBob);
            ctx.lineTo(sx + bodyW/2 + 25, sy - 18 + swordBob);
            ctx.stroke();
            
            // Legs
            ctx.strokeStyle = `hsla(${tHue}, 100%, 65%, 1)`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(sx - 6, sy + bodyH/2);
            ctx.lineTo(sx - 8 - legAnim, sy + bodyH/2 + 14);
            ctx.moveTo(sx + 6, sy + bodyH/2);
            ctx.lineTo(sx + 8 + legAnim, sy + bodyH/2 + 14);
            ctx.stroke();
        }
        else if (wClass === 1) { // Candy: Sweet donut knight with lollipop sword
            ctx.shadowColor = '#ff80bf';
            ctx.shadowBlur = 8;
            
            // Pink cupcake chassis body
            ctx.fillStyle = '#ffb3d9';
            ctx.beginPath();
            ctx.arc(sx, sy, bodyW/1.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ff3399';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Sprinkles on body
            ctx.fillStyle = '#00ffff';
            ctx.fillRect(sx - 5, sy - 8, 3, 2);
            ctx.fillStyle = '#ffff00';
            ctx.fillRect(sx + 4, sy - 4, 3, 2);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(sx - 2, sy + 4, 3, 2);
            
            // Lollipop stick sword
            ctx.strokeStyle = '#a6acaf';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(sx + bodyW/2 + 2, sy - 2 + swordBob);
            ctx.lineTo(sx + bodyW/2 + 16, sy - 14 + swordBob);
            ctx.stroke();
            // Lollipop tip circle
            ctx.beginPath();
            ctx.arc(sx + bodyW/2 + 20, sy - 18 + swordBob, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#ff3388';
            ctx.fill();
            
            // Eyes
            ctx.fillStyle = '#111';
            ctx.beginPath();
            ctx.arc(sx - 4, sy - 3, 2, 0, Math.PI * 2);
            ctx.arc(sx + 4, sy - 3, 2, 0, Math.PI * 2);
            ctx.fill();
            
            // Legs
            ctx.strokeStyle = '#ff3399';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(sx - 6, sy + bodyH/2);
            ctx.lineTo(sx - 8 - legAnim, sy + bodyH/2 + 12);
            ctx.moveTo(sx + 6, sy + bodyH/2);
            ctx.lineTo(sx + 8 + legAnim, sy + bodyH/2 + 12);
            ctx.stroke();
        }
        else if (wClass === 2) { // Steampunk: Boiler chassis with gears and copper plating
            ctx.shadowColor = '#d46a00';
            ctx.shadowBlur = 8;
            
            // Boiler tank chest
            ctx.fillStyle = '#7a3d00';
            ctx.strokeStyle = '#f5b041';
            ctx.lineWidth = 2;
            ctx.fillRect(sx - bodyW/2, sy - bodyH/2, bodyW, bodyH);
            ctx.strokeRect(sx - bodyW/2, sy - bodyH/2, bodyW, bodyH);
            
            // Copper pressure gauge center circle
            ctx.beginPath();
            ctx.arc(sx, sy, s/5, 0, Math.PI * 2);
            ctx.fillStyle = '#eaeded';
            ctx.fill();
            ctx.strokeStyle = '#d46a00';
            ctx.stroke();
            // Red needle
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + 4, sy - 4);
            ctx.stroke();
            
            // Buzzsaw blade sword
            ctx.strokeStyle = '#95a5a6';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(sx + bodyW/2 + 3, sy - 5 + swordBob);
            ctx.lineTo(sx + bodyW/2 + 18, sy - 14 + swordBob);
            ctx.stroke();
            // Gear/saw at tip
            ctx.save();
            ctx.translate(sx + bodyW/2 + 20, sy - 16 + swordBob);
            ctx.rotate(e.animTimer * 4);
            ctx.fillStyle = '#7f8c8d';
            ctx.beginPath();
            ctx.arc(0, 0, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#d46a00';
            ctx.lineWidth = 1;
            ctx.stroke();
            for (let i = 0; i < 4; i++) {
                ctx.rotate(Math.PI / 2);
                ctx.fillRect(-1.5, -9, 3, 2);
            }
            ctx.restore();
            
            // Legs
            ctx.strokeStyle = '#d46a00';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(sx - 6, sy + bodyH/2);
            ctx.lineTo(sx - 8 - legAnim, sy + bodyH/2 + 14);
            ctx.moveTo(sx + 6, sy + bodyH/2);
            ctx.lineTo(sx + 8 + legAnim, sy + bodyH/2 + 14);
            ctx.stroke();
        }
        else { // Void: Dark shadow armored specter with blackhole core
            ctx.shadowColor = '#6c3483';
            ctx.shadowBlur = 12;
            
            // Hollow purple outline armor body
            ctx.fillStyle = '#0f021c';
            ctx.strokeStyle = '#9b59b6';
            ctx.lineWidth = 2;
            ctx.fillRect(sx - bodyW/2, sy - bodyH/2, bodyW, bodyH);
            ctx.strokeRect(sx - bodyW/2, sy - bodyH/2, bodyW, bodyH);
            
            // Inside black hole
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(sx, sy, s/6, 0, Math.PI * 2);
            ctx.fill();
            
            // Glowing purple eyes
            ctx.fillStyle = '#ff00ff';
            ctx.beginPath();
            ctx.arc(sx - 4, sy - bodyH/4, 2, 0, Math.PI * 2);
            ctx.arc(sx + 4, sy - bodyH/4, 2, 0, Math.PI * 2);
            ctx.fill();
            
            // Dark energy scythe blade sword
            ctx.strokeStyle = '#8e44ad';
            ctx.shadowColor = '#ff00ff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(sx + bodyW/2 + 3, sy - 5 + swordBob);
            ctx.lineTo(sx + bodyW/2 + 25, sy - 20 + swordBob);
            ctx.stroke();
            
            // Scythe curve tip
            ctx.beginPath();
            ctx.moveTo(sx + bodyW/2 + 25, sy - 20 + swordBob);
            ctx.quadraticCurveTo(sx + bodyW/2 + 32, sy - 30 + swordBob, sx + bodyW/2 + 20, sy - 35 + swordBob);
            ctx.strokeStyle = '#ff00ff';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Legs
            ctx.strokeStyle = '#8e44ad';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(sx - 6, sy + bodyH/2);
            ctx.lineTo(sx - 8 - legAnim, sy + bodyH/2 + 14);
            ctx.moveTo(sx + 6, sy + bodyH/2);
            ctx.lineTo(sx + 8 + legAnim, sy + bodyH/2 + 14);
            ctx.stroke();
        }
        
        ctx.restore();
    }

    function renderShip(ctx, sx, sy, s, color, e) {
        const wClass = (typeof Player !== 'undefined') ? Player.weaponClass : 0;
        const tHue = (typeof Player !== 'undefined') ? Player.themeHue : 190;
        const lightAngle = e.animTimer * 3;
        
        ctx.save();
        
        if (wClass === 0) { // Cyber: Neon recognizer grid / vector spacecraft
            ctx.shadowColor = `hsla(${tHue}, 100%, 55%, 0.8)`;
            ctx.shadowBlur = 10;
            
            // Draw a diamond vector outline
            ctx.fillStyle = `hsla(${tHue}, 100%, 15%, 0.8)`;
            ctx.strokeStyle = `hsla(${tHue}, 100%, 65%, 1)`;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(sx, sy - s/2);
            ctx.lineTo(sx + s * 0.8, sy);
            ctx.lineTo(sx, sy + s/3);
            ctx.lineTo(sx - s * 0.8, sy);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // Cyber laser scan beam underneath
            ctx.fillStyle = `hsla(${(tHue + 120) % 360}, 100%, 50%, ${0.15 + Math.sin(e.animTimer * 4) * 0.08})`;
            ctx.beginPath();
            ctx.moveTo(sx - 10, sy + s/3);
            ctx.lineTo(sx + 10, sy + s/3);
            ctx.lineTo(sx + 25, sy + s/3 + 30);
            ctx.lineTo(sx - 25, sy + s/3 + 30);
            ctx.closePath();
            ctx.fill();
        }
        else if (wClass === 1) { // Candy: Flying donut spaceship with spinning sprinkle lights
            ctx.shadowColor = '#ff99cc';
            ctx.shadowBlur = 8;
            
            // Donut shape body
            ctx.beginPath();
            ctx.arc(sx, sy, s * 0.6, 0, Math.PI * 2);
            ctx.fillStyle = '#ff80df';
            ctx.fill();
            ctx.strokeStyle = '#ff3399';
            ctx.lineWidth = 3;
            ctx.stroke();
            
            // Hole in center
            ctx.beginPath();
            ctx.arc(sx, sy, s * 0.2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0)';
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            
            // Re-draw outer border on center hole
            ctx.beginPath();
            ctx.arc(sx, sy, s * 0.2, 0, Math.PI * 2);
            ctx.strokeStyle = '#ff3399';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
            // Colorful candy sprinkles
            for (let i = 0; i < 4; i++) {
                const angle = lightAngle + (i * Math.PI / 2);
                const lx = sx + Math.cos(angle) * s * 0.4;
                const ly = sy + Math.sin(angle) * s * 0.4;
                ctx.beginPath();
                ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
                ctx.fillStyle = i % 2 === 0 ? '#00ffff' : '#ffff00';
                ctx.fill();
            }
        }
        else if (wClass === 2) { // Steampunk: Hot-air steam engine airship with rotating propellers
            ctx.shadowColor = '#d46a00';
            ctx.shadowBlur = 8;
            
            // Oval brass boiler body
            ctx.beginPath();
            ctx.ellipse(sx, sy, s * 0.7, s * 0.4, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#8a4f10';
            ctx.fill();
            ctx.strokeStyle = '#f4d03f';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Brass rivets
            ctx.fillStyle = '#ffffcc';
            for (let i = -3; i <= 3; i++) {
                ctx.beginPath();
                ctx.arc(sx + i * (s * 0.18), sy + s * 0.2, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
            
            // Propeller spinning at back
            ctx.save();
            ctx.translate(sx - s * 0.7 - 4, sy);
            ctx.rotate(e.animTimer * 8);
            ctx.fillStyle = '#a6acaf';
            ctx.fillRect(-2, -15, 4, 30);
            ctx.fillRect(-15, -2, 30, 4);
            ctx.fillStyle = '#d46a00';
            ctx.beginPath();
            ctx.arc(0, 0, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        else { // Void: Dark cosmic portal rift / amorphous blackhole ship
            ctx.shadowColor = '#6c3483';
            ctx.shadowBlur = 12;
            
            // Swirling outer nebula
            ctx.fillStyle = 'rgba(108, 52, 131, 0.4)';
            ctx.beginPath();
            ctx.ellipse(sx, sy, s * 0.8, s * 0.5, e.animTimer * 0.2, 0, Math.PI * 2);
            ctx.fill();
            
            // Shifting void core
            ctx.fillStyle = '#0a0114';
            ctx.strokeStyle = '#ff00ff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.ellipse(sx, sy, s * 0.5 + Math.sin(e.animTimer * 4) * 4, s * 0.3 - Math.sin(e.animTimer * 4) * 4, e.animTimer * 0.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            // Black hole center
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.ellipse(sx, sy, s * 0.25, s * 0.15, e.animTimer * 0.8, 0, Math.PI * 2);
            ctx.fill();
            
            // Dark energy rays shooting out
            ctx.strokeStyle = '#a569bd';
            ctx.lineWidth = 1.5;
            for (let i = 0; i < 4; i++) {
                const angle = lightAngle * 0.5 + (i * Math.PI / 2);
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(sx + Math.cos(angle) * s * 0.75, sy + Math.sin(angle) * s * 0.45);
                ctx.stroke();
            }
        }
        
        ctx.restore();
    }

    function spawnHitParticles(x, y, color) {
        for (let i = 0; i < 8; i++) {
            hitParticles.push({
                x: x,
                y: y,
                vx: (Math.random() - 0.5) * 300,
                vy: -100 - Math.random() * 200,
                size: 2 + Math.random() * 3,
                color: color,
                life: 0.3 + Math.random() * 0.3,
                maxLife: 0.6
            });
        }
    }

    function checkCollisions(attackBox, hitBox, playerX) {
        let enemiesHit = [];
        let playerHit = false;
        let totalDamage = 0;

        for (let e of enemies) {
            const eBox = {
                x: e.x - e.size / 2,
                y: e.y - e.size / 2,
                width: e.size,
                height: e.size
            };

            // Player attacking enemies
            if (attackBox && rectsOverlap(attackBox, eBox)) {
                if (e.hitFlash <= 0) {
                    if (e.shape === 'knight') {
                        if (Math.random() < 0.45) {
                            e.hitFlash = 0.15;
                            spawnHitParticles(e.x, e.y - 10, '#ffffff');
                            damageNumbers.push({ x: e.x, y: e.y - e.size - 10, value: 'BLOCKED', color: '#66bbff', life: 0.8, maxLife: 0.8 });
                            if (typeof Sound !== 'undefined') Sound.playPickup('shield');
                            continue;
                        }
                    }

                    const combo = (typeof Player !== 'undefined') ? Player.comboCount : 1;
                    const dmg = combo > 0 ? [20, 25, 40][combo - 1] : 20;

                    e.currentHealth -= dmg;
                    e.hitFlash = 0.2;
                    spawnHitParticles(e.x, e.y, e.color);
                    
                    damageNumbers.push({ x: e.x, y: e.y - e.size / 2, value: `-${dmg}`, color: '#ffea00', life: 0.8, maxLife: 0.8 });

                    if (e.currentHealth <= 0) {
                        enemiesHit.push({ score: e.score, name: e.name });
                        spawnHitParticles(e.x, e.y, e.color);
                        spawnHitParticles(e.x, e.y, '#ffffff');
                    }
                }
            }

            // Enemies hitting player
            if (e.damageCooldown <= 0 && rectsOverlap(eBox, hitBox)) {
                playerHit = true;
                totalDamage += e.damage;
                e.damageCooldown = 1.0;

                damageNumbers.push({ x: playerX, y: hitBox.y - 15, value: `-${e.damage}`, color: '#ff3333', life: 0.8, maxLife: 0.8 });
            }
        }

        // Check Projectile collision on Player
        for (let p of projectiles) {
            const pBox = { x: p.x - p.radius, y: p.y - p.radius, width: p.radius * 2, height: p.radius * 2 };
            if (rectsOverlap(pBox, hitBox)) {
                playerHit = true;
                totalDamage += p.damage;
                // Instant hit / destroy
                p.x = -9999; 
                spawnHitParticles(p.x, p.y, p.color);
                
                damageNumbers.push({ x: playerX, y: hitBox.y - 15, value: `-${p.damage}`, color: '#ff3333', life: 0.8, maxLife: 0.8 });
            }
        }
        // Filter out hit projectiles
        projectiles = projectiles.filter(p => p.x !== -9999);

        return { enemiesHit, playerHit, totalDamage };
    }

    function rectsOverlap(a, b) {
        return a.x < b.x + b.width &&
               a.x + a.width > b.x &&
               a.y < b.y + b.height &&
               a.y + a.height > b.y;
    }

    function reset() {
        enemies = [];
        spawnTimer = 0;
        hitParticles = [];
        projectiles = [];
        damageNumbers = [];
        bossSpawned = { cave: false, space: false };
    }

    return {
        update,
        render,
        checkCollisions,
        reset,
        TYPES,
        get count() { return enemies.length; }
    };
})();
