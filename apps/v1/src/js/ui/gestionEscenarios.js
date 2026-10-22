/**
 * gestionEscenarios.js - Interfaz de usuario para gestionar escenarios
 * Maneja los modales de guardado y carga de escenarios
 */

console.log('📂 gestionEscenarios.js cargando...');

// Una sola inicialización: los listeners y las instancias de Bootstrap no
// deben duplicarse si el arranque y una prueba manual coinciden.
let gestionEscenariosInicializada = false;

// Referencias a elementos del DOM
let btnGuardarEscenario;
let btnCargarEscenario;
let btnConfirmarGuardarEscenario;
let inputNombreEscenario;
let inputDescripcionEscenario;
let modalGuardarEscenario;
let modalCargarEscenario;
let listaEscenariosGuardados;
let noEscenariosMessage;
let escenarioActualInfo;
let escenarioActualNombre;
let escenarioActualFecha;

// Botones de escenarios base
let btnEscenarioInundacionMasiva;
let btnEscenarioBachesAleatorios;

const SCENARIO_DATE_LOCALES = Object.freeze({
    es: 'es-MX',
    en: 'en-US'
});

/**
 * Locale used only to render dates. Scenario names, descriptions and saved
 * timestamps remain user content and unchanged.
 */
function scenarioDateLocale() {
    const language = window.fluviI18n?.activeLanguage || document.documentElement.lang;
    return SCENARIO_DATE_LOCALES[language] || SCENARIO_DATE_LOCALES.es;
}

function formatScenarioDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString(scenarioDateLocale(), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Shows the result of a core scenario operation with an explicit severity and
 * the catalog key returned by core/escenarios.js.
 */
function notifyScenarioResult(resultado) {
    const tipo = resultado?.exito ? 'success' : 'error';
    if (resultado?.notificationKey) {
        window.fluviNotify[tipo](resultado.notificationKey, resultado.notificationParams);
        return;
    }
    mostrarNotificacion(tipo, notificationTitle(tipo), resultado?.mensaje || '');
}

/**
 * Actualiza el estilo de los botones de escenarios base según modo oscuro/luz de la UI
 */
function actualizarFondoEscenariosBase() {
    // Detectar si la UI está en modo oscuro
    const modoOscuro = document.body.classList.contains('dark-mode');

    // Aplicar estilos a los botones de escenarios base
    const botonesEscenarios = [
        btnEscenarioInundacionMasiva,
        btnEscenarioBachesAleatorios
    ];

    botonesEscenarios.forEach(btn => {
        if (btn) {
            if (modoOscuro) {
                // Modo oscuro: fondo oscuro, texto claro
                btn.style.setProperty('background-color', '#2b2b2b', 'important');
                btn.style.setProperty('color', '#ffffff', 'important');
                btn.style.setProperty('border-color', '#444', 'important');
            } else {
                // Modo claro: fondo blanco, texto oscuro
                btn.style.setProperty('background-color', '#ffffff', 'important');
                btn.style.setProperty('color', '#000000', 'important');
                btn.style.setProperty('border-color', '#dee2e6', 'important');
            }

            // Aplicar también a los elementos internos
            const titulo = btn.querySelector('h6');
            const descripcion = btn.querySelector('p');

            if (titulo) {
                titulo.style.setProperty('color', modoOscuro ? '#ffffff' : '#000000', 'important');
            }
            if (descripcion) {
                descripcion.style.setProperty('color', modoOscuro ? '#b8b8b8' : '#6c757d', 'important');
            }
        }
    });
}

/**
 * Inicializa el módulo de gestión de escenarios
 */
function inicializarGestionEscenarios() {
    if (gestionEscenariosInicializada) return;
    console.log('📂 Inicializando gestión de escenarios...');

    // Obtener referencias a elementos del DOM
    btnGuardarEscenario = document.getElementById('btnGuardarEscenario');
    btnCargarEscenario = document.getElementById('btnCargarEscenario');
    btnConfirmarGuardarEscenario = document.getElementById('btnConfirmarGuardarEscenario');
    inputNombreEscenario = document.getElementById('inputNombreEscenario');
    inputDescripcionEscenario = document.getElementById('inputDescripcionEscenario');
    listaEscenariosGuardados = document.getElementById('listaEscenariosGuardados');
    noEscenariosMessage = document.getElementById('noEscenariosMessage');
    escenarioActualInfo = document.getElementById('escenarioActualInfo');
    escenarioActualNombre = document.getElementById('escenarioActualNombre');
    escenarioActualFecha = document.getElementById('escenarioActualFecha');
    if (escenarioActualNombre) {
        escenarioActualNombre.textContent = tr('scenarios.current.none');
    }

    // Botones de escenarios base
    btnEscenarioInundacionMasiva = document.getElementById('btnEscenarioInundacionMasiva');
    btnEscenarioBachesAleatorios = document.getElementById('btnEscenarioBachesAleatorios');

    // Crear instancias de modales Bootstrap
    const modalGuardarElement = document.getElementById('modalGuardarEscenario');
    const modalCargarElement = document.getElementById('modalCargarEscenario');

    if (modalGuardarElement) {
        modalGuardarEscenario = new bootstrap.Modal(modalGuardarElement);
    }

    if (modalCargarElement) {
        modalCargarEscenario = new bootstrap.Modal(modalCargarElement);
    }

    // Event listeners
    if (btnGuardarEscenario) {
        btnGuardarEscenario.addEventListener('click', abrirModalGuardar);
    }

    if (btnCargarEscenario) {
        btnCargarEscenario.addEventListener('click', abrirModalCargar);
    }

    if (btnConfirmarGuardarEscenario) {
        btnConfirmarGuardarEscenario.addEventListener('click', confirmarGuardarEscenario);
    }

    // Validación en tiempo real del nombre
    if (inputNombreEscenario) {
        inputNombreEscenario.addEventListener('input', function() {
            if (this.value.trim() === '') {
                this.classList.add('is-invalid');
            } else {
                this.classList.remove('is-invalid');
            }
        });
    }

    // Event listeners para escenarios base
    if (btnEscenarioInundacionMasiva) {
        btnEscenarioInundacionMasiva.addEventListener('click', () => {
            cargarEscenarioBaseUI('inundacion_masiva');
        });
    }

    if (btnEscenarioBachesAleatorios) {
        btnEscenarioBachesAleatorios.addEventListener('click', () => {
            cargarEscenarioBaseUI('baches_aleatorios');
        });
    }

    // Actualizar fondo de escenarios base inicialmente
    actualizarFondoEscenariosBase();

    // Observar cambios en la clase 'dark-mode' del body
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                actualizarFondoEscenariosBase();
            }
        });
    });

    // Iniciar observación
    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['class']
    });

    gestionEscenariosInicializada = true;
    console.log('✅ Gestión de escenarios inicializada');
}

/**
 * Carga un escenario base predeterminado y actualiza la UI
 * @param {string} tipoEscenario - Tipo de escenario base
 */
