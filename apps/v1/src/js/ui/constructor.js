// ==================== CONSTRUCTOR DE SIMULACIONES ====================
// Sistema para crear, editar, guardar y cargar simulaciones personalizadas

// Variables globales del constructor
const modoConstructor = false;
let simulacionActual = {
    nombre: "Nueva Simulación",
    calles: [],
    conexiones: [],
    edificios: []
};

window.referenceImage = null;
let referenceImageRequest = 0;

function redrawReferenceImage() {
    if (window.USE_PIXI && window.pixiApp?.sceneManager) {
        window.pixiApp.sceneManager.renderAll();
    }
    if (window.renderizarCanvas) window.renderizarCanvas();
}

function referenceViewport() {
    const canvas = document.getElementById('simuladorCanvas');
    const scale = Number(window.escala) || 1;
    return {
        scale,
        width: (canvas?.clientWidth || window.innerWidth) / scale,
        height: (canvas?.clientHeight || window.innerHeight) / scale,
        offsetX: Number(window.offsetX) || 0,
        offsetY: Number(window.offsetY) || 0
    };
}

function pendingLinkedReference(url, previous, display) {
    const view = referenceViewport();
    return {
        url, x: previous?.x ?? -view.offsetX / view.scale + (view.width - 160) / 2,
        y: previous?.y ?? -view.offsetY / view.scale + (view.height - 90) / 2,
        width: previous?.width ?? 160, height: previous?.height ?? 90,
        rotation: Number.isFinite(previous?.rotation) ? previous.rotation : 0,
        ...display, unavailable: true
    };
}

function placedReference(source, image, previous, savedPlacement, display) {
    if (previous && Number.isFinite(previous.x) && Number.isFinite(previous.y) &&
        Number.isFinite(previous.width) && Number.isFinite(previous.height)) {
        // Saved maps keep exact geometry. Replacements fit inside the old bounds;
        // a broken link retains its bounds because its intrinsic size is unknown.
        const retainBounds = savedPlacement || previous.unavailable;
        const fit = Math.min(previous.width / image.naturalWidth, previous.height / image.naturalHeight);
        const width = retainBounds ? previous.width : image.naturalWidth * fit;
        const height = retainBounds ? previous.height : image.naturalHeight * fit;
        return {
            ...source, x: previous.x + (previous.width - width) / 2,
            y: previous.y + (previous.height - height) / 2, width, height, image,
            rotation: Number.isFinite(previous.rotation) ? previous.rotation : 0, ...display
        };
    }
    const view = referenceViewport();
    const fit = Math.min(view.width * 0.8 / image.naturalWidth, view.height * 0.8 / image.naturalHeight);
    const width = image.naturalWidth * fit;
    const height = image.naturalHeight * fit;
    return {
        ...source, x: -view.offsetX / view.scale + (view.width - width) / 2,
        y: -view.offsetY / view.scale + (view.height - height) / 2, width, height, image,
        rotation: 0, ...display
    };
}

function loadReferenceImage(source) {
    const image = new Image();
    return new Promise((resolve, reject) => {
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('No se pudo cargar la imagen de referencia.'));
        image.src = source;
    });
}

function referenceInput(data) {
    const dataUrl = typeof data === 'string' ? data : data.dataUrl;
    const url = typeof data === 'object' ? data.url : null;
    if (!dataUrl && !url) throw new Error('La imagen de referencia no contiene datos ni URL.');
    if (url && !/^https?:\/\//i.test(url)) throw new Error('Introduce una URL HTTP o HTTPS de imagen.');
    const savedPlacement = typeof data === 'object' &&
        Number.isFinite(data.x) && Number.isFinite(data.y) &&
        Number.isFinite(data.width) && Number.isFinite(data.height);
    const previous = savedPlacement ? data : window.referenceImage;
    const display = {
        visible: previous?.visible !== false,
        opacity: Number.isFinite(previous?.opacity) ? Math.max(0, Math.min(1, previous.opacity)) : (savedPlacement ? 1 : 0.7),
        locked: previous?.locked === true
    };
    return { dataUrl, url, savedPlacement, previous, display };
}

window.setReferenceImage = async function (data) {
    const request = ++referenceImageRequest;
    if (data == null) {
        window.referenceImage = null;
        window.referenceImageEditor?.sync();
        redrawReferenceImage();
        return;
    }

    const { dataUrl, url, savedPlacement, previous, display } = referenceInput(data);
    // Publish the link before loading it: a failed request must still have a
    // map-space location and remain serializable/replacable.
    if (url) {
        window.referenceImage = pendingLinkedReference(url, previous, display);
        window.referenceImageEditor?.select();
        redrawReferenceImage();
    }
    let image;
    try {
        image = await loadReferenceImage(url || dataUrl);
    } catch (error) {
        if (!url) throw error;
        return; // The linked reference and its marker remain at the saved position.
    }
    if (request !== referenceImageRequest) return; // A newer selection won the race.
    window.referenceImage = placedReference(url ? { url } : { dataUrl }, image, previous, savedPlacement, display);
    window.referenceImageEditor?.select();
    redrawReferenceImage();
};

// Variables para manejar event handlers y evitar duplicados
let handlerNuevaConexion = null;
let handlerNuevoEdificio = null;

// ==================== INICIALIZACIÓN ====================

function inicializarConstructor() {
    console.log("🏗️ Constructor de simulaciones inicializado");

    // Poblar selector de edificios si existen
    if (window.edificios) {
        const selectEdificio = document.getElementById('selectEdificio');
        if (selectEdificio) {
            window.edificios.forEach((edificio, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = edificio.label || `Edificio ${index + 1}`;
                selectEdificio.appendChild(option);
            });
        }
    }

    configurarEventosConstructor();
}

// ==================== CONFIGURACIÓN DE EVENTOS ====================

function configurarEventosConstructor() {
    document.getElementById('inputImagenReferencia')?.addEventListener('change', async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
                reader.readAsDataURL(file);
            });
            await window.setReferenceImage({ dataUrl });
        } catch (error) {
            alert(`No se pudo cargar la imagen: ${error.message}`);
        } finally {
            event.target.value = '';
        }
    });
    document.getElementById('btnAgregarUrlImagenReferencia')?.addEventListener('click', async () => {
        const input = document.getElementById('inputUrlImagenReferencia');
        const url = input.value.trim();
        try {
            await window.setReferenceImage({ url });
        } catch (error) {
            alert(`No se pudo enlazar la imagen: ${error.message}`);
        }
    });
    document.getElementById('btnEliminarImagenReferencia')?.addEventListener('click', () => window.setReferenceImage(null));
    // Botón Agregar Calle
    const btnAgregarCalle = document.getElementById('btnAgregarCalle');
    if (btnAgregarCalle) {
        btnAgregarCalle.addEventListener('click', mostrarDialogoNuevaCalle);
    }

    // Botón Agregar Edificio
    const btnAgregarEdificio = document.getElementById('btnAgregarEdificio');
    if (btnAgregarEdificio) {
        btnAgregarEdificio.addEventListener('click', mostrarDialogoNuevoEdificio);
    }

    // Botón Editar Edificio
    const btnEditarEdificio = document.getElementById('btnEditarEdificio');
    if (btnEditarEdificio) {
        btnEditarEdificio.addEventListener('click', editarEdificioSeleccionado);
    }

    // Botón Agregar Conexión
    const btnAgregarConexion = document.getElementById('btnAgregarConexion');
    if (btnAgregarConexion) {
        btnAgregarConexion.addEventListener('click', mostrarDialogoNuevaConexion);
    }

    // Botón Guardar Simulación
    const btnGuardarSimulacion = document.getElementById('btnGuardarSimulacion');
    if (btnGuardarSimulacion) {
        btnGuardarSimulacion.addEventListener('click', guardarSimulacion);
    }

    // Botón Cargar Simulación
    const btnCargarSimulacion = document.getElementById('btnCargarSimulacion');
    if (btnCargarSimulacion) {
        btnCargarSimulacion.addEventListener('click', () => {
            document.getElementById('inputCargarSimulacion').click();
        });
    }

    // Input file para cargar
    const inputCargarSimulacion = document.getElementById('inputCargarSimulacion');
    if (inputCargarSimulacion) {
        inputCargarSimulacion.addEventListener('change', cargarSimulacion);
    }

    // Botón Nueva Simulación
    const btnNuevaSimulacion = document.getElementById('btnNuevaSimulacion');
    if (btnNuevaSimulacion) {
        btnNuevaSimulacion.addEventListener('click', nuevaSimulacion);
    }

    // Botón Eliminar Objeto (calle o edificio)
    const btnEliminarObjeto = document.getElementById('btnEliminarObjeto');
    if (btnEliminarObjeto) {
        btnEliminarObjeto.addEventListener('click', eliminarObjetoSeleccionado);
    }

    // Botón Mostrar Lista de Conexiones
    const btnMostrarListaConexiones = document.getElementById('btnMostrarListaConexiones');
    if (btnMostrarListaConexiones) {
        btnMostrarListaConexiones.addEventListener('click', toggleListaConexiones);
    }

    // NOTA: Los botones de métricas (CSV, JSON, Limpiar) son manejados por graficas.js
    // para evitar duplicación de event listeners

}

// ==================== DIÁLOGO NUEVA CALLE ====================

