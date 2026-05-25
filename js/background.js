/* ============================================
   background.js — 3-Layer Background System
   ============================================ */
const Background = (() => {
    // Zone definitions
    const ZONES = {
        forest: {
            name: 'Enchanted Forest',
            colors: ['#0a3d0a', '#1a5c1a', '#0d4d2b'],
            particleColor: '#4aff4a',
            prompt: 'A mystical enchanted forest at twilight with glowing mushrooms, fireflies, ancient trees with luminous vines, fantasy game art, panoramic wide landscape, vibrant colors'
        },
        cave: {
            name: 'Crystal Cave',
            colors: ['#1a0a3d', '#2d1b69', '#0f0b30'],
            particleColor: '#b388ff',
            prompt: 'A vast crystal cave with bioluminescent crystals, underground lake reflections, purple and blue glowing formations, fantasy game art, panoramic wide landscape'
        },
        volcano: {
            name: 'Volcano Depths',
            colors: ['#3d0a0a', '#691b1b', '#4d1500'],
            particleColor: '#ff6644',
            prompt: 'An erupting volcano landscape with rivers of flowing lava, dark red sky, obsidian rocks, fire embers floating, dramatic fantasy game art, panoramic wide landscape'
        },
        sky: {
            name: 'Sky Castle',
            colors: ['#0a1a3d', '#1b3d69', '#0a2d5c'],
            particleColor: '#66bbff',
            prompt: 'A floating castle in the sky above clouds at golden hour, majestic towers, birds flying, rainbow light rays, fantasy game art, panoramic wide landscape'
        },
        space: {
            name: 'Deep Space',
            colors: ['#0a0a1a', '#1a0a2d', '#050510'],
            particleColor: '#ff44ff',
            prompt: 'A colorful deep space nebula with distant galaxies, alien planet surfaces, cosmic dust clouds, neon colors, sci-fi game art, panoramic wide landscape'
        }
    };

    const ZONE_ORDER = ['forest', 'cave', 'volcano', 'sky', 'space'];

    let currentZone = 'forest';
    let previousZone = 'forest';
    let currentImage = null;
    let nextImage = null;
    let gradientAlpha = 0;
    let gradientTransitioning = false;
    let imageAlpha = 0;
    let imageTransitioning = false;
    let particles = [];
    let gradientOffset = 0;
    let canvasRef = null;
    let loadingZones = new Set();

    // ---- Particles ----
    function createParticles(zone) {
        const color = ZONES[zone].particleColor;
        const arr = [];
        for (let i = 0; i < 60; i++) {
            arr.push({
                x: Math.random() * 1280,
                y: Math.random() * 720,
                size: 1 + Math.random() * 3,
                speedX: (Math.random() - 0.5) * 15,
                speedY: -(10 + Math.random() * 25),
                opacity: 0.15 + Math.random() * 0.5,
                color: color,
                phase: Math.random() * Math.PI * 2
            });
        }
        return arr;
    }

    function init(canvas) {
        canvasRef = canvas;
        particles = createParticles(currentZone);
    }

    function setZone(zoneName, theme = "") {
        if (zoneName === currentZone || !ZONES[zoneName]) return;
        previousZone = currentZone;
        currentZone = zoneName;
        
        // Start gradient transition immediately!
        gradientTransitioning = true;
        gradientAlpha = 0;
        
        particles = createParticles(zoneName);

        // Try to load AI background
        const cacheKey = theme ? `${zoneName}_${theme}` : zoneName;
        const cached = API.imageCache[cacheKey];
        if (cached) {
            const actualUrl = typeof cached === 'object' ? cached.url : cached;
            loadImage(actualUrl, true);
        } else {
            prefetchZone(zoneName, theme);
        }
    }

    function loadImage(url, isNext) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            if (isNext) {
                nextImage = img;
                // Start image transition now that it's ready!
                imageTransitioning = true;
                imageAlpha = 0;
            } else {
                currentImage = img;
                imageTransitioning = false;
                imageAlpha = 1;
            }
        };
        img.onerror = () => {
            console.warn('[Background] Failed to load image:', url);
        };
        img.src = url;
    }

    function prefetchZone(zoneName, theme = "") {
        if (!ZONES[zoneName] || loadingZones.has(zoneName)) return;
        
        const cacheKey = theme ? `${zoneName}_${theme}` : zoneName;
        if (API.imageCache[cacheKey]) return;

        // Show the performance rating popup in game.js!
        if (typeof Game !== 'undefined' && Game.showPerformancePopup) {
            Game.showPerformancePopup();
        }

        loadingZones.add(zoneName);

        // Construct unique prompt combining the zone and the custom theme
        const randomSeed = Math.floor(Math.random() * 1000000);
        let finalPrompt = ZONES[zoneName].prompt;
        if (theme) {
            finalPrompt = `${theme} style, ${finalPrompt}, unique seed #${randomSeed}`;
        } else {
            finalPrompt = `${finalPrompt}, unique seed #${randomSeed}`;
        }

        API.generateBackground(zoneName, finalPrompt, theme).then(resObj => {
            loadingZones.delete(zoneName);
            if (resObj) {
                const actualUrl = typeof resObj === 'object' ? resObj.url : resObj;
                loadImage(actualUrl, zoneName === currentZone);
            }
            // Hide the performance rating popup in game.js when done
            if (typeof Game !== 'undefined' && Game.hidePerformancePopup) {
                Game.hidePerformancePopup();
            }
        }).catch(err => {
            loadingZones.delete(zoneName);
            if (typeof Game !== 'undefined' && Game.hidePerformancePopup) {
                Game.hidePerformancePopup();
            }
        });
    }

    function update(dt) {
        // Gradient animation
        gradientOffset += dt * 12;
        if (gradientOffset > 1280) gradientOffset -= 1280;

        // Gradient crossfade
        if (gradientTransitioning) {
            gradientAlpha += dt * 0.5; // 2 seconds total
            if (gradientAlpha >= 1) {
                gradientAlpha = 1;
                gradientTransitioning = false;
            }
        }

        // Image crossfade
        if (imageTransitioning) {
            imageAlpha += dt * 0.5; // 2 seconds total
            if (imageAlpha >= 1) {
                imageAlpha = 1;
                imageTransitioning = false;
                if (nextImage) {
                    currentImage = nextImage;
                    nextImage = null;
                }
            }
        }

        // Update particles
        for (let p of particles) {
            p.x += p.speedX * dt;
            p.y += p.speedY * dt;
            p.phase += dt * 2;
            p.opacity = 0.15 + Math.sin(p.phase) * 0.25;

            // Wrap
            if (p.y < -10) {
                p.y = 730;
                p.x = Math.random() * 1280;
            }
            if (p.x < -10) p.x = 1290;
            if (p.x > 1290) p.x = -10;
        }
    }

    function render(ctx, canvas) {
        // ===== LAYER 1: Animated Gradient Background =====
        renderGradient(ctx, canvas);

        // ===== LAYER 2: AI-Generated Image (if loaded) with crossfade =====
        renderImage(ctx, canvas);

        // ===== LAYER 3: Parallax Floating Particles =====
        renderParticles(ctx);
    }

    function renderGradient(ctx, canvas) {
        const zone = ZONES[currentZone];
        const prevZone = ZONES[previousZone];
        const w = canvas.width;
        const h = canvas.height;

        // Current zone gradient
        const grad = ctx.createLinearGradient(
            gradientOffset, 0,
            w + gradientOffset * 0.3, h
        );
        const colors = zone.colors;
        grad.addColorStop(0, colors[0]);
        grad.addColorStop(0.5, colors[1]);
        grad.addColorStop(1, colors[2]);

        if (gradientTransitioning && gradientAlpha < 1) {
            // Draw previous zone gradient first
            const prevGrad = ctx.createLinearGradient(
                gradientOffset, 0,
                w + gradientOffset * 0.3, h
            );
            const pc = prevZone.colors;
            prevGrad.addColorStop(0, pc[0]);
            prevGrad.addColorStop(0.5, pc[1]);
            prevGrad.addColorStop(1, pc[2]);

            ctx.fillStyle = prevGrad;
            ctx.fillRect(0, 0, w, h);

            ctx.globalAlpha = gradientAlpha;
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
            ctx.globalAlpha = 1;
        } else {
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
        }
    }

    function renderImage(ctx, canvas) {
        const w = canvas.width;
        const h = canvas.height;

        if (currentImage && !nextImage) {
            ctx.globalAlpha = 0.6;
            ctx.drawImage(currentImage, 0, 0, w, h);
            ctx.globalAlpha = 1;
        }

        if (nextImage && imageTransitioning) {
            // Crossfade from currentImage to nextImage
            if (currentImage) {
                ctx.globalAlpha = 0.6 * (1 - imageAlpha);
                ctx.drawImage(currentImage, 0, 0, w, h);
            }
            ctx.globalAlpha = 0.6 * imageAlpha;
            ctx.drawImage(nextImage, 0, 0, w, h);
            ctx.globalAlpha = 1;
        }
    }

    function renderParticles(ctx) {
        for (let p of particles) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, p.opacity);
            ctx.fill();

            // Glow
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 2.5, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, p.opacity * 0.15);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function getZoneForX(x) {
        if (x < 2000) return 'forest';
        if (x < 4000) return 'cave';
        if (x < 6000) return 'volcano';
        if (x < 8000) return 'sky';
        return 'space';
    }

    return {
        init,
        setZone,
        update,
        render,
        getZoneForX,
        prefetchZone,
        ZONES,
        get currentZone() { return currentZone; }
    };
})();
