console.log('🎬 escenarios.js cargando...');

/**
 * MÓDULO DE ESCENARIOS
 * Gestiona los diferentes escenarios de tráfico (bloqueo de carriles, inundaciones, obstáculos)
 */

// Estado del módulo de escenarios
const estadoEscenarios = {
    modoBloqueoActivo: false,
    tipoEscenarioActivo: null, // 'bloqueo', 'inundacion', 'obstaculo'
    emojiObstaculoSeleccionado: 'bache', // Textura por defecto para obstáculos
    lluviaAleatoria: { activa: false, probabilidad: 10 }, // Porcentaje por paso
    isPainting: false,
    celdasBloqueadas: new Map() // key: "calleId:carril:indice", value: { tipo: string, texture?: string }
};

function inicializarLluviaAleatoria() {
    const toggle = document.getElementById('toggleLluviaAleatoria');
    const input = document.getElementById('probabilidadLluvia');
    toggle?.addEventListener('change', () => {
        estadoEscenarios.lluviaAleatoria.activa = toggle.checked;
    });
    input?.addEventListener('input', () => {
        const value = Number(input.value);
        if (Number.isFinite(value) && value >= 0 && value <= 100) {
            estadoEscenarios.lluviaAleatoria.probabilidad = value;
            document.getElementById('probabilidadLluviaValor').textContent = `${value}%`;
        }
    });
    actualizarControlesLluvia();
}

function actualizarControlesLluvia() {
    const lluvia = estadoEscenarios.lluviaAleatoria;
    const toggle = document.getElementById('toggleLluviaAleatoria');
    const input = document.getElementById('probabilidadLluvia');
    const output = document.getElementById('probabilidadLluviaValor');
    if (toggle) toggle.checked = lluvia.activa;
    if (input) input.value = lluvia.probabilidad;
    if (output) output.textContent = `${lluvia.probabilidad}%`;
}

function lluviaAleatoriaToJSON() {
    return { probabilidad: estadoEscenarios.lluviaAleatoria.probabilidad };
}

/** Cargar nunca inicia lluvia; los archivos antiguos usan el valor por defecto. */
function lluviaAleatoriaFromJSON(configuracion) {
    const value = configuracion?.probabilidad;
    estadoEscenarios.lluviaAleatoria.probabilidad = typeof value === 'number' &&
        Number.isFinite(value) && value >= 0 && value <= 100 ? value : 10;
    estadoEscenarios.lluviaAleatoria.activa = false;
    actualizarControlesLluvia();
}

function contarCeldasVacias(calle) {
    let vacias = 0;
    for (const carril of calle.arreglo || []) {
        for (const valor of carril) if (valor === 0) vacias++;
    }
    return vacias;
}

function encontrarCeldaVacia(calle, objetivo) {
    for (let carril = 0; carril < calle.arreglo.length; carril++) {
        for (let indice = 0; indice < calle.arreglo[carril].length; indice++) {
            if (calle.arreglo[carril][indice] !== 0) continue;
            if (objetivo-- !== 0) continue;
            return { carril, indice };
        }
    }
}

/** Una tirada por paso; calles elegibles equiprobables, luego sus celdas vacías. */
function aplicarLluviaAleatoria() {
    const lluvia = estadoEscenarios.lluviaAleatoria;
    if (!lluvia.activa || lluvia.probabilidad <= 0 || Math.random() >= lluvia.probabilidad / 100) return;

    const elegibles = (window.calles || []).map(calle => ({ calle, vacias: contarCeldasVacias(calle) }))
        .filter(({ vacias }) => vacias > 0);
    if (elegibles.length === 0) return;

    const { calle, vacias } = elegibles[Math.floor(Math.random() * elegibles.length)];
    const { carril, indice } = encontrarCeldaVacia(calle, Math.floor(Math.random() * vacias));
    calle.arreglo[carril][indice] = 7;
    const key = `${calle.id || calle.nombre}:${carril}:${indice}`;
    estadoEscenarios.celdasBloqueadas.set(key, { tipo: 'inundacion', texture: 'inundacion' });
    const renderer = window.pixiApp?.sceneManager?.carroRenderer;
    renderer?.updateCell(calle, carril, indice);
    if (window.isPaused) window.pixiApp?.app?.render();
}

/**
 * Muestra una alerta Bootstrap temporal
 * @param {string} mensaje - Mensaje a mostrar
 * @param {string} tipo - Tipo de alerta: 'warning', 'danger', 'info', 'success'
 * @param {number} duracion - Duración en ms (por defecto 4000)
 */