function mostrarDialogoNuevaCalle() {
    // Mostrar el modal
    const modal = new bootstrap.Modal(document.getElementById('modalNuevaCalle'));
    modal.show();

    // Configurar visibilidad del campo de probabilidad de generación según el tipo
    const selectTipoCalle = document.getElementById('selectTipoCalle');
    const campoGeneracionModal = document.getElementById('campoGeneracionModal');
    const inputProbGenCalle = document.getElementById('inputProbGenCalle');

    // Función para mostrar/ocultar el campo según el tipo
    function actualizarVisibilidadCampoGeneracion() {
        const tipoSeleccionado = selectTipoCalle.value;
        if (tipoSeleccionado === 'GENERADOR') {
            campoGeneracionModal.style.display = 'block';
            inputProbGenCalle.required = true;
        } else {
            campoGeneracionModal.style.display = 'none';
            inputProbGenCalle.required = false;
            inputProbGenCalle.value = '0'; // Resetear a 0 para tipos que no generan
        }
    }

    // Ejecutar al cargar para establecer estado inicial
    actualizarVisibilidadCampoGeneracion();

    // Event listener para cambios en el selector de tipo
    selectTipoCalle.addEventListener('change', actualizarVisibilidadCampoGeneracion);

    // Configurar evento del botón confirmar (solo una vez)
    const btnConfirmar = document.getElementById('btnConfirmarNuevaCalle');
    const nuevoHandler = () => {
        // Obtener referencias a los inputs
        const inputNombre = document.getElementById('inputNombreCalle');
        const inputTamano = document.getElementById('inputTamanoCalle');
        const inputCarriles = document.getElementById('inputCarrilesCalle');
        const inputX = document.getElementById('inputXCalle');
        const inputY = document.getElementById('inputYCalle');
        const inputAngulo = document.getElementById('inputAnguloCalle');
        const inputProbGen = document.getElementById('inputProbGenCalle');
        const inputProbSalto = document.getElementById('inputProbSaltoCalle');

        // Obtener valores
        const nombre = inputNombre.value.trim();
        const tamano = parseInt(inputTamano.value);
        const tipo = document.getElementById('selectTipoCalle').value;
        const carriles = parseInt(inputCarriles.value);
        const x = parseFloat(inputX.value);
        const y = parseFloat(inputY.value);
        const angulo = parseFloat(inputAngulo.value);
        let probGen = parseFloat(inputProbGen.value); // let en lugar de const porque puede ser reasignada
        const probSalto = parseFloat(inputProbSalto.value);

        // Flag para validación
        let isValid = true;

        // Validar nombre (solo letras, números, espacios, guiones y puntos)
        const nombreRegex = /^[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s\-.]+$/;
        if (!nombre || nombre === '') {
            inputNombre.classList.add('is-invalid');
            mostrarNotificacion('error', 'Error de Validación', 'El nombre de la calle es obligatorio.');
            isValid = false;
        } else if (!nombreRegex.test(nombre)) {
            inputNombre.classList.add('is-invalid');
            mostrarNotificacion('error', 'Error de Validación', 'El nombre contiene caracteres inválidos. Solo letras, números, espacios, guiones y puntos.');
            isValid = false;
        } else {
            inputNombre.classList.remove('is-invalid');
        }

        // Validar tamaño (1-2500)
        if (isNaN(tamano) || tamano < 1 || tamano > 2500) {
            inputTamano.classList.add('is-invalid');
            mostrarNotificacion('error', 'Error de Validación', 'El tamaño debe estar entre 1 y 2500 celdas.');
            isValid = false;
        } else {
            inputTamano.classList.remove('is-invalid');
        }

        // Validar carriles (1-10)
        if (isNaN(carriles) || carriles < 1 || carriles > 10) {
            inputCarriles.classList.add('is-invalid');
            mostrarNotificacion('error', 'Error de Validación', 'El número de carriles debe estar entre 1 y 10.');
            isValid = false;
        } else {
            inputCarriles.classList.remove('is-invalid');
        }

        // Validar posiciones X, Y
        if (isNaN(x)) {
            inputX.classList.add('is-invalid');
            mostrarNotificacion('error', 'Error de Validación', 'La posición X es inválida.');
            isValid = false;
        } else {
            inputX.classList.remove('is-invalid');
        }

        if (isNaN(y)) {
            inputY.classList.add('is-invalid');
            mostrarNotificacion('error', 'Error de Validación', 'La posición Y es inválida.');
            isValid = false;
        } else {
            inputY.classList.remove('is-invalid');
        }

        // Validar ángulo (0-360)
        if (isNaN(angulo) || angulo < 0 || angulo > 360) {
            inputAngulo.classList.add('is-invalid');
            mostrarNotificacion('error', 'Error de Validación', 'El ángulo debe estar entre 0 y 360 grados.');
            isValid = false;
        } else {
            inputAngulo.classList.remove('is-invalid');
        }

        // Validar probabilidad de generación (0-100) - SOLO para tipo GENERADOR
        if (tipo === 'GENERADOR') {
            if (isNaN(probGen) || probGen < 0 || probGen > 100) {
                inputProbGen.classList.add('is-invalid');
                mostrarNotificacion('error', 'Error de Validación', 'La probabilidad de generación debe estar entre 0 y 100.');
                isValid = false;
            } else {
                inputProbGen.classList.remove('is-invalid');
            }
        } else {
            // Para tipos CONEXION y DEVORADOR, establecer probabilidad en 0
            probGen = 0;
            inputProbGen.classList.remove('is-invalid');
        }

        // Validar probabilidad de salto (0-100)
        if (isNaN(probSalto) || probSalto < 0 || probSalto > 100) {
            inputProbSalto.classList.add('is-invalid');
            mostrarNotificacion('error', 'Error de Validación', 'La probabilidad de cambio de carril debe estar entre 0 y 100.');
            isValid = false;
        } else {
            inputProbSalto.classList.remove('is-invalid');
        }

        // Si hay errores de validación, no continuar
        if (!isValid) {
            return;
        }

        // Convertir probabilidades de porcentaje (0-100) a decimal (0-1)
        const probGenDecimal = probGen / 100;
        const probSaltoDecimal = probSalto / 100;

        // Agregar calle
        agregarCalle(nombre, tamano, tipo, x, y, angulo, probGenDecimal, carriles, probSaltoDecimal);

        // Cerrar modal
        modal.hide();

        // Limpiar formulario y validaciones
        inputNombre.value = '';
        inputNombre.classList.remove('is-invalid');
        inputTamano.value = '100';
        inputTamano.classList.remove('is-invalid');
        inputCarriles.value = '3';
        inputCarriles.classList.remove('is-invalid');
        inputX.value = '500';
        inputX.classList.remove('is-invalid');
        inputY.value = '500';
        inputY.classList.remove('is-invalid');
        inputAngulo.value = '0';
        inputAngulo.classList.remove('is-invalid');
        inputProbGen.value = '50';
        inputProbGen.classList.remove('is-invalid');
        inputProbSalto.value = '2';
        inputProbSalto.classList.remove('is-invalid');

        // Remover listener
        btnConfirmar.removeEventListener('click', nuevoHandler);
    };

    btnConfirmar.removeEventListener('click', nuevoHandler);
    btnConfirmar.addEventListener('click', nuevoHandler);

    // ==================== VALIDACIÓN EN TIEMPO REAL ====================

    // Validar nombre en tiempo real
    const inputNombre = document.getElementById('inputNombreCalle');
    const nombreRegex = /^[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s\-.]+$/;
    inputNombre.addEventListener('input', function() {
        const valor = this.value.trim();
        if (valor === '' || !nombreRegex.test(valor)) {
            this.classList.add('is-invalid');
        } else {
            this.classList.remove('is-invalid');
        }
    });

    // Validar tamaño en tiempo real (1-2500)
    const inputTamano = document.getElementById('inputTamanoCalle');
    inputTamano.addEventListener('input', function() {
        const valor = parseInt(this.value);
        if (isNaN(valor) || valor < 1 || valor > 2500) {
            this.classList.add('is-invalid');
        } else {
            this.classList.remove('is-invalid');
        }
    });

    // Validar carriles en tiempo real (1-10)
    const inputCarriles = document.getElementById('inputCarrilesCalle');
    inputCarriles.addEventListener('input', function() {
        const valor = parseInt(this.value);
        if (isNaN(valor) || valor < 1 || valor > 10) {
            this.classList.add('is-invalid');
        } else {
            this.classList.remove('is-invalid');
        }
    });

    // Validar ángulo en tiempo real (0-360)
    const inputAngulo = document.getElementById('inputAnguloCalle');
    inputAngulo.addEventListener('input', function() {
        const valor = parseFloat(this.value);
        if (isNaN(valor) || valor < 0 || valor > 360) {
            this.classList.add('is-invalid');
        } else {
            this.classList.remove('is-invalid');
        }
    });

    // Validar probabilidad de generación en tiempo real (0-100)
    const inputProbGen = document.getElementById('inputProbGenCalle');
    inputProbGen.addEventListener('input', function() {
        const valor = parseFloat(this.value);
        if (isNaN(valor) || valor < 0 || valor > 100) {
            this.classList.add('is-invalid');
        } else {
            this.classList.remove('is-invalid');
        }
    });

    // Validar probabilidad de salto en tiempo real (0-100)
    const inputProbSalto = document.getElementById('inputProbSaltoCalle');
    inputProbSalto.addEventListener('input', function() {
        const valor = parseFloat(this.value);
        if (isNaN(valor) || valor < 0 || valor > 100) {
            this.classList.add('is-invalid');
        } else {
            this.classList.remove('is-invalid');
        }
    });

    // Corrección automática al perder el foco
    inputTamano.addEventListener('blur', function() {
        let valor = parseInt(this.value);
        if (!isNaN(valor)) {
            if (valor < 1) valor = 1;
            if (valor > 2500) valor = 2500;
            this.value = valor;
            this.classList.remove('is-invalid');
        }
    });

    inputCarriles.addEventListener('blur', function() {
        let valor = parseInt(this.value);
        if (!isNaN(valor)) {
            if (valor < 1) valor = 1;
            if (valor > 10) valor = 10;
            this.value = valor;
            this.classList.remove('is-invalid');
        }
    });

    inputAngulo.addEventListener('blur', function() {
        let valor = parseFloat(this.value);
        if (!isNaN(valor)) {
            if (valor < 0) valor = 0;
            if (valor > 360) valor = 360;
            this.value = valor;
            this.classList.remove('is-invalid');
        }
    });

    inputProbGen.addEventListener('blur', function() {
        let valor = parseFloat(this.value);
        if (!isNaN(valor)) {
            if (valor < 0) valor = 0;
            if (valor > 100) valor = 100;
            this.value = Math.round(valor); // Redondear a número entero
            this.classList.remove('is-invalid');
        }
    });

    inputProbSalto.addEventListener('blur', function() {
        let valor = parseFloat(this.value);
        if (!isNaN(valor)) {
            if (valor < 0) valor = 0;
            if (valor > 100) valor = 100;
            this.value = Math.round(valor); // Redondear a número entero
            this.classList.remove('is-invalid');
        }
    });
}

// ==================== AGREGAR CALLE ====================

function agregarCalle(nombre, tamano, tipo, x, y, angulo, probabilidadGeneracion, carriles, probabilidadSaltoDeCarril, silencioso = false) {
    // Mapear tipo string a constante
    const TIPOS = {
        GENERADOR: "generador",
        CONEXION: "conexion",
        DEVORADOR: "devorador"
    };

    const tipoMapeado = TIPOS[tipo] || TIPOS.CONEXION;

    // Crear calle usando la función existente
    if (typeof window.crearCalle === 'function') {
        const calle = window.crearCalle(
            nombre,
            tamano,
            tipoMapeado,
            x,
            y,
            angulo,
            probabilidadGeneracion,
            carriles,
            probabilidadSaltoDeCarril
        );

        // Agregar a simulación actual
        simulacionActual.calles.push({
            nombre,
            tamano,
            tipo,
            x,
            y,
            angulo,
            probabilidadGeneracion,
            carriles,
            probabilidadSaltoDeCarril
        });

        // Actualizar selector
        actualizarSelectorCalles();

        // Renderizar en PixiJS si está activo
        if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
            if (calle.esCurva) {
                window.pixiApp.sceneManager.calleRenderer?.renderCalleCurva(calle);
            } else {
                window.pixiApp.sceneManager.calleRenderer?.renderCalleRecta(calle);
            }
            // Actualizar etiquetas cuando se agrega una calle
            window.pixiApp.sceneManager.refreshEtiquetas();
        }

        // Renderizar Canvas 2D si existe
        if (window.renderizarCanvas) {
            window.renderizarCanvas();
        }

        console.log(`✅ Calle "${nombre}" agregada a la simulación`);

        return true;
    } else {
        console.error("❌ Función crearCalle no disponible");
        if (!silencioso) {
            alert("Error: No se puede crear la calle");
        }
        return false;
    }
}

// ==================== DIÁLOGO NUEVA CONEXIÓN ====================

// ========== FUNCIONES DE VALIDACIÓN GLOBALES ==========

// Función para validar si ya existe una conexión duplicada
function validarConexionDuplicada(origenIdx, carrilOrigen, destinoIdx, carrilDestino) {
    if (!window.conexiones) return false;

    // Buscar conexión duplicada exacta
    const duplicada = window.conexiones.find(conn => {
        return conn.origen === window.calles[origenIdx] &&
               conn.destino === window.calles[destinoIdx] &&
               conn.carrilOrigen === carrilOrigen &&
               conn.carrilDestino === carrilDestino;
    });

    return duplicada !== undefined;
}

// Función para validar que no haya carriles destino duplicados
function validarCarrilesUnicos() {
    const selectDestino = document.getElementById('selectCalleDestino');
    const destinoIdx = parseInt(selectDestino.value);
    if (isNaN(destinoIdx)) return true;

    const destino = window.calles[destinoIdx];
    const numCarriles = destino.carriles;

    const carrilesUsados = new Set();
    let hayDuplicados = false;

    for (let i = 0; i < numCarriles; i++) {
        const selectCarril = document.getElementById(`carrilDestinoSalida${i}`);
        const probInput = document.getElementById(`probSalida${i}`);

        if (!selectCarril || !probInput) continue;

        const probabilidad = parseFloat(probInput.value);

        // Solo validar si la probabilidad es > 0 (salida activa)
        if (probabilidad > 0) {
            const carrilDestino = parseInt(selectCarril.value);

            if (carrilesUsados.has(carrilDestino)) {
                // Duplicado encontrado
                selectCarril.classList.add('is-invalid');
                hayDuplicados = true;
            } else {
                selectCarril.classList.remove('is-invalid');
                carrilesUsados.add(carrilDestino);
            }
        } else {
            selectCarril.classList.remove('is-invalid');
        }
    }

    return !hayDuplicados;
}

// Función para validar un campo de probabilidad individual
function validarProbabilidadSalida(index) {
    const probInput = document.getElementById(`probSalida${index}`);
    if (!probInput) return true;

    const prob = parseFloat(probInput.value);

    if (isNaN(prob) || prob < 0 || prob > 100) {
        probInput.classList.add('is-invalid');
        return false;
    } else {
        probInput.classList.remove('is-invalid');
        return true;
    }
}

// Función para validar suma de probabilidades = 100%
function validarSumaProbabilidades() {
    const selectDestino = document.getElementById('selectCalleDestino');
    const destinoIdx = parseInt(selectDestino.value);
    if (isNaN(destinoIdx)) return true;

    const destino = window.calles[destinoIdx];
    const numCarriles = destino.carriles;

    let suma = 0;
    for (let i = 0; i < numCarriles; i++) {
        const probInput = document.getElementById(`probSalida${i}`);
        if (probInput) {
            const prob = parseFloat(probInput.value) || 0;
            suma += prob;
        }
    }

    // Mostrar advertencia si la suma no es 100%
    const contenedor = document.getElementById('contenedorDistribucionesProbabilisticas');
    if (!contenedor) return true; // Si no existe el contenedor, salir

    let alertaSuma = contenedor.querySelector('.alerta-suma-probabilidades');

    if (Math.abs(suma - 100) > 0.01) {
        if (!alertaSuma) {
            alertaSuma = document.createElement('div');
            alertaSuma.className = 'alert alert-warning alert-sm mt-2 alerta-suma-probabilidades';
            alertaSuma.innerHTML = `<strong>⚠️ Advertencia:</strong> La suma de probabilidades es <strong>${suma.toFixed(1)}%</strong>. Se recomienda que sume 100% para una distribución correcta.`;
            contenedor.insertBefore(alertaSuma, contenedor.firstChild);
        } else {
            alertaSuma.innerHTML = `<strong>⚠️ Advertencia:</strong> La suma de probabilidades es <strong>${suma.toFixed(1)}%</strong>. Se recomienda que sume 100% para una distribución correcta.`;
        }
        return false;
    } else {
        if (alertaSuma) {
            alertaSuma.remove();
        }
        return true;
    }
}

// Función para validar posiciones
function validarPosiciones(index) {
    const selectOrigen = document.getElementById('selectCalleOrigen');
    const selectDestino = document.getElementById('selectCalleDestino');
    const origenIdx = parseInt(selectOrigen.value);
    const destinoIdx = parseInt(selectDestino.value);

    if (isNaN(origenIdx) || isNaN(destinoIdx)) return true;

    const origen = window.calles[origenIdx];
    const destino = window.calles[destinoIdx];

    const posOrigenInput = document.getElementById(`posOrigenSalida${index}`);
    const posDestinoInput = document.getElementById(`posDestinoSalida${index}`);

    if (!posOrigenInput || !posDestinoInput) return true;

    let isValid = true;

    // Validar posición origen
    const posOrigen = parseInt(posOrigenInput.value);
    if (isNaN(posOrigen) || posOrigen < 1 || posOrigen > origen.tamano) {
        posOrigenInput.classList.add('is-invalid');
        isValid = false;
    } else {
        posOrigenInput.classList.remove('is-invalid');
    }

    // Validar posición destino
    const posDestino = parseInt(posDestinoInput.value);
    if (isNaN(posDestino) || posDestino < 1 || posDestino > destino.tamano) {
        posDestinoInput.classList.add('is-invalid');
        isValid = false;
    } else {
        posDestinoInput.classList.remove('is-invalid');
    }

    return isValid;
}

// Función para validar carril origen
function validarCarrilOrigen() {
    const selectCarrilOrigenProb = document.getElementById('selectCarrilOrigenProb');
    if (!selectCarrilOrigenProb) return true;

    const selectOrigen = document.getElementById('selectCalleOrigen');
    const origenIdx = parseInt(selectOrigen.value);
    if (isNaN(origenIdx)) return true;

    const origen = window.calles[origenIdx];
    const carrilOrigen = parseInt(selectCarrilOrigenProb.value);

    // Validar que sea un carril válido (0-based)
    if (isNaN(carrilOrigen) || carrilOrigen < 0 || carrilOrigen >= origen.carriles) {
        selectCarrilOrigenProb.classList.add('is-invalid');
        return false;
    } else {
        selectCarrilOrigenProb.classList.remove('is-invalid');
        return true;
    }
}

