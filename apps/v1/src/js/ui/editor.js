// ==================== EDITOR.JS - MODO EDICIÓN (CALLES Y EDIFICIOS) ====================
// Este módulo maneja toda la funcionalidad de edición visual de calles y edificios

class EditorCalles {
    constructor() {
        this.modoEdicion = false;
        this.objetoEditando = null;
        this.tipoObjetoEditando = null;
        this.objetoOriginal = null;
        
        // NUEVO: Estado de edición de vértices
        this.modoEdicionVertices = false;
        this.verticeEditando = null;
        this.indiceVerticeEditando = -1;
        this.isDraggingVertice = false;

        // Handler para eventos de vértices (para poder removerlo cuando sea necesario)
        this.vertexMouseDownHandler = null;

        // Elementos del DOM
        this.btnModoEdicion = document.getElementById('btnModoEdicion');
        this.btnGuardarEdicion = document.getElementById('btnGuardarEdicion');
        this.btnCancelarEdicion = document.getElementById('btnCancelarEdicion');
        this.editActionButtons = document.getElementById('editActionButtons');
        this.editModeBadge = document.getElementById('editModeBadge');
        this.moveHandle = document.getElementById('moveHandle');
        this.rotationHandle = document.getElementById('rotateHandle');
        
        // Inputs de posición
        this.inputPosX = document.getElementById('inputPosX');
        this.inputPosY = document.getElementById('inputPosY');
        this.inputAngulo = document.getElementById('inputAngulo');
        this.btnAplicarPosicion = document.getElementById('btnAplicarPosicion');

        // Inputs de dimensiones
        this.dimensionesCalleSection = document.getElementById('dimensionesCalleSection');
        this.inputTamanoEditar = document.getElementById('inputTamanoEditar');
        this.inputCarrilesEditar = document.getElementById('inputCarrilesEditar');
        this.btnAplicarDimensiones = document.getElementById('btnAplicarDimensiones');
        
        // Selectores
        this.selectTipoObjeto = document.getElementById('selectTipoObjeto');
        this.calleEditorSelector = document.getElementById('calleEditorSelector');
        this.edificioSelector = document.getElementById('edificioSelector');
        this.selectCalleEditor = document.getElementById('selectCalleEditor');
        this.selectEdificio = document.getElementById('selectEdificio');

        // Selector de configuración de calles (en el otro acordeón)
        this.selectCalle = document.getElementById('selectCalle');
        
        // Ajustes avanzados
        this.btnAjustesAvanzados = document.getElementById('btnAjustesAvanzados');
        this.advancedSettings = document.getElementById('advancedSettings');
        this.advancedArrow = document.getElementById('advancedArrow');
        
        // Estado de arrastre
        this.isDraggingMove = false;
        this.isDraggingRotate = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.rotationStartAngle = 0;
        
        // Esperar a que las calles estén inicializadas
        this.esperarInicializacion();
    }
    
    esperarInicializacion() {
        if (window.calles && window.calles.length > 0) {
            console.log('✅ Calles detectadas:', window.calles.length);
            this.inicializarSelectores();
            this.inicializarEventos();
        } else {
            console.log('⏳ Esperando inicialización de calles...');
            setTimeout(() => this.esperarInicializacion(), 500);
        }
    }
    
    inicializarSelectores() {
        console.log('🔧 Inicializando selectores...');

        // Poblar selector de calles en configuración
        if (this.selectCalle && window.calles) {
            this.selectCalle.innerHTML = '<option value="">Selecciona una calle</option>';
            window.streetListUI.sortedEntries(window.calles).forEach(({ street: calle, index }) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = calle.nombre || `Calle ${index + 1}`;
                this.selectCalle.appendChild(option);
            });
            console.log(`✅ ${window.calles.length} calles agregadas al selector de configuración`);
        }

