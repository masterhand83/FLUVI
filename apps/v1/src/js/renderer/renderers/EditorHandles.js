/**
 * EditorHandles.js - Handles visuales de edición con PixiJS
 * Gestiona los handles de movimiento y rotación para el modo de edición
 */

class EditorHandles {
    constructor(sceneManager) {
        this.scene = sceneManager;
        this.moveHandle = null;
        this.rotateHandle = null;
        this.currentObject = null;
        this.objectType = null;

        this.isDraggingMove = false;
        this.isDraggingRotate = false;
        this.isDraggingVertice = false;
        this.isShiftDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragInitialX = undefined;
        this.dragInitialY = undefined;
        this.draggedVertice = null;
        this.draggedVerticeIndex = -1;
        this.draggedCalle = null;

        // Elementos visuales para rotación
        this.rotationLine = null; // Línea desde el centro hasta el handle
        this.rotationOrbit = null; // Círculo de órbita
        this.rotationAngleLabel = null; // Etiqueta con el ángulo

        // Exponer globalmente
        window.editorHandles = this;
    }

    createHandles(objeto, tipo) {
        this.clearHandles();
        this.currentObject = objeto;
        this.objectType = tipo;

        // Handle de movimiento (círculo azul)
        this.moveHandle = new PIXI.Graphics();
        this.moveHandle.beginFill(0x0099FF, 0.8);
        this.moveHandle.drawCircle(0, 0, 20);
        this.moveHandle.endFill();
        this.moveHandle.lineStyle(3, 0xFFFFFF);
        this.moveHandle.drawCircle(0, 0, 20);

        // PixiJS v7+ API
        this.moveHandle.eventMode = 'static';
        this.moveHandle.cursor = 'move';

        this.moveHandle.on('pointerdown', (e) => {
            e.stopPropagation();
            this.onMoveHandleDragStart(e);
        });

        // Handle de rotación (círculo verde)
        this.rotateHandle = new PIXI.Graphics();
        this.rotateHandle.beginFill(0x00FF00, 0.8);
        this.rotateHandle.drawCircle(0, 0, 20);
        this.rotateHandle.endFill();
        this.rotateHandle.lineStyle(3, 0xFFFFFF);
        this.rotateHandle.drawCircle(0, 0, 20);

        // PixiJS v7+ API
        this.rotateHandle.eventMode = 'static';
        this.rotateHandle.cursor = 'grab';

        this.rotateHandle.on('pointerdown', (e) => {
            e.stopPropagation();
            this.onRotateHandleDragStart(e);
        });

        // Agregar a capa UI
        const uiLayer = this.scene.getLayer('ui');
        uiLayer.addChild(this.moveHandle);
        uiLayer.addChild(this.rotateHandle);

        // Posicionar handles
        this.updateHandlePositions();

        // Setup eventos globales de arrastre
        this.setupGlobalDragEvents();

        // Habilitar arrastre con SHIFT+Click
        this.enableShiftDrag();
    }