function mostrarDialogoNuevaConexion() {
    if (!window.calles || window.calles.length < 2) {
        alert("❌ Necesitas al menos 2 calles para crear una conexión");
        return;
    }

    // LIMPIAR FORMULARIO - Remover clases de validación de intentos anteriores
    const selectCarrilDestinoIncorp = document.getElementById('selectCarrilDestinoIncorp');
    const inputPosInicial = document.getElementById('inputPosInicial');
    const selectCarrilOrigenProb = document.getElementById('selectCarrilOrigenProb');

    if (selectCarrilDestinoIncorp) selectCarrilDestinoIncorp.classList.remove('is-invalid');
    if (inputPosInicial) inputPosInicial.classList.remove('is-invalid');
    if (selectCarrilOrigenProb) selectCarrilOrigenProb.classList.remove('is-invalid');

    // Limpiar campos de probabilística si existen
    const probInputs = document.querySelectorAll('#camposProbabilistica input, #camposProbabilistica select');
    probInputs.forEach(input => input.classList.remove('is-invalid'));

    // Poblar selectores de calles
    const selectOrigen = document.getElementById('selectCalleOrigen');
    const selectDestino = document.getElementById('selectCalleDestino');

    selectOrigen.innerHTML = '<option value="">Selecciona calle origen...</option>';
    selectDestino.innerHTML = '<option value="">Selecciona calle destino...</option>';

    // Mantener los índices originales al ordenar por nombre.
    const callesConIndices = window.streetListUI.sortedEntries(window.calles).map(({ street: calle, index }) => ({ calle, index }));

    // Poblar selectores con calles ordenadas
    callesConIndices.forEach(item => {
        const optionOrigen = document.createElement('option');
        optionOrigen.value = item.index;
        optionOrigen.textContent = `${item.index}: ${item.calle.nombre}`;
        selectOrigen.appendChild(optionOrigen);

        const optionDestino = document.createElement('option');
        optionDestino.value = item.index;
        optionDestino.textContent = `${item.index}: ${item.calle.nombre}`;
        selectDestino.appendChild(optionDestino);
    });

    // Mostrar el modal
    const modalElement = document.getElementById('modalNuevaConexion');
    const modal = new bootstrap.Modal(modalElement);

    // Agregar listener para limpiar el foco cuando se cierre el modal
    modalElement.addEventListener('hidden.bs.modal', function handleModalHidden() {
        // Remover el foco de cualquier elemento dentro del modal
        if (document.activeElement && modalElement.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        // Remover este listener para evitar acumulación
        modalElement.removeEventListener('hidden.bs.modal', handleModalHidden);
    });

    modal.show();

    // Configurar cambio de tipo de conexión para mostrar/ocultar campos
    const selectTipoConexion = document.getElementById('selectTipoConexion');
    const camposIncorporacion = document.getElementById('camposIncorporacion');
    const camposProbabilistica = document.getElementById('camposProbabilistica');

    selectTipoConexion.addEventListener('change', function() {
        const tipo = this.value;
        camposIncorporacion.style.display = tipo === 'INCORPORACION' ? 'block' : 'none';
        camposProbabilistica.style.display = tipo === 'PROBABILISTICA' ? 'block' : 'none';

        // Poblar selectores según el tipo
        if (tipo === 'INCORPORACION') {
            poblarSelectorCarrilDestinoIncorp();
        } else if (tipo === 'PROBABILISTICA') {
            poblarSelectorCarrilOrigen();
            generarFormulariosDistribucion();
        }
    });

    // Detectar cambio en calle destino para regenerar formularios/selectores
    selectDestino.addEventListener('change', () => {
        const tipo = selectTipoConexion.value;
        if (tipo === 'PROBABILISTICA') {
            generarFormulariosDistribucion();
        } else if (tipo === 'INCORPORACION') {
            poblarSelectorCarrilDestinoIncorp();
        }
    });

    // Detectar cambio en calle origen para poblar selector de carril origen
    selectOrigen.addEventListener('change', () => {
        if (selectTipoConexion.value === 'PROBABILISTICA') {
            poblarSelectorCarrilOrigen();
        }
    });

    // Función para poblar selector de carril origen (PROBABILISTICA)
    function poblarSelectorCarrilOrigen() {
        const selectCarrilOrigenProb = document.getElementById('selectCarrilOrigenProb');
        if (!selectCarrilOrigenProb) return;

        const origenIdx = parseInt(selectOrigen.value);

        if (isNaN(origenIdx) || origenIdx < 0 || origenIdx >= window.calles.length) {
            selectCarrilOrigenProb.innerHTML = '<option value="">Selecciona una calle origen primero</option>';
            return;
        }

        const origen = window.calles[origenIdx];
        const numCarriles = origen.carriles;

        let html = '';
        for (let i = 0; i < numCarriles; i++) {
            html += `<option value="${i}">Carril ${i + 1}</option>`;
        }

        selectCarrilOrigenProb.innerHTML = html;
        // Seleccionar primer carril por defecto
        selectCarrilOrigenProb.value = '0';
    }

    // Función para poblar selector de carril destino (INCORPORACION)
    function poblarSelectorCarrilDestinoIncorp() {
        const selectCarrilDestinoIncorp = document.getElementById('selectCarrilDestinoIncorp');
        const inputPosInicial = document.getElementById('inputPosInicial');

        if (!selectCarrilDestinoIncorp) return;

        const destinoIdx = parseInt(selectDestino.value);

        if (isNaN(destinoIdx) || destinoIdx < 0 || destinoIdx >= window.calles.length) {
            selectCarrilDestinoIncorp.innerHTML = '<option value="">Selecciona una calle destino primero</option>';
            if (inputPosInicial) {
                inputPosInicial.removeAttribute('max');
            }
            return;
        }

        const destino = window.calles[destinoIdx];
        const numCarriles = destino.carriles;

        let html = '';
        for (let i = 0; i < numCarriles; i++) {
            html += `<option value="${i}">Carril ${i + 1}</option>`;
        }

        selectCarrilDestinoIncorp.innerHTML = html;
        // Seleccionar primer carril por defecto
        selectCarrilDestinoIncorp.value = '0';

        // Actualizar límite máximo de posición inicial
        if (inputPosInicial) {
            inputPosInicial.setAttribute('max', destino.tamano);
            inputPosInicial.setAttribute('placeholder', `1-${destino.tamano}`);

            // Actualizar texto de ayuda
            const helpText = inputPosInicial.nextElementSibling;
            if (helpText && helpText.classList.contains('text-muted')) {
                helpText.textContent = `Posición en la calle destino (máx: ${destino.tamano})`;
            }
        }
    }

    // Validar carril origen cuando cambie (ya declarado arriba en la limpieza)
    if (selectCarrilOrigenProb) {
        selectCarrilOrigenProb.addEventListener('change', validarCarrilOrigen);
    }

    // Función para generar formularios de distribución automáticamente
    function generarFormulariosDistribucion() {
        const contenedor = document.getElementById('contenedorDistribucionesProbabilisticas');
        const destinoIdx = parseInt(selectDestino.value);
        const origenIdx = parseInt(selectOrigen.value);

        if (isNaN(destinoIdx) || destinoIdx < 0 || destinoIdx >= window.calles.length) {
            contenedor.innerHTML = '<p class="text-muted text-center py-3">Selecciona una calle destino para configurar las salidas</p>';
            return;
        }

        if (isNaN(origenIdx) || origenIdx < 0 || origenIdx >= window.calles.length) {
            contenedor.innerHTML = '<p class="text-muted text-center py-3">Selecciona una calle origen primero</p>';
            return;
        }

        const origen = window.calles[origenIdx];
        const destino = window.calles[destinoIdx];
        const numCarriles = destino.carriles;

        let html = `
            <div class="mb-3">
                <label class="form-label fw-bold">
                    Configuración de Salidas
                    <span class="badge bg-secondary">${numCarriles} carril${numCarriles > 1 ? 'es' : ''} disponibles</span>
                </label>
                <div class="accordion" id="accordionDistribuciones">
        `;

        // Generar opciones de carriles destino (en formato humano: 1, 2, 3...)
        let opcionesCarriles = '';
        for (let c = 0; c < numCarriles; c++) {
            opcionesCarriles += `<option value="${c}">Carril ${c + 1}</option>`;
        }

        for (let i = 0; i < numCarriles; i++) {
            const collapseId = `collapseSalida${i}`;
            const isFirst = i === 0;

            // Distribuir probabilidades por defecto equitativamente
            const probPorDefecto = Math.floor(100 / numCarriles);
            const probExtra = 100 - (probPorDefecto * numCarriles); // Redondeo extra

            html += `
                <div class="accordion-item">
                    <h2 class="accordion-header">
                        <button class="accordion-button ${!isFirst ? 'collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                            🎯 Salida ${i + 1}
                        </button>
                    </h2>
                    <div id="${collapseId}" class="accordion-collapse collapse ${isFirst ? 'show' : ''}" data-bs-parent="#accordionDistribuciones">
                        <div class="accordion-body">
                            <div class="row g-2">
                                <div class="col-md-6">
                                    <label class="form-label small">Carril Destino</label>
                                    <select class="form-select form-select-sm" id="carrilDestinoSalida${i}">
                                        ${opcionesCarriles}
                                    </select>
                                    <small class="text-muted">A qué carril van los vehículos</small>
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label small">Probabilidad (%)</label>
                                    <input type="number" class="form-control form-control-sm"
                                           id="probSalida${i}"
                                           placeholder="0-100"
                                           min="0"
                                           max="100"
                                           step="1"
                                           value="${probPorDefecto + (i === 0 ? probExtra : 0)}">
                                    <small class="text-muted">% de vehículos que toman esta salida</small>
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label small">Posición Origen (celda)</label>
                                    <input type="number" class="form-control form-control-sm"
                                           id="posOrigenSalida${i}"
                                           placeholder="1-${origen.tamano}"
                                           min="1"
                                           max="${origen.tamano}"
                                           value="${origen.tamano}">
                                    <small class="text-muted">Celda donde se origina (máx: ${origen.tamano})</small>
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label small">Posición Destino (celda)</label>
                                    <input type="number" class="form-control form-control-sm"
                                           id="posDestinoSalida${i}"
                                           placeholder="1-${destino.tamano}"
                                           min="1"
                                           max="${destino.tamano}"
                                           value="1">
                                    <small class="text-muted">Celda donde llegan (máx: ${destino.tamano})</small>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        html += `
                </div>
                <div class="alert alert-warning small mt-2 mb-0">
                    <strong>⚠️ Importante:</strong>
                    <ul class="mb-0 mt-1">
                        <li>La suma de probabilidades debería ser ~100%</li>
                        <li>Cada carril destino solo puede usarse una vez</li>
                        <li>Las posiciones se cuentan desde 1 (no desde 0)</li>
                    </ul>
                </div>
            </div>
        `;

        contenedor.innerHTML = html;

        // Agregar listeners para validación en tiempo real
        for (let i = 0; i < numCarriles; i++) {
            const selectCarril = document.getElementById(`carrilDestinoSalida${i}`);
            const probInput = document.getElementById(`probSalida${i}`);
            const posOrigenInput = document.getElementById(`posOrigenSalida${i}`);
            const posDestinoInput = document.getElementById(`posDestinoSalida${i}`);

            if (selectCarril) {
                selectCarril.value = i; // Valor por defecto: cada salida va a su carril correspondiente
                selectCarril.addEventListener('change', () => {
                    validarCarrilesUnicos();
                });
            }

            if (probInput) {
                probInput.addEventListener('input', () => {
                    validarProbabilidadSalida(i);
                    validarSumaProbabilidades();
                });
            }

            if (posOrigenInput) {
                posOrigenInput.addEventListener('input', () => {
                    validarPosiciones(i);
                });
            }

            if (posDestinoInput) {
                posDestinoInput.addEventListener('input', () => {
                    validarPosiciones(i);
                });
            }
        }
    }

    // Configurar evento del botón confirmar
    const btnConfirmar = document.getElementById('btnConfirmarNuevaConexion');

    // Remover handler anterior si existe (para evitar duplicados)
    if (handlerNuevaConexion !== null) {
        btnConfirmar.removeEventListener('click', handlerNuevaConexion);
    }

    // Crear nuevo handler
    handlerNuevaConexion = () => {
        const origenIdx = parseInt(selectOrigen.value);
        const destinoIdx = parseInt(selectDestino.value);
        const tipo = selectTipoConexion.value;

        // Validaciones básicas
        if (isNaN(origenIdx) || origenIdx < 0 || origenIdx >= window.calles.length) {
            alert("❌ Selecciona una calle de origen válida");
            return;
        }

        if (isNaN(destinoIdx) || destinoIdx < 0 || destinoIdx >= window.calles.length) {
            alert("❌ Selecciona una calle de destino válida");
            return;
        }

        if (origenIdx === destinoIdx) {
            alert("❌ La calle de origen y destino no pueden ser la misma");
            return;
        }

        const origen = window.calles[origenIdx];
        const destino = window.calles[destinoIdx];
        let conexionesCreadas = [];

        if (tipo === "LINEAL") {
            // VALIDACIÓN DE DUPLICADOS: Verificar si ya existe una conexión lineal
            // Las conexiones lineales conectan cada carril i de origen al carril i de destino
            // Verificamos si ya existe la conexión del primer carril
            if (validarConexionDuplicada(origenIdx, 0, destinoIdx, 0)) {
                alert(`❌ Ya existe una conexión lineal de "${origen.nombre}" a "${destino.nombre}".\n\nLas conexiones lineales unen todos los carriles 1:1, por lo que no se pueden duplicar.`);
                return;
            }

            conexionesCreadas = crearConexionLinealSimple(origen, destino);
        } else if (tipo === "INCORPORACION") {
            const selectCarrilDestinoIncorp = document.getElementById('selectCarrilDestinoIncorp');
            const inputPosInicial = document.getElementById('inputPosInicial');

            const carrilDestino = parseInt(selectCarrilDestinoIncorp.value);
            const posInicialHumana = parseInt(inputPosInicial.value);

            if (isNaN(carrilDestino)) {
                alert("❌ Selecciona un carril destino válido");
                selectCarrilDestinoIncorp.classList.add('is-invalid');
                return;
            }

            if (isNaN(posInicialHumana)) {
                alert("❌ La posición inicial es inválida");
                inputPosInicial.classList.add('is-invalid');
                return;
            }

            // Validar rango de carril destino (0-based)
            if (carrilDestino < 0 || carrilDestino >= destino.carriles) {
                alert(`❌ El carril destino debe estar entre 0 y ${destino.carriles - 1}`);
                selectCarrilDestinoIncorp.classList.add('is-invalid');
                return;
            }

            // Validar rango de posición inicial (1-based para el usuario)
            if (posInicialHumana < 1 || posInicialHumana > destino.tamano) {
                alert(`❌ La posición inicial debe estar entre 1 y ${destino.tamano} (tamaño de calle destino)`);
                inputPosInicial.classList.add('is-invalid');
                return;
            }

            // Convertir de índice humano a índice de computadora
            const posInicial = posInicialHumana - 1;

            // VALIDACIÓN DE DUPLICADOS: Verificar si ya existe una conexión de incorporación
            // Las conexiones de incorporación conectan TODOS los carriles de origen al carrilDestino
            // Así que verificamos si ya existe alguna conexión del primer carril de origen al carril destino
            if (validarConexionDuplicada(origenIdx, 0, destinoIdx, carrilDestino)) {
                alert(`❌ Ya existe una conexión de incorporación de "${origen.nombre}" al carril ${carrilDestino + 1} de "${destino.nombre}".\n\nLas conexiones de incorporación unen TODOS los carriles de origen a un carril destino, por lo que no se pueden duplicar.`);
                selectCarrilDestinoIncorp.classList.add('is-invalid');
                return;
            }

            conexionesCreadas = crearConexionIncorporacionSimple(origen, destino, carrilDestino, posInicial);
        } else if (tipo === "PROBABILISTICA") {
            const carrilOrigen = parseInt(document.getElementById('selectCarrilOrigenProb').value);

            if (isNaN(carrilOrigen)) {
                alert("❌ Selecciona un carril origen válido");
                return;
            }

            // Validar que esté en el rango correcto (0-based)
            if (carrilOrigen < 0 || carrilOrigen >= origen.carriles) {
                alert(`❌ El carril origen debe estar entre 0 y ${origen.carriles - 1}`);
                return;
            }

            // Validar que no haya carriles duplicados
            if (!validarCarrilesUnicos()) {
                alert("❌ Hay carriles destino duplicados. Cada carril solo puede usarse una vez.");
                return;
            }

            // Recopilar distribuciones desde el formulario
            const distribuciones = [];
            for (let i = 0; i < destino.carriles; i++) {
                const carrilDestinoSelect = document.getElementById(`carrilDestinoSalida${i}`);
                const probabilidadInput = document.getElementById(`probSalida${i}`);
                const posOrigenInput = document.getElementById(`posOrigenSalida${i}`);
                const posDestinoInput = document.getElementById(`posDestinoSalida${i}`);

                if (!carrilDestinoSelect || !probabilidadInput || !posOrigenInput || !posDestinoInput) {
                    continue; // Saltar si faltan campos
                }

                const carrilDestino = parseInt(carrilDestinoSelect.value); // Ya viene como índice 0-based
                const probabilidad = parseFloat(probabilidadInput.value) / 100; // Convertir % a decimal
                const posOrigenHumano = parseInt(posOrigenInput.value);
                const posDestinoHumano = parseInt(posDestinoInput.value);

                // Validar valores
                if (isNaN(carrilDestino) || isNaN(probabilidad) || isNaN(posOrigenHumano) || isNaN(posDestinoHumano)) {
                    alert(`❌ Valores inválidos en salida ${i + 1}`);
                    posOrigenInput.classList.add('is-invalid');
                    posDestinoInput.classList.add('is-invalid');
                    return;
                }

                if (probabilidad < 0 || probabilidad > 1) {
                    alert(`❌ La probabilidad de la salida ${i + 1} debe estar entre 0 y 100%`);
                    probabilidadInput.classList.add('is-invalid');
                    return;
                }

                // VALIDACIÓN ESTRICTA: Posición origen debe estar entre 1 y tamaño de calle origen
                if (posOrigenHumano < 1 || posOrigenHumano > origen.tamano) {
                    alert(`❌ La posición origen de la salida ${i + 1} debe estar entre 1 y ${origen.tamano} (tamaño de calle origen)`);
                    posOrigenInput.classList.add('is-invalid');
                    return;
                }

                // VALIDACIÓN ESTRICTA: Posición destino debe estar entre 1 y tamaño de calle destino
                if (posDestinoHumano < 1 || posDestinoHumano > destino.tamano) {
                    alert(`❌ La posición destino de la salida ${i + 1} debe estar entre 1 y ${destino.tamano} (tamaño de calle destino)`);
                    posDestinoInput.classList.add('is-invalid');
                    return;
                }

                // Solo agregar si tiene probabilidad > 0
                if (probabilidad > 0) {
                    // VALIDACIÓN DE DUPLICADOS: Verificar si ya existe esta conexión
                    if (validarConexionDuplicada(origenIdx, carrilOrigen, destinoIdx, carrilDestino)) {
                        alert(`❌ Ya existe una conexión del carril ${carrilOrigen + 1} de "${origen.nombre}" al carril ${carrilDestino + 1} de "${destino.nombre}". No se permiten conexiones duplicadas.`);
                        carrilDestinoSelect.classList.add('is-invalid');
                        return;
                    }

                    // Convertir de índice humano (1,2,3...) a índice computadora (0,1,2...)
                    const posOrigen = posOrigenHumano - 1;
                    const posDestino = posDestinoHumano - 1;

                    distribuciones.push({
                        carrilDestino: carrilDestino,
                        posOrigen: posOrigen,
                        posDestino: posDestino,
                        probabilidad: probabilidad
                    });
                }
            }

            if (distribuciones.length === 0) {
                alert("❌ Debes configurar al menos una salida con probabilidad mayor a 0%");
                return;
            }

            // Crear conexión con múltiples distribuciones
            conexionesCreadas = crearConexionProbabilisticaAvanzada(origen, carrilOrigen, destino, distribuciones);
        }

        if (conexionesCreadas && conexionesCreadas.length > 0) {
            // Guardar en simulación actual con todos los detalles necesarios
            simulacionActual.conexiones.push({
                origenIdx,
                destinoIdx,
                tipo,
                detalles: conexionesCreadas.map(c => ({
                    carrilOrigen: c.carrilOrigen,
                    carrilDestino: c.carrilDestino,
                    posOrigen: c.posOrigen,
                    posDestino: c.posDestino,
                    probabilidad: c.probabilidadTransferencia
                }))
            });

            // IMPORTANTE: Reinicializar intersecciones para que la simulación reconozca las nuevas conexiones
            if (window.inicializarIntersecciones) {
                window.inicializarIntersecciones();
                console.log('🔄 Intersecciones reinicializadas');
            }

            if (window.construirMapaIntersecciones) {
                window.construirMapaIntersecciones();
                console.log('🗺️ Mapa de intersecciones reconstruido');
            }

            // Renderizar canvas
            if (window.renderizarCanvas) {
                window.renderizarCanvas();
            }

            // Renderizar en PixiJS si está activo
            if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
                // Limpiar y re-renderizar todas las conexiones
                window.pixiApp.sceneManager.conexionRenderer?.clearAll();
                if (window.conexiones && window.mostrarConexiones) {
                    window.pixiApp.sceneManager.conexionRenderer?.renderAll(window.conexiones);
                }
            }

            console.log(`✅ Conexión ${tipo} creada entre "${origen.nombre}" y "${destino.nombre}"`);
            console.log('📊 Detalles de conexión:', conexionesCreadas);

            // Actualizar lista de conexiones si está visible
            const listaContainer = document.getElementById('listaConexionesContainer');
            if (listaContainer && listaContainer.style.display !== 'none') {
                actualizarListaConexiones(window.calleSeleccionada);
            }

            alert(`✅ Conexión ${tipo} creada exitosamente\n\nLa simulación está lista para usar la nueva conexión.`);

            // Cerrar modal correctamente
            // Remover el foco antes de cerrar para evitar errores de accesibilidad
            const modalElement = document.getElementById('modalNuevaConexion');
            if (modalElement && document.activeElement) {
                // Mover el foco fuera del modal antes de cerrarlo
                document.activeElement.blur();
            }
            modal.hide();

            // Resetear formulario
            selectOrigen.value = '';
            selectDestino.value = '';
            selectTipoConexion.value = 'LINEAL';
            camposIncorporacion.style.display = 'none';
            camposProbabilistica.style.display = 'none';

            // Limpiar contenedor de distribuciones
            const contenedor = document.getElementById('contenedorDistribucionesProbabilisticas');
            if (contenedor) {
                contenedor.innerHTML = '<p class="text-muted text-center py-3">Selecciona una calle destino para configurar las salidas</p>';
            }

            // Nota: No removemos el listener aquí porque lo reutilizamos
            // Se removerá automáticamente la próxima vez que se abra el modal
        }
    };

    // Agregar el nuevo handler
    btnConfirmar.addEventListener('click', handlerNuevaConexion);
}

// ==================== FUNCIONES AUXILIARES DE CONEXIÓN ====================

function crearConexionLinealSimple(origen, destino, noPush = false) {
    if (typeof window.crearConexionLineal === 'function') {
        const conexiones = window.crearConexionLineal(origen, destino);

        if (typeof window.registrarConexiones === 'function') {
            window.registrarConexiones(conexiones);
        }

        // Solo agregar a window.conexiones si no se especifica noPush
        if (!noPush && window.conexiones) {
            window.conexiones.push(...conexiones);
        }

        return conexiones;
    }
    return [];
}

function crearConexionIncorporacionSimple(origen, destino, carrilDestino, posInicial, modoCruzado = 0, noPush = false) {
    if (typeof window.crearConexionIncorporacion === 'function') {
        const conexiones = window.crearConexionIncorporacion(origen, destino, carrilDestino, posInicial, modoCruzado);

        if (typeof window.registrarConexiones === 'function') {
            window.registrarConexiones(conexiones);
        }

        // Solo agregar a window.conexiones si no se especifica noPush
        if (!noPush && window.conexiones) {
            window.conexiones.push(...conexiones);
        }

        return conexiones;
    }
    return [];
}

function crearConexionProbabilisticaSimple(origen, carrilOrigen, destino, carrilDestino, probabilidad, noPush = false) {
    if (typeof window.crearConexionProbabilistica === 'function') {
        const distribucion = [{
            carrilDestino: carrilDestino,
            posOrigen: -1,
            posDestino: 0,
            probabilidad: probabilidad
        }];

        const conexiones = window.crearConexionProbabilistica(origen, carrilOrigen, destino, distribucion);

        if (typeof window.registrarConexiones === 'function') {
            window.registrarConexiones(conexiones);
        }

        // Solo agregar a window.conexiones si no se especifica noPush
        if (!noPush && window.conexiones) {
            window.conexiones.push(...conexiones);
        }

        return conexiones;
    }
    return [];
}

// Crear conexión probabilística avanzada con múltiples distribuciones
function crearConexionProbabilisticaAvanzada(origen, carrilOrigen, destino, distribuciones, noPush = false) {
    if (typeof window.crearConexionProbabilistica === 'function') {
        // La distribución ya viene en el formato correcto: [{carrilDestino, posOrigen, posDestino, probabilidad}, ...]
        const conexiones = window.crearConexionProbabilistica(origen, carrilOrigen, destino, distribuciones);

        if (typeof window.registrarConexiones === 'function') {
            window.registrarConexiones(conexiones);
        }

        // Solo agregar a window.conexiones si no se especifica noPush
        if (!noPush && window.conexiones) {
            window.conexiones.push(...conexiones);
        }

        console.log(`🎲 Conexión probabilística avanzada creada: ${origen.nombre}[C${carrilOrigen}] → ${destino.nombre}`);
        console.log(`   → ${distribuciones.length} salida(s) configurada(s)`);

        return conexiones;
    }
    return [];
}

// ==================== DIÁLOGO NUEVO EDIFICIO ====================

function mostrarDialogoNuevoEdificio() {
    console.log('🏢 mostrarDialogoNuevoEdificio() llamada');

    try {
        // Limpiar formulario
        const inputNombre = document.getElementById('inputNombreEdificio');
        const checkEst = document.getElementById('checkEstacionamiento');
        const listaConex = document.getElementById('listaConexionesEdificio');

        if (inputNombre) inputNombre.value = '';
        if (checkEst) checkEst.checked = false;
        if (window.toggleEstacionamientoConfig) toggleEstacionamientoConfig(false);
        if (listaConex) listaConex.innerHTML = '';
        window.contadorPares = 0;

        // Restaurar título y botón para modo crear
        const modalElement = document.getElementById('modalNuevoEdificio');
        if (!modalElement) {
            console.error('❌ No se encontró el modal modalNuevoEdificio');
            return;
        }

        const modalTitle = modalElement.querySelector('#modalNuevoEdificioLabel');
        const btnConfirmar = document.getElementById('btnConfirmarNuevoEdificio');

        // Un diálogo cancelado conserva su listener: quitarlo antes de abrir otro.
        if (handlerNuevoEdificio) {
            btnConfirmar.removeEventListener('click', handlerNuevoEdificio);
        }

        if (modalTitle) modalTitle.textContent = '🏢 Agregar Nuevo Edificio';
        if (btnConfirmar) btnConfirmar.textContent = '✓ Crear Edificio';

        // Cambiar color del header a verde para modo agregar
        const modalHeader = modalElement.querySelector('.modal-header');
        if (modalHeader) {
            modalHeader.classList.remove('bg-primary', 'bg-warning', 'text-dark');
            modalHeader.classList.add('bg-success', 'text-white');
        }

        // Mostrar el modal
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
        console.log('✅ Modal mostrado');

        // Configurar evento del botón confirmar
        handlerNuevoEdificio = () => {
            const label = document.getElementById('inputNombreEdificio').value;
            const x = parseFloat(document.getElementById('inputXEdificio').value);
            const y = parseFloat(document.getElementById('inputYEdificio').value);
            const width = parseFloat(document.getElementById('inputWidthEdificio').value);
            const height = parseFloat(document.getElementById('inputHeightEdificio').value);
            const angle = parseFloat(document.getElementById('inputAnguloEdificio').value);

            // Validaciones básicas
            if (!label || label.trim() === '') {
                alert("❌ El nombre es obligatorio");
                return;
            }

            if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height) || isNaN(angle)) {
                alert("❌ Valores inválidos. Verifica todos los campos numéricos.");
                return;
            }

            if (width <= 0 || height <= 0) {
                alert("❌ El ancho y alto deben ser mayores a 0");
                return;
            }

            // Agregar edificio
            const edificio = agregarEdificio(label, x, y, width, height, angle);

            // Configurar como estacionamiento si está marcado
            const esEstacionamiento = document.getElementById('checkEstacionamiento').checked;
            if (esEstacionamiento) {
                const capacidad = parseInt(document.getElementById('inputCapacidad').value) || 50;
                const conexiones = window.recolectarConexiones();
                const { probEntrada, probSalida } = window.recolectarProbabilidades();

                if (conexiones.length === 0) {
                    mostrarToast('Sin conexiones, el edificio será decorativo', 'warning');
                } else {
                    // Configurar estacionamiento
                    edificio.capacidadMaxima = capacidad;
                    edificio.probabilidadesEntrada = probEntrada;
                    edificio.probabilidadesSalida = probSalida;

                    const exito = window.configurarEstacionamiento(edificio, conexiones, capacidad);
                    if (exito) {
                        console.log('✅ Edificio configurado como estacionamiento');
                    } else {
                        mostrarToast('Error al configurar estacionamiento. Verifica las conexiones.', 'danger');
                    }
                }
            }

            // Cerrar modal
            modal.hide();

            // Remover listener
            btnConfirmar.removeEventListener('click', handlerNuevoEdificio);
            handlerNuevoEdificio = null;
        };

        btnConfirmar.addEventListener('click', handlerNuevoEdificio);

    } catch (error) {
        console.error('❌ Error en mostrarDialogoNuevoEdificio:', error);
    }
}

// ==================== UTILIDADES ====================

/**
 * Muestra un toast de Bootstrap
 * @param {string} mensaje - Mensaje a mostrar
 * @param {string} tipo - 'success', 'danger', 'warning', 'info'
 */
function mostrarToast(mensaje, tipo = 'success') {
    const container = document.querySelector('.toast-container');
    if (!container) {
        console.warn('⚠️ Contenedor de toasts no encontrado, usando alert');
        alert(mensaje);
        return;
    }

    // Mapeo de tipos a iconos y colores
    const config = {
        success: { icon: '✅', bg: 'bg-success', textClass: 'text-white' },
        danger: { icon: '❌', bg: 'bg-danger', textClass: 'text-white' },
        warning: { icon: '⚠️', bg: 'bg-warning', textClass: 'text-dark' },
        info: { icon: 'ℹ️', bg: 'bg-info', textClass: 'text-white' }
    };

    const { icon, bg, textClass} = config[tipo] || config.success;

    // Crear el toast
    const toastId = `toast-${Date.now()}`;
    const toastHTML = `
        <div id="${toastId}" class="toast ${bg} ${textClass}" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="toast-header ${bg} ${textClass}">
                <strong class="me-auto">${icon} Notificación</strong>
                <button type="button" class="btn-close ${textClass === 'text-white' ? 'btn-close-white' : ''}" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                ${mensaje}
            </div>
        </div>
    `;

    // Insertar el toast
    container.insertAdjacentHTML('beforeend', toastHTML);

    // Inicializar y mostrar el toast
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement, {
        autohide: true,
        delay: 4000
    });
    toast.show();

    // Eliminar del DOM después de ocultarse
    toastElement.addEventListener('hidden.bs.toast', () => {
        toastElement.remove();
    });
}

// ==================== AGREGAR EDIFICIO ====================

function agregarEdificio(label, x, y, width, height, angle) {
    // Inicializar array de edificios si no existe
    if (!window.edificios) {
        window.edificios = [];
    }

    // Crear edificio
    const edificio = {
        id: `edificio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        label: label,
        x: x,
        y: y,
        width: width,
        height: height,
        angle: angle || 0,
        color: '#8B4513', // Color café por defecto

        // Sistema de estacionamiento
        esEstacionamiento: false,
        capacidadMaxima: 50,
        vehiculosActuales: 0,
        conexiones: [], // Array de objetos {tipo: 'entrada'|'salida', calle, carril, indice, probabilidad}

        // Probabilidades por hora (24 horas)
        probabilidadesEntrada: Array(24).fill(0.3), // 30% por defecto
        probabilidadesSalida: Array(24).fill(0.2)   // 20% por defecto
    };

    // Agregar a la lista global
    window.edificios.push(edificio);

    // Agregar a simulación actual
    simulacionActual.edificios.push(edificio);

    // Actualizar selectores
    actualizarSelectorEdificios();

    // Renderizar en PixiJS si está activo
    if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
        window.pixiApp.sceneManager.edificioRenderer?.renderEdificio(edificio);
    }

    // Renderizar Canvas 2D si existe
    if (window.renderizarCanvas) {
        window.renderizarCanvas();
    }

    console.log(`✅ Edificio "${label}" agregado a la simulación`);
    return edificio;
}

// ==================== EDITAR EDIFICIO ====================

/**
 * Actualiza el estado del botón "Editar Edificio" según la selección
 */
function actualizarBotonEditarEdificio() {
    const btnEditarEdificio = document.getElementById('btnEditarEdificio');
    if (!btnEditarEdificio) return;

    // Mostrar el botón solo si hay un edificio seleccionado
    if (window.edificioSeleccionado) {
        btnEditarEdificio.style.display = 'block';
    } else {
        btnEditarEdificio.style.display = 'none';
    }
}

/**
 * Abre el modal de edificio en modo edición
 */
function editarEdificioSeleccionado() {
    if (!window.edificioSeleccionado) {
        alert('⚠️ No hay edificio seleccionado');
        return;
    }

    const edificio = window.edificioSeleccionado;
    console.log('✏️ Editando edificio:', edificio.label);

    // Abrir modal
    const modal = document.getElementById('modalNuevoEdificio');
    if (!modal) {
        console.error('❌ Modal modalNuevoEdificio no encontrado');
        return;
    }

    // Cambiar título y botón para modo edición
    const modalTitle = modal.querySelector('#modalNuevoEdificioLabel');
    const btnConfirmar = document.getElementById('btnConfirmarNuevoEdificio');

    if (modalTitle) modalTitle.textContent = '✏️ Editar Edificio';
    if (btnConfirmar) btnConfirmar.textContent = '✓ Actualizar Edificio';

    // Cambiar color del header a amarillo para modo edición
    const modalHeader = modal.querySelector('.modal-header');
    if (modalHeader) {
        modalHeader.classList.remove('bg-primary', 'bg-success');
        modalHeader.classList.add('bg-warning', 'text-dark');
    }

    const bsModal = new bootstrap.Modal(modal);

    // Poblar campos básicos
    document.getElementById('inputNombreEdificio').value = edificio.label || '';
    document.getElementById('inputXEdificio').value = edificio.x || 0;
    document.getElementById('inputYEdificio').value = edificio.y || 0;
    document.getElementById('inputWidthEdificio').value = edificio.width || 50;
    document.getElementById('inputHeightEdificio').value = edificio.height || 50;
    document.getElementById('inputAnguloEdificio').value = edificio.angle || 0;

    // Configurar estacionamiento si aplica
    const checkEstacionamiento = document.getElementById('checkEstacionamiento');
    checkEstacionamiento.checked = edificio.esEstacionamiento || false;
    window.toggleEstacionamientoConfig(checkEstacionamiento.checked);

    if (edificio.esEstacionamiento) {
        // Capacidad
        document.getElementById('inputCapacidad').value = edificio.capacidadMaxima || 50;

        // Poblar conexiones existentes
        window.contadorPares = 0;
        const listaConexiones = document.getElementById('listaConexionesEdificio');
        if (listaConexiones) {
            listaConexiones.innerHTML = ''; // Limpiar

            // Agrupar conexiones en pares (entrada + salida)
            const entradas = edificio.conexiones.filter(c => c.tipo === 'entrada');
            const salidas = edificio.conexiones.filter(c => c.tipo === 'salida');
            const maxPares = Math.max(entradas.length, salidas.length);

            for (let i = 0; i < maxPares; i++) {
                window.agregarParConexion();
                const parId = `par_${window.contadorPares}`;

                // Poblar entrada (convertir de 0-indexed a 1-indexed para mostrar)
                if (entradas[i]) {
                    const entrada = entradas[i];
                    document.getElementById(`${parId}_entrada_calle`).value = entrada.calleId || '';
                    document.getElementById(`${parId}_entrada_carril`).value = (entrada.carril + 1) || 1;
                    document.getElementById(`${parId}_entrada_indice`).value = (entrada.indice + 1) || 1;
                }

                // Poblar salida (convertir de 0-indexed a 1-indexed para mostrar)
                if (salidas[i]) {
                    const salida = salidas[i];
                    document.getElementById(`${parId}_salida_calle`).value = salida.calleId || '';
                    document.getElementById(`${parId}_salida_carril`).value = (salida.carril + 1) || 1;
                    document.getElementById(`${parId}_salida_indice`).value = (salida.indice + 1) || 1;
                }
            }
        }

        // Poblar probabilidades por hora
        if (edificio.probabilidadesEntrada && edificio.probabilidadesSalida) {
            for (let hora = 0; hora < 24; hora++) {
                const sliderEntrada = document.getElementById(`probEntrada_${hora}`);
                const badgeEntrada = document.getElementById(`valEntrada_${hora}`);
                const sliderSalida = document.getElementById(`probSalida_${hora}`);
                const badgeSalida = document.getElementById(`valSalida_${hora}`);

                if (sliderEntrada && badgeEntrada) {
                    // IMPORTANTE: Usar ?? en lugar de || para permitir valor 0
                    const valorEntrada = Math.round((edificio.probabilidadesEntrada[hora] ?? 0.3) * 100);
                    sliderEntrada.value = valorEntrada;
                    badgeEntrada.textContent = valorEntrada + '%';
                }

                if (sliderSalida && badgeSalida) {
                    // IMPORTANTE: Usar ?? en lugar de || para permitir valor 0
                    const valorSalida = Math.round((edificio.probabilidadesSalida[hora] ?? 0.2) * 100);
                    sliderSalida.value = valorSalida;
                    badgeSalida.textContent = valorSalida + '%';
                }
            }
        }
    }

    bsModal.show();

    // Cambiar el handler del botón de confirmación para modo edición
    const btnEditar = document.getElementById('btnConfirmarNuevoEdificio');
    if (btnEditar) {
        // Remover listeners previos
        const nuevoBtn = btnEditar.cloneNode(true);
        btnEditar.parentNode.replaceChild(nuevoBtn, btnEditar);

        // Agregar nuevo listener para modo edición
        nuevoBtn.addEventListener('click', () => {
            // Recolectar valores del formulario
            edificio.label = document.getElementById('inputNombreEdificio').value || 'Edificio';
            edificio.x = parseFloat(document.getElementById('inputXEdificio').value) || 0;
            edificio.y = parseFloat(document.getElementById('inputYEdificio').value) || 0;
            edificio.width = parseFloat(document.getElementById('inputWidthEdificio').value) || 50;
            edificio.height = parseFloat(document.getElementById('inputHeightEdificio').value) || 50;
            edificio.angle = parseFloat(document.getElementById('inputAnguloEdificio').value) || 0;

            // Actualizar configuración de estacionamiento
            const esEstacionamiento = document.getElementById('checkEstacionamiento').checked;
            edificio.esEstacionamiento = esEstacionamiento;

            if (esEstacionamiento) {
                const capacidad = parseInt(document.getElementById('inputCapacidad').value) || 50;
                const conexiones = window.recolectarConexiones();
                const { probEntrada, probSalida } = window.recolectarProbabilidades();

                // Limpiar conexiones antiguas del mapa
                if (window.limpiarConexionesEdificio) {
                    window.limpiarConexionesEdificio(edificio);
                }

                // Actualizar propiedades
                edificio.capacidadMaxima = capacidad;
                edificio.probabilidadesEntrada = probEntrada;
                edificio.probabilidadesSalida = probSalida;

                // Reconfigurar como estacionamiento
                if (conexiones.length > 0) {
                    window.configurarEstacionamiento(edificio, conexiones, capacidad);
                } else {
                    edificio.conexiones = [];
                    mostrarToast('Sin conexiones, el edificio será decorativo', 'warning');
                }
            } else {
                // Desactivar estacionamiento
                if (window.limpiarConexionesEdificio) {
                    window.limpiarConexionesEdificio(edificio);
                }
                edificio.conexiones = [];
            }

            // Actualizar selectores
            actualizarSelectorEdificios();

            // Re-renderizar
            if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
                // Re-renderizar el edificio actualizado
                window.pixiApp.sceneManager.edificioRenderer?.renderAll(window.edificios);

                // Re-renderizar conexiones de estacionamiento si aplica
                if (edificio.esEstacionamiento) {
                    window.pixiApp.sceneManager.conexionRenderer?.renderEstacionamientos();
                }

                // Re-renderizar contadores si están visibles
                if (window.mostrarContadores) {
                    window.pixiApp.sceneManager.renderContadores();
                }
            }

            if (window.renderizarCanvas) {
                window.renderizarCanvas();
            }

            bsModal.hide();
            console.log(`✅ Edificio "${edificio.label}" actualizado`);
            mostrarToast(`Edificio "${edificio.label}" actualizado exitosamente`, 'success');
        });
    }
}