        // Poblar selector de calles en editor (constructor)
        if (this.selectCalleEditor && window.calles) {
            this.selectCalleEditor.innerHTML = '<option value="">Selecciona una calle</option>';
            window.streetListUI.sortedEntries(window.calles).forEach(({ street: calle, index }) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = calle.nombre || `Calle ${index + 1}`;
                this.selectCalleEditor.appendChild(option);
            });
            console.log(`✅ ${window.calles.length} calles agregadas al selector del editor`);
        }

        // Poblar selector de edificios
        if (this.selectEdificio && window.edificios) {
            this.selectEdificio.innerHTML = '<option value="">Selecciona un edificio</option>';
            window.edificios.forEach((edificio, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = edificio.label || `Edificio ${index + 1}`;
                this.selectEdificio.appendChild(option);
            });
            console.log(`✅ ${window.edificios.length} edificios agregados al selector`);
        }
    }
    
    inicializarEventos() {
        console.log('🔧 Inicializando eventos del editor...');
        
        // Toggle de ajustes avanzados
        this.btnAjustesAvanzados?.addEventListener('click', () => {
            this.advancedSettings.classList.toggle('show');
            this.advancedArrow.textContent = this.advancedSettings.classList.contains('show') ? '▲' : '▼';
        });
        
        // Cambio de tipo de objeto (en Constructor de Mapas)
        this.selectTipoObjeto?.addEventListener('change', () => {
            const tipo = this.selectTipoObjeto.value;
            console.log('📋 Tipo seleccionado:', tipo);

            if (tipo === 'calle') {
                this.calleEditorSelector.style.display = 'block';
                this.edificioSelector.style.display = 'none';
                this.selectEdificio.value = '';

                // Mostrar modo curva para calles
                const curvaModeSection = document.getElementById('curvaModeSection');
                if (curvaModeSection) curvaModeSection.style.display = 'block';
            } else if (tipo === 'edificio') {
                this.calleEditorSelector.style.display = 'none';
                this.edificioSelector.style.display = 'block';
                this.selectCalleEditor.value = '';

                // Ocultar modo curva para edificios
                const curvaModeSection = document.getElementById('curvaModeSection');
                if (curvaModeSection) curvaModeSection.style.display = 'none';
            } else {
                this.calleEditorSelector.style.display = 'none';
                this.edificioSelector.style.display = 'none';

                // Ocultar modo curva
                const curvaModeSection = document.getElementById('curvaModeSection');
                if (curvaModeSection) curvaModeSection.style.display = 'none';
            }

            window.calleSeleccionada = null;
            window.edificioSeleccionado = null;
            this.actualizarInputsPosicion();
            this.actualizarEstadoBotonEdicion();

            // Actualizar botón "Editar Edificio"
            if (window.actualizarBotonEditarEdificio) {
                window.actualizarBotonEditarEdificio();
            }

            if (window.renderizarCanvas) window.renderizarCanvas();
        });
        
        // Selección de calle en Configuración de Calles (solo muestra info, no activa edición)
        this.selectCalle?.addEventListener('change', () => {
            const calleIndex = this.selectCalle.value;
            console.log('🛣️ Calle seleccionada en configuración:', calleIndex);

            if (calleIndex !== "") {
                window.calleSeleccionada = window.calles[calleIndex];
                window.modoSeleccion = "configuracion"; // Modo configuración
                console.log('✅ Calle activa para configuración:', window.calleSeleccionada.nombre);
            } else {
                window.calleSeleccionada = null;
            }

            // Actualizar lista de conexiones si está visible
            const listaConexionesContainer = document.getElementById('listaConexionesContainer');
            if (listaConexionesContainer && listaConexionesContainer.style.display !== 'none') {
                if (typeof actualizarListaConexiones === 'function') {
                    actualizarListaConexiones(window.calleSeleccionada);
                }
            }

            if (window.renderizarCanvas) window.renderizarCanvas();
        });

        // Selección de calle en Constructor de Mapas (para edición)
        this.selectCalleEditor?.addEventListener('change', () => {
            const calleIndex = this.selectCalleEditor.value;
            console.log('🛣️ Calle seleccionada en editor:', calleIndex);

            if (calleIndex !== "") {
                const calle = window.calles[calleIndex];

                // Solo limpiar y agregar bordes si la calle NO está ya seleccionada
                // (esto evita duplicados cuando viene de un dispatchEvent desde CalleRenderer)
                if (window.calleSeleccionada !== calle) {
                    // Limpiar TODOS los bordes de selección existentes (calles y edificios)
                    if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
                        // Limpiar bordes de calles
                        if (window.pixiApp.sceneManager.calleRenderer) {
                            window.pixiApp.sceneManager.calleRenderer.clearAllSelectionBorders();
                        }
                        // Limpiar bordes de edificios
                        if (window.pixiApp.sceneManager.edificioRenderer) {
                            window.edificios.forEach(e => {
                                const sprite = window.pixiApp.sceneManager.edificioSprites.get(e);
                                if (sprite) {
                                    const border = sprite.getChildByName ? sprite.getChildByName('selectionBorder') : null;
                                    if (border) {
                                        sprite.removeChild(border);
                                        border.destroy();
                                    }
                                }
                            });
                        }
                    }

                    window.calleSeleccionada = calle;
                    window.edificioSeleccionado = null;
                    window.modoSeleccion = "constructor"; // Modo constructor

                    // Agregar borde de selección a la calle seleccionada
                    if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager && window.pixiApp.sceneManager.calleRenderer) {
                        const container = window.pixiApp.sceneManager.calleSprites.get(calle);
                        if (container) {
                            if (calle.esCurva) {
                                window.pixiApp.sceneManager.calleRenderer.addSelectionBorderCurva(container, calle);
                            } else {
                                window.pixiApp.sceneManager.calleRenderer.addSelectionBorder(container, calle);
                            }
                        }
                    }
                }

                this.actualizarInputsPosicion();
                console.log('✅ Calle activa para edición:', window.calleSeleccionada ? window.calleSeleccionada.nombre : 'ninguna');
            } else {
                // Si se deselecciona, limpiar bordes
                if (window.calleSeleccionada && window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager && window.pixiApp.sceneManager.calleRenderer) {
                    window.pixiApp.sceneManager.calleRenderer.clearAllSelectionBorders();
                }
                window.calleSeleccionada = null;
            }
            this.actualizarEstadoBotonEdicion();

            // Actualizar botón "Editar Edificio" (ocultar cuando calle seleccionada)
            if (window.actualizarBotonEditarEdificio) {
                window.actualizarBotonEditarEdificio();
            }

            // Si estamos en modo edición, cambiar a la nueva calle
            if (this.modoEdicion && window.calleSeleccionada) {
                this.objetoEditando = window.calleSeleccionada;
                this.tipoObjetoEditando = 'calle';
                this.actualizarPosicionHandles();
            }

            // Actualizar lista de conexiones si está visible
            const listaConexionesContainer = document.getElementById('listaConexionesContainer');
            if (listaConexionesContainer && listaConexionesContainer.style.display !== 'none') {
                if (typeof actualizarListaConexiones === 'function') {
                    actualizarListaConexiones(window.calleSeleccionada);
                }
            }

            if (window.renderizarCanvas) window.renderizarCanvas();
        });
        
        // Selección de edificio
        this.selectEdificio?.addEventListener('change', () => {
            const edificioIndex = this.selectEdificio.value;
            console.log('🏢 Edificio seleccionado:', edificioIndex);

            if (edificioIndex !== "") {
                const edificio = window.edificios[edificioIndex];

                // Solo limpiar y agregar bordes si el edificio NO está ya seleccionado
                // (esto evita duplicados cuando viene de un dispatchEvent desde EdificioRenderer)
                if (window.edificioSeleccionado !== edificio) {
                    // Limpiar TODOS los bordes de selección existentes (edificios y calles)
                    if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
                        // Limpiar bordes de calles
                        if (window.pixiApp.sceneManager.calleRenderer) {
                            window.pixiApp.sceneManager.calleRenderer.clearAllSelectionBorders();
                        }
                        // Limpiar bordes de edificios
                        if (window.pixiApp.sceneManager.edificioRenderer) {
                            window.edificios.forEach(e => {
                                const sprite = window.pixiApp.sceneManager.edificioSprites.get(e);
                                if (sprite) {
                                    const border = sprite.getChildByName ? sprite.getChildByName('selectionBorder') : null;
                                    if (border) {
                                        sprite.removeChild(border);
                                        border.destroy();
                                    }
                                }
                            });
                        }
                    }

                    window.edificioSeleccionado = edificio;
                    window.edificioSeleccionado.index = parseInt(edificioIndex);
                    window.calleSeleccionada = null;
                    window.modoSeleccion = "constructor"; // Modo constructor

                    // Agregar borde de selección al edificio seleccionado
                    if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager && window.pixiApp.sceneManager.edificioRenderer) {
                        const sprite = window.pixiApp.sceneManager.edificioSprites.get(edificio);
                        if (sprite) {
                            window.pixiApp.sceneManager.edificioRenderer.addSelectionBorder(sprite, edificio);
                        }
                    }
                }

                this.actualizarInputsPosicion();
                console.log('✅ Edificio activo:', window.edificioSeleccionado ? window.edificioSeleccionado.label : 'ninguno');
            } else {
                // Si se deselecciona, limpiar bordes
                if (window.edificioSeleccionado && window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
                    const sprite = window.pixiApp.sceneManager.edificioSprites.get(window.edificioSeleccionado);
                    if (sprite) {
                        const border = sprite.getChildByName ? sprite.getChildByName('selectionBorder') : null;
                        if (border) {
                            sprite.removeChild(border);
                            border.destroy();
                        }
                    }
                }
                window.edificioSeleccionado = null;
            }
            this.actualizarEstadoBotonEdicion();

            // Actualizar botón "Editar Edificio"
            if (window.actualizarBotonEditarEdificio) {
                window.actualizarBotonEditarEdificio();
            }

            // Si estamos en modo edición, cambiar al nuevo edificio
            if (this.modoEdicion && window.edificioSeleccionado) {
                this.objetoEditando = window.edificioSeleccionado;
                this.tipoObjetoEditando = 'edificio';
                this.actualizarPosicionHandles();
            }

            if (window.renderizarCanvas) window.renderizarCanvas();
        });
        
        // Aplicar posición manual
        this.btnAplicarPosicion?.addEventListener('click', () => {
            const objeto = window.calleSeleccionada || window.edificioSeleccionado;
            if (!objeto) return;

            const x = parseFloat(this.inputPosX.value);
            const y = parseFloat(this.inputPosY.value);
            const angulo = parseFloat(this.inputAngulo.value);

            if (!isNaN(x)) objeto.x = x;
            if (!isNaN(y)) objeto.y = y;

            if (window.calleSeleccionada) {
                if (!isNaN(angulo)) objeto.angulo = angulo % 360;
            } else if (window.edificioSeleccionado) {
                if (!isNaN(angulo)) objeto.angle = angulo % 360;
            }

            this.actualizarInputsPosicion();
            this.actualizarPosicionHandles();
            if (window.renderizarCanvas) window.renderizarCanvas();
        });

        // Aplicar dimensiones de calle
        this.btnAplicarDimensiones?.addEventListener('click', () => {
            if (!window.calleSeleccionada) return;

            const nuevoTamano = parseInt(this.inputTamanoEditar.value);
            const nuevosCarriles = parseInt(this.inputCarrilesEditar.value);

            if (isNaN(nuevoTamano) || isNaN(nuevosCarriles)) {
                alert('⚠️ Por favor ingresa valores válidos para tamaño y carriles');
                return;
            }

            if (nuevoTamano < 10 || nuevoTamano > 500) {
                alert('⚠️ El tamaño debe estar entre 10 y 500 celdas');
                return;
            }

            if (nuevosCarriles < 1 || nuevosCarriles > 10) {
                alert('⚠️ Los carriles deben estar entre 1 y 10');
                return;
            }

            const confirmar = confirm(`⚠️ Cambiar las dimensiones eliminará los vehículos fuera de los nuevos límites.\n\n¿Continuar?\n\nTamaño: ${window.calleSeleccionada.tamano} → ${nuevoTamano} celdas\nCarriles: ${window.calleSeleccionada.carriles} → ${nuevosCarriles} carriles`);

            if (confirmar) {
                this.aplicarNuevasDimensiones(window.calleSeleccionada, nuevoTamano, nuevosCarriles);
            }
        });
        
        // Entrar a modo edición
        this.btnModoEdicion?.addEventListener('click', () => {
            if (this.modoEdicion) {
                this.salirModoEdicion();
            } else {
                this.entrarModoEdicion();
            }
        });
        
        // Guardar cambios
        this.btnGuardarEdicion?.addEventListener('click', () => {
            this.guardarEdicion();
        });
        
        // Cancelar edición
        this.btnCancelarEdicion?.addEventListener('click', () => {
            this.cancelarEdicion();
        });
        
        // Eventos de arrastre para mover
        this.moveHandle?.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.iniciarArrastreMovimiento(e);
        });
        
        // Eventos de arrastre para rotar
        this.rotationHandle?.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.iniciarArrastreRotacion(e);
        });
        
        // NUEVO: Capturar mousedown en el canvas para detectar vértices (Canvas 2D y PixiJS)
        // Usar una función que se puede volver a adjuntar después de que PixiJS reemplace el canvas
        this.setupVertexEventListeners();

        // Si PixiJS se inicializa después, re-adjuntar el event listener
        // Esto es necesario porque PixiJS reemplaza el canvas cuando se inicializa
        if (window.USE_PIXI && !window.pixiApp) {
            // Esperar a que PixiJS se inicialice
            const checkPixiInitialized = setInterval(() => {
                if (window.pixiApp && window.pixiApp.app) {
                    console.log('🔄 PixiJS inicializado, re-adjuntando event listeners de vértices');
                    this.setupVertexEventListeners();
                    clearInterval(checkPixiInitialized);
                }
            }, 500);
        }
        
        // Eventos globales de mouse
        document.addEventListener('mousemove', (e) => {
            if (this.isDraggingMove) {
                this.arrastreMovimiento(e);
            } else if (this.isDraggingRotate) {
                this.arrastreRotacion(e);
            } else if (this.isDraggingVertice) {
                this.arrastreVertice(e);
            }
            
            // Actualizar posición de handles si estamos en modo edición
            if (this.modoEdicion && !this.isDraggingMove && !this.isDraggingRotate) {
                this.actualizarPosicionHandles();
            }
        });
        
        document.addEventListener('mouseup', () => {
            this.isDraggingMove = false;
            this.isDraggingRotate = false;

            if (this.isDraggingVertice) {
                this.isDraggingVertice = false;
                this.verticeEditando = null;
                this.indiceVerticeEditando = -1;

                // Restaurar cursor
                const canvas = window.USE_PIXI && window.pixiApp && window.pixiApp.app
                    ? window.pixiApp.app.view
                    : document.getElementById('simuladorCanvas');
                if (canvas) {
                    canvas.classList.remove('dragging-vertex');
                }

                console.log('✅ Arrastre de vértice finalizado');
            }
        });
        
        console.log('✅ Editor completamente inicializado');
    }
    
    // ==================== FUNCIONES DE DETECCIÓN Y EDICIÓN DE VÉRTICES ====================

    setupVertexEventListeners() {
        const canvas = window.USE_PIXI && window.pixiApp && window.pixiApp.app
            ? window.pixiApp.app.view
            : document.getElementById('simuladorCanvas');

        if (!canvas) {
            console.warn('⚠️ Canvas no encontrado para event listeners de vértices');
            return;
        }

        // Remover event listener anterior si existe (para evitar duplicados)
        if (this.vertexMouseDownHandler) {
            canvas.removeEventListener('mousedown', this.vertexMouseDownHandler);
        }

        // Crear y guardar el handler
        this.vertexMouseDownHandler = (e) => {
            // Solo procesar si estamos en modo edición, modo de vértices activo, y hay vértices
            if (!this.modoEdicion) return;
            if (!window.vertexEditMode) return; // IMPORTANTE: Solo con modo de edición de vértices activo
            if (this.tipoObjetoEditando !== 'calle') return;
            if (!this.objetoEditando || !this.objetoEditando.vertices) return;

            console.log('🎯 Editor: Detectando click en vértice (modo toggle activo)...');

            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const scaledMouseX = mouseX * scaleX;
            const scaledMouseY = mouseY * scaleY;

            const escala = window.escala || 1;
            const offsetX = window.offsetX || 0;
            const offsetY = window.offsetY || 0;

            const worldX = (scaledMouseX - offsetX) / escala;
            const worldY = (scaledMouseY - offsetY) / escala;

            console.log(`   Coordenadas mundo: (${worldX.toFixed(2)}, ${worldY.toFixed(2)})`);
            console.log(`   Calle editando: ${this.objetoEditando?.nombre}, Vértices: ${this.objetoEditando?.vertices?.length}`);

            // Intentar detectar vértice
            const verticeDetectado = this.detectarClicEnVertice(worldX, worldY);

            console.log(`   Vértice detectado:`, verticeDetectado ? `Índice ${verticeDetectado.indice}` : 'Ninguno');

            if (verticeDetectado) {
                e.preventDefault();
                e.stopPropagation();
                this.iniciarArrastreVertice(
                    verticeDetectado.vertice,
                    verticeDetectado.indice,
                    worldX,
                    worldY
                );
                console.log(`🎯 Vértice ${verticeDetectado.indice} capturado`);
            }
        };

        // Adjuntar el event listener
        canvas.addEventListener('mousedown', this.vertexMouseDownHandler);
        console.log('✅ Event listener de vértices adjuntado al canvas');
    }

    // Función para detectar clic en vértice
    detectarClicEnVertice(mouseX, mouseY) {
        if (!this.objetoEditando || !this.objetoEditando.vertices) {
            console.log('🔍 detectarClicEnVertice: Sin objeto editando o sin vértices');
            return null;
        }

        const umbralDistancia = 15 / (window.escala || 1);
        console.log(`🔍 detectarClicEnVertice: Buscando vértices cerca de (${mouseX.toFixed(2)}, ${mouseY.toFixed(2)}), umbral: ${umbralDistancia.toFixed(2)}`);

        for (let i = 0; i < this.objetoEditando.vertices.length; i++) {
            const vertice = this.objetoEditando.vertices[i];
            const pos = window.calcularPosicionVertice
                ? window.calcularPosicionVertice(this.objetoEditando, vertice)
                : null;

            if (!pos) {
                console.log(`   Vértice ${i}: Sin posición calculada`);
                continue;
            }

            const dx = mouseX - pos.x;
            const dy = mouseY - pos.y;
            const distancia = Math.sqrt(dx * dx + dy * dy);

            console.log(`   Vértice ${i}: pos=(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}), distancia=${distancia.toFixed(2)}`);

            if (distancia < umbralDistancia) {
                console.log(`   ✅ Vértice ${i} detectado!`);
                return { vertice, indice: i, pos };
            }
        }

        console.log('   ❌ Ningún vértice detectado');
        return null;
    }

    // Iniciar arrastre de vértice
    iniciarArrastreVertice(vertice, indice, mouseX, mouseY) {
        this.isDraggingVertice = true;
        this.verticeEditando = vertice;
        this.indiceVerticeEditando = indice;
        this.dragStartX = mouseX;
        this.dragStartY = mouseY;

        // Cambiar cursor
        const canvas = window.USE_PIXI && window.pixiApp && window.pixiApp.app
            ? window.pixiApp.app.view
            : document.getElementById('simuladorCanvas');
        if (canvas) {
            canvas.classList.add('dragging-vertex');
            canvas.style.cursor = 'grabbing';
        }

        console.log(`✏️ Editando vértice ${indice} de ${this.objetoEditando.nombre}`);
    }

    // Arrastrar vértice
    arrastreVertice(e) {
        if (!this.verticeEditando || !this.objetoEditando) return;

        // Obtener el canvas correcto (PixiJS o Canvas 2D)
        const canvas = window.USE_PIXI && window.pixiApp && window.pixiApp.app
            ? window.pixiApp.app.view
            : document.getElementById('simuladorCanvas');

        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const scaledMouseX = mouseX * scaleX;
        const scaledMouseY = mouseY * scaleY;
        
        const escala = window.escala || 1;
        const offsetX = window.offsetX || 0;
        const offsetY = window.offsetY || 0;
        
        const worldX = (scaledMouseX - offsetX) / escala;
        const worldY = (scaledMouseY - offsetY) / escala;
        
        // Actualizar ángulo del vértice basado en posición del mouse
        if (window.actualizarVerticePorArrastre) {
            const exito = window.actualizarVerticePorArrastre(
                this.objetoEditando,
                this.indiceVerticeEditando,
                worldX,
                worldY
            );
            
            if (exito) {
                // Activar modo curva si no está activo
                if (!this.objetoEditando.esCurva) {
                    this.objetoEditando.esCurva = true;
                    console.log(`🌊 Modo curva activado para ${this.objetoEditando.nombre}`);
                }
                
                if (window.renderizarCanvas) window.renderizarCanvas();
            }
        }
    }
    
    // ==================== FUNCIONES DE ESTADO Y ACTUALIZACIÓN ====================
    
    actualizarEstadoBotonEdicion() {
        if (this.btnModoEdicion) {
            const haySeleccion = window.calleSeleccionada || window.edificioSeleccionado;
            this.btnModoEdicion.disabled = !haySeleccion;
        }
    }
    
    actualizarInputsPosicion() {
        const objeto = window.calleSeleccionada || window.edificioSeleccionado;
        if (!objeto) {
            if (this.inputPosX) this.inputPosX.value = '';
            if (this.inputPosY) this.inputPosY.value = '';
            if (this.inputAngulo) this.inputAngulo.value = '';
            this.ocultarSeccionDimensiones();
            return;
        }

        // Validar que los valores existen y son números válidos antes de actualizar
        if (this.inputPosX && !isNaN(objeto.x) && objeto.x !== undefined) {
            this.inputPosX.value = Math.round(objeto.x);
        }
        if (this.inputPosY && !isNaN(objeto.y) && objeto.y !== undefined) {
            this.inputPosY.value = Math.round(objeto.y);
        }

        if (window.calleSeleccionada) {
            if (this.inputAngulo && !isNaN(objeto.angulo) && objeto.angulo !== undefined) {
                this.inputAngulo.value = Math.round(objeto.angulo);
            }
            this.mostrarSeccionDimensiones();
            this.actualizarInputsDimensiones();
        } else if (window.edificioSeleccionado) {
            const angle = objeto.angle || 0;
            if (this.inputAngulo && !isNaN(angle)) {
                this.inputAngulo.value = Math.round(angle);
            }
            this.ocultarSeccionDimensiones();
        }
    }

    mostrarSeccionDimensiones() {
        if (this.dimensionesCalleSection) {
            this.dimensionesCalleSection.style.display = 'block';
        }
    }

    ocultarSeccionDimensiones() {
        if (this.dimensionesCalleSection) {
            this.dimensionesCalleSection.style.display = 'none';
        }
    }

    actualizarInputsDimensiones() {
        if (!window.calleSeleccionada) return;

        if (this.inputTamanoEditar) {
            this.inputTamanoEditar.value = window.calleSeleccionada.tamano;
        }
        if (this.inputCarrilesEditar) {
            this.inputCarrilesEditar.value = window.calleSeleccionada.carriles;
        }
    }

    aplicarNuevasDimensiones(calle, nuevoTamano, nuevosCarriles) {
        console.log(`📏 Redimensionando calle: ${calle.nombre}`);
        console.log(`   Nuevo: ${nuevoTamano}x${nuevosCarriles}`);
        window.streetDependentPreview.commit(calle, { tamano: nuevoTamano, carriles: nuevosCarriles });
        this.actualizarInputsDimensiones();
        this.inicializarSelectores();
        if (window.renderizarCanvas) window.renderizarCanvas();
        console.log('✅ Calle redimensionada exitosamente');
    }

    // ==================== FUNCIONES DE MODO EDICIÓN ====================
    
    entrarModoEdicion() {
        const calle = window.calleSeleccionada;
        const edificio = window.edificioSeleccionado;

        if (!calle && !edificio) {
            alert('⚠️ Selecciona una calle o edificio primero');
            return;
        }

        // Desactivar todos los switches de escenarios si están activos
        const toggleBloqueoCarril = document.getElementById('toggleBloqueoCarril');
        const toggleInundacion = document.getElementById('toggleInundacion');
        const toggleObstaculo = document.getElementById('toggleObstaculo');

        if (toggleBloqueoCarril?.checked || toggleInundacion?.checked || toggleObstaculo?.checked) {
            // Desactivar todos los toggles
            if (toggleBloqueoCarril?.checked) {
                toggleBloqueoCarril.checked = false;
                toggleBloqueoCarril.dispatchEvent(new Event('change'));
            }
            if (toggleInundacion?.checked) {
                toggleInundacion.checked = false;
                toggleInundacion.dispatchEvent(new Event('change'));
            }
            if (toggleObstaculo?.checked) {
                toggleObstaculo.checked = false;
                toggleObstaculo.dispatchEvent(new Event('change'));
            }
            console.log('✅ Switches de escenarios desactivados para entrar en Modo Edición');
        }

        this.modoEdicion = true;
        
        if (calle) {
            this.objetoEditando = calle;
            this.tipoObjetoEditando = 'calle';

            // Guardar estado original completo (incluyendo vértices y curvas)
            this.objetoOriginal = {
                x: calle.x,
                y: calle.y,
                angulo: calle.angulo,
                esCurva: calle.esCurva || false,
                vertices: calle.vertices ? JSON.parse(JSON.stringify(calle.vertices)) : null // Copia profunda
            };
            console.log('✏️ Modo edición activado para calle:', calle.nombre);
            console.log('   Estado guardado:', {
                posicion: `(${calle.x}, ${calle.y})`,
                angulo: calle.angulo,
                esCurva: this.objetoOriginal.esCurva,
                verticesGuardados: this.objetoOriginal.vertices ? this.objetoOriginal.vertices.length : 0
            });
            
            // NUEVO: Activar mostrar conexiones automáticamente si la calle tiene vértices
            if (calle.vertices && calle.vertices.length > 0) {
                if (!window.mostrarConexiones) {
                    document.getElementById('btnConexiones')?.click();
                }
            }
        } else if (edificio) {
            this.objetoEditando = edificio;
            this.tipoObjetoEditando = 'edificio';
            this.objetoOriginal = {
                x: edificio.x,
                y: edificio.y,
                angle: edificio.angle || 0
            };
            console.log('✏️ Modo edición activado para edificio:', edificio.label);
        }
        
        // Pausar simulación
        const btnPause = document.getElementById('btnPauseResume');
        if (btnPause && !window.isPaused) {
            btnPause.click();
        }
        
        // Mostrar controles de edición
        if (this.editActionButtons) {
            this.editActionButtons.style.display = 'block';
        }
        if (this.editModeBadge) {
            this.editModeBadge.classList.add('active');
        }
        
        // Cambiar estilo del botón
        if (this.btnModoEdicion) {
            this.btnModoEdicion.textContent = '🔒 Salir de Edición';
            this.btnModoEdicion.classList.remove('btn-warning');
            this.btnModoEdicion.classList.add('btn-secondary');
        }
        
        // Agregar clase de edición de vértices al canvas
        if (calle && calle.vertices && calle.vertices.length > 0) {
            const canvas = window.USE_PIXI && window.pixiApp && window.pixiApp.app
                ? window.pixiApp.app.view
                : document.getElementById('simuladorCanvas');

            if (canvas) {
                canvas.classList.add('editing-vertices');
            }
        }

        // Renderizar vértices si es una calle
        if (window.USE_PIXI && calle && window.pixiApp && window.pixiApp.sceneManager) {
            if (window.pixiApp.sceneManager.calleRenderer) {
                console.log('🔄 Renderizando vértices para la calle seleccionada...');
                window.pixiApp.sceneManager.calleRenderer.renderVertices(calle);
                console.log('✅ Vértices renderizados');
            }
        }

        // Mostrar handles
        if (window.USE_PIXI && window.editorHandles) {
            // Usar handles de PixiJS
            window.editorHandles.createHandles(this.objetoEditando, this.tipoObjetoEditando);
            console.log('✅ Handles de PixiJS activados');
        } else {
            // Fallback a handles HTML
            this.actualizarPosicionHandles();
            if (this.moveHandle) {
                this.moveHandle.classList.add('active');
                console.log('✅ Handle de movimiento HTML activado');
            }
            if (this.rotationHandle) {
                this.rotationHandle.classList.add('active');
                console.log('✅ Handle de rotación HTML activado');
            }
        }

        // Ocultar controles normales
        const controlBar = document.getElementById('canvasControlBar');
        if (controlBar) controlBar.style.opacity = '0.3';
    }
    
    guardarEdicion() {
        if (!this.modoEdicion) return;
        
        if (this.tipoObjetoEditando === 'calle') {
            console.log('💾 Cambios guardados en calle:', {
                calle: this.objetoEditando.nombre,
                nuevaX: this.objetoEditando.x,
                nuevaY: this.objetoEditando.y,
                nuevoAngulo: this.objetoEditando.angulo
            });
            
            // Recalcular intersecciones con las nuevas posiciones
            if (window.inicializarIntersecciones) window.inicializarIntersecciones();
            if (window.construirMapaIntersecciones) window.construirMapaIntersecciones();
        } else if (this.tipoObjetoEditando === 'edificio') {
            console.log('💾 Cambios guardados en edificio:', {
                edificio: this.objetoEditando.label,
                nuevaX: this.objetoEditando.x,
                nuevaY: this.objetoEditando.y,
                nuevoAngulo: this.objetoEditando.angle
            });
        }
        
        const editedBuilding = this.tipoObjetoEditando === 'edificio';
        this.salirModoEdicion();
        if (editedBuilding) alert('✅ Cambios guardados correctamente');
    }
    
    cancelarEdicion() {
        if (!this.modoEdicion || !this.objetoOriginal) return;

        console.log('🔙 Cancelando edición, restaurando estado original...');

        // Restaurar posición y rotación
        this.objetoEditando.x = this.objetoOriginal.x;
        this.objetoEditando.y = this.objetoOriginal.y;

        if (this.tipoObjetoEditando === 'calle') {
            const calle = this.objetoEditando;

            // Restaurar ángulo
            calle.angulo = this.objetoOriginal.angulo;

            // Restaurar estado de curva
            calle.esCurva = this.objetoOriginal.esCurva;

            // Restaurar vértices (copia profunda desde el backup)
            if (this.objetoOriginal.vertices) {
                calle.vertices = JSON.parse(JSON.stringify(this.objetoOriginal.vertices));
                console.log(`   ✅ Vértices restaurados: ${calle.vertices.length} vértices`);
            } else {
                // Si no había vértices guardados, asegurar que la calle los tenga
                if (!calle.vertices && (calle.tipo === TIPOS.CONEXION || calle.tipo === TIPOS.GENERADOR || calle.tipo === TIPOS.DEVORADOR)) {
                    if (window.inicializarVertices) {
                        window.inicializarVertices(calle);
                        console.log(`   🔄 Vértices re-inicializados`);
                    }
                }
            }

            console.log('   Estado restaurado:', {
                posicion: `(${calle.x}, ${calle.y})`,
                angulo: calle.angulo,
                esCurva: calle.esCurva,
                verticesRestaurados: calle.vertices ? calle.vertices.length : 0
            });

            // Re-renderizar la calle en PixiJS con el estado restaurado
            if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
                const sceneManager = window.pixiApp.sceneManager;

                // Limpiar sprite existente
                if (sceneManager.calleSprites && sceneManager.calleSprites.has(calle)) {
                    const container = sceneManager.calleSprites.get(calle);
                    if (container) {
                        container.destroy({ children: true });
                    }
                    sceneManager.calleSprites.delete(calle);
                }

                // Re-renderizar con estado restaurado
                if (sceneManager.calleRenderer) {
                    if (calle.esCurva) {
                        sceneManager.calleRenderer.renderCalleCurva(calle);
                        console.log('   🌊 Calle curva re-renderizada');
                    } else {
                        sceneManager.calleRenderer.renderCalleRecta(calle);
                        console.log('   📏 Calle recta re-renderizada');
                    }
                }
            }

        } else if (this.tipoObjetoEditando === 'edificio') {
            this.objetoEditando.angle = this.objetoOriginal.angle;

            // Re-renderizar edificio en PixiJS
            if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
                const sceneManager = window.pixiApp.sceneManager;
                const edificio = this.objetoEditando;

                if (sceneManager.edificioSprites && sceneManager.edificioSprites.has(edificio)) {
                    const sprite = sceneManager.edificioSprites.get(edificio);
                    if (sprite) {
                        sprite.x = edificio.x;
                        sprite.y = edificio.y;
                        sprite.rotation = (edificio.angle || 0) * Math.PI / 180;
                    }
                }
            }
        }

        this.actualizarInputsPosicion();
        if (window.renderizarCanvas) window.renderizarCanvas();

        this.salirModoEdicion();

        console.log('✅ Edición cancelada - Todos los cambios revertidos');
    }
    
    salirModoEdicion() {
        const calleEditando = this.tipoObjetoEditando === 'calle' ? this.objetoEditando : null;

        this.modoEdicion = false;
        this.objetoEditando = null;
        this.tipoObjetoEditando = null;
        this.objetoOriginal = null;

        // Desactivar modo de edición de vértices si estaba activo
        if (window.vertexEditMode) {
            window.vertexEditMode = false;

            // Ocultar badge y restaurar feedback visual
            const badge = document.getElementById('vertexEditModeBadge');
            if (badge) {
                badge.style.animation = 'slideOutRight 0.3s ease-out';
                setTimeout(() => badge.style.display = 'none', 300);
            }

            console.log('🔴 Modo edición de vértices desactivado al salir de modo edición');
        }

        // Ocultar controles de edición
        if (this.editActionButtons) {
            this.editActionButtons.style.display = 'none';
        }
        if (this.editModeBadge) {
            this.editModeBadge.classList.remove('active');
        }

        // Quitar clase de edición de vértices del canvas
        const canvas = window.USE_PIXI && window.pixiApp && window.pixiApp.app
            ? window.pixiApp.app.view
            : document.getElementById('simuladorCanvas');

        if (canvas) {
            canvas.classList.remove('editing-vertices');
            canvas.classList.remove('dragging-vertex');
        }

        // Limpiar vértices visuales si estábamos editando una calle
        if (window.USE_PIXI && calleEditando && window.pixiApp && window.pixiApp.sceneManager) {
            if (window.pixiApp.sceneManager.calleRenderer) {
                window.pixiApp.sceneManager.calleRenderer.clearVertices(calleEditando);
            }
        }

        // Limpiar handles
        if (window.USE_PIXI && window.editorHandles) {
            // Limpiar handles de PixiJS
            window.editorHandles.clearHandles();
            console.log('✅ Handles de PixiJS limpiados');
        } else {
            // Limpiar handles HTML
            if (this.moveHandle) {
                this.moveHandle.classList.remove('active');
            }
            if (this.rotationHandle) {
                this.rotationHandle.classList.remove('active');
            }
        }

        // Restaurar estilo del botón
        if (this.btnModoEdicion) {
            this.btnModoEdicion.textContent = '✏️ Modo Edición';
            this.btnModoEdicion.classList.remove('btn-secondary');
            this.btnModoEdicion.classList.add('btn-warning');
        }

        // Mostrar controles normales
        const controlBar = document.getElementById('canvasControlBar');
        if (controlBar) controlBar.style.opacity = '1';
    }
    
    // ==================== FUNCIONES DE HANDLES Y ARRASTRE ====================
    
    actualizarPosicionHandles() {
        if (!this.objetoEditando) {
            console.log('⚠️ No hay objeto editando');
            return;
        }

        // Si estamos usando PixiJS, los handles son manejados por EditorHandles.js
        // No necesitamos actualizar los handles HTML
        if (window.USE_PIXI && window.editorHandles) {
            return;
        }

        const escala = window.escala || 1;
        const offsetX = window.offsetX || 0;
        const offsetY = window.offsetY || 0;
        const celda_tamano = window.celda_tamano || 5;

        // Obtener las dimensiones reales del canvas (ventana del usuario)
        const canvas = document.getElementById('simuladorCanvas');
        if (!canvas) {
            console.log('⚠️ No se encuentra el canvas');
            return;
        }

        // Configuración de handles
        const handleRadius = 20; // Radio del handle en px
        const margen = 25; // Margen desde los bordes de la ventana del usuario
        const separacionMinima = 50; // Distancia mínima entre handles para evitar traslape
        const offsetMinimo = 30; // Distancia mínima del handle al borde del objeto (en píxeles mundo)

        // Calcular límites reales del área disponible para handles
        // SIEMPRE dentro de la ventana visible del usuario (canvas)
        const areaMinX = margen;
        const areaMaxX = canvas.width - handleRadius * 2 - margen;
        const areaMinY = margen;
        const areaMaxY = canvas.height - handleRadius * 2 - margen;

        // Calcular posiciones ideales de los handles y dimensiones del objeto
        let centroX, centroY, rotX, rotY;
        let objectWidth, objectHeight;

        if (this.tipoObjetoEditando === 'calle') {
            objectWidth = this.objetoEditando.tamano * celda_tamano;
            objectHeight = this.objetoEditando.carriles * celda_tamano;

            // Verificar si la calle tiene curvas para usar el cálculo apropiado
            if (this.objetoEditando.esCurva && window.calcularCentroCalleCurva) {
                // Para calles curvadas, usar el centro calculado de la trayectoria
                const centroCalleCurva = window.calcularCentroCalleCurva(this.objetoEditando);
                centroX = centroCalleCurva.x * escala + offsetX;
                centroY = centroCalleCurva.y * escala + offsetY;

                // Para la rotación, usar el punto final de la curva
                if (window.calcularPuntoFinalCalleCurva) {
                    const puntoFinalCurva = window.calcularPuntoFinalCalleCurva(this.objetoEditando);
                    rotX = puntoFinalCurva.x * escala + offsetX;
                    rotY = puntoFinalCurva.y * escala + offsetY;
                } else {
                    // Fallback si no está disponible la función
                    rotX = centroX + 50;
                    rotY = centroY;
                }
            } else {
                // Para calles rectas, usar el cálculo tradicional
                const screenX = this.objetoEditando.x * escala + offsetX;
                const screenY = this.objetoEditando.y * escala + offsetY;
                const angle = this.objetoEditando.angulo * Math.PI / 180;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);

                centroX = screenX + (objectWidth * escala * cos / 2) - (objectHeight * escala * sin / 2);
                centroY = screenY + (objectWidth * escala * sin / 2) + (objectHeight * escala * cos / 2);

                rotX = screenX + (objectWidth * escala * cos);
                rotY = screenY + (objectWidth * escala * sin);

                // NUEVA LÓGICA: Si la calle es pequeña, colocar handles fuera
                const objetoPequeno = objectWidth < 80 || objectHeight < 80;
                if (objetoPequeno) {
                    // Handle de movimiento: arriba del objeto (perpendicular)
                    const moveOffsetDistance = (objectHeight / 2 + offsetMinimo) * escala;
                    centroX = screenX + (objectWidth * escala * cos / 2) - moveOffsetDistance * sin;
                    centroY = screenY + (objectWidth * escala * sin / 2) + moveOffsetDistance * cos;

                    // Handle de rotación: a la derecha del objeto
                    const rotOffsetDistance = (objectWidth + offsetMinimo) * escala;
                    rotX = screenX + rotOffsetDistance * cos;
                    rotY = screenY + rotOffsetDistance * sin;
                }
            }

        } else if (this.tipoObjetoEditando === 'edificio') {
            objectWidth = this.objetoEditando.width || 100;
            objectHeight = this.objetoEditando.height || 100;

            const screenX = this.objetoEditando.x * escala + offsetX;
            const screenY = this.objetoEditando.y * escala + offsetY;

            const angle = (this.objetoEditando.angle || 0) * Math.PI / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            centroX = screenX + (objectWidth * escala * cos / 2) - (objectHeight * escala * sin / 2);
            centroY = screenY + (objectWidth * escala * sin / 2) + (objectHeight * escala * cos / 2);

            const offsetRotX = (objectWidth / 2) * cos * escala;
            const offsetRotY = (objectWidth / 2) * sin * escala;

            rotX = screenX + offsetRotX;
            rotY = screenY + offsetRotY;

            // NUEVA LÓGICA: Si el edificio es pequeño, colocar handles fuera
            const objetoPequeno = objectWidth < 80 || objectHeight < 80;
            if (objetoPequeno) {
                // Handle de movimiento: arriba del edificio
                const moveOffsetDistance = (objectHeight / 2 + offsetMinimo) * escala;
                centroX = screenX + (objectWidth * escala * cos / 2) - moveOffsetDistance * sin;
                centroY = screenY + (objectWidth * escala * sin / 2) + moveOffsetDistance * cos;

                // Handle de rotación: a la derecha del edificio
                const rotOffsetDistance = (objectWidth / 2 + offsetMinimo) * escala;
                rotX = screenX + rotOffsetDistance * cos;
                rotY = screenY + rotOffsetDistance * sin;
            }
        }

        // Calcular posiciones ideales de los handles (donde "quieren" estar)
        const idealMoveX = centroX - handleRadius;
        const idealMoveY = centroY - handleRadius;
        const idealRotX = rotX - handleRadius;
        const idealRotY = rotY - handleRadius;

        // Inicializar posiciones finales con las ideales
        let finalMoveX = idealMoveX;
        let finalMoveY = idealMoveY;
        let finalRotX = idealRotX;
        let finalRotY = idealRotY;

        // Función auxiliar para reposicionar handle inteligentemente
        const reposicionarHandle = (idealX, idealY, areaMinX, areaMaxX, areaMinY, areaMaxY) => {
            let finalX = idealX;
            let finalY = idealY;

            // Si está fuera del área visible
            if (idealX < areaMinX || idealX > areaMaxX || idealY < areaMinY || idealY > areaMaxY) {

                // Calcular el centro del área visible
                const centroAreaX = (areaMinX + areaMaxX) / 2;
                const centroAreaY = (areaMinY + areaMaxY) / 2;

                // Calcular vector desde el centro del área hacia la posición ideal
                const vectorX = idealX - centroAreaX;
                const vectorY = idealY - centroAreaY;
                const vectorLength = Math.sqrt(vectorX * vectorX + vectorY * vectorY);

                if (vectorLength > 0) {
                    // Normalizar el vector
                    const normX = vectorX / vectorLength;
                    const normY = vectorY / vectorLength;

                    // Proyectar desde el centro hacia el borde en esa dirección
                    const maxDistX = normX > 0 ? areaMaxX - centroAreaX : centroAreaX - areaMinX;
                    const maxDistY = normY > 0 ? areaMaxY - centroAreaY : centroAreaY - areaMinY;

                    // Usar la distancia más restrictiva
                    const maxDist = Math.min(Math.abs(maxDistX / normX), Math.abs(maxDistY / normY));

                    finalX = centroAreaX + normX * Math.max(0, maxDist - 10); // -10 para margen
                    finalY = centroAreaY + normY * Math.max(0, maxDist - 10);

                    // Asegurar que está dentro de los límites
                    finalX = Math.max(areaMinX, Math.min(areaMaxX, finalX));
                    finalY = Math.max(areaMinY, Math.min(areaMaxY, finalY));
                } else {
                    // Si están en el mismo punto, usar el centro del área
                    finalX = centroAreaX;
                    finalY = centroAreaY;
                }
            }

            return { x: finalX, y: finalY };
        };

        // Reposicionar handles usando la lógica inteligente
        const posMoveHandle = reposicionarHandle(idealMoveX, idealMoveY, areaMinX, areaMaxX, areaMinY, areaMaxY);
        finalMoveX = posMoveHandle.x;
        finalMoveY = posMoveHandle.y;

        const posRotHandle = reposicionarHandle(idealRotX, idealRotY, areaMinX, areaMaxX, areaMinY, areaMaxY);
        finalRotX = posRotHandle.x;
        finalRotY = posRotHandle.y;

        // Verificar y resolver traslapes entre handles
        const distanciaX = Math.abs(finalMoveX - finalRotX);
        const distanciaY = Math.abs(finalMoveY - finalRotY);
        const distanciaTotal = Math.sqrt(distanciaX * distanciaX + distanciaY * distanciaY);

        if (distanciaTotal < separacionMinima) {
            // Calcular vector de separación
            const dx = finalRotX - finalMoveX;
            const dy = finalRotY - finalMoveY;
            const longitud = Math.sqrt(dx * dx + dy * dy);

            if (longitud > 0) {
                // Normalizar vector de separación
                const nx = dx / longitud;
                const ny = dy / longitud;

                // Aplicar separación mínima
                const separacionNecesaria = (separacionMinima - longitud) / 2;

                finalMoveX -= nx * separacionNecesaria;
                finalMoveY -= ny * separacionNecesaria;
                finalRotX += nx * separacionNecesaria;
                finalRotY += ny * separacionNecesaria;

                // Asegurar que siguen dentro del área después del ajuste
                finalMoveX = Math.max(areaMinX, Math.min(areaMaxX, finalMoveX));
                finalMoveY = Math.max(areaMinY, Math.min(areaMaxY, finalMoveY));
                finalRotX = Math.max(areaMinX, Math.min(areaMaxX, finalRotX));
                finalRotY = Math.max(areaMinY, Math.min(areaMaxY, finalRotY));
            } else {
                // Si están exactamente en la misma posición, separar horizontalmente
                finalMoveX = Math.max(areaMinX, finalMoveX - separacionMinima / 2);
                finalRotX = Math.min(areaMaxX, finalRotX + separacionMinima / 2);
            }
        }

        // Aplicar posiciones finales (solo si los valores son válidos)
        if (this.moveHandle && !isNaN(finalMoveX) && !isNaN(finalMoveY)) {
            this.moveHandle.style.left = `${finalMoveX}px`;
            this.moveHandle.style.top = `${finalMoveY}px`;
        }

        if (this.rotationHandle && !isNaN(finalRotX) && !isNaN(finalRotY)) {
            this.rotationHandle.style.left = `${finalRotX}px`;
            this.rotationHandle.style.top = `${finalRotY}px`;
        }

        // Debug opcional (descomenta para debugging)
        // console.log('🔧 Handles actualizados:', {
        //     objeto: { x: this.objetoEditando.x, y: this.objetoEditando.y },
        //     ideal: { moveX: idealMoveX, moveY: idealMoveY, rotX: idealRotX, rotY: idealRotY },
        //     final: { moveX: finalMoveX, moveY: finalMoveY, rotX: finalRotX, rotY: finalRotY },
        //     area: { minX: areaMinX, maxX: areaMaxX, minY: areaMinY, maxY: areaMaxY },
        //     distancia: Math.sqrt((finalRotX-finalMoveX)**2 + (finalRotY-finalMoveY)**2)
        // });
    }
    
    iniciarArrastreMovimiento(e) {
        e.preventDefault();
        e.stopPropagation();
        this.isDraggingMove = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        console.log('🖱️ Iniciando arrastre de movimiento (HTML handle)');
    }

    arrastreMovimiento(e) {
        if (!this.objetoEditando) return;

        const escala = window.escala || 1;
        const camera = window.pixiApp?.cameraController;

        // Usar CameraController si está disponible
        const scale = camera ? camera.scale : escala;

        const deltaX = (e.clientX - this.dragStartX) / scale;
        const deltaY = (e.clientY - this.dragStartY) / scale;

        this.objetoEditando.x += deltaX;
        this.objetoEditando.y += deltaY;

        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;

        this.actualizarInputsPosicion();
        this.actualizarPosicionHandles();

        // Actualizar sprite en PixiJS
        if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
            if (this.tipoObjetoEditando === 'calle') {
                window.pixiApp.sceneManager.calleRenderer?.updateCalleSprite(this.objetoEditando);
            } else {
                window.pixiApp.sceneManager.edificioRenderer?.updateEdificioSprite(this.objetoEditando);
            }
        }

        if (window.renderizarCanvas) window.renderizarCanvas();
    }
    
    iniciarArrastreRotacion(e) {
        e.preventDefault();
        e.stopPropagation();
        this.isDraggingRotate = true;
        
        const celda_tamano = window.celda_tamano || 5;
        const escala = window.escala || 1;
        const offsetX = window.offsetX || 0;
        const offsetY = window.offsetY || 0;
        
        let centroX, centroY;
        
        if (this.tipoObjetoEditando === 'calle') {
            centroX = this.objetoEditando.x + (this.objetoEditando.tamano * celda_tamano) / 2;
            centroY = this.objetoEditando.y + (this.objetoEditando.carriles * celda_tamano) / 2;
        } else if (this.tipoObjetoEditando === 'edificio') {
            centroX = this.objetoEditando.x;
            centroY = this.objetoEditando.y;
        }
        
        const mouseWorldX = (e.clientX - offsetX) / escala;
        const mouseWorldY = (e.clientY - offsetY) / escala;
        
        this.rotationStartAngle = Math.atan2(
            mouseWorldY - centroY,
            mouseWorldX - centroX
        ) * 180 / Math.PI;
        
        console.log('🔄 Iniciando rotación');
    }
    
    arrastreRotacion(e) {
        if (!this.objetoEditando) return;
        
        const celda_tamano = window.celda_tamano || 5;
        const escala = window.escala || 1;
        const offsetX = window.offsetX || 0;
        const offsetY = window.offsetY || 0;
        
        let centroX, centroY;
        
        if (this.tipoObjetoEditando === 'calle') {
            centroX = this.objetoEditando.x + (this.objetoEditando.tamano * celda_tamano) / 2;
            centroY = this.objetoEditando.y + (this.objetoEditando.carriles * celda_tamano) / 2;
        } else if (this.tipoObjetoEditando === 'edificio') {
            centroX = this.objetoEditando.x;
            centroY = this.objetoEditando.y;
        }
        
        const mouseWorldX = (e.clientX - offsetX) / escala;
        const mouseWorldY = (e.clientY - offsetY) / escala;
        
        const currentAngle = Math.atan2(
            mouseWorldY - centroY,
            mouseWorldX - centroX
        ) * 180 / Math.PI;
        
        const deltaAngle = currentAngle - this.rotationStartAngle;
        
        if (this.tipoObjetoEditando === 'calle') {
            this.objetoEditando.angulo = (this.objetoEditando.angulo + deltaAngle) % 360;
            if (this.objetoEditando.angulo < 0) {
                this.objetoEditando.angulo += 360;
            }
        } else if (this.tipoObjetoEditando === 'edificio') {
            if (!this.objetoEditando.angle) this.objetoEditando.angle = 0;
            this.objetoEditando.angle = (this.objetoEditando.angle + deltaAngle) % 360;
            if (this.objetoEditando.angle < 0) {
                this.objetoEditando.angle += 360;
            }
        }
        
        this.rotationStartAngle = currentAngle;
        
        this.actualizarInputsPosicion();
        this.actualizarPosicionHandles();
        if (window.renderizarCanvas) window.renderizarCanvas();
    }
}

// Instanciar el editor cuando el DOM esté listo
let editorCalles;
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        editorCalles = new EditorCalles();
        window.editorCalles = editorCalles; // Exponer globalmente
        console.log('✅ Editor de calles y edificios inicializado');
    });
} else {
    editorCalles = new EditorCalles();
    window.editorCalles = editorCalles; // Exponer globalmente
    console.log('🚀 Editor de calles y edificios cargado');
}
