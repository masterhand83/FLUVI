/**
 * SceneManager.js - Gestor del Scene Graph
 * Administra las capas, sprites y la actualización de la escena
 */

class SceneManager {
    constructor(app, assetLoader) {
        this.app = app;
        this.assets = assetLoader;

        // Contenedor principal con soporte para z-index
        this.mainContainer = new PIXI.Container();
        this.mainContainer.sortableChildren = true;
        this.mainContainer.interactiveChildren = true;
        this.app.stage.addChild(this.mainContainer);

        // Asegurar que el stage tenga eventos habilitados
        this.app.stage.eventMode = 'static';
        this.app.stage.interactiveChildren = true;

        // Inicializar sistema de ciclo día/noche
        this.dayNightCycle = new DayNightCycle();

        console.log('🎮 Stage configurado con eventos interactivos');

        // Crear capas en orden de renderizado
        this.layers = {
            background: this.createLayer(0),    // Fondo
            buildings: this.createLayer(10),    // Edificios (detrás de calles)
            streets: this.createLayer(15),      // Calles (encima de edificios)
            connections: this.createLayer(20),  // Conexiones
            vehicles: this.createLayer(25),     // Vehículos
            ui: this.createLayer(30),           // UI (etiquetas, handles)
            debug: this.createLayer(40)         // Debug (intersecciones, vértices)
        };

        // Maps para tracking de sprites (referencia dato → sprite)
        this.calleSprites = new Map();      // Map<Calle, PIXI.Container>
        this.carroSprites = new Map();      // Map<id:string, PIXI.Sprite>
        this.edificioSprites = new Map();   // Map<Edificio, PIXI.Sprite>
        this.conexionGraphics = new Map();  // Map<Conexion, PIXI.Graphics>
        this.verticeSprites = new Map();    // Map<id:string, PIXI.Graphics>

        // Variables de estado para evitar re-renderizado innecesario
        this.lastMostrarConexiones = false;
        this.lastMostrarVertices = false;
        this.lastMostrarEtiquetas = false;
        this.verticesRendered = false;
        this.conexionesRendered = false;
        this.backgroundRendered = false; // Flag para background (solo renderizar UNA VEZ)

        // Inicializar renderers especializados (se crearán después)
        this.calleRenderer = null;
        this.carroRenderer = null;
        this.edificioRenderer = null;
        this.conexionRenderer = null;
        this.uiRenderer = null;
        this.backgroundAreaRenderer = null;

        console.log('🎬 SceneManager creado');
    }

    createLayer(zIndex) {
        const layer = new PIXI.Container();
        layer.zIndex = zIndex;
        layer.sortableChildren = true;
        layer.eventMode = 'static'; // Habilitar eventos en PixiJS v7+
        layer.interactiveChildren = true;
        this.mainContainer.addChild(layer);
        return layer;
    }

    getLayer(name) {
        if (!this.layers[name]) {
            console.warn(`⚠️ Capa no encontrada: ${name}`);
        }
        return this.layers[name];
    }

    initRenderers() {
        this.backgroundAreaRenderer = new BackgroundAreaRenderer(this);
        this.calleRenderer = new CalleRenderer(this, this.assets);
        this.carroRenderer = new CarroRenderer(this, this.assets);
        this.edificioRenderer = new EdificioRenderer(this, this.assets);
        this.conexionRenderer = new ConexionRenderer(this, this.assets);
        this.uiRenderer = new UIRenderer(this, this.assets);

        console.log('✅ Renderers inicializados');
    }

