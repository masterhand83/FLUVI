/**
 * PixiApp.js - Aplicación principal de PixiJS
 * Singleton que gestiona la inicialización y ciclo de vida del motor gráfico
 */

class PixiApp {
    static instance = null;

    static getInstance(canvasId = 'simuladorCanvas') {
        if (!PixiApp.instance) {
            PixiApp.instance = new PixiApp(canvasId);
        }
        return PixiApp.instance;
    }

    constructor(canvasId) {
        if (PixiApp.instance) {
            return PixiApp.instance;
        }

        // Obtener dimensiones del canvas actual
        const oldCanvas = document.getElementById(canvasId);
        if (!oldCanvas) {
            console.error(`❌ Canvas con id "${canvasId}" no encontrado`);
            return;
        }

        const parent = oldCanvas.parentElement;
        const width = oldCanvas.width;
        const height = oldCanvas.height;

        // 📱 OPTIMIZACIÓN MÓVIL: Detectar dispositivo
        const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isSmallScreen = window.innerWidth <= 768;
        const isMobile = isMobileDevice || isSmallScreen;

        // Configuración adaptativa según dispositivo
        const mobileConfig = {
            resolution: 1, // Resolución fija en móviles (no usar devicePixelRatio)
            antialias: false, // Sin antialiasing en móviles
            powerPreference: 'low-power', // Priorizar batería
            maxFPS: 30 // 30 FPS en móviles (suficiente para la simulación)
        };

        const desktopConfig = {
            resolution: Math.min(window.devicePixelRatio || 1, 2), // Máximo 2x
            antialias: true,
            powerPreference: 'high-performance',
            maxFPS: 60
        };

        const config = isMobile ? mobileConfig : desktopConfig;

        console.log(`🔧 Configuración: ${isMobile ? '📱 MÓVIL' : '🖥️ DESKTOP'} (FPS: ${config.maxFPS}, Resolution: ${config.resolution}x, Antialias: ${config.antialias})`);

        // Crear aplicación PixiJS con fallback a Canvas 2D si WebGL no está disponible
        try {
            this.app = new PIXI.Application({
                width: width,
                height: height,
                backgroundColor: 0xc6cbcd, // Color actual del fondo
                resolution: config.resolution,
                autoDensity: true,
                antialias: config.antialias,
                powerPreference: config.powerPreference,
                forceCanvas: false, // Intentar WebGL primero

                // OPTIMIZACIÓN: Configurar renderer para mejor rendimiento
                backgroundAlpha: 1,
                clearBeforeRender: true,
                preserveDrawingBuffer: false,

                // OPTIMIZACIÓN: FPS target
                sharedTicker: true,
                sharedLoader: true
            });

            // OPTIMIZACIÓN: Configurar target FPS según dispositivo
            this.app.ticker.maxFPS = config.maxFPS;

            console.log(`✅ WebGL disponible (target: ${config.maxFPS} FPS)`);
        } catch (webglError) {
            console.warn('⚠️ WebGL no disponible, usando Canvas 2D renderer como fallback...');
            console.warn('   Razón:', webglError.message);
            this.app = new PIXI.Application({
                width: width,
                height: height,
                backgroundColor: 0xc6cbcd,
                resolution: config.resolution,
                autoDensity: true,
                antialias: false, // Siempre desactivado en Canvas 2D
                powerPreference: config.powerPreference,
                forceCanvas: true, // Forzar Canvas 2D
                backgroundAlpha: 1,
                clearBeforeRender: true,
                preserveDrawingBuffer: false
            });
            this.app.ticker.maxFPS = config.maxFPS;
            console.log(`✅ Canvas 2D renderer activado (target: ${config.maxFPS} FPS)`);
        }

        // Guardar información del dispositivo
        this.isMobile = isMobile;

        // Reemplazar canvas viejo con el de PixiJS
        oldCanvas.remove();
        this.app.view.id = canvasId;
        this.app.view.style.display = 'block';
        parent.appendChild(this.app.view);

        // Inicializar subsistemas (se inicializarán después)
        this.assetLoader = null;
        this.sceneManager = null;
        this.cameraController = null;
        this.minimapRenderer = null;

        // Exponer globalmente para compatibilidad
        window.pixiApp = this;

        console.log('🎨 PixiApp creado');
    }