// Exponer funciones globalmente
window.actualizarBotonEditarEdificio = actualizarBotonEditarEdificio;
window.editarEdificioSeleccionado = editarEdificioSeleccionado;

// ==================== ACTUALIZAR SELECTORES ====================

function actualizarSelectorCalles() {
    const selectCalle = document.getElementById('selectCalle');
    const selectCalleEditor = document.getElementById('selectCalleEditor');

    // Actualizar selector en Configuración de Calles
    if (selectCalle && window.calles) {
        // Limpiar opciones existentes (excepto la primera)
        while (selectCalle.options.length > 1) {
            selectCalle.remove(1);
        }

        // Agregar todas las calles
        window.streetListUI.sortedEntries(window.calles).forEach(({ street: calle, index }) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = calle.nombre;
            selectCalle.appendChild(option);
        });
    }

    // Actualizar selector en Constructor de Mapas
    if (selectCalleEditor && window.calles) {
        // Limpiar opciones existentes (excepto la primera)
        while (selectCalleEditor.options.length > 1) {
            selectCalleEditor.remove(1);
        }

        // Agregar todas las calles
        window.streetListUI.sortedEntries(window.calles).forEach(({ street: calle, index }) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = calle.nombre;
            selectCalleEditor.appendChild(option);
        });
    }
}