    update(delta) {
        // 📱 OPTIMIZACIÓN MÓVIL: Obtener estado del dispositivo
        const isMobile = window.pixiApp && window.pixiApp.isMobile;

        // Actualizar color de fondo según ciclo día/noche usando tiempo virtual
        // En móviles, actualizar solo cada 3 frames para ahorrar CPU
        if (!isMobile || (this.frameCount % 3 === 0)) {
            if (this.dayNightCycle) {
                let simulatedDate;

                // Usar tiempo virtual si está disponible
                if (window.configuracionTiempo) {
                    // Crear un Date a partir del tiempo virtual
                    simulatedDate = new Date();
                    simulatedDate.setHours(Math.floor(window.configuracionTiempo.horaActual));
                    simulatedDate.setMinutes(Math.floor(window.configuracionTiempo.minutoActual));
                    simulatedDate.setSeconds(Math.floor(window.configuracionTiempo.segundoActual));
                } else if (window.simulatedCurrentDate) {
                    // Fallback al sistema anterior
                    simulatedDate = window.simulatedCurrentDate;
                }

                if (simulatedDate) {
                    const backgroundColor = this.dayNightCycle.getBackgroundColor(simulatedDate);
                    if (backgroundColor !== this.app.renderer.background.color) {
                        this.app.renderer.background.color = backgroundColor;
                    }
                }
            }
        }

        // Actualizar sprites de vehículos (cambios cada frame, crítico para la simulación)
        if (this.carroRenderer && window.calles) {
            this.carroRenderer.updateAll(window.calles);
        }

        // Incrementar contador de frames (para throttling en móviles)
        this.frameCount = (this.frameCount || 0) + 1;

        // Actualizar etiquetas solo cuando cambie el estado
        if (window.mostrarEtiquetas !== this.lastMostrarEtiquetas) {
            this.lastMostrarEtiquetas = window.mostrarEtiquetas;

            if (window.mostrarEtiquetas && this.uiRenderer && window.calles) {
                // Renderizar etiquetas solo una vez al activar
                this.uiRenderer.updateEtiquetas(window.calles);
            } else if (this.uiRenderer) {
                // Limpiar etiquetas al desactivar
                this.uiRenderer.clearEtiquetas();
            }
        }

        // Actualizar conexiones solo cuando cambie el estado
        if (window.mostrarConexiones !== this.lastMostrarConexiones) {
            this.lastMostrarConexiones = window.mostrarConexiones;

            if (window.mostrarConexiones) {
                // Renderizar conexiones solo una vez al activar
                if (this.conexionRenderer && window.conexiones && window.conexiones.length > 0) {
                    this.conexionRenderer.renderAll(window.conexiones);
                }
                this.conexionesRendered = true;
            } else {
                // Limpiar conexiones solo una vez al desactivar
                if (this.conexionRenderer) {
                    this.conexionRenderer.clearAll();
                }
                this.conexionesRendered = false;
            }
        }

        // Actualizar vértices solo cuando cambie el estado (separado de conexiones)
        if (window.mostrarVertices !== this.lastMostrarVertices) {
            this.lastMostrarVertices = window.mostrarVertices;

            if (window.mostrarVertices) {
                // Renderizar vértices solo una vez al activar
                this.renderVertices();
                this.verticesRendered = true;
            } else {
                // Limpiar vértices solo una vez al desactivar
                if (this.uiRenderer) {
                    this.uiRenderer.clearVertices();
                }
                // Limpiar vértices de la capa debug
                const layer = this.getLayer('debug');
                const childrenToRemove = [];
                layer.children.forEach(child => {
                    if (child.name && (child.name.startsWith('vertice_') || child.name.startsWith('vertice_text_'))) {
                        childrenToRemove.push(child);
                    }
                });
                childrenToRemove.forEach(child => {
                    child.destroy();
                    layer.removeChild(child);
                });
                this.verticesRendered = false;
            }
        }

        // Nota: PixiJS renderiza automáticamente el stage cada frame
        // No necesitamos llamar a render() manualmente
    }

    // Método para forzar actualización de etiquetas cuando cambien las calles
    refreshEtiquetas() {
        if (window.mostrarEtiquetas && this.uiRenderer && window.calles) {
            this.uiRenderer.updateEtiquetas(window.calles);
        }
    }

    renderAll() {
        console.log('🎨 SceneManager.renderAll() llamado');

        // OPTIMIZACIÓN CRÍTICA: Renderizar áreas de fondo SOLO UNA VEZ
        // El fondo es completamente estático, nunca cambia
        if (!this.backgroundRendered && this.backgroundAreaRenderer && window.backgroundAreas && window.backgroundAreas.length > 0) {
            console.log(`  → Renderizando ${window.backgroundAreas.length} área(s) de fondo (UNA SOLA VEZ)`);
            this.backgroundAreaRenderer.renderAll(window.backgroundAreas);
            this.backgroundRendered = true; // Marcar como renderizado, NUNCA volver a renderizar
            console.log(`  ✅ Fondo marcado como renderizado, no se volverá a procesar`);
        }

        // Renderizar edificios
        if (this.edificioRenderer && window.edificios && window.edificios.length > 0) {
            console.log(`  → Renderizando ${window.edificios.length} edificios`);
            this.edificioRenderer.renderAll(window.edificios);
        }

        // Renderizar calles
        if (this.calleRenderer && window.calles && window.calles.length > 0) {
            console.log(`  → Renderizando ${window.calles.length} calles`);
            this.calleRenderer.renderAll(window.calles);
        } else {
            console.warn('  ⚠️ No hay calles para renderizar o CalleRenderer no inicializado');
        }

        // Renderizar vehículos
        if (this.carroRenderer && window.calles && window.calles.length > 0) {
            this.carroRenderer.updateAll(window.calles);
        }

        // Renderizar conexiones si están visibles
        if (window.mostrarConexiones && this.conexionRenderer && window.conexiones && window.conexiones.length > 0) {
            console.log(`  → Renderizando ${window.conexiones.length} conexiones`);
            this.conexionRenderer.renderAll(window.conexiones);
        }

        // Renderizar conexiones de estacionamiento (siempre visibles)
        if (this.conexionRenderer && window.edificios) {
            const estacionamientos = window.edificios.filter(e => e.esEstacionamiento && e.conexiones && e.conexiones.length > 0);
            if (estacionamientos.length > 0) {
                console.log(`  → Renderizando conexiones de ${estacionamientos.length} estacionamientos`);
                this.conexionRenderer.renderEstacionamientos();
            }
        }

        // Renderizar intersecciones si están visibles
        if (window.mostrarIntersecciones && window.intersecciones && window.intersecciones.length > 0) {
            this.renderIntersecciones();
        }

        // Renderizar vértices de curvas si están visibles
        if (window.mostrarVertices && this.uiRenderer) {
            this.renderVertices();
        }

        // Renderizar etiquetas si están visibles
        if (window.mostrarEtiquetas && this.uiRenderer && window.calles && window.calles.length > 0) {
            this.uiRenderer.updateEtiquetas(window.calles);
        }

        // Renderizar contadores de estacionamientos si están visibles
        if (window.mostrarContadores && this.uiRenderer && window.edificios) {
            this.uiRenderer.updateContadores();
        }

        console.log('✅ SceneManager.renderAll() completado');
    }