    async init() {
        console.log('🔧 Inicializando PixiApp...');

        try {
            // Cargar assets
            this.assetLoader = new AssetLoader();
            await this.assetLoader.loadAssets();

            // Crear gestores
            this.sceneManager = new SceneManager(this.app, this.assetLoader);
            this.cameraController = new CameraController(this.app, this.sceneManager);

            // Inicializar renderers
            this.sceneManager.initRenderers();

            // Inicializar minimapa (opcional, no crítico)
            if (typeof MinimapRenderer !== 'undefined') {
                try {
                    this.minimapRenderer = new MinimapRenderer();
                    console.log('✅ Minimapa inicializado');
                } catch (minimapError) {
                    console.warn('⚠️ No se pudo inicializar el minimapa:', minimapError.message);
                    console.warn('   Continuando sin minimapa...');
                    this.minimapRenderer = null;
                }
            }

            // Setup events
            this.setupResize();
            this.setupTicker();

            console.log('✅ PixiApp inicializado correctamente');
            return true;
        } catch (error) {
            console.error('❌ Error inicializando PixiApp:', error);
            return false;
        }
    }

    setupTicker() {
        // OPTIMIZACIÓN: Limitar FPS del minimapa (no necesita 60 FPS)
        let minimapaFrameCounter = 0;
        const minimapaUpdateInterval = 3; // Actualizar minimapa cada 3 frames (~20 FPS)

        this.app.ticker.add((delta) => {
            // PixiJS renderiza automáticamente el stage
            // Solo actualizar lógica si es necesario
            if (!window.isPaused && this.sceneManager) {
                this.sceneManager.update(delta);
            }

            // La edición pausa el tráfico, pero los links visibles deben seguir
            // los extremos de las calles durante el arrastre.
            if (window.mostrarConexiones && this.sceneManager?.conexionRenderer) {
                this.sceneManager.conexionRenderer.renderAll(window.conexiones);
            }

            // OPTIMIZACIÓN: Actualizar minimapa a menor frecuencia (20 FPS en vez de 60 FPS)
            minimapaFrameCounter++;
            if (minimapaFrameCounter >= minimapaUpdateInterval) {
                minimapaFrameCounter = 0;
                if (typeof window.dibujarMinimapa === 'function') {
                    window.dibujarMinimapa();
                }
            }
        });
    }

    setupResize() {
        // ⚡ OPTIMIZACIÓN: Debouncing de resize events (reduce llamadas de ~100/seg a ~5/seg)
        let resizeTimeout;
        const resizeHandler = () => {
            const sidebar = document.querySelector('.sidebar');
            const header = document.querySelector('header');

            // Verificar si el sidebar está visible (no tiene clase 'hidden')
            const sidebarVisible = sidebar && !sidebar.classList.contains('hidden');
            const sidebarWidth = window.innerWidth > 768 && sidebarVisible ? (sidebar.offsetWidth || 380) : 0;
            const headerHeight = header ? header.offsetHeight : 0;

            this.app.renderer.resize(
                window.innerWidth - sidebarWidth,
                window.innerHeight - headerHeight
            );

            console.log(`📐 Resize: ${window.innerWidth - sidebarWidth}x${window.innerHeight - headerHeight} (sidebar: ${sidebarVisible ? 'visible' : 'hidden'})`);
        };

        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(resizeHandler, 200); // 200ms debounce
        });

        console.log('⚡ Resize debouncing activado (200ms)');
    }

    // API pública para compatibilidad
    render() {
        // PixiJS renderiza automáticamente, pero mantener compatibilidad
        if (this.sceneManager) {
            this.sceneManager.renderAll();
        }
    }

    destroy() {
        if (this.app) {
            this.app.destroy(true, { children: true, texture: true, baseTexture: true });
        }
        PixiApp.instance = null;
        console.log('🗑️ PixiApp destruido');
    }
}

// Exponer globalmente
window.PixiApp = PixiApp;
console.log('✓ PixiApp cargado');