function actualizarSelectorEdificios() {
    const selectEdificio = document.getElementById('selectEdificio');
    if (!selectEdificio || !window.edificios) return;

    // Limpiar opciones existentes (excepto la primera)
    while (selectEdificio.options.length > 1) {
        selectEdificio.remove(1);
    }

    // Crear array de edificios con sus índices originales
    const edificiosConIndice = window.edificios.map((edificio, index) => ({
        edificio: edificio,
        index: index,
        label: edificio.label || `Edificio ${index + 1}`
    }));

    // Ordenar alfabéticamente por label
    edificiosConIndice.sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));

    // Agregar todos los edificios ordenados
    edificiosConIndice.forEach(item => {
        const option = document.createElement('option');
        option.value = item.index;
        option.textContent = item.label;
        selectEdificio.appendChild(option);
    });
}

// ==================== ELIMINAR OBJETO SELECCIONADO ====================

function eliminarObjetoSeleccionado() {
    const calle = window.calleSeleccionada;
    const edificio = window.edificioSeleccionado;

    if (!calle && !edificio) {
        alert("No hay ningún objeto seleccionado. Selecciona una calle o edificio primero.");
        return;
    }

    if (calle) {
        const confirmacion = confirm(`¿Eliminar la calle "${calle.nombre}"?`);
        if (!confirmacion) return;

        const index = window.calles.indexOf(calle);
        if (index !== -1) {
            const deletedStreet = window.calles[index];
            const refersToDeletedStreet = connection =>
                connection?.origen === deletedStreet || connection?.destino === deletedStreet;

            // Remove live links first, then rebuild the per-lane outgoing indexes
            // used by the traffic step. Filtering by object identity keeps streets
            // with duplicate or similar names untouched.
            if (Array.isArray(window.conexiones)) {
                const removedConnections = window.conexiones.filter(refersToDeletedStreet);
                const remainingConnections = window.conexiones.filter(connection => !refersToDeletedStreet(connection));
                window.conexiones.splice(0, window.conexiones.length, ...remainingConnections);
                (window.calles || []).forEach(street => {
                    (street.conexionesSalida || []).forEach((laneConnections, lane) => {
                        street.conexionesSalida[lane] = (laneConnections || [])
                            .filter(candidate => !refersToDeletedStreet(candidate));
                    });
                });
                removedConnections.forEach(connection => {
                    const origin = connection.origen;
                    if (origin === deletedStreet) return;
                    const position = connection.posOrigen === -1 ? origin.tamano - 1 : connection.posOrigen;
                    if (origin.celulasEsperando?.[connection.carrilOrigen]?.[position] !== undefined &&
                        !origin.conexionesSalida[connection.carrilOrigen].some(candidate =>
                            (candidate.posOrigen === -1 ? origin.tamano - 1 : candidate.posOrigen) === position)) {
                        origin.celulasEsperando[connection.carrilOrigen][position] = false;
                    }
                });
            }

            // Remove both endpoints of each parking pair that touches this street,
            // and clear the corresponding marks on every surviving street.
            (window.edificios || []).forEach(edificio => {
                const parkingConnections = edificio.conexiones || [];
                const pairIndexByConnection = new Map();
                const pairCounts = { entrada: 0, salida: 0 };
                parkingConnections.forEach(connection => {
                    const type = connection.tipo;
                    pairIndexByConnection.set(connection, pairCounts[type]);
                    pairCounts[type]++;
                });
                const deletedPairIndexes = new Set(parkingConnections
                    .filter(connection => connection.calleId === deletedStreet.id || connection.calleId === deletedStreet.nombre)
                    .map(connection => pairIndexByConnection.get(connection)));
                if (!deletedPairIndexes.size) return;

                const removedConnections = parkingConnections.filter(connection => deletedPairIndexes.has(pairIndexByConnection.get(connection)));
                edificio.conexiones = parkingConnections.filter(connection => !deletedPairIndexes.has(pairIndexByConnection.get(connection)));
                (window.calles || []).forEach(street => {
                    if (!street.conexionesEstacionamiento) return;
                    removedConnections.forEach(connection => {
                        if (connection.calleId !== (street.id ?? street.nombre)) return;
                        street.conexionesEstacionamiento.delete(`${connection.carril}-${connection.indice}`);
                    });
                });
                if (edificio.esEstacionamiento && edificio.conexiones.length === 0) {
                    edificio.esEstacionamiento = false;
                }
            });

            for (const key of estadoEscenarios.celdasBloqueadas.keys()) {
                if (key.startsWith(`${deletedStreet.id}:`) || key.startsWith(`${deletedStreet.nombre}:`)) {
                    estadoEscenarios.celdasBloqueadas.delete(key);
                }
            }

            // Eliminar calle
            window.calles.splice(index, 1);

            // Eliminar de simulación actual
            if (simulacionActual.calles[index]?.nombre === calle.nombre) {
                simulacionActual.calles.splice(index, 1);
            } else if (simulacionActual.calles.filter(c => c.nombre === calle.nombre).length === 1) {
                simulacionActual.calles = simulacionActual.calles.filter(c => c.nombre !== calle.nombre);
            }
            if (Array.isArray(simulacionActual.conexiones)) {
                simulacionActual.conexiones = simulacionActual.conexiones
                    .filter(connection => connection.origenIdx !== index && connection.destinoIdx !== index)
                    .map(connection => ({
                        ...connection,
                        origenIdx: connection.origenIdx > index ? connection.origenIdx - 1 : connection.origenIdx,
                        destinoIdx: connection.destinoIdx > index ? connection.destinoIdx - 1 : connection.destinoIdx
                    }));
            }

            // Limpiar selección
            window.calleSeleccionada = null;

            // Actualizar selectores
            actualizarSelectorCalles();

            // Eliminar sprite en PixiJS si está activo
            if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
                window.pixiApp.sceneManager.calleRenderer?.removeCalleSprite(calle);
                // Actualizar etiquetas cuando se elimina una calle
                window.pixiApp.sceneManager.refreshEtiquetas();
            }

            // Reinicializar intersecciones
            if (window.inicializarIntersecciones) {
                window.inicializarIntersecciones();
            }

            // Renderizar Canvas 2D si existe
            if (window.renderizarCanvas) {
                window.renderizarCanvas();
            }

            console.log(`🗑️ Calle "${calle.nombre}" eliminada`);
        }
    } else if (edificio) {
        const confirmacion = confirm(`¿Eliminar el edificio "${edificio.label}"?`);
        if (!confirmacion) return;

        const index = window.edificios.findIndex(e => e === edificio);
        if (index !== -1) {
            // Eliminar edificio
            window.edificios.splice(index, 1);

            // Eliminar de simulación actual
            simulacionActual.edificios = simulacionActual.edificios.filter(e => e.label !== edificio.label);

            // Limpiar selección
            window.edificioSeleccionado = null;

            // Actualizar selector
            actualizarSelectorEdificios();

            // Eliminar sprite en PixiJS si está activo
            if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
                window.pixiApp.sceneManager.edificioRenderer?.removeEdificioSprite(edificio);
            }

            // Renderizar Canvas 2D si existe
            if (window.renderizarCanvas) {
                window.renderizarCanvas();
            }

            console.log(`🗑️ Edificio "${edificio.label}" eliminado`);
            alert("Edificio eliminado exitosamente");
        }
    }
}