    renderContadores() {
        if (this.uiRenderer && window.edificios) {
            this.uiRenderer.updateContadores();
        }
    }

    clearContadores() {
        if (this.uiRenderer) {
            this.uiRenderer.clearContadores();
        }
    }

    renderIntersecciones() {
        const layer = this.getLayer('debug');

        // Limpiar intersecciones anteriores
        layer.removeChildren();

        if (!window.intersecciones || window.intersecciones.length === 0) {
            return;
        }

        const celda_tamano = window.celda_tamano || 5;
        const radio = celda_tamano / 2;

        window.intersecciones.forEach(inter => {
            if (inter.coords) {
                const graphics = new PIXI.Graphics();
                graphics.beginFill(0xFF00FF, 0.5); // Magenta semi-transparente
                graphics.drawCircle(inter.coords.x, inter.coords.y, radio);
                graphics.endFill();
                layer.addChild(graphics);
            }
        });
    }

    renderVertices() {
        if (!window.calles) return;

        const layer = this.getLayer('debug');

        // Limpiar vértices y textos anteriores (solo los que agregamos aquí)
        const childrenToRemove = [];
        layer.children.forEach(child => {
            if (child.name && (child.name.startsWith('vertice_') || child.name.startsWith('vertice_text_'))) {
                childrenToRemove.push(child);
            }
        });
        childrenToRemove.forEach(child => {
            child.destroy();
            layer.removeChild(child);
        });

        window.calles.forEach(calle => {
            if (calle.tipo !== window.TIPOS?.CONEXION || !calle.vertices || calle.vertices.length === 0) {
                return;
            }

            calle.vertices.forEach((vertice, index) => {
                if (!window.calcularPosicionVertice) return;

                const pos = window.calcularPosicionVertice(calle, vertice);

                // Dibujar línea guía entre vértices
                if (index > 0 && calle.vertices[index - 1]) {
                    const verticeAnterior = calle.vertices[index - 1];
                    const posAnterior = window.calcularPosicionVertice(calle, verticeAnterior);

                    const line = new PIXI.Graphics();
                    line.lineStyle(1, 0xFFA500, 0.4); // Naranja semi-transparente
                    line.moveTo(posAnterior.x, posAnterior.y);
                    line.lineTo(pos.x, pos.y);
                    line.name = `vertice_line_${calle.nombre}_${index}`;
                    layer.addChild(line);
                }

                // Dibujar círculo del vértice
                const circle = new PIXI.Graphics();

                // Si es el vértice seleccionado, hacerlo más grande y de otro color
                if (window.verticeSeleccionado === vertice) {
                    circle.lineStyle(3, 0xFFFFFF);
                    circle.beginFill(0xFF0000, 0.9);
                    circle.drawCircle(pos.x, pos.y, 10);
                } else {
                    circle.lineStyle(2, 0xFFFFFF);
                    circle.beginFill(0x9370DB, 0.8);
                    circle.drawCircle(pos.x, pos.y, 8);
                }
                circle.endFill();
                circle.name = `vertice_${calle.nombre}_${index}`;

                // Hacer interactivo para poder arrastrarlo (PixiJS v7+ API)
                circle.eventMode = 'static';
                circle.cursor = 'pointer';

                layer.addChild(circle);

                // Agregar número del vértice con mayor resolución para evitar pixelación
                const text = new PIXI.Text(index.toString(), {
                    fontFamily: 'Arial',
                    fontSize: 9,
                    fontWeight: 'bold',
                    fill: 0xFFFFFF,
                    align: 'center'
                });
                text.anchor.set(0.5);
                text.resolution = 2; // Doble resolución para mayor calidad
                text.x = pos.x;
                text.y = pos.y;
                text.name = `vertice_text_${calle.nombre}_${index}`;
                layer.addChild(text);
            });
        });
    }

    clearLayer(layerName) {
        const layer = this.getLayer(layerName);
        if (layer) {
            layer.removeChildren();
        }
    }

    clearAll() {
        Object.keys(this.layers).forEach(name => {
            this.clearLayer(name);
        });

        this.calleSprites.clear();
        this.carroSprites.clear();
        this.edificioSprites.clear();
        this.conexionGraphics.clear();
        this.verticeSprites.clear();

        console.log('🗑️ Escena limpiada');
    }
}

window.SceneManager = SceneManager;
console.log('✓ SceneManager cargado');