function mostrarAlertaBootstrap(mensaje, tipo = 'warning', duracion = 4000) {
    // Crear contenedor si no existe
    let contenedor = document.getElementById('alertContainer');
    if (!contenedor) {
        contenedor = document.createElement('div');
        contenedor.id = 'alertContainer';
        contenedor.style.position = 'fixed';
        contenedor.style.top = '20px';
        contenedor.style.right = '20px';
        contenedor.style.zIndex = '9999';
        contenedor.style.maxWidth = '400px';
        document.body.appendChild(contenedor);
    }

    // Crear alerta
    const alerta = document.createElement('div');
    alerta.className = `alert alert-${tipo} alert-dismissible fade show`;
    alerta.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    alerta.setAttribute('role', 'alert');

    alerta.innerHTML = `
        <strong>⚠️</strong> ${mensaje}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;

    contenedor.appendChild(alerta);

    // Auto-cerrar después de la duración especificada
    setTimeout(() => {
        alerta.classList.remove('show');
        setTimeout(() => alerta.remove(), 150);
    }, duracion);
}

// Referencias a elementos del DOM
let toggleBloqueoCarril;
let toggleInundacion;
let toggleObstaculo;
let paintModeIndicatorBloqueo;
let paintModeIndicatorInundacion;
let paintModeIndicatorObstaculo;
let selectorEmojiObstaculo;
let canvasEscenarios;

/**
 * Inicializa el módulo de escenarios
 */
function inicializarEscenarios() {
    console.log('🎬 Inicializando módulo de escenarios...');
    inicializarLluviaAleatoria();

    // Obtener referencias a elementos del DOM
    toggleBloqueoCarril = document.getElementById('toggleBloqueoCarril');
    toggleInundacion = document.getElementById('toggleInundacion');
    toggleObstaculo = document.getElementById('toggleObstaculo');
    paintModeIndicatorBloqueo = document.getElementById('paintModeIndicator');
    paintModeIndicatorInundacion = document.getElementById('paintModeIndicatorInundacion');
    paintModeIndicatorObstaculo = document.getElementById('paintModeIndicatorObstaculo');
    selectorEmojiObstaculo = document.getElementById('selectorEmojiObstaculo');
    canvasEscenarios = document.getElementById('simuladorCanvas');

    // Verificar que existen los elementos esenciales
    if (!toggleBloqueoCarril || !paintModeIndicatorBloqueo || !canvasEscenarios) {
        console.error('❌ No se encontraron todos los elementos necesarios para escenarios');
        return;
    }

    // Event listener para el toggle de bloqueo de carril
    toggleBloqueoCarril.addEventListener('change', (e) => {
        if (e.target.checked) {
            // Verificar si hay otro modo activo
            if (estadoEscenarios.tipoEscenarioActivo) {
                e.preventDefault();
                toggleBloqueoCarril.checked = false;
                const modoActual = estadoEscenarios.tipoEscenarioActivo === 'inundacion' ? 'Inundación' : 'Obstáculo';
                mostrarAlertaBootstrap(
                    `Ya tienes el modo "<strong>${modoActual}</strong>" activo.<br>Debes desactivarlo primero antes de activar otro modo de escenario.`,
                    'warning',
                    5000
                );
                return;
            }
            activarEscenario('bloqueo');
        } else {
            desactivarEscenario();
        }
    });

    // Event listener para el toggle de inundación
    if (toggleInundacion) {
        toggleInundacion.addEventListener('change', (e) => {
            if (e.target.checked) {
                // Verificar si hay otro modo activo
                if (estadoEscenarios.tipoEscenarioActivo) {
                    e.preventDefault();
                    toggleInundacion.checked = false;
                    const modoActual = estadoEscenarios.tipoEscenarioActivo === 'bloqueo' ? 'Bloqueo de Carril' : 'Obstáculo';
                    mostrarAlertaBootstrap(
                        `Ya tienes el modo "<strong>${modoActual}</strong>" activo.<br>Debes desactivarlo primero antes de activar otro modo de escenario.`,
                        'warning',
                        5000
                    );
                    return;
                }
                activarEscenario('inundacion');
            } else {
                desactivarEscenario();
            }
        });
    }

    // Event listener para el toggle de obstáculo
    if (toggleObstaculo) {
        toggleObstaculo.addEventListener('change', (e) => {
            if (e.target.checked) {
                // Verificar si hay otro modo activo
                if (estadoEscenarios.tipoEscenarioActivo) {
                    e.preventDefault();
                    toggleObstaculo.checked = false;
                    const modoActual = estadoEscenarios.tipoEscenarioActivo === 'bloqueo' ? 'Bloqueo de Carril' : 'Inundación';
                    mostrarAlertaBootstrap(
                        `Ya tienes el modo "<strong>${modoActual}</strong>" activo.<br>Debes desactivarlo primero antes de activar otro modo de escenario.`,
                        'warning',
                        5000
                    );
                    return;
                }
                activarEscenario('obstaculo');
                // Mostrar selector de emoji
                const container = document.getElementById('selectorObstaculoContainer');
                if (container) container.style.display = 'block';
            } else {
                desactivarEscenario();
                // Ocultar selector de emoji
                const container = document.getElementById('selectorObstaculoContainer');
                if (container) container.style.display = 'none';
            }
        });
    }

    // Event listener para selector de textura de obstáculo
    if (selectorEmojiObstaculo) {
        selectorEmojiObstaculo.addEventListener('change', (e) => {
            estadoEscenarios.emojiObstaculoSeleccionado = e.target.value;
            console.log('🎨 Textura de obstáculo seleccionada:', e.target.value);
        });
    }

    // Event listener para botón de limpiar todos los bloqueos
    const btnLimpiarTodosBloqueos = document.getElementById('btnLimpiarTodosBloqueos');
    if (btnLimpiarTodosBloqueos) {
        btnLimpiarTodosBloqueos.addEventListener('click', () => {
            if (estadoEscenarios.celdasBloqueadas.size === 0) {
                mostrarAdvertencia('Sin bloqueos', 'No hay obstáculos, inundaciones o bloqueos para limpiar.');
                return;
            }

            // Mostrar modal de confirmación
            mostrarConfirmacion(
                '🗑️ Limpiar Todos los Bloqueos',
                `¿Estás seguro de que deseas eliminar <strong>${estadoEscenarios.celdasBloqueadas.size} bloqueo(s)</strong>?<br><br>Se eliminarán todos los obstáculos, inundaciones y bloqueos del mapa.<br><br><strong>Los vehículos no serán afectados.</strong>`,
                () => {
                    // Callback si confirma - usar versión silenciosa sin confirmación adicional
                    limpiarTodosLosBloqueosSilencioso();
                    mostrarExito('✅ Bloqueos eliminados', 'Todos los obstáculos, inundaciones y bloqueos han sido eliminados exitosamente.');
                },
                null, // No hay callback para cancelar
                {
                    btnConfirmText: '🗑️ Eliminar Todo',
                    btnConfirmClass: 'btn-danger',
                    btnCancelText: 'Cancelar'
                }
            );
        });
    }

    console.log('✅ Módulo de escenarios inicializado');
    console.log('ℹ️ Los clicks en el canvas son manejados por CalleRenderer con prioridad al modo bloqueo');
}

/**
 * Activa un tipo de escenario específico
 */
function activarEscenario(tipo) {
    // Desactivar el modo edición si está activo
    if (window.editorVisual && window.editorVisual.modoEdicion) {
        window.editorVisual.salirModoEdicion();
        console.log('✅ Modo Edición desactivado para activar escenario');
    }

    estadoEscenarios.modoBloqueoActivo = true;
    estadoEscenarios.tipoEscenarioActivo = tipo;

    toggleModoBloqueo(true, tipo);
    console.log(`🎬 Escenario activado: ${tipo}`);
}

/**
 * Desactiva todos los escenarios
 */
function desactivarEscenario() {
    estadoEscenarios.modoBloqueoActivo = false;
    estadoEscenarios.tipoEscenarioActivo = null;

    toggleModoBloqueo(false);
    console.log('🎬 Escenario desactivado');
}

/**
 * Activa o desactiva el modo bloqueo
 */
function toggleModoBloqueo(activar, tipo = 'bloqueo') {
    const btnPauseResume = document.getElementById('btnPauseResume');
    const btnPaso = document.getElementById('btnPaso');

    if (activar) {
        console.log(`🚧 Modo ${tipo} ACTIVADO`);

        // Ocultar todos los indicadores primero
        if (paintModeIndicatorBloqueo) paintModeIndicatorBloqueo.style.display = 'none';
        if (paintModeIndicatorInundacion) paintModeIndicatorInundacion.style.display = 'none';
        if (paintModeIndicatorObstaculo) paintModeIndicatorObstaculo.style.display = 'none';

        // Mostrar solo el indicador correspondiente al tipo de escenario
        if (tipo === 'bloqueo' && paintModeIndicatorBloqueo) {
            paintModeIndicatorBloqueo.style.display = 'block';
        } else if (tipo === 'inundacion' && paintModeIndicatorInundacion) {
            paintModeIndicatorInundacion.style.display = 'block';

            // 🌧️ ACTIVAR EFECTO DE LLUVIA para modo inundación
            if (window.pixiApp && window.RainEffect) {
                if (!window.pixiApp.rainEffect) {
                    window.pixiApp.rainEffect = new window.RainEffect(window.pixiApp.app);
                }
                window.pixiApp.rainEffect.start();
                console.log('🌧️ Efecto de lluvia activado');
            }
        } else if (tipo === 'obstaculo' && paintModeIndicatorObstaculo) {
            paintModeIndicatorObstaculo.style.display = 'block';
        }

        if (canvasEscenarios) canvasEscenarios.classList.add('blocking-mode');
    } else {
        console.log('🚧 Modo escenario DESACTIVADO');

        // Ocultar todos los indicadores
        if (paintModeIndicatorBloqueo) paintModeIndicatorBloqueo.style.display = 'none';
        if (paintModeIndicatorInundacion) paintModeIndicatorInundacion.style.display = 'none';
        if (paintModeIndicatorObstaculo) paintModeIndicatorObstaculo.style.display = 'none';

        // 🌧️ DESACTIVAR EFECTO DE LLUVIA
        if (window.pixiApp && window.pixiApp.rainEffect) {
            window.pixiApp.rainEffect.stop();
            console.log('🌧️ Efecto de lluvia desactivado');
        }

        if (canvasEscenarios) canvasEscenarios.classList.remove('blocking-mode');
        estadoEscenarios.isPainting = false;
    }
}

// NOTA: La funcionalidad de pintar/bloquear celdas ahora está integrada en CalleRenderer.onCalleClick
// para evitar conflictos con otros manejadores de eventos

/**
 * Limpiar todos los bloqueos silenciosamente (sin confirmación, para uso interno al cargar escenarios)
 */
function limpiarTodosLosBloqueosSilencioso() {
    if (estadoEscenarios.celdasBloqueadas.size === 0) {
        console.log('ℹ️ No hay bloqueos para limpiar');
        return;
    }

    const totalBloqueados = estadoEscenarios.celdasBloqueadas.size;
    let celdasLimpiadas = 0;

    // Recorrer todas las celdas bloqueadas y desbloquearlas
    estadoEscenarios.celdasBloqueadas.forEach((metadata, celdaKey) => {
        const partes = celdaKey.split(':');
        // El calleId puede contener ':' así que tomamos los últimos dos como carril e índice
        const indice = parseInt(partes.pop());
        const carril = parseInt(partes.pop());
        const calleId = partes.join(':'); // Reunir el resto como ID

        // Buscar la calle por ID o nombre (soportar ambos formatos)
        const calle = window.calles?.find(c => c.id === calleId || c.nombre === calleId);

        if (calle && calle.arreglo && calle.arreglo[carril]) {
            calle.arreglo[carril][indice] = 0;
            celdasLimpiadas++;
        }
    });

    // Limpiar el Map
    estadoEscenarios.celdasBloqueadas.clear();

    console.log(`🗑️ ${celdasLimpiadas}/${totalBloqueados} celdas bloqueadas limpiadas silenciosamente`);

    // Forzar actualización del renderer
    if (window.pixiApp && window.pixiApp.sceneManager && window.pixiApp.sceneManager.carroRenderer) {
        window.pixiApp.sceneManager.carroRenderer.updateAll(window.calles);
    }
}

/**
 * Restablece la sesión activa de escenarios sin confirmaciones ni cambios a la
 * biblioteca guardada. Útil al iniciar otra simulación/mapa.
 */
function restablecerSesionEscenarios() {
    // The outgoing streets are discarded immediately after this reset; avoid
    // repainting all of their cells or rebuilding sprites just to remove them.
    estadoEscenarios.celdasBloqueadas.clear();
    desactivarEscenario();
    lluviaAleatoriaFromJSON();

    // También funciona si se invoca antes de inicializar los listeners del UI.
    [toggleBloqueoCarril, toggleInundacion, toggleObstaculo].forEach(toggle => {
        if (toggle) toggle.checked = false;
    });
    const selectorContainer = document.getElementById('selectorObstaculoContainer');
    if (selectorContainer) selectorContainer.style.display = 'none';
    estadoEscenarios.isPainting = false;
    window.escenarioActualCargado = null;
}

/**
 * Limpia todos los bloqueos (con confirmación del usuario)
 */
function limpiarTodosLosBloqueos() {
    if (estadoEscenarios.celdasBloqueadas.size === 0) {
        console.log('ℹ️ No hay bloqueos para limpiar');
        return;
    }

    const confirmacion = confirm(`¿Estás seguro de que quieres eliminar ${estadoEscenarios.celdasBloqueadas.size} bloqueo(s)?`);

    if (!confirmacion) return;

    // Usar la función silenciosa
    limpiarTodosLosBloqueosSilencioso();

    console.log('✅ Bloqueos eliminados por el usuario');
}

// NOTA: Las funciones de conversión de coordenadas y detección de celdas
// ahora son manejadas por CalleRenderer usando window.obtenerCeldaEnPosicion

/**
 * Exporta el estado de los bloqueos para guardarlo
 */
function exportarBloqueos() {
    const bloqueos = [];
    estadoEscenarios.celdasBloqueadas.forEach((metadata, celdaKey) => {
        bloqueos.push({ key: celdaKey, ...metadata });
    });
    return bloqueos;
}

/**
 * Importa el estado de los bloqueos desde un guardado
 */
function importarBloqueos(bloqueosArray) {
    estadoEscenarios.celdasBloqueadas.clear();

    if (Array.isArray(bloqueosArray)) {
        bloqueosArray.forEach(bloqueo => {
            const celdaKey = bloqueo.key;
            // Soportar tanto el formato antiguo (emoji) como el nuevo (texture)
            const metadata = {
                tipo: bloqueo.tipo,
                texture: bloqueo.texture || bloqueo.emoji
            };

            estadoEscenarios.celdasBloqueadas.set(celdaKey, metadata);

            // Aplicar el bloqueo en las calles
            const [calleId, carril, indice] = celdaKey.split(':').map(Number);
            const calle = window.calles?.find(c => c.id === calleId);

            if (calle && calle.arreglo[carril]) {
                calle.arreglo[carril][indice] = 7;
            }
        });

        console.log(`📥 Importados ${bloqueosArray.length} bloqueos`);
    }
}

// ============================================================
// SISTEMA DE GUARDADO Y CARGA DE ESCENARIOS
// ============================================================

/**
 * Guarda el escenario actual en localStorage
 * @param {string} nombre - Nombre del escenario
 * @param {string} descripcion - Descripción opcional
 * @returns {boolean} - true si se guardó exitosamente
 */
function crearEscenarioJSON(nombre, descripcion = '') {
    if (!nombre || nombre.trim() === '') {
        console.error('❌ El nombre del escenario es obligatorio');
        return null;
    }

    try {
        // Capturar configuración actual de las calles
        const callesConfig = window.calles.map(calle => ({
            id: calle.id || calle.nombre, // ID único de la calle
            nombre: calle.nombre,
            tamano: calle.tamano,
            carriles: calle.carriles
        }));

        // Capturar todas las celdas bloqueadas
        const celdasBloqueadasArray = [];
        estadoEscenarios.celdasBloqueadas.forEach((valor, key) => {
            const partes = key.split(':');
            const indice = partes.pop();
            const carril = partes.pop();
            const calleId = partes.join(':');

            // Encontrar la calle correspondiente (buscar por id o nombre)
            const calle = window.calles.find(c => c.id === calleId || c.nombre === calleId);
            if (calle) {
                celdasBloqueadasArray.push({
                    calleNombre: calle.nombre,
                    calleId: calle.id || calle.nombre,
                    carril: parseInt(carril),
                    indice: parseInt(indice),
                    tipo: valor.tipo,
                    texture: valor.texture || null
                });
            }
        });

        // Crear objeto del escenario
        const escenario = {
            version: '1.0',
            id: Date.now().toString(),
            nombre: nombre.trim(),
            descripcion: descripcion.trim(),
            fechaCreacion: new Date().toISOString(),
            callesConfig: callesConfig,
            lluviaAleatoria: lluviaAleatoriaToJSON(),
            celdasBloqueadas: celdasBloqueadasArray,
            estadisticas: {
                totalBloqueos: celdasBloqueadasArray.filter(c => c.tipo === 'bloqueo').length,
                totalInundaciones: celdasBloqueadasArray.filter(c => c.tipo === 'inundacion').length,
                totalObstaculos: celdasBloqueadasArray.filter(c => c.tipo === 'obstaculo').length
            }
        };

        console.log('✅ Escenario creado exitosamente:', escenario);
        return escenario;

    } catch (error) {
        console.error('❌ Error al crear escenario:', error);
        return null;
    }
}

/**
 * Obtiene todos los escenarios guardados
 * @returns {Array} - Array de escenarios
 */
function obtenerEscenariosGuardados() {
    try {
        const data = localStorage.getItem('escenariosGuardados');
        return data ? JSON.parse(data) : [];
    } catch (error) {
        console.error('❌ Error al obtener escenarios guardados:', error);
        return [];
    }
}

/**
 * Valida si un escenario es compatible con la configuración actual
 * @param {Object} escenario - Escenario a validar
 * @returns {Object} - { valido: boolean, errores: Array }
 */
function validarEscenario(escenario) {
    const errores = [];

    // Validar que existan las calles referenciadas
    escenario.callesConfig.forEach(calleGuardada => {
        const calleActual = window.calles.find(c =>
            (c.id && c.id === calleGuardada.id) || c.nombre === calleGuardada.nombre
        );

        if (!calleActual) {
            errores.push(`La calle "${calleGuardada.nombre}" no existe en el simulador actual`);
        } else {
            // Validar longitud (tamano)
            if (calleActual.tamano !== calleGuardada.tamano) {
                errores.push(
                    `La calle "${calleGuardada.nombre}" tiene una longitud diferente ` +
                    `(actual: ${calleActual.tamano} celdas, guardada: ${calleGuardada.tamano} celdas)`
                );
            }

            // Validar número de carriles
            if (calleActual.carriles !== calleGuardada.carriles) {
                errores.push(
                    `La calle "${calleGuardada.nombre}" tiene un número diferente de carriles ` +
                    `(actual: ${calleActual.carriles}, guardado: ${calleGuardada.carriles})`
                );
            }
        }
    });

    return {
        valido: errores.length === 0,
        errores: errores
    };
}

/**
 * Carga un escenario desde un objeto JSON
 * @param {Object} escenario - Objeto del escenario a cargar
 * @returns {Object} - { exito: boolean, mensaje: string }
 */
function cargarEscenarioDesdeJSON(escenario) {
    try {
        if (!escenario) {
            return { exito: false, mensaje: 'Escenario no válido' };
        }

        // Validar compatibilidad
        const validacion = validarEscenario(escenario);
        if (!validacion.valido) {
            const mensajeError = 'No se puede cargar el escenario:\n\n' +
                validacion.errores.map(e => `• ${e}`).join('\n');
            return { exito: false, mensaje: mensajeError };
        }

        // Limpiar todos los bloqueos actuales (silenciosamente, sin confirmación)
        limpiarTodosLosBloqueosSilencioso();

        lluviaAleatoriaFromJSON(escenario.lluviaAleatoria);

        // Cargar celdas bloqueadas
        let celdasCargadas = 0;
        escenario.celdasBloqueadas.forEach(celda => {
            const calle = window.calles.find(c =>
                (c.id && c.id === celda.calleId) || c.nombre === celda.calleNombre
            );

            if (calle && calle.arreglo && calle.arreglo[celda.carril] && calle.arreglo[celda.carril][celda.indice] !== undefined) {
                // Marcar la celda como bloqueada en el arreglo
                calle.arreglo[celda.carril][celda.indice] = 7;

                // IMPORTANTE: Usar calle.id (o nombre si no hay id) para la clave
                const calleId = calle.id || calle.nombre;
                const key = `${calleId}:${celda.carril}:${celda.indice}`;

                // Registrar en el mapa de celdas bloqueadas con metadata completa
                estadoEscenarios.celdasBloqueadas.set(key, {
                    tipo: celda.tipo,
                    texture: celda.texture
                });

                console.log(`✓ Celda cargada: ${key} - Tipo: ${celda.tipo}, Textura: ${celda.texture}`);
                celdasCargadas++;
            } else {
                console.warn(`⚠️ No se pudo cargar celda en ${celda.calleNombre}[${celda.carril}][${celda.indice}]`);
            }
        });

        // Guardar el escenario actualmente cargado
        window.escenarioActualCargado = {
            id: escenario.id,
            nombre: escenario.nombre,
            fechaCarga: new Date().toISOString()
        };

        // Forzar actualización del renderizado visual
        if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
            // IMPORTANTE: Limpiar todos los sprites existentes primero
            if (window.pixiApp.sceneManager.carroRenderer) {
                // Limpiar el mapa de sprites para forzar recreación
                window.pixiApp.sceneManager.carroRenderer.scene.carroSprites.forEach((sprite, id) => {
                    sprite.destroy();
                });
                window.pixiApp.sceneManager.carroRenderer.scene.carroSprites.clear();

                // Limpiar el estado de vehículos previo
                window.pixiApp.sceneManager.carroRenderer.lastVehicleState.clear();

                // Forzar actualización completa
                window.pixiApp.sceneManager.carroRenderer.updateAll(window.calles);
            }
        }

        // Renderizar el canvas (para modo Canvas 2D)
        if (window.renderizarCanvas) {
            window.renderizarCanvas();
        }

        console.log(`✅ Escenario "${escenario.nombre}" cargado exitosamente. Celdas cargadas: ${celdasCargadas}`);
        return {
            exito: true,
            mensaje: `Escenario cargado exitosamente\n${celdasCargadas} celdas aplicadas`,
            escenario: escenario
        };

    } catch (error) {
        console.error('❌ Error al cargar escenario:', error);
        return { exito: false, mensaje: 'Error al cargar el escenario: ' + error.message };
    }
}

/**
 * Elimina un escenario guardado
 * @param {string} escenarioId - ID del escenario a eliminar
 * @returns {boolean} - true si se eliminó exitosamente
 */
function eliminarEscenario(escenarioId) {
    try {
        let escenarios = obtenerEscenariosGuardados();
        const indiceAntes = escenarios.length;

        escenarios = escenarios.filter(e => e.id !== escenarioId);

        if (escenarios.length === indiceAntes) {
            return false; // No se encontró el escenario
        }

        localStorage.setItem('escenariosGuardados', JSON.stringify(escenarios));
        console.log('✅ Escenario eliminado exitosamente');
        return true;

    } catch (error) {
        console.error('❌ Error al eliminar escenario:', error);
        return false;
    }
}

// ============================================================
// ESCENARIOS BASE (PREDETERMINADOS)
// ============================================================

/**
 * Genera el escenario base "Inundación Masiva"
 * Deja solo un carril libre en todas las calles e inunda los demás
 * @returns {Object} - Objeto del escenario generado
 */
function generarEscenarioInundacionMasiva() {
    console.log('🌊 Generando escenario: Inundación Masiva');

    // Limpiar bloqueos actuales primero
    if (typeof limpiarTodosLosBloqueos === 'function') {
        estadoEscenarios.celdasBloqueadas.clear();
        window.calles.forEach(calle => {
            for (let carril = 0; carril < calle.carriles; carril++) {
                for (let i = 0; i < calle.tamano; i++) {
                    if (calle.arreglo[carril][i] === 7) {
                        calle.arreglo[carril][i] = 0;
                    }
                }
            }
        });
    }

    let celdasInundadas = 0;

    // Iterar sobre todas las calles
    window.calles.forEach(calle => {
        if (!calle.arreglo || calle.carriles <= 1) {
            console.log(`  ⏭️ Calle "${calle.nombre}" tiene solo 1 carril, se omite`);
            return; // Skip calles con 1 solo carril
        }

        console.log(`  🛣️ Procesando calle "${calle.nombre}" (${calle.carriles} carriles, ${calle.tamano} celdas)`);

        // Determinar zonas de conexión (primeras y últimas 5 celdas)
        const zonaInicioConexion = 5;
        const zonaFinConexion = calle.tamano - 5;

        // Limpiar completamente el primer carril (carril 0) de cualquier vehículo
        for (let indice = 0; indice < calle.tamano; indice++) {
            const valorActual = calle.arreglo[0][indice];
            // Si hay un vehículo (1-6) o bloqueo (7), eliminarlo
            if (valorActual !== 0) {
                calle.arreglo[0][indice] = 0;
            }
        }

        // Dejar libre el primer carril (carril 0) completamente
        // Inundar todos los demás carriles (carril 1 en adelante)
        for (let carril = 1; carril < calle.carriles; carril++) {
            for (let indice = 0; indice < calle.tamano; indice++) {
                // Verificar si estamos en zona de conexión
                const esZonaConexion = (indice < zonaInicioConexion || indice >= zonaFinConexion);

                // En zonas de conexión, inundar solo si hay más de 2 carriles
                // para dejar al menos 2 carriles libres para flujo
                if (esZonaConexion && calle.carriles <= 2) {
                    continue; // No inundar en zonas de conexión si solo hay 2 carriles
                }

                // Limpiar cualquier contenido previo (vehículos, bloqueos, etc.)
                const valorAnterior = calle.arreglo[carril][indice];
                if (valorAnterior !== 0) {
                    // Si había algo (vehículo o bloqueo), eliminarlo primero
                    calle.arreglo[carril][indice] = 0;
                }

                // Inundar la celda (forzar valor 7)
                calle.arreglo[carril][indice] = 7;

                // Registrar en el mapa de celdas bloqueadas
                // IMPORTANTE: Usar calle.id o calle.nombre si no hay id
                const calleId = calle.id || calle.nombre;
                const celdaKey = `${calleId}:${carril}:${indice}`;
                estadoEscenarios.celdasBloqueadas.set(celdaKey, {
                    tipo: 'inundacion',
                    texture: 'inundacion'
                });

                celdasInundadas++;
            }
        }

        console.log(`  ✅ "${calle.nombre}": ${celdasInundadas} celdas inundadas`);
    });

    console.log(`🌊 Total de celdas inundadas: ${celdasInundadas}`);

    // Crear objeto del escenario
    const escenario = {
        version: '1.0',
        id: 'base_inundacion_masiva',
        nombre: 'Inundación Masiva (Base)',
        descripcion: 'Escenario base que simula una inundación dejando solo un carril libre en cada calle',
        fechaCreacion: new Date().toISOString(),
        esEscenarioBase: true, // Marcar como escenario base
        callesConfig: window.calles.map(c => ({
            id: c.id || c.nombre,
            nombre: c.nombre,
            tamano: c.tamano,
            carriles: c.carriles
        })),
        celdasBloqueadas: [],
        estadisticas: {
            totalBloqueos: 0,
            totalInundaciones: celdasInundadas,
            totalObstaculos: 0
        }
    };

    // Exportar celdas bloqueadas al formato del escenario
    estadoEscenarios.celdasBloqueadas.forEach((metadata, celdaKey) => {
        const [calleId, carril, indice] = celdaKey.split(':');
        const calle = window.calles.find(c => c.id === calleId || c.nombre === calleId);

        if (calle) {
            escenario.celdasBloqueadas.push({
                calleNombre: calle.nombre,
                calleId: calle.id || calle.nombre,
                carril: parseInt(carril),
                indice: parseInt(indice),
                tipo: metadata.tipo,
                texture: metadata.texture
            });
        }
    });

    console.log('✅ Escenario base "Inundación Masiva" generado exitosamente');
    return escenario;
}

/**
 * Genera el escenario base "Baches Aleatorios"
 * Coloca baches aleatoriamente con 5% de probabilidad en todas las calles
 * @returns {Object} - Objeto del escenario generado
 */
function generarEscenarioBachesAleatorios() {
    console.log('🕳️ Generando escenario: Baches Aleatorios');

    // Limpiar bloqueos actuales primero
    if (typeof limpiarTodosLosBloqueos === 'function') {
        estadoEscenarios.celdasBloqueadas.clear();
        window.calles.forEach(calle => {
            for (let carril = 0; carril < calle.carriles; carril++) {
                for (let i = 0; i < calle.tamano; i++) {
                    if (calle.arreglo[carril][i] === 7) {
                        calle.arreglo[carril][i] = 0;
                    }
                }
            }
        });
    }

    let celdasConBaches = 0;
    const probabilidadBache = 0.05; // 5%

    // Iterar sobre todas las calles
    window.calles.forEach(calle => {
        if (!calle.arreglo) {
            console.log(`  ⏭️ Calle "${calle.nombre}" no tiene arreglo, se omite`);
            return;
        }

        // Omitir calles de un solo carril (evitar bloqueo total)
        if (calle.carriles <= 1) {
            console.log(`  ⏭️ Calle "${calle.nombre}" tiene solo 1 carril, se omite (evitar bloqueo total)`);
            return;
        }

        console.log(`  🛣️ Procesando calle "${calle.nombre}" (${calle.carriles} carriles, ${calle.tamano} celdas)`);

        // Determinar zonas de conexión (primeras y últimas 5 celdas)
        const zonaInicioConexion = 5;
        const zonaFinConexion = calle.tamano - 5;

        let bachesEnCalle = 0;

        // Iterar sobre todos los carriles
        for (let carril = 0; carril < calle.carriles; carril++) {
            for (let indice = 0; indice < calle.tamano; indice++) {
                // Verificar si estamos en zona de conexión
                const esZonaConexion = (indice < zonaInicioConexion || indice >= zonaFinConexion);

                // No poner baches en zonas de conexión para mantener flujo
                if (esZonaConexion) {
                    continue;
                }

                // Generar número aleatorio para decidir si poner bache
                if (Math.random() < probabilidadBache) {
                    // Limpiar cualquier contenido previo (vehículos, bloqueos, etc.)
                    const valorAnterior = calle.arreglo[carril][indice];
                    if (valorAnterior !== 0) {
                        calle.arreglo[carril][indice] = 0;
                    }

                    // Colocar bache (tipo 7 con textura 'bache')
                    calle.arreglo[carril][indice] = 7;

                    // Registrar en el mapa de celdas bloqueadas
                    const calleId = calle.id || calle.nombre;
                    const celdaKey = `${calleId}:${carril}:${indice}`;
                    estadoEscenarios.celdasBloqueadas.set(celdaKey, {
                        tipo: 'obstaculo',
                        texture: 'bache'
                    });

                    celdasConBaches++;
                    bachesEnCalle++;
                }
            }
        }

        console.log(`  ✅ "${calle.nombre}": ${bachesEnCalle} baches colocados`);
    });

    console.log(`🕳️ Total de baches colocados: ${celdasConBaches}`);

    // Crear objeto del escenario
    const escenario = {
        version: '1.0',
        id: 'base_baches_aleatorios',
        nombre: 'Baches Aleatorios (Base)',
        descripcion: 'Escenario base que coloca baches aleatoriamente con 5% de probabilidad en todas las calles',
        fechaCreacion: new Date().toISOString(),
        esEscenarioBase: true,
        callesConfig: window.calles.map(c => ({
            id: c.id || c.nombre,
            nombre: c.nombre,
            tamano: c.tamano,
            carriles: c.carriles
        })),
        celdasBloqueadas: [],
        estadisticas: {
            totalBloqueos: 0,
            totalInundaciones: 0,
            totalObstaculos: celdasConBaches
        }
    };

    // Exportar celdas bloqueadas al formato del escenario
    estadoEscenarios.celdasBloqueadas.forEach((metadata, celdaKey) => {
        const [calleId, carril, indice] = celdaKey.split(':');
        const calle = window.calles.find(c => c.id === calleId || c.nombre === calleId);

        if (calle) {
            escenario.celdasBloqueadas.push({
                calleNombre: calle.nombre,
                calleId: calle.id || calle.nombre,
                carril: parseInt(carril),
                indice: parseInt(indice),
                tipo: metadata.tipo,
                texture: metadata.texture
            });
        }
    });

    console.log('✅ Escenario base "Baches Aleatorios" generado exitosamente');
    return escenario;
}

/**
 * Carga un escenario base predeterminado
 * @param {string} tipoEscenario - Tipo de escenario base ('inundacion_masiva', 'baches_aleatorios', etc.)
 */
function cargarEscenarioBase(tipoEscenario) {
    console.log(`🎯 Cargando escenario base: ${tipoEscenario}`);

    let escenario = null;

    switch (tipoEscenario) {
        case 'inundacion_masiva':
            escenario = generarEscenarioInundacionMasiva();
            break;
        case 'baches_aleatorios':
            escenario = generarEscenarioBachesAleatorios();
            break;
        default:
            console.error(`❌ Tipo de escenario base desconocido: ${tipoEscenario}`);
            alert('Tipo de escenario no reconocido');
            return;
    }

    if (escenario) {
        // Cargar el escenario generado
        const resultado = cargarEscenarioDesdeJSON(escenario);

        if (resultado.exito) {
            const stats = escenario.estadisticas;
            const mensaje = `✅ Escenario "${escenario.nombre}" cargado exitosamente!\n\n` +
                `📊 Estadísticas:\n` +
                (stats.totalInundaciones > 0 ? `• ${stats.totalInundaciones} celdas inundadas\n` : '') +
                (stats.totalObstaculos > 0 ? `• ${stats.totalObstaculos} obstáculos colocados\n` : '') +
                (stats.totalBloqueos > 0 ? `• ${stats.totalBloqueos} bloqueos\n` : '');
            alert(mensaje);
        } else {
            alert(`❌ Error al cargar el escenario:\n${resultado.mensaje}`);
        }
    }
}

// Exponer funciones globalmente
window.inicializarEscenarios = inicializarEscenarios;
window.aplicarLluviaAleatoria = aplicarLluviaAleatoria;
window.lluviaAleatoriaToJSON = lluviaAleatoriaToJSON;
window.lluviaAleatoriaFromJSON = lluviaAleatoriaFromJSON;
window.exportarBloqueos = exportarBloqueos;
window.importarBloqueos = importarBloqueos;
window.estadoEscenarios = estadoEscenarios;
window.crearEscenarioJSON = crearEscenarioJSON;
window.validarEscenario = validarEscenario;
window.cargarEscenarioDesdeJSON = cargarEscenarioDesdeJSON;
window.cargarEscenarioBase = cargarEscenarioBase;
window.generarEscenarioInundacionMasiva = generarEscenarioInundacionMasiva;
window.generarEscenarioBachesAleatorios = generarEscenarioBachesAleatorios;
window.limpiarTodosLosBloqueos = limpiarTodosLosBloqueos;
window.limpiarTodosLosBloqueosSilencioso = limpiarTodosLosBloqueosSilencioso;
window.restablecerSesionEscenarios = restablecerSesionEscenarios;

console.log('✅ escenarios.js cargado');