    setupGlobalDragEvents() {
        const stage = this.scene.app.stage;
        const view = this.scene.app.view;

        // Ya está configurado en SceneManager como eventMode = 'static'
        // Asegurarse de que el stage capture eventos en toda el área del canvas
        stage.hitArea = new PIXI.Rectangle(0, 0, this.scene.app.screen.width, this.scene.app.screen.height);

        // Eventos de PixiJS para handles visuales
        stage.on('pointermove', (e) => {
            if (this.isDraggingMove) {
                this.onMoveHandleDrag(e);
            } else if (this.isDraggingRotate) {
                this.onRotateHandleDrag(e);
            } else if (this.isDraggingVertice) {
                this.onVerticeDrag(e);
            }
        });

        stage.on('pointerup', () => {
            // Si finalizamos un arrastre
            if (this.isDraggingMove || this.isDraggingRotate) {
                // Actualizar inputs de UI ahora que terminó el drag
                if (window.editorCalles) {
                    window.editorCalles.actualizarInputsPosicion();
                }

                // NUEVO: Restaurar opacidad normal de vértices
                if (this.objectType === 'calle' && this.currentObject && this.currentObject.vertices) {
                    this.setVerticesTranslucency(false);
                }

                // Si es una calle, recalcular intersecciones
                if (this.currentObject && this.objectType === 'calle') {
                    console.log('✅ Arrastre finalizado:', this.currentObject.nombre,
                                `Nueva posición: (${Math.round(this.currentObject.x)}, ${Math.round(this.currentObject.y)})`);

                    // Recalcular intersecciones después de mover la calle
                    if (window.inicializarIntersecciones) {
                        window.inicializarIntersecciones();
                    }
                    if (window.construirMapaIntersecciones) {
                        window.construirMapaIntersecciones();
                    }
                }
            }

            // NUEVO: Limpiar elementos visuales de rotación si se estaba rotando
            if (this.isDraggingRotate) {
                this.clearRotationVisuals();
            }

            this.isDraggingMove = false;
            this.isDraggingRotate = false;
            this.isDraggingVertice = false;
            this.draggedVertice = null;
            this.draggedVerticeIndex = -1;
            this.draggedCalle = null;
            this.dragInitialX = undefined;
            this.dragInitialY = undefined;

            if (this.rotateHandle) {
                this.rotateHandle.cursor = 'grab';
            }

            // Restablecer cursor
            if (view) {
                view.style.cursor = 'default';
            }
        });

        // Eventos nativos para SHIFT+Click
        this.nativeMouseMoveHandler = (e) => {
            if (this.isDraggingMove && this.isShiftDragging) {
                this.onMoveHandleDrag(e);
            }
        };

        this.nativeMouseUpHandler = () => {
            if (this.isDraggingMove && this.isShiftDragging) {
                // Actualizar inputs de UI ahora que terminó el drag
                if (window.editorCalles) {
                    window.editorCalles.actualizarInputsPosicion();
                }

                // NUEVO: Restaurar opacidad normal de vértices
                if (this.objectType === 'calle' && this.currentObject && this.currentObject.vertices) {
                    this.setVerticesTranslucency(false);
                }

                // Finalizar arrastre SHIFT+Click
                if (this.currentObject && this.objectType === 'calle') {
                    console.log('✅ Arrastre de calle finalizado (SHIFT+Click):', this.currentObject.nombre,
                                `Nueva posición: (${Math.round(this.currentObject.x)}, ${Math.round(this.currentObject.y)})`);

                    // Recalcular intersecciones
                    if (window.inicializarIntersecciones) {
                        window.inicializarIntersecciones();
                    }
                    if (window.construirMapaIntersecciones) {
                        window.construirMapaIntersecciones();
                    }
                }

                this.isDraggingMove = false;
                this.isShiftDragging = false;
                this.dragInitialX = undefined;
                this.dragInitialY = undefined;

                if (view) {
                    view.style.cursor = 'default';
                }
            }
        };

        document.addEventListener('mousemove', this.nativeMouseMoveHandler);
        document.addEventListener('mouseup', this.nativeMouseUpHandler);
    }

    // Habilitar arrastre con SHIFT+Click directamente en objetos
    enableShiftDrag() {
        if (!this.currentObject) return;

        const view = this.scene.app.view;

        // Crear handler para SHIFT+mousedown
        this.shiftMouseDownHandler = (e) => {
            if (!e.shiftKey || !window.editorCalles || !window.editorCalles.modoEdicion) return;
            if (!this.currentObject) return;

            // Obtener posición del mouse en coordenadas del mundo
            const rect = view.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const camera = window.pixiApp.cameraController;
            const worldPos = camera.screenToWorld(mouseX, mouseY);

            // Usar hit detection geométrico correcto según el tipo de objeto
            let isHit = false;

            if (this.objectType === 'calle') {
                const calle = this.currentObject;
                const celda_tamano = window.celda_tamano || 5;

                // Si la calle tiene curvas, verificar por celdas
                if (calle.esCurva && calle.vertices && calle.vertices.length > 0 && window.obtenerCoordenadasGlobalesCeldaConCurva) {
                    for (let carril = 0; carril < calle.carriles && !isHit; carril++) {
                        for (let indice = 0; indice < calle.tamano && !isHit; indice++) {
                            const coords = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, carril, indice);
                            const dx = worldPos.x - coords.x;
                            const dy = worldPos.y - coords.y;
                            const distancia = Math.sqrt(dx * dx + dy * dy);

                            if (distancia < celda_tamano) {
                                isHit = true;
                            }
                        }
                    }
                } else {
                    // Para calles rectas, usar transformación geométrica
                    const angle = -calle.angulo * Math.PI / 180;
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);

                    const dx = worldPos.x - calle.x;
                    const dy = worldPos.y - calle.y;
                    const localX = dx * cos + dy * sin;
                    const localY = -dx * sin + dy * cos;

                    const width = calle.tamano * celda_tamano;
                    const height = calle.carriles * celda_tamano;

                    if (localX >= 0 && localX <= width && localY >= 0 && localY <= height) {
                        isHit = true;
                    }
                }
            } else {
                // Es un edificio
                const edificio = this.currentObject;
                const angle = -(edificio.angle || 0) * Math.PI / 180;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);

