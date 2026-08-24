/**
 * RainEffect.js - Sistema de efecto de lluvia eficiente para PixiJS
 *
 * Sistema optimizado de partículas de lluvia que no afecta el rendimiento
 */

console.log('🌧️ RainEffect.js cargando...');

class RainEffect {
    constructor(app) {
        this.app = app;
        this.container = null;
        this.particles = [];
        this.isActive = false;

        // 📱 OPTIMIZACIÓN MÓVIL: Detectar dispositivo y ajustar parámetros
        this.isMobile = window.pixiApp && window.pixiApp.isMobile;
        this.isEnabled = !this.isMobile; // Desactivado por defecto en móviles

        // Ajustar cantidad de partículas según dispositivo
        this.maxParticles = this.isMobile ? 30 : 150; // 80% menos en móviles
        this.particlePool = []; // Pool de partículas reutilizables

        // Sistema de relámpagos (desactivado en móviles)
        this.lightningOverlay = null;
        this.lightningTimer = 0;
        this.lightningInterval = 300 + Math.random() * 400; // 5-13 segundos entre relámpagos
        this.isLightningFlashing = false;
        this.lightningFlashDuration = 0;
        this.lightningEnabled = !this.isMobile; // Sin relámpagos en móviles

        console.log(`🌧️ RainEffect inicializado (${this.isMobile ? '📱 MÓVIL - desactivado por defecto' : '🖥️ DESKTOP'})`);
    }

    /**
     * Inicializa el contenedor de lluvia
     */
    initialize() {
        if (this.container) return; // Ya inicializado

        // Crear contenedor para las gotas de lluvia
        this.container = new PIXI.Container();
        this.container.name = 'rainEffect';
        this.container.zIndex = 35; // Entre UI (30) y Debug (40)

        // Crear overlay de relámpagos (muy sutil)
        this.lightningOverlay = new PIXI.Graphics();
        this.lightningOverlay.zIndex = 36; // Encima de la lluvia
        this.lightningOverlay.alpha = 0; // Invisible por defecto
        this.lightningOverlay.eventMode = 'none'; // 🔧 FIX: No capturar eventos de click
        this.lightningOverlay.interactiveChildren = false; // 🔧 FIX: Deshabilitar interactividad

        // Agregar al stage
        this.app.stage.addChild(this.container);
        this.app.stage.addChild(this.lightningOverlay);

        console.log('🌧️ Contenedor de lluvia y relámpagos creado');
    }

    /**
     * Crea una partícula de lluvia eficiente
     */
    createRainParticle() {
        // Reutilizar partícula del pool si existe
        if (this.particlePool.length > 0) {
            return this.particlePool.pop();
        }

        // Crear nueva partícula usando Graphics (más eficiente que Sprite)
        const particle = new PIXI.Graphics();

        // Dibujar una línea gruesa para la gota de lluvia (azul fuerte para visibilidad de día)
        particle.lineStyle(2, 0x0066FF, 0.8); // Azul fuerte (#0066FF) con buena opacidad
        particle.moveTo(0, 0);
        particle.lineTo(0, 10); // Línea de 10 pixels (un poco más larga)

        return particle;
    }

    /**
     * Resetea una partícula a una nueva posición
     */
    resetParticle(particle) {
        const screenWidth = this.app.screen.width;
        const screenHeight = this.app.screen.height;

        particle.x = Math.random() * screenWidth;
        particle.y = Math.random() * -100; // Empezar arriba de la pantalla
        particle.speedY = 10 + Math.random() * 5; // Velocidad más rápida (10-15)
        particle.speedX = -1 + Math.random() * 2; // Ligera desviación horizontal
        particle.alpha = 0.6 + Math.random() * 0.3; // Mayor opacidad para mejor visibilidad
    }