// ==================== GUARDAR SIMULACIÓN ====================

function guardarSimulacion() {
    // Obtener nombre de la simulación
    const nombreSimulacion = prompt("Nombre de la simulación:", simulacionActual.nombre || "Nueva Simulación");
    if (!nombreSimulacion) return;

    simulacionActual.nombre = nombreSimulacion;

    // Recopilar datos actuales
    const datosSimulacion = {
        version: "1.0",
        nombre: nombreSimulacion,
        fecha: new Date().toISOString(),
        calles: window.calles ? window.calles.map(calle => ({
            nombre: calle.nombre,
            tamano: calle.tamano,
            tipo: calle.tipo.nombre || calle.tipo,
            x: calle.x,
            y: calle.y,
            angulo: calle.angulo,
            probabilidadGeneracion: calle.probabilidadGeneracion,
            carriles: calle.carriles,
            probabilidadSaltoDeCarril: calle.probabilidadSaltoDeCarril,
            // Guardar vértices si existen
            vertices: calle.vertices || [],
            esCurva: calle.esCurva || false,
            ...(calle.bezierGeometry ? {
                bezierGeometry: true,
                endX: calle.endX,
                endY: calle.endY,
                bezierControls: calle.bezierControls.map(control => ({ x: control.x, y: control.y }))
            } : {})
        })) : [],
        conexiones: window.conexiones ? window.conexiones.map(c => {
            // Encontrar los índices de las calles origen y destino
            const origenIdx = window.calles.findIndex(calle => calle === c.origen);
            const destinoIdx = window.calles.findIndex(calle => calle === c.destino);

            return {
                origenIdx,
                destinoIdx,
                tipo: c.tipo === 'lineal' ? 'LINEAL' : (c.tipo === 'incorporacion' ? 'INCORPORACION' : 'PROBABILISTICA'),
                detalles: [{
                    carrilOrigen: c.carrilOrigen,
                    carrilDestino: c.carrilDestino,
                    posOrigen: c.posOrigen,
                    posDestino: c.posDestino,
                    probabilidad: c.probabilidadTransferencia
                }]
            };
        }) : [],
        edificios: window.edificios || [],
        imagenReferencia: window.referenceImage ? {
            ...(window.referenceImage.url ? { url: window.referenceImage.url } : { dataUrl: window.referenceImage.dataUrl }),
            x: window.referenceImage.x,
            y: window.referenceImage.y,
            width: window.referenceImage.width,
            height: window.referenceImage.height,
            rotation: window.referenceImage.rotation || 0,
            visible: window.referenceImage.visible,
            opacity: window.referenceImage.opacity,
            locked: window.referenceImage.locked
        } : null,
        // Guardar configuración de tiempo virtual si está disponible
        configuracionTiempo: window.tiempoToJSON ? window.tiempoToJSON() : null
    };

    // Convertir a JSON
    const jsonString = JSON.stringify(datosSimulacion, null, 2);

    // Crear blob y descargar
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${nombreSimulacion.replace(/\s+/g, '_')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`💾 Simulación "${nombreSimulacion}" guardada`);
    alert(`Simulación "${nombreSimulacion}" guardada exitosamente como JSON`);
}

// ==================== CARGAR SIMULACIÓN ====================

