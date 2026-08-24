/**
 * MinimapRenderer.js - Renderizador del minimapa
 * Crea un minimapa con PixiJS en un contenedor separado
 */

class MinimapRenderer {
    constructor() {
        this.minimapaCanvas = document.getElementById('minimapa');
        if (!this.minimapaCanvas) {
            console.warn('⚠️ Canvas de minimapa no encontrado');
            return;
        }

        // Crear aplicación PixiJS para el minimapa con fallback a Canvas 2D
        try {
            this.app = new PIXI.Application({
                view: this.minimapaCanvas,
                width: this.minimapaCanvas.width,
                height: this.minimapaCanvas.height,
                backgroundColor: 0x767878,
                resolution: window.devicePixelRatio || 1,
                autoDensity: true,
                antialias: false, // Desactivar antialiasing para el minimapa (más rápido)
                forceCanvas: false
            });
        } catch (webglError) {
            console.warn('⚠️ WebGL no disponible para minimapa, usando Canvas 2D...');
            this.app = new PIXI.Application({
                view: this.minimapaCanvas,
                width: this.minimapaCanvas.width,
                height: this.minimapaCanvas.height,
                backgroundColor: 0x767878,
                resolution: window.devicePixelRatio || 1,
                autoDensity: true,
                antialias: false,
                forceCanvas: true // Forzar Canvas 2D
            });
        }

        this.container = new PIXI.Container();
        this.app.stage.addChild(this.container);

        this.calleSprites = [];
        this.viewportRect = new PIXI.Graphics();
        this.container.addChild(this.viewportRect);

        console.log('🗺️ MinimapRenderer inicializado');
    }

    render() {
        if (!this.app || !window.calles) return;

        const params = this.calcularParametros();
        if (!params) return;

        const { minimapaAncho, minimapaAlto, minimapaEscala, minimapaOffsetX, minimapaOffsetY, viewport } = params;

        // Ajustar tamaño si cambió
        if (this.app.renderer.width !== minimapaAncho || this.app.renderer.height !== minimapaAlto) {
            this.app.renderer.resize(minimapaAncho, minimapaAlto);
        }

        // Limpiar sprites de calles anteriores
        this.calleSprites.forEach(sprite => sprite.destroy());
        this.calleSprites = [];

        // Aplicar transformación al contenedor
        this.container.x = minimapaOffsetX;
        this.container.y = minimapaOffsetY;

        // Renderizar calles
        const celda_tamano = window.celda_tamano || 5;
        window.calles.forEach(calle => {
            const graphics = new PIXI.Graphics();
            graphics.beginFill(0x000000); // Negro para las calles

            const width = calle.tamano * celda_tamano * minimapaEscala;
            const height = calle.carriles * celda_tamano * minimapaEscala;

            graphics.drawRect(0, 0, width, height);
            graphics.endFill();

            graphics.x = calle.x * minimapaEscala;
            graphics.y = calle.y * minimapaEscala;
            graphics.rotation = -calle.angulo * Math.PI / 180;

            this.container.addChild(graphics);
            this.calleSprites.push(graphics);
        });

        // Renderizar rectángulo de viewport
        this.viewportRect.clear();

        const rectAncho = viewport.ancho * minimapaEscala;
        const rectAlto = viewport.alto * minimapaEscala;
        const rectX = viewport.x * minimapaEscala;
        const rectY = viewport.y * minimapaEscala;

        // Si el rectángulo es muy pequeño, hacerlo visible con área de detección
        if (rectAncho < 40 || rectAlto < 40) {
            const areaDeteccionAncho = Math.max(rectAncho, 40);
            const areaDeteccionAlto = Math.max(rectAlto, 40);
            const areaX = rectX - (areaDeteccionAncho - rectAncho) / 2;
            const areaY = rectY - (areaDeteccionAlto - rectAlto) / 2;

            // Área de detección con transparencia
            this.viewportRect.beginFill(0xFF6464, 0.3); // Rojo semi-transparente
            this.viewportRect.drawRect(areaX, areaY, areaDeteccionAncho, areaDeteccionAlto);
            this.viewportRect.endFill();
        }

        // Rectángulo principal del viewport
        this.viewportRect.lineStyle(2, 0xFF0000, 1); // Rojo sólido
        this.viewportRect.drawRect(rectX, rectY, rectAncho, rectAlto);

        // Traer el rectángulo al frente
        this.container.setChildIndex(this.viewportRect, this.container.children.length - 1);
    }

    calcularParametros() {
        if (!window.calles || window.calles.length === 0) return null;

        const calcularLimitesMapa = window.calcularLimitesMapa;
        if (!calcularLimitesMapa) return null;

        const limites = calcularLimitesMapa();
        const { minX, minY, maxX, maxY } = limites;

        const anchoMapa = maxX - minX;
        const altoMapa = maxY - minY;

        // Tamaño del minimapa (puedes ajustar estos valores)
        const minimapaAncho = 250;
        const minimapaAlto = 250;

        // Calcular escala para que el mapa quepa en el minimapa con margen
        const margen = 10;
        const escalaX = (minimapaAncho - 2 * margen) / anchoMapa;
        const escalaY = (minimapaAlto - 2 * margen) / altoMapa;
        const minimapaEscala = Math.min(escalaX, escalaY);

        // Calcular offsets para centrar el mapa en el minimapa
        const minimapaOffsetX = (minimapaAncho - anchoMapa * minimapaEscala) / 2 - minX * minimapaEscala;
        const minimapaOffsetY = (minimapaAlto - altoMapa * minimapaEscala) / 2 - minY * minimapaEscala;

        // Calcular viewport (área visible en el canvas principal)
        const escala = window.escala || 1;
        const offsetX = window.offsetX || 0;
        const offsetY = window.offsetY || 0;
        const canvas = document.getElementById('simuladorCanvas');

        const viewport = {
            x: -offsetX / escala,
            y: -offsetY / escala,
            ancho: canvas.width / escala,
            alto: canvas.height / escala
        };

        return {
            minimapaAncho,
            minimapaAlto,
            minimapaEscala,
            minimapaOffsetX,
            minimapaOffsetY,
            viewport
        };
    }

    destroy() {
        if (this.app) {
            this.app.destroy(true);
        }
    }
}

window.MinimapRenderer = MinimapRenderer;
console.log('✓ MinimapRenderer cargado');