function cargarEscenarioBaseUI(tipoEscenario) {
    console.log(`🎯 Cargando escenario base desde UI: ${tipoEscenario}`);

    // Verificar que la función existe
    if (typeof window.cargarEscenarioBase !== 'function') {
        console.error('❌ window.cargarEscenarioBase no está definido');
        window.fluviNotify.error('scenarios.notifications.baseUnavailable');
        return;
    }

    // Generar y cargar el escenario
    let escenarioGenerado = null;

    try {
        // Generar el escenario según el tipo
        switch (tipoEscenario) {
            case 'inundacion_masiva':
                if (typeof window.generarEscenarioInundacionMasiva !== 'function') {
                    throw new Error(tr('scenarios.notifications.baseUnavailable'));
                }
                escenarioGenerado = window.generarEscenarioInundacionMasiva();
                break;
            case 'baches_aleatorios':
                if (typeof window.generarEscenarioBachesAleatorios !== 'function') {
                    throw new Error(tr('scenarios.notifications.baseUnavailable'));
                }
                escenarioGenerado = window.generarEscenarioBachesAleatorios();
                break;
            default:
                throw new Error(tr('scenarios.notifications.unknownBaseType'));
        }

        // Cargar el escenario generado
        if (escenarioGenerado) {
            const resultado = window.cargarEscenarioDesdeJSON(escenarioGenerado);

            if (resultado.exito) {
                // Actualizar info del escenario actual
                actualizarInfoEscenarioActual(escenarioGenerado);

                // Mostrar notificación de éxito
                window.fluviNotify.success('scenarios.notifications.baseLoaded', {
                    name: escenarioGenerado.nombre,
                    stats: window.describirEstadisticasEscenario(escenarioGenerado.estadisticas)
                });
            } else {
                notifyScenarioResult(resultado);
            }
        }
    } catch (error) {
        console.error('❌ Error al cargar escenario base:', error);
        window.fluviNotify.error('scenarios.notifications.baseLoadFailed', {
            reason: error.message
        });
    }
}

/**
 * Abre el modal para guardar un escenario
 */
function abrirModalGuardar() {
    // Limpiar formulario
    if (inputNombreEscenario) {
        inputNombreEscenario.value = '';
        inputNombreEscenario.classList.remove('is-invalid');
    }

    if (inputDescripcionEscenario) {
        inputDescripcionEscenario.value = '';
    }

    // Un escenario también puede guardar solo la probabilidad de lluvia,
    // antes de iniciar el experimento o de que ocurra la primera inundación.

    // Mostrar modal
    if (modalGuardarEscenario) {
        modalGuardarEscenario.show();
    }
}

/**
 * Confirma y guarda el escenario
 */
function confirmarGuardarEscenario() {
    const nombre = inputNombreEscenario.value.trim();
    const descripcion = inputDescripcionEscenario.value.trim();

    // Validar nombre
    if (nombre === '') {
        inputNombreEscenario.classList.add('is-invalid');
        window.fluviNotify.error('scenarios.notifications.nameRequired');
        return;
    }

    // Crear el escenario directamente (sin localStorage)
    const escenarioGuardado = window.crearEscenarioJSON(nombre, descripcion);

    if (escenarioGuardado) {
        // Descargar como archivo JSON
        descargarEscenarioJSON(escenarioGuardado, nombre);

        // Cerrar modal
        if (modalGuardarEscenario) {
            modalGuardarEscenario.hide();
        }

        // Mostrar notificación de éxito
        window.fluviNotify.success('scenarios.notifications.saved', { name: nombre });

        // Limpiar formulario
        inputNombreEscenario.value = '';
        inputNombreEscenario.classList.remove('is-invalid');
        inputDescripcionEscenario.value = '';
    } else {
        window.fluviNotify.error('scenarios.notifications.saveFailed');
    }
}

/**
 * Descarga un escenario como archivo JSON
 */
