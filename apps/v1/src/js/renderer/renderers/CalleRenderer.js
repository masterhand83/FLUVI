/**
 * CalleRenderer.js - Renderizador de calles
 * Maneja la visualización de calles rectas y curvas
 */

class CalleRenderer {
    constructor(sceneManager, assetLoader) {
        this.scene = sceneManager;
        this.assets = assetLoader;
        this.celda_tamano = window.celda_tamano || 5;
        this.draggingVertexIndex = -1; // Índice del vértice que se está arrastrando
        this.draggingCalle = null; // Calle del vértice que se está arrastrando
        this.influenceCircle = null; // Círculo de influencia visual para el vértice siendo arrastrado
        this.lastPaintedCell = null; // Última celda pintada en modo pincel
        this.paintMode = null; // 'paint' (pintar/bloquear) o 'erase' (borrar/desbloquear)
    }

    renderAll(calles) {
        if (!calles || calles.length === 0) {
            console.warn('⚠️ CalleRenderer: No hay calles para renderizar');
            return;
        }

        console.log(`🛣️ CalleRenderer: Renderizando ${calles.length} calles`);

        calles.forEach(calle => {
            try {
                if (calle.esCurva) {
                    this.renderCalleCurva(calle);
                } else {
                    this.renderCalleRecta(calle);
                }
            } catch (error) {
                console.error(`❌ Error renderizando calle ${calle.nombre}:`, error);
            }
        });

        // Renderizar vértices para TODAS las calles (la función decidirá si mostrarlos o no)
        calles.forEach(calle => {
            if (calle.vertices && calle.vertices.length > 0) {
                this.renderVertices(calle);
            }
        });
    }

    renderCalleRecta(calle) {
        // Si ya existe, actualizar
        if (this.scene.calleSprites.has(calle)) {
            return this.updateCalleSprite(calle);
        }

        // Crear contenedor para la calle
        const container = new PIXI.Container();
        container.x = calle.x;
        container.y = calle.y;
        container.rotation = CoordinateConverter.degreesToRadians(calle.angulo);

        // Usar TilingSprite para repetir textura
        const texture = this.assets.getTexture('carretera');

        if (!texture) {
            console.error('❌ Textura de carretera no encontrada');
            return null;
        }

        const tilingSprite = new PIXI.TilingSprite(
            texture,
            calle.tamano * this.celda_tamano,
            calle.carriles * this.celda_tamano
        );

        // Configurar el tiling para que cada celda muestre la textura completa
        if (texture.width && texture.height) {
            tilingSprite.tileScale.set(
                this.celda_tamano / texture.width,
                this.celda_tamano / texture.height
            );
        }

        // Hacer el TilingSprite interactivo para asegurar que capture eventos
        tilingSprite.eventMode = 'static'; // PixiJS v7+ API
        tilingSprite.cursor = 'pointer';

        container.addChild(tilingSprite);

        // Agregar borde de selección si es la calle seleccionada
        if (window.calleSeleccionada === calle) {
            this.addSelectionBorder(container, calle);
        }

        // Guardar referencia
        this.scene.calleSprites.set(calle, container);
        this.scene.getLayer('streets').addChild(container);

        // Hacer interactivo (PixiJS v7+ API)
        container.eventMode = 'static';
        container.cursor = 'pointer';
        container.on('pointerdown', (e) => this.onCalleClick(calle, e));
        container.on('pointerover', () => this.onCalleHover(calle, container));
        container.on('pointerout', () => this.onCalleOut(calle, container));

        return container;
    }