function cargarSimulacion(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            const datosSimulacion = JSON.parse(e.target.result);

            // Validar estructura
            if (!datosSimulacion.calles || !Array.isArray(datosSimulacion.calles)) {
                throw new Error("Formato de archivo inválido");
            }

            // Confirmar carga
            const confirmacion = confirm(`¿Cargar simulación "${datosSimulacion.nombre}"?\nEsto eliminará la simulación actual.`);
            if (!confirmacion) return;

            // Limpiar simulación actual
            limpiarSimulacionActual();
            if (datosSimulacion.imagenReferencia) {
                await window.setReferenceImage(datosSimulacion.imagenReferencia);
            }

            // Cargar calles (silenciosamente, sin alertas individuales)
            let callesExitosas = 0;
            let callesFallidas = 0;

            datosSimulacion.calles.forEach(calleData => {
                const exito = agregarCalle(
                    calleData.nombre,
                    calleData.tamano,
                    calleData.tipo.toUpperCase(),
                    calleData.x,
                    calleData.y,
                    calleData.angulo,
                    calleData.probabilidadGeneracion,
                    calleData.carriles,
                    calleData.probabilidadSaltoDeCarril,
                    true  // silencioso = true
                );

                if (exito) {
                    callesExitosas++;
                    const calleCreada = window.calles[window.calles.length - 1];
                    if (calleCreada && calleData.bezierGeometry && Array.isArray(calleData.bezierControls)) {
                        const proposed = { ...calleCreada, esCurva: true, bezierGeometry: true,
                            endX: calleData.endX, endY: calleData.endY,
                            bezierControls: calleData.bezierControls.map(control => ({ x: control.x, y: control.y })) };
                        const geometry = window.streetBezier?.validate(proposed);
                        if (geometry?.valid && geometry.cells === calleCreada.tamano) {
                            Object.assign(calleCreada, proposed);
                            calleCreada.vertices = [];
                        }
                    } else if (calleCreada && calleData.vertices?.length > 0) {
                        calleCreada.vertices = calleData.vertices;
                        calleCreada.esCurva = calleData.esCurva || false;
                    }
                } else {
                    callesFallidas++;
                }
            });

            // Cargar edificios si existen
            if (datosSimulacion.edificios && Array.isArray(datosSimulacion.edificios)) {
                window.edificios = datosSimulacion.edificios;

                // IMPORTANTE: Actualizar selector de edificios después de cargar
                actualizarSelectorEdificios();

                // IMPORTANTE: Renderizar inmediatamente para mostrar los edificios
                if (window.renderizarCanvas) {
                    window.renderizarCanvas();
                }

                console.log(`✅ ${window.edificios.length} edificios cargados, selector actualizado y renderizados`);
            }

            // Cargar configuración de tiempo virtual si existe
            if (datosSimulacion.configuracionTiempo && window.tiempoFromJSON) {
                window.tiempoFromJSON(datosSimulacion.configuracionTiempo);
                console.log(`⏰ Configuración de tiempo virtual cargada`);
            } else {
                console.log(`⏰ No se encontró configuración de tiempo, usando valores por defecto`);
            }

            // Cargar conexiones (en segundo paso para asegurar que las calles existan)
            if (datosSimulacion.conexiones && Array.isArray(datosSimulacion.conexiones)) {
                setTimeout(() => {
                    // Asegurarse de que la clase ConexionCA y los tipos estén disponibles
                    if (!window.ConexionCA || !window.TIPOS_CONEXION) {
                        console.error("❌ ConexionCA o TIPOS_CONEXION no están disponibles");
                        return;
                    }

                    const conexionesCreadas = [];

                    // Crear cada conexión individualmente desde los detalles del JSON
                    datosSimulacion.conexiones.forEach(conexionData => {
                        const origen = window.calles[conexionData.origenIdx];
                        const destino = window.calles[conexionData.destinoIdx];

                        if (!origen || !destino) {
                            console.warn(`⚠️ Conexión omitida: calles no encontradas`);
                            return;
                        }

                        // Verificar que haya detalles
                        if (!conexionData.detalles || conexionData.detalles.length === 0) {
                            console.warn(`⚠️ Conexión omitida: no hay detalles`);
                            return;
                        }

                        // Mapear tipo string a constante
                        let tipoConexion = window.TIPOS_CONEXION.LINEAL;
                        if (conexionData.tipo === "INCORPORACION") {
                            tipoConexion = window.TIPOS_CONEXION.INCORPORACION;
                        } else if (conexionData.tipo === "PROBABILISTICA") {
                            tipoConexion = window.TIPOS_CONEXION.PROBABILISTICA;
                        }

                        // Crear UNA conexión por cada detalle guardado
                        conexionData.detalles.forEach(detalle => {
                            // Crear instancia de ConexionCA directamente con los datos exactos del JSON
                            const nuevaConexion = new window.ConexionCA(
                                origen,
                                destino,
                                detalle.carrilOrigen,
                                detalle.carrilDestino,
                                detalle.posOrigen !== undefined ? detalle.posOrigen : -1,
                                detalle.posDestino !== undefined ? detalle.posDestino : 0,
                                detalle.probabilidad !== undefined ? detalle.probabilidad : 1.0,
                                tipoConexion
                            );

                            // Agregar a la lista temporal
                            conexionesCreadas.push(nuevaConexion);

                            console.log(`📥 Conexión cargada: ${origen.nombre}[C${detalle.carrilOrigen}] → ${destino.nombre}[C${detalle.carrilDestino}] (${conexionData.tipo})`);
                        });
                    });

                    // Registrar todas las conexiones creadas
                    if (typeof window.registrarConexiones === 'function') {
                        window.registrarConexiones(conexionesCreadas);
                    }

                    // Agregar a window.conexiones
                    if (!window.conexiones) {
                        window.conexiones = [];
                    }
                    window.conexiones.push(...conexionesCreadas);

                    console.log(`✅ Total de conexiones cargadas: ${conexionesCreadas.length}`);

                    // Inicializar intersecciones
                    if (window.inicializarIntersecciones) {
                        window.inicializarIntersecciones();
                    }

                    if (window.construirMapaIntersecciones) {
                        window.construirMapaIntersecciones();
                    }

                    // Re-renderizar todo en PixiJS si está activo
                    if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
                        console.log('🎨 Re-renderizando simulación cargada en PixiJS');
                        window.pixiApp.sceneManager.clearAll();
                        window.pixiApp.sceneManager.renderAll();

                        // Forzar actualización de etiquetas si están habilitadas
                        if (window.mostrarEtiquetas && window.pixiApp.sceneManager.uiRenderer) {
                            console.log('🏷️ Actualizando etiquetas después de cargar simulación');
                            window.pixiApp.sceneManager.uiRenderer.updateEtiquetas(window.calles);
                        }
                    }

                    // Renderizar Canvas 2D si existe
                    if (window.renderizarCanvas) {
                        window.renderizarCanvas();
                    }

                    console.log(`✅ Simulación "${datosSimulacion.nombre}" cargada completamente`);
                }, 100);
            }

            simulacionActual = datosSimulacion;

            // Mostrar resumen de la carga
            let mensaje = `✅ Simulación "${datosSimulacion.nombre}" cargada exitosamente\n\n`;
            mensaje += `📊 Resumen:\n`;
            mensaje += `  • Calles: ${callesExitosas} cargadas`;
            if (callesFallidas > 0) {
                mensaje += ` (${callesFallidas} fallidas)`;
            }
            mensaje += `\n  • Edificios: ${window.edificios ? window.edificios.length : 0} cargados\n`;
            mensaje += `  • Conexiones: ${datosSimulacion.conexiones ? datosSimulacion.conexiones.length : 0} configuradas`;

            alert(mensaje);

            console.log(`✅ Simulación "${datosSimulacion.nombre}" cargada completamente`);

        } catch (error) {
            console.error("❌ Error al cargar simulación:", error);
            alert(`❌ Error al cargar simulación: ${error.message}`);
        }
    };

    reader.readAsText(file);

    // Resetear input
    event.target.value = '';
}

// ==================== NUEVA SIMULACIÓN ====================

function nuevaSimulacion() {
    const confirmacion = confirm("¿Crear una nueva simulación?\nEsto eliminará la simulación actual.");
    if (!confirmacion) return;

    limpiarSimulacionActual();

    simulacionActual = {
        nombre: "Nueva Simulación",
        calles: [],
        conexiones: [],
        edificios: []
    };

    alert("Nueva simulación creada");
}

// ==================== LIMPIAR SIMULACIÓN ====================

function limpiarSimulacionActual() {
    referenceImageRequest++;
    window.referenceImage = null;
    window.referenceImageEditor?.sync();
    // Limpiar calles
    if (window.calles) {
        window.calles.length = 0;
    }

    // Limpiar conexiones
    if (window.conexiones) {
        window.conexiones.length = 0;
    }

    // Limpiar intersecciones
    if (window.intersecciones) {
        window.intersecciones.length = 0;
    }

    // Limpiar edificios
    if (window.edificios) {
        window.edificios.length = 0;
    }

    // Limpiar selección
    window.calleSeleccionada = null;
    window.edificioSeleccionado = null;

    // Actualizar selectores
    actualizarSelectorCalles();
    actualizarSelectorEdificios();

    // Limpiar PixiJS si está activo
    if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
        console.log('🧹 Limpiando escena de PixiJS');
        window.pixiApp.sceneManager.clearAll();
    }

    // Renderizar Canvas 2D si existe
    redrawReferenceImage();
    if (window.renderizarCanvas) {
        window.renderizarCanvas();
    }

    console.log("🧹 Simulación limpiada (calles, conexiones, intersecciones y edificios)");
}

// ==================== GESTIÓN DE CONEXIONES ====================

let conexionEditandoIndex = -1;
let handlerConfirmarEdicion = null; // Variable global para el handler del botón confirmar
let handlerCambioTipo = null; // Variable global para el handler del select tipo

// Toggle para mostrar/ocultar lista de conexiones
function toggleListaConexiones() {
    const container = document.getElementById('listaConexionesContainer');
    const btn = document.getElementById('btnMostrarListaConexiones');

    if (container.style.display === 'none') {
        actualizarListaConexiones(window.calleSeleccionada);
        container.style.display = 'block';
        btn.textContent = '🔼 Ocultar Conexiones';
    } else {
        container.style.display = 'none';
        btn.textContent = '📋 Ver Conexiones Existentes';
    }
}

// Actualizar la lista de conexiones en el UI
// Si se proporciona calleSeleccionada, solo muestra conexiones donde la calle es origen o destino
function actualizarListaConexiones(calleSeleccionada = null) {
    const listaDiv = document.getElementById('listaConexiones');
    listaDiv.innerHTML = '';

    if (!window.conexiones || window.conexiones.length === 0) {
        listaDiv.innerHTML = '<div class="list-group-item text-muted text-center">No hay conexiones creadas</div>';
        return;
    }

    // Filtrar conexiones si hay una calle seleccionada
    let conexionesFiltradas = window.conexiones;
    if (calleSeleccionada) {
        conexionesFiltradas = window.conexiones.filter(conexion => {
            if (!conexion || !conexion.origen || !conexion.destino) return false;
            return conexion.origen === calleSeleccionada || conexion.destino === calleSeleccionada;
        });

        // Mostrar mensaje si la calle seleccionada no tiene conexiones
        if (conexionesFiltradas.length === 0) {
            listaDiv.innerHTML = `<div class="list-group-item text-muted text-center">
                <strong>${calleSeleccionada.nombre}</strong> no tiene conexiones asociadas
            </div>`;
            console.log(`📋 Calle "${calleSeleccionada.nombre}" no tiene conexiones`);
            return;
        }
    }

    // Mostrar encabezado si hay filtro activo
    if (calleSeleccionada) {
        const header = document.createElement('div');
        header.className = 'list-group-item list-group-item-info';
        header.innerHTML = `<small><strong>📌 Conexiones de:</strong> ${calleSeleccionada.nombre}</small>`;
        listaDiv.appendChild(header);
    }

    conexionesFiltradas.forEach((conexion, indexFiltrado) => {
        if (!conexion || !conexion.origen || !conexion.destino) return;

        // Obtener el índice real de la conexión en el array global
        const indexReal = window.conexiones.indexOf(conexion);

        const origenNombre = conexion.origen.nombre || `Calle ${indexReal}`;
        const destinoNombre = conexion.destino.nombre || `Calle ${indexReal}`;

        let tipoIcono = '🟢';
        let tipoTexto = 'Lineal';
        if (conexion.tipo === 'incorporacion') {
            tipoIcono = '🟠';
            tipoTexto = 'Incorporación';
        } else if (conexion.tipo === 'probabilistica') {
            tipoIcono = '🟣';
            tipoTexto = 'Probabilística';
        }

        const item = document.createElement('div');
        item.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center';

        let detallesConexion = `${tipoIcono} <strong>${origenNombre}</strong> [C${conexion.carrilOrigen + 1}] → <strong>${destinoNombre}</strong> [C${conexion.carrilDestino + 1}]`;

        if (conexion.tipo === 'probabilistica') {
            const prob = Math.round(conexion.probabilidadTransferencia * 100);
            detallesConexion += ` <span class="badge bg-secondary">${prob}%</span>`;
        }

        item.innerHTML = `
            <div class="small">${detallesConexion}</div>
            <div class="btn-group btn-group-sm" role="group">
                <button class="btn btn-outline-warning btn-sm" onclick="editarConexion(${indexReal})" title="Editar">
                    ✏️
                </button>
                <button class="btn btn-outline-danger btn-sm" onclick="eliminarConexion(${indexReal})" title="Eliminar">
                    🗑️
                </button>
            </div>
        `;

        listaDiv.appendChild(item);
    });

    const mensajeLog = calleSeleccionada
        ? `📋 Conexiones de "${calleSeleccionada.nombre}": ${conexionesFiltradas.length} de ${window.conexiones.length} totales`
        : `📋 Lista de conexiones actualizada: ${window.conexiones.length} conexiones`;
    console.log(mensajeLog);
}

// Función para poblar el modal de edición con datos de UNA conexión probabilística
function poblarEdicionProbabilistica(conexion) {
    const origen = conexion.origen;
    const destino = conexion.destino;

    // Poblar selector de carril origen (solo lectura, no se puede cambiar)
    const selectCarrilOrigen = document.getElementById('editSelectCarrilOrigenProb');
    if (selectCarrilOrigen) {
        let html = '';
        for (let i = 0; i < origen.carriles; i++) {
            html += `<option value="${i}">Carril ${i + 1}</option>`;
        }
        selectCarrilOrigen.innerHTML = html;
        selectCarrilOrigen.value = conexion.carrilOrigen;
        selectCarrilOrigen.disabled = true; // No permitir cambiar el carril origen
    }

    // Generar formulario SOLO para esta conexión individual
    const contenedor = document.getElementById('editContenedorDistribucionesProbabilisticas');

    const html = `
        <div class="alert alert-info small mb-3">
            <strong>📝 Editando conexión individual:</strong> Carril ${conexion.carrilOrigen + 1} → Carril ${conexion.carrilDestino + 1}
        </div>

        <div class="mb-3">
            <label class="form-label fw-bold">Configuración de Esta Salida</label>

            <div class="row g-2">
                <div class="col-md-6">
                    <label class="form-label small">Carril Destino</label>
                    <select class="form-select form-select-sm" id="editCarrilDestinoSalidaUnica" disabled>
                        <option value="${conexion.carrilDestino}">Carril ${conexion.carrilDestino + 1}</option>
                    </select>
                    <small class="text-muted">No se puede cambiar al editar</small>
                </div>
                <div class="col-md-6">
                    <label class="form-label small">Probabilidad (%)</label>
                    <input type="number" class="form-control form-control-sm"
                           id="editProbSalidaUnica"
                           placeholder="0-100"
                           min="0"
                           max="100"
                           step="1"
                           value="${conexion.probabilidadTransferencia * 100}">
                    <small class="text-muted">% de vehículos que toman esta salida</small>
                </div>
                <div class="col-md-6">
                    <label class="form-label small">Posición Origen (celda)</label>
                    <input type="number" class="form-control form-control-sm"
                           id="editPosOrigenSalidaUnica"
                           placeholder="1-${origen.tamano}"
                           min="1"
                           max="${origen.tamano}"
                           value="${conexion.posOrigen + 1}">
                    <small class="text-muted">Celda donde se origina (máx: ${origen.tamano})</small>
                </div>
                <div class="col-md-6">
                    <label class="form-label small">Posición Destino (celda)</label>
                    <input type="number" class="form-control form-control-sm"
                           id="editPosDestinoSalidaUnica"
                           placeholder="1-${destino.tamano}"
                           min="1"
                           max="${destino.tamano}"
                           value="${conexion.posDestino + 1}">
                    <small class="text-muted">Celda donde llegan (máx: ${destino.tamano})</small>
                </div>
            </div>
        </div>

        <div class="alert alert-warning small mt-2 mb-0">
            <strong>⚠️ Nota:</strong> Solo puedes editar la probabilidad y las posiciones de esta salida específica.
            Para cambiar el carril origen o destino, elimina esta conexión y crea una nueva.
        </div>
    `;

    contenedor.innerHTML = html;
}