function descargarEscenarioJSON(escenario, nombreArchivo) {
    // Convertir a JSON con formato legible
    const jsonString = JSON.stringify(escenario, null, 2);

    // Crear blob
    const blob = new Blob([jsonString], { type: 'application/json' });

    // Crear URL temporal
    const url = URL.createObjectURL(blob);

    // Crear elemento de descarga temporal
    const a = document.createElement('a');
    a.href = url;
    a.download = `escenario_${nombreArchivo.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();

    // Limpiar
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`📥 Escenario descargado como: ${a.download}`);
}

/**
 * Abre el modal para cargar un escenario
 */
function abrirModalCargar() {
    // Los escenarios se cargan desde archivos JSON o desde la lista local
    // heredada (compatible con versiones anteriores del simulador).
    renderizarListaEscenarios();

    // Mostrar modal
    if (modalCargarEscenario) {
        modalCargarEscenario.show();
    }
}

/**
 * Crea un elemento HTML para un escenario en la lista. El nombre y la
 * descripción se asignan como texto para conservar literalmente el contenido
 * creado por el usuario.
 */
function crearItemEscenario(escenario) {
    const div = document.createElement('div');
    div.className = 'list-group-item list-group-item-action';

    const fila = document.createElement('div');
    fila.className = 'd-flex w-100 justify-content-between align-items-start';

    const contenido = document.createElement('div');
    contenido.className = 'flex-grow-1';

    const titulo = document.createElement('h6');
    titulo.className = 'mb-1';
    titulo.textContent = escenario.nombre;
    contenido.appendChild(titulo);

    if (escenario.descripcion) {
        const descripcion = document.createElement('p');
        descripcion.className = 'mb-1 small text-muted';
        descripcion.textContent = escenario.descripcion;
        contenido.appendChild(descripcion);
    }

    const fecha = document.createElement('small');
    fecha.className = 'text-muted';
    const stats = escenario.estadisticas || {
        totalBloqueos: 0,
        totalInundaciones: 0,
        totalObstaculos: 0
    };
    const totalElementos = stats.totalBloqueos + stats.totalInundaciones + stats.totalObstaculos;
    fecha.textContent = `📅 ${formatScenarioDate(escenario.fechaCreacion)} | ${tr('scenarios.list.elements', { count: totalElementos })}`;
    contenido.appendChild(fecha);

    const insignias = document.createElement('div');
    insignias.className = 'mt-2 small';
    const insignia = (clase, key, count) => {
        if (!(count > 0)) return;
        const badge = document.createElement('span');
        badge.className = `badge ${clase} me-1`;
        badge.textContent = tr(key, { count });
        insignias.appendChild(badge);
    };
    insignia('bg-danger', 'scenarios.list.blocks', stats.totalBloqueos);
    insignia('bg-info', 'scenarios.list.floods', stats.totalInundaciones);
    insignia('bg-warning', 'scenarios.list.obstacles', stats.totalObstaculos);
    contenido.appendChild(insignias);

    const acciones = document.createElement('div');
    acciones.className = 'btn-group-vertical ms-2';
    acciones.setAttribute('role', 'group');

    const cargar = document.createElement('button');
    cargar.type = 'button';
    cargar.className = 'btn btn-sm btn-primary';
    cargar.textContent = tr('scenarios.list.load');
    cargar.addEventListener('click', () => cargarEscenarioUI(escenario));

    const eliminar = document.createElement('button');
    eliminar.type = 'button';
    eliminar.className = 'btn btn-sm btn-outline-danger';
    eliminar.textContent = tr('scenarios.list.delete');
    eliminar.addEventListener('click', () => confirmarEliminarEscenario(escenario));

    acciones.append(cargar, eliminar);
    fila.append(contenido, acciones);
    div.appendChild(fila);

    return div;
}

/**
 * Pinta la lista de escenarios guardados en el navegador y su estado vacío.
 */
function renderizarListaEscenarios() {
    if (!listaEscenariosGuardados) return;
    const escenarios = typeof window.obtenerEscenariosGuardados === 'function'
        ? window.obtenerEscenariosGuardados()
        : [];
    listaEscenariosGuardados.replaceChildren(...escenarios.map(crearItemEscenario));
    if (noEscenariosMessage) {
        noEscenariosMessage.style.display = escenarios.length > 0 ? 'none' : 'block';
    }
}

/**
 * Pide confirmación antes de eliminar un escenario de la lista local.
 */
function confirmarEliminarEscenario(escenario) {
    mostrarConfirmacion(
        tr('scenarios.list.deleteTitle'),
        window.fluviI18n.tEscaped('scenarios.list.deleteQuestion', { name: escenario.nombre }),
        () => {
            const eliminado = typeof window.eliminarEscenario === 'function' &&
                window.eliminarEscenario(escenario.id);
            if (eliminado) {
                window.fluviNotify.success('scenarios.list.deleted', { name: escenario.nombre });
                renderizarListaEscenarios();
            } else {
                window.fluviNotify.error('scenarios.list.deleteFailed', { name: escenario.nombre });
            }
        },
        null,
        {
            btnConfirmText: tr('scenarios.list.delete'),
            btnConfirmClass: 'btn-danger',
            btnCancelText: tr('common.cancel')
        }
    );
}

/**
 * Carga un escenario desde un objeto JSON
 */
function cargarEscenarioUI(escenarioObj) {
    const resultado = window.cargarEscenarioDesdeJSON(escenarioObj);

    if (resultado.exito) {
        // Cerrar modal
        if (modalCargarEscenario) {
            modalCargarEscenario.hide();
        }

        // Actualizar info del escenario actual
        actualizarInfoEscenarioActual(resultado.escenario);
    }

    // Mostrar notificación con la severidad y el mensaje traducidos
    notifyScenarioResult(resultado);
}

/**
 * Actualiza la información del escenario actualmente cargado
 */
function actualizarInfoEscenarioActual(escenario) {
    if (escenarioActualInfo && escenarioActualNombre && escenarioActualFecha) {
        escenarioActualNombre.textContent = escenario.nombre;
        escenarioActualFecha.textContent = formatScenarioDate(escenario.fechaCreacion);
        escenarioActualInfo.style.display = 'block';
    }
}

/**
 * Limpia la información del escenario actualmente cargado
 */
function limpiarInfoEscenarioActual() {
    if (escenarioActualInfo) {
        escenarioActualInfo.style.display = 'none';
    }
    if (escenarioActualNombre) {
        escenarioActualNombre.textContent = tr('scenarios.current.none');
    }

    window.escenarioActualCargado = null;
}

/**
 * Carga un escenario desde un archivo JSON subido
 */
function cargarDesdeArchivoJSON(event) {
    const file = event.target.files[0];

    if (!file) {
        return;
    }

    // Verificar que sea un archivo JSON
    if (!file.name.endsWith('.json')) {
        window.fluviNotify.error('scenarios.notifications.invalidFileType');
        return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
        // Un error de sintaxis JSON es distinto de un archivo JSON válido que
        // no tiene la forma de un escenario.
        let escenario;
        try {
            escenario = JSON.parse(e.target.result);
        } catch (error) {
            console.error('❌ Error al parsear JSON:', error);
            window.fluviNotify.error('scenarios.notifications.parseFailed', {
                reason: error.message
            });
            event.target.value = ''; // Limpiar input
            return;
        }

        // Validar estructura básica
        if (!escenario || !escenario.version || !escenario.nombre || !Array.isArray(escenario.celdasBloqueadas)) {
            window.fluviNotify.error('scenarios.validation.invalidFormat');
            event.target.value = '';
            return;
        }

        // Cargar el escenario directamente (sin localStorage)
        const resultado = window.cargarEscenarioDesdeJSON(escenario);

        if (resultado.exito) {
            // Cerrar modal
            if (modalCargarEscenario) {
                modalCargarEscenario.hide();
            }

            // Actualizar info del escenario actual
            actualizarInfoEscenarioActual(escenario);

            // Mostrar notificación de éxito
            window.fluviNotify.success('scenarios.notifications.loadedFromFile', {
                name: escenario.nombre,
                count: resultado.celdasCargadas
            });
        } else {
            notifyScenarioResult(resultado);
        }

        // Limpiar input para permitir cargar el mismo archivo nuevamente
        event.target.value = '';
    };

    reader.onerror = () => {
        window.fluviNotify.error('scenarios.notifications.readFailed');
        event.target.value = ''; // Limpiar input
    };

    // Leer el archivo como texto
    reader.readAsText(file);
}

// Exponer funciones globalmente
window.inicializarGestionEscenarios = inicializarGestionEscenarios;
window.cargarEscenarioUI = cargarEscenarioUI;
window.cargarDesdeArchivoJSON = cargarDesdeArchivoJSON;
window.actualizarFondoEscenariosBase = actualizarFondoEscenariosBase;

console.log('✅ gestionEscenarios.js cargado');
