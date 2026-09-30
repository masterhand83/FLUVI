/** UIRenderer.js - Etiquetas, vértices y contadores de estacionamiento. */
class UIRenderer {
    constructor(sceneManager, assetLoader) {
        this.scene = sceneManager;
        this.assets = assetLoader;
        this.etiquetas = new Map(); // Map<calle, Text>
    }

    updateEtiquetas(calles) {
        if (!calles || !etiquetasVisibles('streets')) {
            this.clearEtiquetas();
            return;
        }
        const current = new Set(calles);
        this.etiquetas.forEach((text, calle) => {
            if (!current.has(calle)) {
                text.destroy();
                this.etiquetas.delete(calle);
            }
        });
        calles.forEach(calle => this.updateEtiqueta(calle));
    }

    updateEtiqueta(calle) {
        let text = this.etiquetas.get(calle);
        if (!calle.nombre || !etiquetasVisibles('streets')) {
            text?.destroy();
            this.etiquetas.delete(calle);
            return;
        }
        if (!text) {
            text = new PIXI.Text(calle.nombre, estiloEtiqueta());
            text.anchor.set(0.5);
            text.resolution = Math.max(2, window.devicePixelRatio || 1);
            this.scene.getLayer('ui').addChild(text);
            this.etiquetas.set(calle, text);
        }
        const point = calcularPosicionEnCalle(calle);
        text.text = calle.nombre;
        text.style = estiloEtiqueta();
        text.position.set(point.x, point.y);
        text.rotation = anguloEtiqueta(point.angulo);
    }

    clearEtiquetas() {
        this.etiquetas.forEach(text => {
            text.parent?.removeChild(text);
            text.destroy();
        });
        this.etiquetas.clear();
    }

    updateVertices(calle) {
        if (!calle || !calle.esCurva || !calle.vertices) {
            this.clearVertices();
            return;
        }

        // Limpiar vértices anteriores
        this.clearVertices();

        calle.vertices.forEach((vertice, index) => {
            const id = `${calle.nombre}_vertice_${index}`;

            const pos = window.calcularPosicionVertice
                ? window.calcularPosicionVertice(calle, vertice)
                : { x: calle.x, y: calle.y };

            // Crear círculo para el vértice
            const graphics = new PIXI.Graphics();
            graphics.beginFill(0x9370DB, 0.8);
            graphics.drawCircle(0, 0, 8);
            graphics.endFill();
            graphics.lineStyle(2, 0xFFFFFF);
            graphics.drawCircle(0, 0, 8);

            graphics.x = pos.x;
            graphics.y = pos.y;

            // Hacer interactivo para arrastre (PixiJS v7+ API)
            graphics.eventMode = 'static';
            graphics.cursor = 'pointer';

            // Eventos de arrastre (se implementarán en EditorHandles)
            graphics.on('pointerdown', (e) => {
                if (window.editorHandles) {
                    window.editorHandles.onVerticeMouseDown(calle, vertice, index, e);
                }
            });

            this.scene.getLayer('debug').addChild(graphics);
            this.scene.verticeSprites.set(id, graphics);
        });
    }

    clearVertices() {
        this.scene.verticeSprites.forEach((graphics, id) => {
            graphics.destroy();
        });
        this.scene.verticeSprites.clear();
    }

    /**
     * Renderiza contadores de ocupación para edificios tipo estacionamiento
     */
    updateContadores() {
        if (!window.edificios || !window.mostrarContadores) {
            this.clearContadores();
            return;
        }

        // Limpiar contadores anteriores
        this.clearContadores();

        // Inicializar Map si no existe
        if (!this.contadores) {
            this.contadores = new Map();
        }

        // Filtrar edificios que son estacionamientos
        const estacionamientos = window.edificios.filter(e => e.esEstacionamiento);

        estacionamientos.forEach(edificio => {
            const container = new PIXI.Container();

            // Posición: debajo del edificio
            const offsetY = (edificio.height / 2) + 15; // 15px debajo del edificio
            container.x = edificio.x;
            container.y = edificio.y + offsetY;

            // Texto del contador: (ocupados/capacidad)
            const ocupacion = edificio.vehiculosActuales || 0;
            const capacidad = edificio.capacidadMaxima || 0;
            const textoContador = `(${ocupacion}/${capacidad})`;

            // Crear fondo semi-transparente
            const padding = 4;
            const bgColor = 0x000000;
            const bgAlpha = 0.7;

            // Crear texto
            const textColor = 0xFFFFFF; // Blanco para contraste con fondo negro
            const fontSize = 12;

            const text = new PIXI.Text(textoContador, {
                fontFamily: 'Arial',
                fontSize: fontSize,
                fill: textColor,
                align: 'center'
            });
            text.anchor.set(0.5, 0.5);

            // Crear fondo
            const bg = new PIXI.Graphics();
            bg.beginFill(bgColor, bgAlpha);
            bg.drawRoundedRect(
                -text.width / 2 - padding,
                -text.height / 2 - padding,
                text.width + padding * 2,
                text.height + padding * 2,
                4 // radio de esquinas redondeadas
            );
            bg.endFill();

            // Agregar fondo y texto al container
            container.addChild(bg);
            container.addChild(text);

            // Aplicar rotación del edificio (inversa para mantener texto legible)
            container.rotation = -(edificio.angle || 0) * Math.PI / 180;

            // Z-index alto para que esté encima de todo
            container.zIndex = 100;

            // Agregar al layer de UI
            this.scene.getLayer('ui').addChild(container);

            // Guardar referencia
            const key = edificio.id || edificio.label;
            this.contadores.set(key, container);
        });
    }

    clearContadores() {
        if (!this.contadores) return;

        this.contadores.forEach((container, key) => {
            container.destroy({ children: true });
        });
        this.contadores.clear();
    }

    clearAll() {
        this.clearEtiquetas();
        this.clearVertices();
        this.clearContadores();
    }
}

window.UIRenderer = UIRenderer;
console.log('✓ UIRenderer cargado');