    /**
     * Dispara un relámpago sutil
     */
    triggerLightning() {
        // 📱 OPTIMIZACIÓN MÓVIL: Sin relámpagos en móviles
        if (!this.lightningEnabled || !this.lightningOverlay || this.isLightningFlashing) return;

        this.isLightningFlashing = true;
        this.lightningFlashDuration = 0;

        // Dibujar overlay blanco muy sutil que cubre toda la pantalla
        this.lightningOverlay.clear();
        this.lightningOverlay.beginFill(0xFFFFFF, 1); // Blanco puro
        this.lightningOverlay.drawRect(0, 0, this.app.screen.width, this.app.screen.height);
        this.lightningOverlay.endFill();
    }

    /**
     * Activa el efecto de lluvia
     */
    start() {
        if (this.isActive) return;

        // 📱 OPTIMIZACIÓN MÓVIL: Verificar si está habilitado
        if (!this.isEnabled) {
            console.log('🌧️ Lluvia desactivada en móviles por defecto (puedes activarla manualmente si quieres)');
            return;
        }

        this.initialize();
        this.isActive = true;

        // Crear partículas iniciales
        for (let i = 0; i < this.maxParticles; i++) {
            const particle = this.createRainParticle();
            this.resetParticle(particle);

            // Distribuir verticalmente para inicio suave
            particle.y = Math.random() * this.app.screen.height;

            this.particles.push(particle);
            this.container.addChild(particle);
        }

        // Iniciar animación
        this.app.ticker.add(this.update, this);

        console.log('🌧️ Lluvia activada');
    }

    /**
     * Desactiva el efecto de lluvia
     */
    stop() {
        if (!this.isActive) return;

        this.isActive = false;

        // Detener animación
        this.app.ticker.remove(this.update, this);

        // Devolver partículas al pool
        this.particles.forEach(particle => {
            this.container.removeChild(particle);
            this.particlePool.push(particle);
        });

        this.particles = [];

        console.log('🌧️ Lluvia desactivada');
    }

    /**
     * Actualiza las partículas cada frame (método super eficiente)
     */
    update(delta) {
        if (!this.isActive) return;

        const screenHeight = this.app.screen.height;

        // Actualizar cada partícula
        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];

            // Mover partícula
            particle.y += particle.speedY * delta;
            particle.x += particle.speedX * delta;

            // Si sale de la pantalla, resetear
            if (particle.y > screenHeight + 10) {
                this.resetParticle(particle);
            }
        }

        // Sistema de relámpagos
        if (this.isLightningFlashing) {
            // Flash muy rápido (fade out exponencial)
            this.lightningFlashDuration += delta;

            if (this.lightningFlashDuration < 3) {
                // Flash inicial muy brillante pero corto (0.05 segundos)
                this.lightningOverlay.alpha = 0.15 * (1 - this.lightningFlashDuration / 3);
            } else if (this.lightningFlashDuration < 8) {
                // Segundo flash más tenue (parpadeo)
                this.lightningOverlay.alpha = 0.08 * (1 - (this.lightningFlashDuration - 3) / 5);
            } else {
                // Terminar flash
                this.lightningOverlay.alpha = 0;
                this.lightningOverlay.clear(); // 🔧 FIX: Limpiar el gráfico para que no bloquee clicks
                this.isLightningFlashing = false;
                // Resetear timer para próximo relámpago
                this.lightningInterval = 300 + Math.random() * 400; // 5-13 segundos
                this.lightningTimer = 0;
            }
        } else {
            // Contar tiempo hasta próximo relámpago
            this.lightningTimer += delta;
            if (this.lightningTimer >= this.lightningInterval) {
                this.triggerLightning();
            }
        }
    }

    /**
     * Limpia completamente el efecto
     */
    destroy() {
        this.stop();

        if (this.container) {
            // Destruir todas las partículas
            this.particlePool.forEach(p => p.destroy());
            this.particles.forEach(p => p.destroy());

            this.container.destroy({ children: true });
            this.container = null;
        }

        if (this.lightningOverlay) {
            this.lightningOverlay.destroy();
            this.lightningOverlay = null;
        }

        this.particlePool = [];
        this.particles = [];

        console.log('🌧️ RainEffect destruido');
    }
}

// Exponer globalmente
window.RainEffect = RainEffect;

console.log('✅ RainEffect.js cargado');