                const dx = worldPos.x - edificio.x;
                const dy = worldPos.y - edificio.y;
                const localX = dx * cos + dy * sin;
                const localY = -dx * sin + dy * cos;

                const halfWidth = edificio.width / 2;
                const halfHeight = edificio.height / 2;

                if (localX >= -halfWidth && localX <= halfWidth &&
                    localY >= -halfHeight && localY <= halfHeight) {
                    isHit = true;
                }
            }

            if (isHit) {
                e.preventDefault();
                this.isDraggingMove = true;
                this.isShiftDragging = true;
                this.dragStartX = e.clientX;
                this.dragStartY = e.clientY;
                this.dragInitialX = this.currentObject.x;
                this.dragInitialY = this.currentObject.y;
                view.style.cursor = 'move';

                // NUEVO: Si es una calle, hacer vértices translúcidos
                if (this.objectType === 'calle' && this.currentObject.vertices) {
                    this.setVerticesTranslucency(true);
                }

                console.log('🖱️ Iniciando arrastre con SHIFT+Click');
            }
        };

        view.addEventListener('mousedown', this.shiftMouseDownHandler);
    }

    // Limpiar evento de SHIFT cuando se limpia
    disableShiftDrag() {
        if (this.shiftMouseDownHandler && this.scene.app.view) {
            this.scene.app.view.removeEventListener('mousedown', this.shiftMouseDownHandler);
            this.shiftMouseDownHandler = null;
        }

        if (this.nativeMouseMoveHandler) {
            document.removeEventListener('mousemove', this.nativeMouseMoveHandler);
            this.nativeMouseMoveHandler = null;
        }

        if (this.nativeMouseUpHandler) {
            document.removeEventListener('mouseup', this.nativeMouseUpHandler);
            this.nativeMouseUpHandler = null;
        }
    }

    updateHandlePositions() {
        if (!this.currentObject) return;

        const celda_tamano = window.celda_tamano || 5;
        const handleRadius = 20; // Radio del handle en píxeles mundo
        const offsetMinimo = 30; // Distancia mínima del handle al borde del objeto

        // Calcular centro del objeto y dimensiones
        let centroX, centroY, rotX, rotY;
        let objectWidth, objectHeight;

        if (this.objectType === 'calle') {
            const calle = this.currentObject;

            if (calle.esCurva && window.calcularCentroCalleCurva) {
                const centro = window.calcularCentroCalleCurva(calle);
                centroX = centro.x;
                centroY = centro.y;

                // Para calles curvas, estimar dimensiones aproximadas
                objectWidth = calle.tamano * celda_tamano;
                objectHeight = calle.carriles * celda_tamano;

                if (window.calcularPuntoFinalCalleCurva) {
                    const puntoFinal = window.calcularPuntoFinalCalleCurva(calle);
                    rotX = puntoFinal.x;
                    rotY = puntoFinal.y;
                } else {
                    rotX = centroX + 50;
                    rotY = centroY;
                }
            } else {
                const angle = -calle.angulo * Math.PI / 180;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);

                objectWidth = calle.tamano * celda_tamano;
                objectHeight = calle.carriles * celda_tamano;

                const centerLocalX = objectWidth / 2;
                const centerLocalY = objectHeight / 2;

                centroX = calle.x + (centerLocalX * cos - centerLocalY * sin);
                centroY = calle.y + (centerLocalX * sin + centerLocalY * cos);

                const rotOffsetLocalX = objectWidth;
                rotX = calle.x + (rotOffsetLocalX * cos);
                rotY = calle.y + (rotOffsetLocalX * sin);
            }
        } else {
            // Es un edificio
            const edificio = this.currentObject;
            objectWidth = edificio.width || 100;
            objectHeight = edificio.height || 100;

            // Para edificios, (x, y) YA ES el centro debido al pivot/anchor
            centroX = edificio.x;
            centroY = edificio.y;

            const angle = (edificio.angle || 0) * Math.PI / 180;
            const offsetX = objectWidth / 2 * Math.cos(angle);
            const offsetY = objectWidth / 2 * Math.sin(angle);

            rotX = edificio.x + offsetX;
            rotY = edificio.y + offsetY;
        }

        // NUEVA LÓGICA: Determinar si el objeto es pequeño y ajustar handles para que estén fuera
        const objetoPequeno = objectWidth < 80 || objectHeight < 80;

        if (objetoPequeno) {
            // Para objetos pequeños, colocar handles fuera del objeto
            if (this.objectType === 'calle') {
                const calle = this.currentObject;
                const angle = -calle.angulo * Math.PI / 180;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);

                // Handle de movimiento: arriba del objeto (perpendicular)
                const moveOffsetDistance = objectHeight / 2 + offsetMinimo;
                centroX = calle.x + (objectWidth / 2 * cos - moveOffsetDistance * sin);
                centroY = calle.y + (objectWidth / 2 * sin + moveOffsetDistance * cos);

                // Handle de rotación: a la derecha del objeto
                const rotOffsetDistance = objectWidth + offsetMinimo;
                rotX = calle.x + (rotOffsetDistance * cos);
                rotY = calle.y + (rotOffsetDistance * sin);

            } else {
                // Edificio pequeño
                const edificio = this.currentObject;
                const angle = (edificio.angle || 0) * Math.PI / 180;

                // Handle de movimiento: arriba del edificio
                // Como edificio.x y edificio.y YA SON el centro, no sumamos objectWidth/2
                const moveOffsetDistance = objectHeight / 2 + offsetMinimo;
                centroX = edificio.x - moveOffsetDistance * Math.sin(angle);
                centroY = edificio.y + moveOffsetDistance * Math.cos(angle);

                // Handle de rotación: a la derecha del edificio
                const rotOffsetDistance = objectWidth / 2 + offsetMinimo;
                rotX = edificio.x + rotOffsetDistance * Math.cos(angle);
                rotY = edificio.y + rotOffsetDistance * Math.sin(angle);
            }
        }

        // Posicionar handles
        if (this.moveHandle) {
            this.moveHandle.x = centroX;
            this.moveHandle.y = centroY;
            this.moveHandle.zIndex = 100;
        }

        if (this.rotateHandle) {
            this.rotateHandle.x = rotX;
            this.rotateHandle.y = rotY;
            this.rotateHandle.zIndex = 100;
        }
    }

    onMoveHandleDragStart(event) {
        this.isDraggingMove = true;
        const pos = event.data.global;
        this.dragStartX = pos.x;
        this.dragStartY = pos.y;

        // Cambiar cursor del canvas completo
        if (this.scene.app.view) {
            this.scene.app.view.style.cursor = 'move';
        }

        // NUEVO: Si es una calle, hacer vértices translúcidos
        if (this.objectType === 'calle' && this.currentObject.vertices) {
            this.setVerticesTranslucency(true);
        }

        // NO guardar posición inicial para usar movimiento incremental (más fluido)
        console.log('🖱️ Iniciando arrastre de movimiento (handle PixiJS)');
    }

    onMoveHandleDrag(event) {
        if (!this.currentObject) return;

        const camera = window.pixiApp.cameraController;

        // Detectar si es evento de PixiJS o evento nativo del mouse
        let currentX, currentY;

        if (this.isShiftDragging && event.clientX !== undefined) {
            // Evento nativo del mouse (SHIFT+Click)
            currentX = event.clientX;
            currentY = event.clientY;

            // Para SHIFT+Click, usar posición inicial y delta total
            const deltaX = (currentX - this.dragStartX) / camera.scale;
            const deltaY = (currentY - this.dragStartY) / camera.scale;

            this.currentObject.x = this.dragInitialX + deltaX;
            this.currentObject.y = this.dragInitialY + deltaY;
        } else if (event.data && event.data.global) {
            // Evento de PixiJS (handles visuales)
            const pos = event.data.global;
            currentX = pos.x;
            currentY = pos.y;

            // Para handles visuales, usar delta incremental
            const deltaX = (currentX - this.dragStartX) / camera.scale;
            const deltaY = (currentY - this.dragStartY) / camera.scale;

            this.currentObject.x += deltaX;
            this.currentObject.y += deltaY;

            this.dragStartX = currentX;
            this.dragStartY = currentY;
        } else {
            return;
        }

        // Actualizar posiciones de handles
        this.updateHandlePositions();

        // OPTIMIZADO: Actualizar sprite del objeto
        if (this.objectType === 'calle') {
            const calle = this.currentObject;

            // Para calles curvas, re-renderizar completamente para mejor precisión visual
            if (calle.esCurva && calle.vertices && calle.vertices.length > 0) {
                // Destruir solo el sprite de la calle, NO los vértices
                const container = this.scene.calleSprites.get(calle);
                if (container) {
                    container.destroy({ children: true });
                    this.scene.calleSprites.delete(calle);
                }

                // Re-renderizar solo la calle curva (sin tocar vértices para evitar conflictos)
                if (this.scene.calleRenderer) {
                    this.scene.calleRenderer.renderCalleCurva(calle);
                    // NO re-renderizar vértices aquí - mantenerlos translúcidos y con el círculo de influencia
                }

                // Actualizar posiciones de vértices manualmente
                const verticesContainer = this.scene.verticeSprites.get(calle);
                if (verticesContainer) {
                    calle.vertices.forEach((vertice, index) => {
                        const pos = window.calcularPosicionVertice
                            ? window.calcularPosicionVertice(calle, vertice)
                            : null;

                        if (pos && verticesContainer.children[index]) {
                            verticesContainer.children[index].x = pos.x;
                            verticesContainer.children[index].y = pos.y;
                        }
                    });
                }
            } else {
                // Para calles rectas, solo actualizar posición (más rápido)
                const container = this.scene.calleSprites.get(calle);
                if (container) {
                    container.x = calle.x;
                    container.y = calle.y;
                }

                // Actualizar vértices si existen (calles rectas con vértices preparados para curvas)
                if (calle.vertices && calle.vertices.length > 0) {
                    const verticesContainer = this.scene.verticeSprites.get(calle);
                    if (verticesContainer) {
                        calle.vertices.forEach((vertice, index) => {
                            const pos = window.calcularPosicionVertice
                                ? window.calcularPosicionVertice(calle, vertice)
                                : null;

                            if (pos && verticesContainer.children[index]) {
                                verticesContainer.children[index].x = pos.x;
                                verticesContainer.children[index].y = pos.y;
                            }
                        });
                    }
                }
            }
        } else {
            // Para edificios, solo actualizar posición
            const sprite = this.scene.edificioSprites.get(this.currentObject);
            if (sprite) {
                sprite.x = this.currentObject.x;
                sprite.y = this.currentObject.y;
            }
        }

        // Actualizar inputs de UI en tiempo real durante el drag
        if (window.editorCalles) {
            try {
                window.editorCalles.actualizarInputsPosicion();
            } catch (error) {
                // Ignorar errores de actualización de UI durante el arrastre
                console.warn('Error actualizando inputs durante arrastre:', error);
            }
        }
    }

    onRotateHandleDragStart(event) {
        this.isDraggingRotate = true;
        this.rotateHandle.cursor = 'grabbing';

        // Cambiar cursor del canvas completo
        if (this.scene.app.view) {
            this.scene.app.view.style.cursor = 'grabbing';
        }

        // NUEVO: Si es una calle, hacer vértices translúcidos
        if (this.objectType === 'calle' && this.currentObject.vertices) {
            this.setVerticesTranslucency(true);
        }

        const pos = event.data.global;
        const camera = window.pixiApp.cameraController;
        const worldPos = camera.screenToWorld(pos.x, pos.y);

        // Calcular ángulo inicial
        const celda_tamano = window.celda_tamano || 5;
        let centroX, centroY;

        if (this.objectType === 'calle') {
            const calle = this.currentObject;
            const angle = -calle.angulo * Math.PI / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const centerLocalX = (calle.tamano * celda_tamano) / 2;
            const centerLocalY = (calle.carriles * celda_tamano) / 2;

            centroX = calle.x + (centerLocalX * cos - centerLocalY * sin);
            centroY = calle.y + (centerLocalX * sin + centerLocalY * cos);
        } else {
            // Para edificios, (x, y) YA ES el centro debido al pivot/anchor
            centroX = this.currentObject.x;
            centroY = this.currentObject.y;
        }

        this.rotationStartAngle = Math.atan2(
            worldPos.y - centroY,
            worldPos.x - centroX
        );

        // NUEVO: Crear elementos visuales de rotación
        this.createRotationVisuals(centroX, centroY);

        console.log('🔄 Iniciando rotación');
    }

    onRotateHandleDrag(event) {
        if (!this.currentObject) return;

        const pos = event.data.global;
        const camera = window.pixiApp.cameraController;
        const worldPos = camera.screenToWorld(pos.x, pos.y);

        const celda_tamano = window.celda_tamano || 5;
        let centroX, centroY;

        if (this.objectType === 'calle') {
            const calle = this.currentObject;
            const angle = -calle.angulo * Math.PI / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const centerLocalX = (calle.tamano * celda_tamano) / 2;
            const centerLocalY = (calle.carriles * celda_tamano) / 2;

            centroX = calle.x + (centerLocalX * cos - centerLocalY * sin);
            centroY = calle.y + (centerLocalX * sin + centerLocalY * cos);
        } else {
            // Para edificios, (x, y) YA ES el centro debido al pivot/anchor
            centroX = this.currentObject.x;
            centroY = this.currentObject.y;
        }

        const currentAngle = Math.atan2(
            worldPos.y - centroY,
            worldPos.x - centroX
        );

        const deltaAngle = (currentAngle - this.rotationStartAngle) * 180 / Math.PI;

        // Factor de sensibilidad para rotación (0.5 = 50% de la velocidad original)
        // Valores más bajos = rotación más lenta y controlada
        const rotationSensitivity = 0.5;
        const adjustedDeltaAngle = deltaAngle * rotationSensitivity;

        if (this.objectType === 'calle') {
            this.currentObject.angulo = (this.currentObject.angulo + adjustedDeltaAngle) % 360;
            if (this.currentObject.angulo < 0) {
                this.currentObject.angulo += 360;
            }
        } else {
            if (!this.currentObject.angle) this.currentObject.angle = 0;
            this.currentObject.angle = (this.currentObject.angle + adjustedDeltaAngle) % 360;
            if (this.currentObject.angle < 0) {
                this.currentObject.angle += 360;
            }
        }

        this.rotationStartAngle = currentAngle;

        // OPTIMIZADO: Para calles, re-renderizar completamente para actualización instantánea
        // Durante el modo edición, la simulación está en pausa, así que no importa el rendimiento
        if (this.objectType === 'calle') {
            const calle = this.currentObject;

            // Destruir solo el sprite de la calle, NO los vértices
            const container = this.scene.calleSprites.get(calle);
            if (container) {
                container.destroy({ children: true });
                this.scene.calleSprites.delete(calle);
            }

            // Re-renderizar la calle con el nuevo ángulo
            if (this.scene.calleRenderer) {
                if (calle.esCurva) {
                    this.scene.calleRenderer.renderCalleCurva(calle);
                } else {
                    this.scene.calleRenderer.renderCalleRecta(calle);
                }

                // NO re-renderizar vértices aquí - mantenerlos translúcidos
            }

            // Actualizar posiciones de vértices manualmente si existen
            if (calle.vertices && calle.vertices.length > 0) {
                const verticesContainer = this.scene.verticeSprites.get(calle);
                if (verticesContainer) {
                    calle.vertices.forEach((vertice, index) => {
                        const pos = window.calcularPosicionVertice
                            ? window.calcularPosicionVertice(calle, vertice)
                            : null;

                        if (pos && verticesContainer.children[index]) {
                            verticesContainer.children[index].x = pos.x;
                            verticesContainer.children[index].y = pos.y;
                        }
                    });
                }
            }
        } else {
            // Para edificios, solo actualizar rotación (más rápido)
            const sprite = this.scene.edificioSprites.get(this.currentObject);
            if (sprite) {
                sprite.rotation = CoordinateConverter.degreesToRadians(this.currentObject.angle || 0);
            }
        }

        // Actualizar posiciones de handles
        this.updateHandlePositions();

        // NUEVO: Actualizar elementos visuales de rotación
        this.updateRotationVisuals(centroX, centroY);

        // Actualizar inputs de UI en tiempo real durante el drag
        if (window.editorCalles) {
            try {
                window.editorCalles.actualizarInputsPosicion();
            } catch (error) {
                // Ignorar errores de actualización de UI durante la rotación
                console.warn('Error actualizando inputs durante rotación:', error);
            }
        }
    }

    // Manejo de arrastre de vértices
    onVerticeMouseDown(calle, vertice, index, event) {
        this.isDraggingVertice = true;
        this.draggedVertice = vertice;
        this.draggedVerticeIndex = index;
        this.draggedCalle = calle;

        console.log(`🖱️ Iniciando arrastre de vértice ${index}`);
    }

    onVerticeDrag(event) {
        if (!this.draggedVertice || !this.draggedCalle || this.draggedVerticeIndex < 0) return;

        const camera = window.pixiApp.cameraController;
        const pos = event.data.global;
        const worldPos = camera.screenToWorld(pos.x, pos.y);

        // Actualizar ángulo del vértice usando la función de curvas.js
        if (window.actualizarVerticePorArrastre) {
            const actualizado = window.actualizarVerticePorArrastre(
                this.draggedCalle,
                this.draggedVerticeIndex,
                worldPos.x,
                worldPos.y
            );

            if (actualizado) {
                // Re-renderizar la calle curva
                if (window.pixiApp.sceneManager.calleRenderer) {
                    window.pixiApp.sceneManager.calleRenderer.updateCalleCurvaSprite(this.draggedCalle);
                }

                // Re-renderizar vértices
                if (window.mostrarConexiones) {
                    window.pixiApp.sceneManager.renderVertices();
                }
            }
        }
    }

    // Función para hacer todos los vértices translúcidos o restaurar opacidad normal
    setVerticesTranslucency(translucent) {
        if (!this.currentObject || !this.currentObject.vertices) return;

        const calle = this.currentObject;
        const verticesContainer = this.scene.verticeSprites.get(calle);

        if (!verticesContainer) {
            console.log('⚠️ No se encontró contenedor de vértices para la calle');
            return;
        }

        const targetAlpha = translucent ? 0.3 : 1.0;

        // Iterar sobre todos los vértices y cambiar su opacidad
        verticesContainer.children.forEach((vertexGraphic, index) => {
            vertexGraphic.alpha = targetAlpha;
        });

        console.log(`🎨 Vértices de ${calle.nombre} ${translucent ? 'translúcidos' : 'restaurados'} (alpha: ${targetAlpha})`);
    }

    // ==================== ELEMENTOS VISUALES DE ROTACIÓN ====================

    createRotationVisuals(centroX, centroY) {
        // Limpiar elementos previos
        this.clearRotationVisuals();

        const uiLayer = this.scene.getLayer('ui');

        // 1. Círculo de órbita (muestra el rango de rotación)
        this.rotationOrbit = new PIXI.Graphics();

        // Calcular radio desde el centro hasta el handle
        const dx = this.rotateHandle.x - centroX;
        const dy = this.rotateHandle.y - centroY;
        const radius = Math.sqrt(dx * dx + dy * dy);

        // Dibujar círculo de órbita
        this.rotationOrbit.lineStyle(2, 0xFF00FF, 0.4); // Magenta translúcido
        this.rotationOrbit.drawCircle(centroX, centroY, radius);

        // Agregar círculo más pequeño en el centro
        this.rotationOrbit.lineStyle(2, 0xFFFFFF, 0.6);
        this.rotationOrbit.beginFill(0xFFFFFF, 0.3);
        this.rotationOrbit.drawCircle(centroX, centroY, 8);
        this.rotationOrbit.endFill();

        this.rotationOrbit.zIndex = 1999;
        uiLayer.addChild(this.rotationOrbit);

        // 2. Línea desde el centro hasta el handle
        this.rotationLine = new PIXI.Graphics();
        this.rotationLine.lineStyle(3, 0x00FF00, 0.8); // Verde brillante
        this.rotationLine.moveTo(centroX, centroY);
        this.rotationLine.lineTo(this.rotateHandle.x, this.rotateHandle.y);
        this.rotationLine.zIndex = 2001;
        uiLayer.addChild(this.rotationLine);

        // 3. Etiqueta con el ángulo
        const currentAngle = this.objectType === 'calle'
            ? this.currentObject.angulo
            : (this.currentObject.angle || 0);

        this.rotationAngleLabel = new PIXI.Text(`${Math.round(currentAngle)}°`, {
            fontFamily: 'Arial',
            fontSize: 20,
            fontWeight: 'bold',
            fill: 0xFFFFFF,
            stroke: 0x000000,
            strokeThickness: 4,
            dropShadow: true,
            dropShadowColor: 0x000000,
            dropShadowBlur: 4,
            dropShadowDistance: 2
        });

        // Posicionar la etiqueta cerca del handle
        this.rotationAngleLabel.x = this.rotateHandle.x + 30;
        this.rotationAngleLabel.y = this.rotateHandle.y - 30;
        this.rotationAngleLabel.anchor.set(0.5);
        this.rotationAngleLabel.zIndex = 2002;
        uiLayer.addChild(this.rotationAngleLabel);

        // 4. Hacer el handle más grande durante el arrastre
        this.rotateHandle.scale.set(1.3);

        console.log('✨ Elementos visuales de rotación creados');
    }

    updateRotationVisuals(centroX, centroY) {
        if (!this.rotationLine || !this.rotationAngleLabel) return;

        // Actualizar línea
        this.rotationLine.clear();
        this.rotationLine.lineStyle(3, 0x00FF00, 0.8);
        this.rotationLine.moveTo(centroX, centroY);
        this.rotationLine.lineTo(this.rotateHandle.x, this.rotateHandle.y);

        // Actualizar ángulo en la etiqueta
        const currentAngle = this.objectType === 'calle'
            ? this.currentObject.angulo
            : (this.currentObject.angle || 0);

        this.rotationAngleLabel.text = `${Math.round(currentAngle)}°`;
        this.rotationAngleLabel.x = this.rotateHandle.x + 30;
        this.rotationAngleLabel.y = this.rotateHandle.y - 30;
    }

    clearRotationVisuals() {
        if (this.rotationLine) {
            this.rotationLine.destroy();
            this.rotationLine = null;
        }

        if (this.rotationOrbit) {
            this.rotationOrbit.destroy();
            this.rotationOrbit = null;
        }

        if (this.rotationAngleLabel) {
            this.rotationAngleLabel.destroy();
            this.rotationAngleLabel = null;
        }

        // Restaurar tamaño normal del handle
        if (this.rotateHandle) {
            this.rotateHandle.scale.set(1.0);
        }

        console.log('🧹 Elementos visuales de rotación eliminados');
    }

    clearHandles() {
        if (this.moveHandle) {
            this.moveHandle.destroy();
            this.moveHandle = null;
        }

        if (this.rotateHandle) {
            this.rotateHandle.destroy();
            this.rotateHandle = null;
        }

        // Limpiar elementos visuales de rotación
        this.clearRotationVisuals();

        // Limpiar SHIFT+Click handler
        this.disableShiftDrag();

        this.currentObject = null;
        this.objectType = null;
        this.isDraggingMove = false;
        this.isDraggingRotate = false;
    }
}

window.EditorHandles = EditorHandles;
console.log('✓ EditorHandles cargado');
