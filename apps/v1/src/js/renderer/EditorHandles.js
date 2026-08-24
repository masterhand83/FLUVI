/**
 * EditorHandles.js - Handles visuales de edición con PixiJS
 * Maneja los handles de movimiento y rotación para objetos seleccionados
 */

class EditorHandles {
    constructor(sceneManager) {
        this.scene = sceneManager;
        this.moveHandle = null;
        this.rotateHandle = null;
        this.currentObject = null;
        this.currentType = null; // 'calle' o 'edificio'

        this.isDraggingMove = false;
        this.isDraggingRotate = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.rotationStartAngle = 0;

        console.log('🎮 EditorHandles creado');
    }

    /**
     * Crea los handles para un objeto específico
     * @param {Object} objeto - Objeto a editar (calle o edificio)
     * @param {string} tipo - Tipo de objeto ('calle' o 'edificio')
     */
    createHandles(objeto, tipo) {
        this.clearHandles();
        this.currentObject = objeto;
        this.currentType = tipo;

        // Handle de movimiento (círculo azul)
        this.moveHandle = new PIXI.Graphics();
        this.moveHandle.beginFill(0x0099FF, 0.9);
        this.moveHandle.drawCircle(0, 0, 20);
        this.moveHandle.endFill();
        this.moveHandle.lineStyle(3, 0xFFFFFF);
        this.moveHandle.drawCircle(0, 0, 20);

        // Agregar icono de movimiento
        this.moveHandle.lineStyle(2, 0xFFFFFF);
        this.moveHandle.moveTo(-8, 0);
        this.moveHandle.lineTo(8, 0);
        this.moveHandle.moveTo(0, -8);
        this.moveHandle.lineTo(0, 8);

        // PixiJS v7+ API
        this.moveHandle.eventMode = 'static';
        this.moveHandle.cursor = 'move';

        this.moveHandle.on('pointerdown', (e) => {
            e.stopPropagation();
            this.onMoveHandleDragStart(e);
        });

        // Handle de rotación (círculo verde)
        this.rotateHandle = new PIXI.Graphics();
        this.rotateHandle.beginFill(0x00FF00, 0.9);
        this.rotateHandle.drawCircle(0, 0, 20);
        this.rotateHandle.endFill();
        this.rotateHandle.lineStyle(3, 0xFFFFFF);
        this.rotateHandle.drawCircle(0, 0, 20);

        // Agregar icono de rotación (flecha circular)
        this.rotateHandle.lineStyle(2, 0xFFFFFF);
        this.rotateHandle.arc(0, 0, 10, -Math.PI / 2, Math.PI, false);
        this.rotateHandle.moveTo(0, -10);
        this.rotateHandle.lineTo(-3, -7);
        this.rotateHandle.moveTo(0, -10);
        this.rotateHandle.lineTo(3, -7);

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

        console.log(`✅ Handles creados para ${tipo}: ${objeto.nombre || 'Sin nombre'}`);
    }

    setupGlobalDragEvents() {
        const stage = this.scene.app.stage;

        // Ya está configurado en SceneManager como eventMode = 'static'

        const onPointerMove = (e) => {
            if (this.isDraggingMove) {
                this.onMoveHandleDrag(e);
            } else if (this.isDraggingRotate) {
                this.onRotateHandleDrag(e);
            }
        };

        const onPointerUp = () => {
            if (this.isDraggingMove || this.isDraggingRotate) {
                console.log('🔓 Arrastre finalizado');
            }

            this.isDraggingMove = false;
            this.isDraggingRotate = false;

            if (this.rotateHandle) {
                this.rotateHandle.cursor = 'grab';
            }

            if (this.moveHandle) {
                this.moveHandle.cursor = 'move';
            }
        };

        // Remover listeners anteriores si existen
        stage.off('pointermove', onPointerMove);
        stage.off('pointerup', onPointerUp);
        stage.off('pointerupoutside', onPointerUp);

        // Agregar nuevos listeners
        stage.on('pointermove', onPointerMove);
        stage.on('pointerup', onPointerUp);
        stage.on('pointerupoutside', onPointerUp);
    }