// Editar una conexión existente
function editarConexion(index) {
    if (!window.conexiones || index < 0 || index >= window.conexiones.length) {
        alert('❌ Conexión no encontrada');
        return;
    }

    const conexion = window.conexiones[index];
    conexionEditandoIndex = index;

    // LIMPIAR FORMULARIO - Remover clases de validación de intentos anteriores
    const selectCarrilDestino = document.getElementById('editSelectCarrilDestinoIncorp');
    const inputPosInicial = document.getElementById('editInputPosInicial');
    const selectCarrilOrigen = document.getElementById('editSelectCarrilOrigenProb');

    if (selectCarrilDestino) selectCarrilDestino.classList.remove('is-invalid');
    if (inputPosInicial) inputPosInicial.classList.remove('is-invalid');
    if (selectCarrilOrigen) selectCarrilOrigen.classList.remove('is-invalid');

    // Limpiar campos de probabilística si existen
    const probInputs = document.querySelectorAll('#editCamposProbabilistica input, #editCamposProbabilistica select');
    probInputs.forEach(input => input.classList.remove('is-invalid'));

    // Mostrar información de la conexión
    const infoSpan = document.getElementById('editConexionInfo');
    infoSpan.textContent = `${conexion.origen.nombre} → ${conexion.destino.nombre}`;

    // Configurar tipo de conexión
    const selectTipo = document.getElementById('editSelectTipoConexion');
    let tipo = 'LINEAL';
    if (conexion.tipo === 'incorporacion') tipo = 'INCORPORACION';
    else if (conexion.tipo === 'probabilistica') tipo = 'PROBABILISTICA';
    selectTipo.value = tipo;

    // Mostrar campos según tipo
    const camposIncorp = document.getElementById('editCamposIncorporacion');
    const camposProb = document.getElementById('editCamposProbabilistica');

    camposIncorp.style.display = 'none';
    camposProb.style.display = 'none';

    if (tipo === 'INCORPORACION') {
        camposIncorp.style.display = 'block';

        // Poblar selector de carril destino
        const selectCarrilDestino = document.getElementById('editSelectCarrilDestinoIncorp');
        if (selectCarrilDestino) {
            let html = '';
            for (let i = 0; i < conexion.destino.carriles; i++) {
                html += `<option value="${i}">Carril ${i + 1}</option>`;
            }
            selectCarrilDestino.innerHTML = html;
            selectCarrilDestino.value = conexion.carrilDestino;
        }

        // Mostrar posición sumando +1 para que sea intuitivo (contar desde 1)
        document.getElementById('editInputPosInicial').value = (conexion.posDestino || 0) + 1;
    } else if (tipo === 'PROBABILISTICA') {
        camposProb.style.display = 'block';
        // Poblar selector de carril origen y formularios de distribución
        poblarEdicionProbabilistica(conexion);
    }

    // Configurar evento de cambio de tipo
    // Remover handler anterior si existe
    if (handlerCambioTipo !== null) {
        selectTipo.removeEventListener('change', handlerCambioTipo);
    }

    // Crear y guardar el nuevo handler
    handlerCambioTipo = function() {
        camposIncorp.style.display = this.value === 'INCORPORACION' ? 'block' : 'none';
        camposProb.style.display = this.value === 'PROBABILISTICA' ? 'block' : 'none';
    };

    selectTipo.addEventListener('change', handlerCambioTipo);

    // Configurar botón de confirmación
    const btnConfirmar = document.getElementById('btnConfirmarEditarConexion');

    // Remover el handler anterior si existe
    if (handlerConfirmarEdicion !== null) {
        btnConfirmar.removeEventListener('click', handlerConfirmarEdicion);
    }

    // Crear y guardar el nuevo handler
    handlerConfirmarEdicion = () => {
        guardarCambiosConexion(index);
    };

    // Agregar el nuevo handler
    btnConfirmar.addEventListener('click', handlerConfirmarEdicion);

    // Abrir modal
    const modalEditElement = document.getElementById('modalEditarConexion');
    const modal = new bootstrap.Modal(modalEditElement);

    // Agregar listener para limpiar el foco cuando se cierre el modal
    modalEditElement.addEventListener('hidden.bs.modal', function handleEditModalHidden() {
        // Remover el foco de cualquier elemento dentro del modal
        if (document.activeElement && modalEditElement.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        // Remover este listener para evitar acumulación
        modalEditElement.removeEventListener('hidden.bs.modal', handleEditModalHidden);
    });

    modal.show();
}

// Guardar cambios en una conexión (modifica directamente la conexión existente)
function guardarCambiosConexion(index) {
    if (!window.conexiones || index < 0 || index >= window.conexiones.length) {
        alert('❌ Error al guardar cambios');
        return;
    }

    const conexion = window.conexiones[index];
    const tipoNuevo = document.getElementById('editSelectTipoConexion').value;

    // Guardar carril origen actual para mover en conexionesSalida si cambia
    const carrilOrigenAntiguo = conexion.carrilOrigen;

    // Extraer valores del formulario según el tipo
    if (tipoNuevo === 'PROBABILISTICA') {
        // Obtener valores del formulario de edición individual
        const probabilidadInput = document.getElementById('editProbSalidaUnica');
        const posOrigenInput = document.getElementById('editPosOrigenSalidaUnica');
        const posDestinoInput = document.getElementById('editPosDestinoSalidaUnica');

        if (!probabilidadInput || !posOrigenInput || !posDestinoInput) {
            alert('❌ Error al leer valores del formulario');
            return;
        }

        const probabilidad = parseFloat(probabilidadInput.value) / 100;
        const posOrigenHumano = parseInt(posOrigenInput.value);
        const posDestinoHumano = parseInt(posDestinoInput.value);

        const origen = conexion.origen;
        const destino = conexion.destino;

        // Validaciones
        if (isNaN(probabilidad) || probabilidad < 0 || probabilidad > 1) {
            alert('❌ La probabilidad debe estar entre 0 y 100%');
            probabilidadInput.classList.add('is-invalid');
            return;
        }

        if (isNaN(posOrigenHumano) || posOrigenHumano < 1 || posOrigenHumano > origen.tamano) {
            alert(`❌ La posición origen debe estar entre 1 y ${origen.tamano}`);
            posOrigenInput.classList.add('is-invalid');
            return;
        }

        if (isNaN(posDestinoHumano) || posDestinoHumano < 1 || posDestinoHumano > destino.tamano) {
            alert(`❌ La posición destino debe estar entre 1 y ${destino.tamano}`);
            posDestinoInput.classList.add('is-invalid');
            return;
        }

        // Convertir a índices de computadora
        const posOrigen = posOrigenHumano - 1;
        const posDestino = posDestinoHumano - 1;

        // Modificar directamente la conexión existente
        conexion.probabilidadTransferencia = probabilidad;
        conexion.posOrigen = posOrigen;
        conexion.posDestino = posDestino;

        console.log(`✅ Conexión probabilística actualizada: Carril ${conexion.carrilOrigen + 1} → Carril ${conexion.carrilDestino + 1} (${(probabilidad * 100).toFixed(0)}%)`);

    } else if (tipoNuevo === 'INCORPORACION') {
        const selectCarrilDestino = document.getElementById('editSelectCarrilDestinoIncorp');
        const inputPosInicial = document.getElementById('editInputPosInicial');

        const carrilDestino = parseInt(selectCarrilDestino.value);
        const posInicialHumano = parseInt(inputPosInicial.value);

        // Validaciones mejoradas
        if (isNaN(carrilDestino)) {
            alert('❌ Selecciona un carril destino válido');
            selectCarrilDestino.classList.add('is-invalid');
            return;
        }
        if (isNaN(posInicialHumano)) {
            alert('❌ La posición inicial es inválida');
            inputPosInicial.classList.add('is-invalid');
            return;
        }
        if (carrilDestino < 0 || carrilDestino >= conexion.destino.carriles) {
            alert(`❌ El carril destino debe estar entre 0 y ${conexion.destino.carriles - 1}`);
            selectCarrilDestino.classList.add('is-invalid');
            return;
        }
        // Validar que la posición sea mayor que 0 (contar desde 1)
        if (posInicialHumano < 1 || posInicialHumano > conexion.destino.tamano) {
            alert(`❌ La posición inicial debe estar entre 1 y ${conexion.destino.tamano}`);
            inputPosInicial.classList.add('is-invalid');
            return;
        }

        // Convertir de índice humano (desde 1) a índice de computadora (desde 0)
        const posInicial = posInicialHumano - 1;

        // Modificar propiedades directamente
        conexion.tipo = window.TIPOS_CONEXION.INCORPORACION;
        conexion.carrilDestino = carrilDestino;
        conexion.posDestino = posInicial;
        conexion.probabilidadTransferencia = 1.0;

    } else if (tipoNuevo === 'LINEAL') {
        // Para conexión lineal, los carriles permanecen iguales
        conexion.tipo = window.TIPOS_CONEXION.LINEAL;
        conexion.probabilidadTransferencia = 1.0;
        conexion.posDestino = 0;
    }

    // Si cambió el carril origen, mover la conexión en conexionesSalida
    if (carrilOrigenAntiguo !== conexion.carrilOrigen) {
        const origen = conexion.origen;

        // Remover del carril antiguo
        if (origen.conexionesSalida && origen.conexionesSalida[carrilOrigenAntiguo]) {
            const idx = origen.conexionesSalida[carrilOrigenAntiguo].indexOf(conexion);
            if (idx !== -1) {
                origen.conexionesSalida[carrilOrigenAntiguo].splice(idx, 1);
            }
        }

        // Agregar al nuevo carril
        if (!origen.conexionesSalida[conexion.carrilOrigen]) {
            origen.conexionesSalida[conexion.carrilOrigen] = [];
        }
        origen.conexionesSalida[conexion.carrilOrigen].push(conexion);
    }

    // Reinicializar intersecciones
    if (window.inicializarIntersecciones) {
        window.inicializarIntersecciones();
    }
    if (window.construirMapaIntersecciones) {
        window.construirMapaIntersecciones();
    }

    // Actualizar vista
    actualizarListaConexiones(window.calleSeleccionada);
    if (window.renderizarCanvas) {
        window.renderizarCanvas();
    }

    // Cerrar modal correctamente
    const modalEditElement = document.getElementById('modalEditarConexion');
    // Remover el foco antes de cerrar para evitar errores de accesibilidad
    if (modalEditElement && document.activeElement && modalEditElement.contains(document.activeElement)) {
        document.activeElement.blur();
    }
    const modal = bootstrap.Modal.getInstance(modalEditElement);
    if (modal) modal.hide();

    // Limpiar los handlers globales
    const btnConfirmar = document.getElementById('btnConfirmarEditarConexion');
    const selectTipo = document.getElementById('editSelectTipoConexion');

    if (handlerConfirmarEdicion !== null) {
        btnConfirmar.removeEventListener('click', handlerConfirmarEdicion);
        handlerConfirmarEdicion = null;
    }

    if (handlerCambioTipo !== null) {
        selectTipo.removeEventListener('change', handlerCambioTipo);
        handlerCambioTipo = null;
    }

    console.log(`✏️ Conexión ${index} editada: ${conexion.origen.nombre}[${conexion.carrilOrigen}] → ${conexion.destino.nombre}[${conexion.carrilDestino}] (${tipoNuevo})`);
    alert('✅ Cambios aplicados correctamente a la simulación.');
}

// Eliminar una conexión (aplica cambios inmediatamente)
function eliminarConexion(index) {
    if (!window.conexiones || index < 0 || index >= window.conexiones.length) {
        alert('❌ Conexión no encontrada');
        return;
    }

    const conexion = window.conexiones[index];
    const confirmacion = confirm(`¿Eliminar conexión de "${conexion.origen.nombre}" a "${conexion.destino.nombre}"?`);

    if (!confirmacion) return;

    // Eliminar de conexionesSalida de la calle origen
    if (conexion.origen.conexionesSalida && conexion.origen.conexionesSalida[conexion.carrilOrigen]) {
        const idx = conexion.origen.conexionesSalida[conexion.carrilOrigen].indexOf(conexion);
        if (idx !== -1) {
            conexion.origen.conexionesSalida[conexion.carrilOrigen].splice(idx, 1);
        }
    }

    // Remover de window.conexiones
    window.conexiones.splice(index, 1);

    // Reinicializar intersecciones
    if (window.inicializarIntersecciones) {
        window.inicializarIntersecciones();
    }
    if (window.construirMapaIntersecciones) {
        window.construirMapaIntersecciones();
    }

    // Actualizar vista
    actualizarListaConexiones(window.calleSeleccionada);
    if (window.renderizarCanvas) {
        window.renderizarCanvas();
    }

    // Actualizar en PixiJS si está activo
    if (window.USE_PIXI && window.pixiApp && window.pixiApp.sceneManager) {
        // Limpiar y re-renderizar todas las conexiones
        window.pixiApp.sceneManager.conexionRenderer?.clearAll();
        if (window.conexiones && window.mostrarConexiones) {
            window.pixiApp.sceneManager.conexionRenderer?.renderAll(window.conexiones);
        }
    }

    console.log(`🗑️ Conexión ${index} eliminada de la simulación`);
    alert('✅ Conexión eliminada correctamente.');
}


// ==================== EXPONER FUNCIONES GLOBALMENTE ====================

window.inicializarConstructor = inicializarConstructor;
window.agregarCalle = agregarCalle;
window.guardarSimulacion = guardarSimulacion;
window.cargarSimulacion = cargarSimulacion;
window.nuevaSimulacion = nuevaSimulacion;
window.simulacionActual = simulacionActual;

// Exponer funciones de gestión de conexiones
window.toggleListaConexiones = toggleListaConexiones;
window.actualizarListaConexiones = actualizarListaConexiones;
window.editarConexion = editarConexion;
window.eliminarConexion = eliminarConexion;

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarConstructor);
} else {
    // Si ya se cargó, inicializar directamente
    setTimeout(inicializarConstructor, 500);
}

console.log("🏗️ Constructor.js cargado");