    renderCalleCurva(calle) {
        // Para calles curvas, crear múltiples sprites siguiendo vértices
        if (this.scene.calleSprites.has(calle)) {
            return this.updateCalleCurvaSprite(calle);
        }

        const container = new PIXI.Container();
        // El container se posiciona en (0,0) del mundo, los sprites usan coordenadas globales
        container.x = 0;
        container.y = 0;

        const texture = this.assets.getTexture('carretera');

        // Renderizar celda por celda siguiendo la curva
        for (let carril = 0; carril < calle.carriles; carril++) {
            for (let i = 0; i < calle.tamano; i++) {
                // Usar función de curvas.js para obtener coordenadas
                const coords = window.obtenerCoordenadasGlobalesCeldaConCurva
                    ? window.obtenerCoordenadasGlobalesCeldaConCurva(calle, carril, i)
                    : this.obtenerCoordenadasBasicas(calle, carril, i);

                const sprite = new PIXI.Sprite(texture);
                sprite.anchor.set(0.5);
                sprite.width = this.celda_tamano;
                sprite.height = this.celda_tamano;
                // Usar coordenadas globales directamente ya que el container está en (0,0)
                sprite.x = coords.x;
                sprite.y = coords.y;
                sprite.rotation = CoordinateConverter.degreesToRadians(coords.angulo || calle.angulo);

                // Hacer cada sprite individual interactivo para calles curvas (PixiJS v7+ API)
                sprite.eventMode = 'static';
                sprite.cursor = 'pointer';
                sprite.on('pointerdown', (e) => this.onCalleClick(calle, e));
                sprite.on('pointerover', () => this.onCalleHover(calle, container));
                sprite.on('pointerout', () => this.onCalleOut(calle, container));

                container.addChild(sprite);
            }
        }

        // Agregar overlay de contorno si modo selección está activo
        if (window.esModoSeleccionCallesActivo && window.esModoSeleccionCallesActivo()) {
            const calleIdx = window.calles ? window.calles.indexOf(calle) : -1;
            const estaIncluida = window.calleEstaIncluidaEnMetricas ? window.calleEstaIncluidaEnMetricas(calleIdx) : true;

            const overlay = new PIXI.Graphics();
            overlay.name = 'metricsOverlay';

            // IMPORTANTE: Desactivar interactividad para que no bloquee clicks
            overlay.eventMode = 'none';

            // Configurar estilo según si está incluida o no
            if (estaIncluida) {
                overlay.lineStyle(3, 0x00ff00, 1.0); // Borde verde sólido
                overlay.beginFill(0x00ff00, 0.15); // Relleno verde muy transparente
            } else {
                overlay.lineStyle(3, 0xff0000, 1.0); // Borde rojo sólido
                overlay.beginFill(0xff0000, 0.25); // Relleno rojo semi-transparente
            }

            // Dibujar contorno siguiendo la forma de la calle curva
            if (window.obtenerCoordenadasGlobalesCeldaConCurva) {
                // Borde superior (primer carril)
                for (let i = 0; i < calle.tamano; i++) {
                    const coords = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, 0, i);

                    if (i === 0) {
                        overlay.moveTo(coords.x, coords.y);
                    } else {
                        overlay.lineTo(coords.x, coords.y);
                    }
                }

                // Borde inferior (último carril) - ir en reversa
                for (let i = calle.tamano - 1; i >= 0; i--) {
                    const coords = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, calle.carriles - 1, i);
                    overlay.lineTo(coords.x, coords.y);
                }

                // Cerrar el contorno
                const firstCoords = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, 0, 0);
                overlay.lineTo(firstCoords.x, firstCoords.y);
            }

            overlay.endFill();
            container.addChild(overlay);

            console.log(`🎨 Overlay de contorno ${estaIncluida ? 'VERDE' : 'ROJO'} agregado a calle curva:`, calle.nombre);
        }

        // Agregar borde si está seleccionada
        if (window.calleSeleccionada === calle) {
            this.addSelectionBorderCurva(container, calle);
        }

        // Guardar referencia
        this.scene.calleSprites.set(calle, container);
        this.scene.getLayer('streets').addChild(container);

        return container;
    }

    obtenerCoordenadasBasicas(calle, carril, indice) {
        const angle = -calle.angulo * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const localX = indice * this.celda_tamano + this.celda_tamano / 2;
        const localY = carril * this.celda_tamano + this.celda_tamano / 2;

        return {
            x: calle.x + (localX * cos - localY * sin),
            y: calle.y + (localX * sin + localY * cos),
            angulo: calle.angulo
        };
    }

    updateCalleSprite(calle) {
        const container = this.scene.calleSprites.get(calle);
        if (!container) return;

        container.x = calle.x;
        container.y = calle.y;
        container.rotation = CoordinateConverter.degreesToRadians(calle.angulo);
        const road = container.children.find(child => child instanceof PIXI.TilingSprite);
        if (road) {
            road.width = calle.tamano * this.celda_tamano;
            road.height = calle.carriles * this.celda_tamano;
        }

        // Actualizar borde de selección
        this.updateSelectionBorder(container, calle);
    }

    updateCalleCurvaSprite(calle) {
        // Reconstruir sprites (más simple que actualizar)
        this.removeCalleSprite(calle);
        this.renderCalleCurva(calle);
    }

    addSelectionBorder(container, calle) {
        const graphics = new PIXI.Graphics();
        graphics.lineStyle(1, window.modoSeleccion === "constructor" ? 0xFFA500 : 0xFFD700);
        graphics.drawRect(
            0,
            0,
            calle.tamano * this.celda_tamano,
            calle.carriles * this.celda_tamano
        );
        graphics.name = 'selectionBorder';
        container.addChild(graphics);
    }

    addSelectionBorderCurva(container, calle) {
        const graphics = new PIXI.Graphics();
        const color = window.modoSeleccion === "constructor" ? 0xFFA500 : 0xFFD700;

        graphics.lineStyle(1, color, 1);

        // Dibujar contorno siguiendo ambos bordes de la calle curva (sin offset)
        if (window.obtenerCoordenadasGlobalesCeldaConCurva) {
            // Borde superior (carril 0)
            for (let i = 0; i < calle.tamano; i++) {
                const coords = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, 0, i);

                if (i === 0) {
                    graphics.moveTo(coords.x, coords.y);
                } else {
                    graphics.lineTo(coords.x, coords.y);
                }
            }

            // Borde inferior (último carril)
            for (let i = calle.tamano - 1; i >= 0; i--) {
                const coords = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, calle.carriles - 1, i);
                graphics.lineTo(coords.x, coords.y);
            }

            // Cerrar el contorno volviendo al primer punto
            const firstCoords = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, 0, 0);
            graphics.lineTo(firstCoords.x, firstCoords.y);
        }

        graphics.name = 'selectionBorder';
        container.addChild(graphics);
    }

    updateSelectionBorder(container, calle) {
        // Remover borde anterior
        const oldBorder = container.getChildByName('selectionBorder');
        if (oldBorder) {
            container.removeChild(oldBorder);
        }

        // Agregar nuevo si está seleccionada
        if (window.calleSeleccionada === calle) {
            this.addSelectionBorder(container, calle);
        }
    }

    updateSelectionBorderCurva(container, calle) {
        // Remover borde anterior
        const oldBorder = container.getChildByName('selectionBorder');
        if (oldBorder) {
            container.removeChild(oldBorder);
        }

        // Agregar nuevo si está seleccionada
        if (window.calleSeleccionada === calle) {
            this.addSelectionBorderCurva(container, calle);
        }
    }

    /**
     * Actualiza el overlay de métricas para una calle recta
     */
    updateMetricsOverlay(calle) {
        const container = this.scene.calleSprites.get(calle);
        if (!container) {
            console.warn('⚠️ updateMetricsOverlay: Container no encontrado para calle', calle.nombre);
            return;
        }

        // Remover overlay anterior si existe
        const children = [...container.children]; // Crear copia para iterar seguramente
        for (const child of children) {
            if (child.name === 'metricsOverlay') {
                container.removeChild(child);
                child.destroy();
            }
        }

        // Agregar nuevo overlay si modo selección está activo
        if (window.esModoSeleccionCallesActivo && window.esModoSeleccionCallesActivo()) {
            const calleIdx = window.calles ? window.calles.indexOf(calle) : -1;
            const estaIncluida = window.calleEstaIncluidaEnMetricas ? window.calleEstaIncluidaEnMetricas(calleIdx) : true;

            const overlay = new PIXI.Graphics();
            overlay.name = 'metricsOverlay';

            // IMPORTANTE: Desactivar interactividad para que no bloquee clicks
            overlay.eventMode = 'none';

            // Hacer el overlay mucho más visible
            if (estaIncluida) {
                // Calle incluida: overlay verde con borde grueso
                overlay.lineStyle(3, 0x00ff00, 1.0); // Borde verde sólido
                overlay.beginFill(0x00ff00, 0.15); // Relleno verde muy transparente
            } else {
                // Calle excluida: overlay rojo con borde grueso
                overlay.lineStyle(3, 0xff0000, 1.0); // Borde rojo sólido
                overlay.beginFill(0xff0000, 0.25); // Relleno rojo semi-transparente
            }

            overlay.drawRect(0, 0, calle.tamano * this.celda_tamano, calle.carriles * this.celda_tamano);
            overlay.endFill();

            // Agregar como último hijo para que esté encima de todo
            container.addChild(overlay);

            console.log(`🎨 Overlay ${estaIncluida ? 'VERDE' : 'ROJO'} agregado a calle:`, calle.nombre);
        }
    }

    /**
     * Actualiza todos los overlays de métricas
     */
    updateAllMetricsOverlays() {
        if (!window.calles) {
            console.warn('⚠️ updateAllMetricsOverlays: No hay calles definidas');
            return;
        }

        console.log(`🔄 Actualizando overlays de ${window.calles.length} calles...`);

        let rectasActualizadas = 0;
        let curvasActualizadas = 0;

        window.calles.forEach((calle, idx) => {
            if (calle.esCurva) {
                // Para calles curvas, reconstruir completamente
                console.log(`  Reconstruyendo calle curva [${idx}]:`, calle.nombre);
                this.removeCalleSprite(calle);
                this.renderCalleCurva(calle);
                curvasActualizadas++;
            } else {
                // Para calles rectas, solo actualizar overlay
                console.log(`  Actualizando overlay de calle recta [${idx}]:`, calle.nombre);
                this.updateMetricsOverlay(calle);
                rectasActualizadas++;
            }
        });

        console.log(`✅ Overlays actualizados: ${rectasActualizadas} rectas, ${curvasActualizadas} curvas`);
    }

    removeCalleSprite(calle) {
        const container = this.scene.calleSprites.get(calle);
        if (container) {
            container.destroy({ children: true });
            this.scene.calleSprites.delete(calle);
        }
    }

    clearAllSelectionBorders() {
        // Limpiar bordes de TODAS las calles
        this.scene.calleSprites.forEach((container, calle) => {
            const border = container.getChildByName('selectionBorder');
            if (border) {
                container.removeChild(border);
                border.destroy();
            }
        });

        // Limpiar bordes de TODOS los edificios
        if (window.pixiApp && window.pixiApp.sceneManager && window.pixiApp.sceneManager.edificioRenderer) {
            const edificioRenderer = window.pixiApp.sceneManager.edificioRenderer;
            edificioRenderer.scene.edificioSprites.forEach((sprite, edificio) => {
                const border = sprite.getChildByName ? sprite.getChildByName('selectionBorder') : null;
                if (border) {
                    sprite.removeChild(border);
                    border.destroy();
                }
            });
        }

        console.log('🧹 Todos los bordes de selección limpiados');
    }

    // Event handlers
    onCalleClick(calle, event) {
        console.log('🟥 CalleRenderer.onCalleClick EJECUTADO - Calle:', calle.nombre);

        // Detener propagación para evitar conflictos
        event.stopPropagation();

        // PRIORIDAD 0: Si el modo de selección de calles para métricas está activo
        if (window.esModoSeleccionCallesActivo && window.esModoSeleccionCallesActivo()) {
            console.log('🎯 Modo selección de calles activo - toggling calle en métricas');

            // Obtener el índice de la calle
            const calleIdx = window.calles ? window.calles.indexOf(calle) : -1;

            if (calleIdx !== -1 && window.toggleCalleEnMetricas) {
                window.toggleCalleEnMetricas(calleIdx);
            } else {
                console.warn('⚠️ No se pudo encontrar el índice de la calle o la función toggleCalleEnMetricas');
            }

            // Salir sin ejecutar la lógica normal de clicks
            return;
        }

        // PRIORIDAD 1: Si el modo bloqueo está activo, manejar el bloqueo de carriles
        if (window.estadoEscenarios && window.estadoEscenarios.modoBloqueoActivo) {
            console.log('🚧 Modo bloqueo activo - iniciando modo pincel');

            // Determinar el modo de pintura basado en la celda inicial
            const globalPos = event.data.global;
            const worldX = (globalPos.x - window.offsetX) / window.escala;
            const worldY = (globalPos.y - window.offsetY) / window.escala;

            if (typeof window.encontrarCeldaMasCercana === 'function') {
                const celdaInicial = window.encontrarCeldaMasCercana(worldX, worldY);

                if (celdaInicial) {
                    const { calle: calleInicial, carril, indice } = celdaInicial;
                    const valorInicial = calleInicial.arreglo[carril]?.[indice];

                    // Determinar acción: si está bloqueada (7), borrar; si no, pintar
                    this.paintMode = (valorInicial === 7) ? 'erase' : 'paint';
                    console.log(`🎨 Modo de pincel establecido: ${this.paintMode === 'paint' ? 'PINTAR/BLOQUEAR' : 'BORRAR/DESBLOQUEAR'}`);
                }
            }

            // Iniciar modo pintura
            window.estadoEscenarios.isPainting = true;

            // Pintar la celda inicial
            this.paintCell(calle, event);

            // Función para pintar mientras se arrastra
            const onPointerMove = (e) => {
                if (window.estadoEscenarios.isPainting) {
                    this.paintCell(calle, e);
                }
            };

            // Función para terminar de pintar
            const onPointerUp = () => {
                window.estadoEscenarios.isPainting = false;
                this.lastPaintedCell = null; // Resetear última celda pintada
                this.paintMode = null; // Resetear modo de pincel
                this.scene.app.stage.off('pointermove', onPointerMove);
                this.scene.app.stage.off('pointerup', onPointerUp);
                this.scene.app.stage.off('pointerupoutside', onPointerUp);
                console.log('🖌️ Modo pincel terminado');
            };

            // Registrar eventos globales para pintar con drag
            this.scene.app.stage.on('pointermove', onPointerMove);
            this.scene.app.stage.on('pointerup', onPointerUp);
            this.scene.app.stage.on('pointerupoutside', onPointerUp);

            // Salir sin ejecutar la lógica normal de clicks
            return;
        }

        // PRIORIDAD 2: Lógica normal de clicks (cuando NO está el modo bloqueo activo)
        // Obtener coordenadas del mundo
        const globalPos = event.data.global;
        const worldX = (globalPos.x - window.offsetX) / window.escala;
        const worldY = (globalPos.y - window.offsetY) / window.escala;

        const isCtrl = event.data.originalEvent.ctrlKey || event.data.originalEvent.metaKey;
        console.log('Ctrl?', isCtrl);

        // Si es Ctrl+Click, seleccionar/deseleccionar la calle
        if (event.data.originalEvent.ctrlKey || event.data.originalEvent.metaKey) {
            console.log('🖱️ Ctrl+Clic en calle:', calle.nombre);

            // Guardar la calle previamente seleccionada
            const previousSelection = window.calleSeleccionada;

            // Si se clickeó la misma calle, deseleccionar
            if (previousSelection === calle) {
                console.log('🔄 Deseleccionando calle:', calle.nombre);
                window.calleSeleccionada = null;

                // Remover borde de selección
                const container = this.scene.calleSprites.get(calle);
                if (container) {
                    const border = container.getChildByName('selectionBorder');
                    if (border) {
                        container.removeChild(border);
                        border.destroy();
                    }
                }

                // Resetear AMBOS selectores de calle
                const selectCalle = document.getElementById('selectCalle');
                const selectCalleEditor = document.getElementById('selectCalleEditor');
                if (selectCalle) {
                    selectCalle.selectedIndex = 0;
                }
                if (selectCalleEditor) {
                    selectCalleEditor.selectedIndex = 0;
                }

                // Actualizar UI
                if (window.editorCalles) {
                    window.editorCalles.actualizarInputsPosicion();
                }

                return;
            }

            // NUEVO: Limpiar TODOS los bordes existentes primero
            this.clearAllSelectionBorders();

            // Actualizar selección global
            window.calleSeleccionada = calle;
            window.edificioSeleccionado = null;

            // Agregar borde a la calle seleccionada
            const currentContainer = this.scene.calleSprites.get(calle);
            if (currentContainer) {
                // Primero remover cualquier borde existente (por si acaso)
                const existingBorder = currentContainer.getChildByName('selectionBorder');
                if (existingBorder) {
                    currentContainer.removeChild(existingBorder);
                    existingBorder.destroy();
                }

                // Agregar el nuevo borde
                if (calle.esCurva) {
                    this.addSelectionBorderCurva(currentContainer, calle);
                } else {
                    this.addSelectionBorder(currentContainer, calle);
                }
            }

            // Actualizar selector de tipo de objeto en Constructor
            const selectTipoObjeto = document.getElementById('selectTipoObjeto');
            if (selectTipoObjeto) {
                selectTipoObjeto.value = 'calle';
                // Disparar evento change para mostrar el selector correcto
                selectTipoObjeto.dispatchEvent(new Event('change'));
            }

            // Actualizar AMBOS selectores de calle (Constructor y Configuración)
            const selectCalle = document.getElementById('selectCalle');
            const selectCalleEditor = document.getElementById('selectCalleEditor');
            const calleIndex = window.calles ? window.calles.indexOf(calle) : -1;

            if (calleIndex !== -1) {
                // Actualizar selector de Configuración de Calles
                if (selectCalle) {
                    selectCalle.value = calleIndex;
                    // Disparar evento change para actualizar los inputs de probabilidades
                    selectCalle.dispatchEvent(new Event('change'));
                }
                // Actualizar selector del Constructor
                if (selectCalleEditor) {
                    selectCalleEditor.value = calleIndex;
                    selectCalleEditor.dispatchEvent(new Event('change'));
                }
            }

            // Resetear selector de edificios ya que ahora hay una calle seleccionada
            const selectEdificio = document.getElementById('selectEdificio');
            if (selectEdificio) {
                selectEdificio.value = '';
            }

            // Actualizar UI (selectores y paneles)
            if (window.editorCalles) {
                window.editorCalles.actualizarInputsPosicion();

                // Si estamos en modo edición, recrear handles para el nuevo objeto
                if (window.editorCalles.modoEdicion && window.editorHandles) {
                    console.log('🔄 Cambiando handles al nuevo objeto en modo edición');
                    window.editorHandles.clearHandles();
                    window.editorHandles.createHandles(calle, 'calle');
                }
            }

            // Llamar a la función global de renderizado si existe (para Canvas 2D fallback)
            if (!window.USE_PIXI && window.renderizarCanvas) {
                window.renderizarCanvas();
            }
        } else {
            // Comportamiento normal sin Ctrl: agregar/quitar vehículos usando ClickActionManager
            console.log('🔵 Click normal en calle (sin Ctrl)');

            if (typeof window.encontrarCeldaMasCercana === 'function') {
                const celdaObjetivo = window.encontrarCeldaMasCercana(worldX, worldY);

                if (celdaObjetivo) {
                    const { calle: calleObjetivo, carril, indice } = celdaObjetivo;

                    // Verificar que la celda objetivo sea de la calle clickeada
                    if (calleObjetivo === calle) {
                        const valorActual = calleObjetivo.arreglo[carril]?.[indice];
                        console.log('📍 Celda encontrada - Carril:', carril, 'Índice:', indice, 'Valor actual:', valorActual);

                        // Usar ClickActionManager si existe
                        if (window.clickActionManager) {
                            const changed = window.clickActionManager.executeAction({
                                calle: calleObjetivo,
                                carril: carril,
                                indice: indice
                            });

                            if (changed) {
                                const nuevoValor = calleObjetivo.arreglo[carril][indice];
                                console.log('✅ Vehículo modificado por ClickActionManager. Nuevo valor:', nuevoValor);
                            } else {
                                console.log('⚠️ ClickActionManager no realizó cambios');
                            }
                        } else {
                            // Fallback: lógica simple de toggle
                            console.log('⚠️ ClickActionManager no disponible, usando lógica simple');
                            if (valorActual === 0 || valorActual === undefined) {
                                // Agregar vehículo
                                const nuevoValor = Math.floor(Math.random() * 6) + 1;
                                calleObjetivo.arreglo[carril][indice] = nuevoValor;
                                console.log('✅ AGREGADO:', nuevoValor);
                            } else {
                                // Quitar vehículo
                                calleObjetivo.arreglo[carril][indice] = 0;
                                console.log('✅ QUITADO (valor anterior:', valorActual, ')');
                            }
                        }

                        // Los vehículos se actualizan automáticamente en el siguiente frame
                        // No es necesario llamar a renderizarCanvas en PixiJS
                    } else {
                        console.log(`⚠️ La celda más cercana no pertenece a la calle clickeada`);
                    }
                } else {
                    console.log(`⚠️ No se encontró celda cercana en (${worldX.toFixed(2)}, ${worldY.toFixed(2)})`);
                }
            } else {
                console.warn('⚠️ window.encontrarCeldaMasCercana no está definido');
            }
        }
    }

    onCalleHover(calle, container) {
        container.alpha = 0.9;

        // Mostrar tooltip con el nombre de la calle
        const tooltip = document.getElementById('canvasTooltip');
        if (tooltip && calle.nombre) {
            // MODO 1: Detección de celdas DESACTIVADA (comportamiento original, más rápido)
            if (!window.cellDetectionEnabled) {
                tooltip.textContent = calle.nombre;
                tooltip.style.display = 'block';

                // Usar eventos DOM (método original, más ligero)
                const updateTooltipPosition = (e) => {
                    tooltip.style.left = (e.clientX + 15) + 'px';
                    tooltip.style.top = (e.clientY + 15) + 'px';
                };

                // Guardar la función y el tipo de listener para poder removerlo después
                container._tooltipMoveHandler = updateTooltipPosition;
                container._tooltipListenerType = 'dom'; // Marcar que es evento DOM

                // Agregar listener de movimiento del mouse (DOM)
                document.addEventListener('mousemove', updateTooltipPosition);
                return;
            }

            // MODO 2: Detección de celdas ACTIVADA (con optimizaciones)
            // Guardar referencia al stage para eventos PixiJS
            const stage = this.scene.app.stage;

            // Variables para throttling (optimización de rendimiento)
            let lastUpdateTime = 0;
            const throttleDelay = 50; // Actualizar celda cada 50ms (20 veces por segundo)

            // Función optimizada para encontrar celda solo en la calle actual
            const encontrarCeldaEnCalle = (calle, worldX, worldY) => {
                let celdaMasCercana = null;
                let distanciaMinima = Infinity;
                const umbralDistancia = this.celda_tamano;

                // Solo iterar sobre la calle actual (no todas las calles)
                for (let carril = 0; carril < calle.carriles; carril++) {
                    for (let indice = 0; indice < calle.tamano; indice++) {
                        // Usar función correcta según si la calle tiene curvas
                        let centroCelda;
                        if (calle.esCurva && calle.vertices && calle.vertices.length > 0) {
                            if (typeof window.obtenerCoordenadasGlobalesCeldaConCurva === 'function') {
                                centroCelda = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, carril, indice);
                            } else {
                                continue;
                            }
                        } else {
                            if (typeof window.obtenerCoordenadasGlobalesCelda === 'function') {
                                centroCelda = window.obtenerCoordenadasGlobalesCelda(calle, carril, indice);
                            } else {
                                continue;
                            }
                        }

                        const dx = worldX - centroCelda.x;
                        const dy = worldY - centroCelda.y;
                        const distancia = Math.sqrt(dx * dx + dy * dy);

                        if (distancia < distanciaMinima) {
                            distanciaMinima = distancia;
                            celdaMasCercana = { carril, indice };
                        }

                        // Early exit: si encontramos una celda muy cercana, retornar inmediatamente
                        if (distancia < umbralDistancia * 0.5) {
                            return celdaMasCercana;
                        }
                    }
                }

                // Solo retornar si está dentro del umbral
                if (celdaMasCercana && distanciaMinima < umbralDistancia) {
                    return celdaMasCercana;
                }
                return null;
            };

            // Actualizar posición del tooltip y contenido siguiendo el mouse (con detección de celda)
            const updateTooltipPositionWithCell = (pixiEvent) => {
                // Obtener coordenadas de pantalla para posicionar el tooltip
                const clientX = pixiEvent.data.global.x;
                const clientY = pixiEvent.data.global.y;

                // SIEMPRE actualizar posición del tooltip (sin throttle, es muy ligero)
                tooltip.style.left = (clientX + 15) + 'px';
                tooltip.style.top = (clientY + 15) + 'px';

                // Throttling: solo actualizar el número de celda cada X ms
                const currentTime = performance.now();
                if (currentTime - lastUpdateTime < throttleDelay) {
                    return; // Salir temprano, no actualizar contenido aún
                }
                lastUpdateTime = currentTime;

                // Convertir a coordenadas del mundo para detectar la celda
                const globalPos = pixiEvent.data.global;
                const worldX = (globalPos.x - window.offsetX) / window.escala;
                const worldY = (globalPos.y - window.offsetY) / window.escala;

                // Usar función optimizada que solo busca en la calle actual
                const celdaObjetivo = encontrarCeldaEnCalle(calle, worldX, worldY);

                if (celdaObjetivo) {
                    const { carril, indice } = celdaObjetivo;
                    // El número de celda es el índice dentro del carril + 1 (para contar desde 1)
                    // Todos los carriles comparten la misma numeración de posiciones
                    const numeroCelda = indice + 1;
                    tooltip.textContent = `${calle.nombre} : ${numeroCelda}`;
                } else {
                    // Si no se encuentra celda, solo mostrar el nombre de la calle
                    tooltip.textContent = calle.nombre;
                }
            };

            // Mostrar tooltip inicial
            tooltip.textContent = calle.nombre;
            tooltip.style.display = 'block';

            // Guardar la función y el tipo de listener para poder removerlo después
            container._tooltipMoveHandler = updateTooltipPositionWithCell;
            container._tooltipListenerType = 'pixi'; // Marcar que es evento PixiJS

            // Agregar listener de movimiento del mouse al stage (eventos PixiJS)
            stage.on('pointermove', updateTooltipPositionWithCell);
        }
    }

    onCalleOut(calle, container) {
        container.alpha = 1.0;

        // Ocultar tooltip
        const tooltip = document.getElementById('canvasTooltip');
        if (tooltip) {
            tooltip.style.display = 'none';
        }

        // Remover listener según el tipo que se usó
        if (container._tooltipMoveHandler) {
            if (container._tooltipListenerType === 'dom') {
                // Remover listener DOM (método original)
                document.removeEventListener('mousemove', container._tooltipMoveHandler);
            } else if (container._tooltipListenerType === 'pixi') {
                // Remover listener PixiJS (método con detección de celdas)
                const stage = this.scene.app.stage;
                stage.off('pointermove', container._tooltipMoveHandler);
            }

            container._tooltipMoveHandler = null;
            container._tooltipListenerType = null;
        }
    }

    // ==================== MODO PINCEL PARA ESCENARIOS ====================

    /**
     * Pinta una celda en el modo de escenarios (bloqueo/inundación/obstáculo)
     * @param {Object} calle - Calle donde se encuentra la celda
     * @param {Object} event - Evento de puntero con coordenadas
     */
    paintCell(calle, event) {
        // Obtener coordenadas del mundo
        const globalPos = event.data.global;
        const worldX = (globalPos.x - window.offsetX) / window.escala;
        const worldY = (globalPos.y - window.offsetY) / window.escala;

        // Buscar la celda más cercana
        if (typeof window.encontrarCeldaMasCercana === 'function') {
            const celdaObjetivo = window.encontrarCeldaMasCercana(worldX, worldY);

            if (celdaObjetivo) {
                const { calle: calleObjetivo, carril, indice } = celdaObjetivo;

                const valorActual = calleObjetivo.arreglo[carril]?.[indice];
                const celdaKey = `${calleObjetivo.id}:${carril}:${indice}`;

                // Evitar repintar la misma celda repetidamente
                if (this.lastPaintedCell === celdaKey) {
                    return;
                }

                this.lastPaintedCell = celdaKey;

                // Aplicar la acción según el modo establecido
                if (this.paintMode === 'erase') {
                    // Modo BORRAR: solo desbloquear si está bloqueada
                    if (valorActual === 7) {
                        console.log('🔓 Desbloqueando celda:', celdaKey);
                        calleObjetivo.arreglo[carril][indice] = 0;
                        window.estadoEscenarios.celdasBloqueadas.delete(celdaKey);
                    } else {
                        // No hacer nada si ya está desbloqueada
                        return;
                    }
                } else if (this.paintMode === 'paint') {
                    // Modo PINTAR: solo bloquear si NO está bloqueada
                    if (valorActual !== 7) {
                        const tipoEscenario = window.estadoEscenarios.tipoEscenarioActivo || 'bloqueo';
                        console.log(`🔒 Bloqueando celda con ${tipoEscenario}:`, celdaKey);

                        calleObjetivo.arreglo[carril][indice] = 7;

                        // Guardar metadata del tipo de escenario
                        const metadata = { tipo: tipoEscenario };
                        if (tipoEscenario === 'obstaculo') {
                            metadata.texture = window.estadoEscenarios.emojiObstaculoSeleccionado || 'bache';
                        } else if (tipoEscenario === 'inundacion') {
                            metadata.texture = 'inundacion';
                        }

                        window.estadoEscenarios.celdasBloqueadas.set(celdaKey, metadata);
                    } else {
                        // No hacer nada si ya está bloqueada
                        return;
                    }
                }

                // Forzar actualización del CarroRenderer para renderizar el bloqueo inmediatamente
                if (this.scene && this.scene.carroRenderer && window.calles) {
                    this.scene.carroRenderer.updateAll(window.calles);

                    // Si la simulación está pausada, forzar render manual de PixiJS
                    if (window.isPaused && window.pixiApp && window.pixiApp.app) {
                        window.pixiApp.app.render();
                    }
                }
            }
        } else {
            console.error('❌ Función encontrarCeldaMasCercana no está disponible');
        }
    }

    // ==================== RENDERIZADO DE VÉRTICES PARA CURVAS ====================

    renderVertices(calle) {
        console.log(`🔍 renderVertices llamado para: ${calle.nombre}`);
        console.log(`   Tiene vértices: ${calle.vertices ? calle.vertices.length : 0}`);

        // Solo renderizar vértices si:
        // 1. La calle tiene vértices
        // 2. La calle está seleccionada
        // 3. Estamos en modo edición
        if (!calle.vertices || calle.vertices.length === 0) {
            console.log('   ❌ No tiene vértices, saliendo...');
            return;
        }

        const isSelected = window.calleSeleccionada === calle;
        const isEditMode = window.editorCalles && window.editorCalles.modoEdicion;

        console.log(`   isSelected: ${isSelected}, isEditMode: ${isEditMode}`);

        const shouldShow = isSelected && isEditMode;

        if (!shouldShow) {
            console.log('   ❌ No debería mostrar vértices, limpiando...');
            // Limpiar vértices existentes
            this.clearVertices(calle);
            return;
        }

        console.log(`   ✅ Debería mostrar vértices, procediendo...`);

        // Obtener o crear contenedor de vértices
        let verticesContainer = this.scene.verticeSprites.get(calle);

        if (!verticesContainer) {
            verticesContainer = new PIXI.Container();
            verticesContainer.name = 'verticesContainer';
            verticesContainer.sortableChildren = true; // Permitir ordenamiento por zIndex
            verticesContainer.eventMode = 'static'; // Habilitar eventos en PixiJS v7+
            verticesContainer.interactiveChildren = true; // Permitir interactividad en hijos
            this.scene.verticeSprites.set(calle, verticesContainer);
            this.scene.getLayer('ui').addChild(verticesContainer);
            console.log(`   📦 Contenedor de vértices creado con eventMode='static'`);
        }

        // Limpiar vértices anteriores
        verticesContainer.removeChildren();

        console.log(`   📍 Renderizando ${calle.vertices.length} vértices...`);

        // Renderizar cada vértice
        calle.vertices.forEach((vertice, index) => {
            const pos = window.calcularPosicionVertice
                ? window.calcularPosicionVertice(calle, vertice)
                : null;

            if (!pos) {
                console.log(`   ⚠️ No se pudo calcular posición para vértice ${index}`);
                return;
            }

            console.log(`   🔵 Vértice ${index} en (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})`);

            // Crear círculo para el vértice
            const graphics = new PIXI.Graphics();

            // Estilo según posición del vértice
            const isFirst = index === 0;
            const isLast = index === calle.vertices.length - 1;

            if (isFirst) {
                // Primer vértice: Verde (inicio de la calle) - AHORA EDITABLE
                graphics.beginFill(0x00FF88, 0.9);
                graphics.lineStyle(3, 0xFFFFFF);
            } else if (isLast) {
                // Último vértice: Rojo (final de la calle) - AHORA EDITABLE
                graphics.beginFill(0xFF5555, 0.9);
                graphics.lineStyle(3, 0xFFFFFF);
            } else {
                // Vértices intermedios: Amarillo (editables)
                graphics.beginFill(0xFFD700, 0.8);
                graphics.lineStyle(2, 0xFFFFFF);
            }

            // Todos los vértices tienen el mismo tamaño ahora (todos editables)
            const circleRadius = 8;
            graphics.drawCircle(0, 0, circleRadius);
            graphics.endFill();

            // IMPORTANTE: Área de hit más grande para facilitar el click (TODOS los vértices)
            graphics.filters = [];
            const hitArea = new PIXI.Circle(0, 0, 15); // Radio de 15 píxeles para hit area
            graphics.hitArea = hitArea;
            console.log(`      → Hit area establecida: radio 15px`);

            graphics.x = pos.x;
            graphics.y = pos.y;
            graphics.name = `vertice_${index}`;

            // IMPORTANTE: Asegurar que el vértice está por encima de todo
            graphics.zIndex = 1000 + index;

            // IMPORTANTE: Si estamos arrastrando CUALQUIER vértice de esta calle, hacer TODOS translúcidos
            if (this.draggingCalle === calle && this.draggingVertexIndex >= 0) {
                graphics.alpha = 0.3;
                console.log(`      → Vértice ${index} translúcido (arrastrando vértice ${this.draggingVertexIndex})`);
            }

            // TODOS los vértices ahora son editables (primero, último e intermedios)
            console.log(`      → Vértice ${index} es EDITABLE (${isFirst ? '🟢 INICIO' : isLast ? '🔴 FIN' : '🟡 INTERMEDIO'})`);

            // IMPORTANTE: En PixiJS v7+ necesitamos usar eventMode
            graphics.eventMode = 'static'; // Habilitar eventos
            graphics.cursor = 'pointer';

            // El cursor se cambiará dinámicamente según el modo de edición de vértices
            graphics.on('pointerover', () => {
                console.log(`      🖱️ Hover sobre vértice ${index}, modo activo: ${window.vertexEditMode}`);
                if (window.vertexEditMode) {
                    graphics.cursor = 'grab';
                } else {
                    graphics.cursor = 'pointer';
                }
            });

            graphics.on('pointerout', () => {
                graphics.cursor = 'pointer';
            });

            // Habilitar eventos de PixiJS para arrastre de vértices con Z + Click
            graphics.on('pointerdown', (e) => {
                console.log(`      🖱️ POINTERDOWN en vértice ${index}!`);
                this.onVerticePointerDown(calle, vertice, index, e);
            });

            console.log(`      ✅ Vértice ${index} renderizado con eventos PixiJS`);

            verticesContainer.addChild(graphics);
        });

        console.log(`   ✅ Todos los vértices renderizados (${calle.vertices.length} total)`);
    }

    clearVertices(calle) {
        const verticesContainer = this.scene.verticeSprites.get(calle);
        if (verticesContainer) {
            verticesContainer.destroy({ children: true });
            this.scene.verticeSprites.delete(calle);
        }
    }

    // ==================== EVENTOS DE VÉRTICES ====================

    onVerticePointerDown(calle, vertice, index, event) {
        console.log(`🔍 Click en vértice ${index}, modo edición activo: ${window.vertexEditMode}`);

        // Verificar que estamos en modo edición
        if (!window.editorCalles || !window.editorCalles.modoEdicion) {
            console.log('⚠️ Solo puedes editar vértices en modo edición');
            return;
        }

        // Solo permitir arrastre si el modo de edición de vértices está activo
        if (!window.vertexEditMode) {
            console.log('💡 Presiona la tecla Z para activar el modo de edición de vértices');
            return;
        }

        event.stopPropagation(); // Evitar que se active el click de la calle

        console.log(`🎯 Vértice ${index} capturado para arrastre (Z+Click)`);
        console.log(`   Calle: ${calle.nombre}`);
        console.log(`   Vértice actual anguloOffset: ${vertice.anguloOffset}°`);

        // Cambiar cursor a grabbing
        const canvas = this.scene.app.view;
        if (canvas) {
            canvas.classList.add('dragging-vertex');
            canvas.style.cursor = 'grabbing';
        }

        // Marcar este vértice como "siendo arrastrado" para hacerlo translúcido
        this.draggingVertexIndex = index;
        this.draggingCalle = calle;
        console.log(`   🎨 Vértice ${index} marcado para arrastre translúcido`);

        // Guardar estado inicial
        const dragData = {
            calle: calle,
            vertice: vertice,
            index: index,
            isDragging: true
        };

        console.log(`   dragData creado:`, dragData);

        // Activar modo curva si no está activo
        if (!calle.esCurva) {
            calle.esCurva = true;
            console.log(`🌊 Modo curva activado para ${calle.nombre}`);
        }

        // Re-renderizar vértices una vez para aplicar el efecto translúcido
        this.renderVertices(calle);

        // NUEVO: Crear círculo de influencia visual
        this.createInfluenceCircle(calle, vertice, index);

        // Función de arrastre
        const onPointerMove = (e) => {
            console.log(`🖱️ onPointerMove disparado, isDragging: ${dragData.isDragging}`);

            if (!dragData.isDragging) {
                console.log('   ❌ No está arrastrando, saliendo...');
                return;
            }

            // Obtener posición global del mouse
            const globalPos = e.data.global;
            console.log(`   Global pos: (${globalPos.x}, ${globalPos.y})`);

            // Convertir a coordenadas del mundo (sin transformaciones de cámara)
            const worldPos = this.scene.mainContainer.toLocal(globalPos);

            console.log(`📍 Mouse en mundo: (${worldPos.x.toFixed(2)}, ${worldPos.y.toFixed(2)})`);

            // Actualizar ángulo del vértice usando la función de curvas.js
            if (window.actualizarVerticePorArrastre) {
                console.log(`   Llamando actualizarVerticePorArrastre...`);
                const resultado = window.actualizarVerticePorArrastre(
                    dragData.calle,
                    dragData.index,
                    worldPos.x,
                    worldPos.y
                );

                console.log(`   Resultado: ${resultado}`);

                if (resultado) {
                    console.log(`✅ Ángulo actualizado: ${dragData.calle.vertices[dragData.index].anguloOffset.toFixed(2)}°`);

                    // Re-renderizar la calle y los vértices
                    if (this.scene.calleSprites.has(dragData.calle)) {
                        this.scene.calleSprites.get(dragData.calle).destroy({ children: true });
                        this.scene.calleSprites.delete(dragData.calle);
                    }

                    if (dragData.calle.esCurva) {
                        this.renderCalleCurva(dragData.calle);
                    } else {
                        this.renderCalleRecta(dragData.calle);
                    }

                    this.renderVertices(dragData.calle);

                    // NUEVO: Actualizar posición del círculo de influencia
                    this.updateInfluenceCircle(dragData.calle, dragData.vertice, dragData.index);
                } else {
                    console.warn('⚠️ No se pudo actualizar el ángulo del vértice');
                }
            } else {
                console.error('❌ window.actualizarVerticePorArrastre no está definido');
            }
        };

        // Función de soltar
        const onPointerUp = () => {
            dragData.isDragging = false;
            this.scene.app.stage.off('pointermove', onPointerMove);
            this.scene.app.stage.off('pointerup', onPointerUp);
            this.scene.app.stage.off('pointerupoutside', onPointerUp);

            // Desmarcar vértice arrastrado
            this.draggingVertexIndex = -1;
            this.draggingCalle = null;

            // NUEVO: Eliminar círculo de influencia
            this.clearInfluenceCircle();

            // Restaurar cursor
            const canvas = this.scene.app.view;
            if (canvas) {
                canvas.classList.remove('dragging-vertex');
                canvas.style.cursor = window.vertexEditMode ? 'crosshair' : '';
            }

            // Re-renderizar vértices para restaurar opacidad normal
            this.renderVertices(dragData.calle);

            console.log(`✅ Vértice ${index} soltado - Opacidad restaurada`);
        };

        // Registrar eventos globales
        this.scene.app.stage.on('pointermove', onPointerMove);
        this.scene.app.stage.on('pointerup', onPointerUp);
        this.scene.app.stage.on('pointerupoutside', onPointerUp);
    }

    // ==================== CÍRCULO DE INFLUENCIA VISUAL ====================

    createInfluenceCircle(calle, vertice, index) {
        // Limpiar círculo anterior si existe
        this.clearInfluenceCircle();

        // Calcular posición del vértice
        const pos = window.calcularPosicionVertice
            ? window.calcularPosicionVertice(calle, vertice)
            : null;

        if (!pos) {
            console.warn('⚠️ No se pudo calcular la posición del vértice para el círculo de influencia');
            return;
        }

        // Crear el círculo de influencia
        this.influenceCircle = new PIXI.Graphics();

        // Círculo exterior (área de influencia) - translúcido y pulsante
        this.influenceCircle.lineStyle(3, 0x00FFFF, 0.6); // Cian brillante
        this.influenceCircle.beginFill(0x00FFFF, 0.1); // Relleno muy translúcido
        this.influenceCircle.drawCircle(0, 0, 40); // Radio de 40 píxeles
        this.influenceCircle.endFill();

        // Círculo interior (indicador de centro)
        this.influenceCircle.lineStyle(2, 0xFFFFFF, 0.8);
        this.influenceCircle.drawCircle(0, 0, 5);

        // Cruz en el centro para mayor precisión
        this.influenceCircle.lineStyle(2, 0xFFFFFF, 0.8);
        this.influenceCircle.moveTo(-8, 0);
        this.influenceCircle.lineTo(8, 0);
        this.influenceCircle.moveTo(0, -8);
        this.influenceCircle.lineTo(0, 8);

        // Posicionar el círculo
        this.influenceCircle.x = pos.x;
        this.influenceCircle.y = pos.y;
        this.influenceCircle.zIndex = 2000; // Muy alto para estar encima de todo

        // Hacer que el vértice que se está arrastrando sea más grande y brillante
        const verticesContainer = this.scene.verticeSprites.get(calle);
        if (verticesContainer) {
            const vertexGraphic = verticesContainer.children[index];
            if (vertexGraphic) {
                vertexGraphic.scale.set(1.5); // 50% más grande
                vertexGraphic.alpha = 1.0; // Completamente opaco (los demás son translúcidos)
            }
        }

        // Agregar a la capa UI para que esté encima de todo
        const uiLayer = this.scene.getLayer('ui');
        uiLayer.addChild(this.influenceCircle);

        console.log(`✨ Círculo de influencia creado en vértice ${index} posición (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})`);
    }

    updateInfluenceCircle(calle, vertice, index) {
        if (!this.influenceCircle) return;

        // Calcular nueva posición del vértice
        const pos = window.calcularPosicionVertice
            ? window.calcularPosicionVertice(calle, vertice)
            : null;

        if (!pos) return;

        // Actualizar posición del círculo
        this.influenceCircle.x = pos.x;
        this.influenceCircle.y = pos.y;

        // Mantener el vértice arrastrado más grande y opaco
        const verticesContainer = this.scene.verticeSprites.get(calle);
        if (verticesContainer) {
            const vertexGraphic = verticesContainer.children[index];
            if (vertexGraphic) {
                vertexGraphic.scale.set(1.5);
                vertexGraphic.alpha = 1.0;
            }
        }
    }

    clearInfluenceCircle() {
        if (this.influenceCircle) {
            this.influenceCircle.destroy();
            this.influenceCircle = null;
            console.log('🧹 Círculo de influencia eliminado');
        }
    }
}

window.CalleRenderer = CalleRenderer;
console.log('✓ CalleRenderer cargado');