    updateHandlePositions() {
        if (!this.currentObject) return;

        const celda_tamano = window.celda_tamano || 5;
        let centroX, centroY, rotX, rotY;

        if (this.currentType === 'calle') {
            const calle = this.currentObject;

            if (calle.esCurva && window.calcularCentroCalleCurva) {
                const centro = window.calcularCentroCalleCurva(calle);
                centroX = centro.x;
                centroY = centro.y;

                if (window.calcularPuntoFinalCalleCurva) {
                    const puntoFinal = window.calcularPuntoFinalCalleCurva(calle);
                    rotX = puntoFinal.x;
                    rotY = puntoFinal.y;
                } else {
                    rotX = centroX + 50;
                    rotY = centroY;
                }
            } else {
                centroX = calle.x + (calle.tamano * celda_tamano) / 2;
                centroY = calle.y + (calle.carriles * celda_tamano) / 2;
                rotX = calle.x + (calle.tamano * celda_tamano);
                rotY = calle.y;
            }
        } else {
            // Es un edificio
            const edificio = this.currentObject;
            centroX = edificio.x;
            centroY = edificio.y;

            const angle = (edificio.angle || 0) * Math.PI / 180;
            const offsetX = (edificio.width / 2) * Math.cos(angle);
            const offsetY = (edificio.width / 2) * Math.sin(angle);

            rotX = edificio.x + offsetX;
            rotY = edificio.y + offsetY;
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
        this.moveHandle.cursor = 'grabbing';

        console.log('🖐️ Iniciando arrastre de movimiento');
    }

    onMoveHandleDrag(event) {
        if (!this.currentObject) return;

        const camera = window.pixiApp.cameraController;
        const pos = event.data.global;

        const deltaX = (pos.x - this.dragStartX) / camera.scale;
        const deltaY = (pos.y - this.dragStartY) / camera.scale;

        this.currentObject.x += deltaX;
        this.currentObject.y += deltaY;

        this.dragStartX = pos.x;
        this.dragStartY = pos.y;

        // Actualizar posiciones
        this.updateHandlePositions();

        // Actualizar sprite del objeto
        this.updateObjectSprite();

        // Actualizar inputs en UI
        this.updateUIInputs();
    }

    onRotateHandleDragStart(event) {
        this.isDraggingRotate = true;
        this.rotateHandle.cursor = 'grabbing';

        const pos = event.data.global;
        const camera = window.pixiApp.cameraController;
        const worldPos = camera.screenToWorld(pos.x, pos.y);

        // Calcular ángulo inicial
        const celda_tamano = window.celda_tamano || 5;
        let centroX, centroY;

        if (this.currentType === 'calle') {
            const calle = this.currentObject;
            centroX = calle.x + (calle.tamano * celda_tamano) / 2;
            centroY = calle.y + (calle.carriles * celda_tamano) / 2;
        } else {
            centroX = this.currentObject.x;
            centroY = this.currentObject.y;
        }

        this.rotationStartAngle = Math.atan2(
            worldPos.y - centroY,
            worldPos.x - centroX
        );

        console.log('🔄 Iniciando rotación');
    }

    onRotateHandleDrag(event) {
        if (!this.currentObject) return;

        const pos = event.data.global;
        const camera = window.pixiApp.cameraController;
        const worldPos = camera.screenToWorld(pos.x, pos.y);

        const celda_tamano = window.celda_tamano || 5;
        let centroX, centroY;

        if (this.currentType === 'calle') {
            const calle = this.currentObject;
            centroX = calle.x + (calle.tamano * celda_tamano) / 2;
            centroY = calle.y + (calle.carriles * celda_tamano) / 2;
        } else {
            centroX = this.currentObject.x;
            centroY = this.currentObject.y;
        }

        const currentAngle = Math.atan2(
            worldPos.y - centroY,
            worldPos.x - centroX
        );

        const deltaAngle = (currentAngle - this.rotationStartAngle) * 180 / Math.PI;

        if (this.currentType === 'calle') {
            this.currentObject.angulo = (this.currentObject.angulo + deltaAngle) % 360;
            if (this.currentObject.angulo < 0) {
                this.currentObject.angulo += 360;
            }
        } else {
            if (!this.currentObject.angle) this.currentObject.angle = 0;
            this.currentObject.angle = (this.currentObject.angle + deltaAngle) % 360;
            if (this.currentObject.angle < 0) {
                this.currentObject.angle += 360;
            }
        }

        this.rotationStartAngle = currentAngle;

        // Actualizar sprite del objeto
        this.updateObjectSprite();

        // Actualizar posiciones de handles
        this.updateHandlePositions();

        // Actualizar inputs en UI
        this.updateUIInputs();
    }

    updateObjectSprite() {
        if (this.currentType === 'calle') {
            this.scene.updateCalleSprite(this.currentObject);
        } else {
            if (this.scene.edificioRenderer) {
                this.scene.edificioRenderer.updateEdificioSprite(this.currentObject);
            }
        }
    }

    updateUIInputs() {
        if (window.editorCalles && window.editorCalles.actualizarInputsPosicion) {
            window.editorCalles.actualizarInputsPosicion();
        }
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

        this.currentObject = null;
        this.currentType = null;
        this.isDraggingMove = false;
        this.isDraggingRotate = false;
    }

    /**
     * Verifica si algún handle está siendo arrastrado
     * @returns {boolean}
     */
    isDragging() {
        return this.isDraggingMove || this.isDraggingRotate;
    }
}

window.EditorHandles = EditorHandles;
