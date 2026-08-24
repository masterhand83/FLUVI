/**
 * edificioUI.js - Interfaz de usuario para configurar edificios como estacionamientos
 */

console.log('🏢 edificioUI.js cargando...');

// Variables globales para tracking
let edificioEnEdicion = null;

// Exponer contadorPares en window para que sea accesible globalmente
if (!window.contadorPares) {
    window.contadorPares = 0;
}

/**
 * Muestra/oculta la configuración de estacionamiento
 */
function toggleEstacionamientoConfig(checked) {
    const configDiv = document.getElementById('configEstacionamiento');
    if (configDiv) {
        configDiv.style.display = checked ? 'block' : 'none';
    }

    if (checked) {
        // Inicializar sliders de probabilidades si no existen
        inicializarSlidersProbabilidades();
    }
}

/**
 * Inicializa los sliders de probabilidades por hora
 */
function inicializarSlidersProbabilidades() {
    const containerEntrada = document.getElementById('slidersProbEntrada');
    const containerSalida = document.getElementById('slidersProbSalida');

    if (!containerEntrada || !containerSalida) return;

    // Limpiar containers
    containerEntrada.innerHTML = '';
    containerSalida.innerHTML = '';

    // Crear sliders para cada hora (0-23)
    for (let hora = 0; hora < 24; hora++) {
        // Slider de ENTRADA
        const divEntrada = document.createElement('div');
        divEntrada.className = 'mb-2';
        divEntrada.innerHTML = `
            <label class="form-label small mb-0">Hora ${hora}:00</label>
            <div class="d-flex align-items-center gap-2">
                <input type="range" class="form-range" id="probEntrada_${hora}" min="0" max="100" value="30">
                <span class="badge bg-primary" id="valEntrada_${hora}">30%</span>
            </div>
        `;
        containerEntrada.appendChild(divEntrada);

        // Event listener para entrada
        const sliderEntrada = divEntrada.querySelector(`#probEntrada_${hora}`);
        const badgeEntrada = divEntrada.querySelector(`#valEntrada_${hora}`);
        sliderEntrada.addEventListener('input', () => {
            badgeEntrada.textContent = sliderEntrada.value + '%';
        });

        // Slider de SALIDA
        const divSalida = document.createElement('div');
        divSalida.className = 'mb-2';
        divSalida.innerHTML = `
            <label class="form-label small mb-0">Hora ${hora}:00</label>
            <div class="d-flex align-items-center gap-2">
                <input type="range" class="form-range" id="probSalida_${hora}" min="0" max="100" value="20">
                <span class="badge bg-info" id="valSalida_${hora}">20%</span>
            </div>
        `;
        containerSalida.appendChild(divSalida);

        // Event listener para salida
        const sliderSalida = divSalida.querySelector(`#probSalida_${hora}`);
        const badgeSalida = divSalida.querySelector(`#valSalida_${hora}`);
        sliderSalida.addEventListener('input', () => {
            badgeSalida.textContent = sliderSalida.value + '%';
        });
    }
}

/**
 * Aplica un perfil predefinido de horarios
 */
function aplicarPerfilHorario(perfil) {
    const perfiles = {
        normal: {
            entrada: Array(24).fill(30),
            salida: Array(24).fill(20)
        },
        oficina: {
            entrada: [
                20, 20, 10, 10, 10, 20, 40, 60, 70, 50, 30, 20, // 0-11
                10, 10, 10, 20, 30, 60, 70, 50, 30, 20, 20, 20  // 12-23
            ],
            salida: [
                10, 10, 10, 10, 10, 10, 20, 30, 20, 10, 10, 30, // 0-11
                50, 60, 40, 20, 20, 50, 70, 60, 40, 20, 10, 10  // 12-23
            ]
        },
        centro: {
            entrada: [
                10, 10, 10, 10, 10, 10, 20, 30, 40, 50, 60, 70, // 0-11
                70, 60, 60, 70, 70, 80, 80, 70, 50, 40, 30, 20  // 12-23
            ],
            salida: [
                10, 10, 10, 10, 10, 10, 10, 10, 10, 20, 30, 40, // 0-11
                50, 50, 40, 50, 60, 70, 80, 80, 70, 60, 40, 20  // 12-23
            ]
        }
    };

    const perfilSeleccionado = perfiles[perfil];
    if (!perfilSeleccionado) return;

    // Aplicar valores a los sliders
    for (let hora = 0; hora < 24; hora++) {
        const sliderEntrada = document.getElementById(`probEntrada_${hora}`);
        const badgeEntrada = document.getElementById(`valEntrada_${hora}`);
        const sliderSalida = document.getElementById(`probSalida_${hora}`);
        const badgeSalida = document.getElementById(`valSalida_${hora}`);

        if (sliderEntrada && badgeEntrada) {
            sliderEntrada.value = perfilSeleccionado.entrada[hora];
            badgeEntrada.textContent = perfilSeleccionado.entrada[hora] + '%';
        }

        if (sliderSalida && badgeSalida) {
            sliderSalida.value = perfilSeleccionado.salida[hora];
            badgeSalida.textContent = perfilSeleccionado.salida[hora] + '%';
        }
    }

    console.log(`✅ Perfil "${perfil}" aplicado`);
}

/**
 * Agrega un par de conexiones (entrada + salida) al formulario
 */
function agregarParConexion() {
    console.log('🔵 agregarParConexion() llamada');

    const lista = document.getElementById('listaConexionesEdificio');
    if (!lista) {
        console.error('❌ Elemento listaConexionesEdificio no encontrado');
        alert('ERROR: No se encontró el elemento listaConexionesEdificio');
        return;
    }

    console.log('✅ listaConexionesEdificio encontrado:', lista);

    // Verificar máximo de 10 pares
    const paresActuales = lista.querySelectorAll('.par-conexion').length;
    if (paresActuales >= 10) {
        alert('⚠️ Máximo 10 pares de conexiones permitidos');
        return;
    }

    window.contadorPares++;
    const parId = `par_${window.contadorPares}`;

    const div = document.createElement('div');
    div.className = 'par-conexion border rounded p-3 mb-2';
    div.id = parId;
    div.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-2">
            <strong>Par ${window.contadorPares}</strong>
            <button type="button" class="btn btn-sm btn-danger" onclick="eliminarParConexion('${parId}')">
                ✖️ Eliminar
            </button>
        </div>

        <!-- ENTRADA -->
        <div class="mb-3 bg-success bg-opacity-25 p-2 rounded">
            <label class="form-label small mb-1 text-white"><strong>🟢 ENTRADA</strong></label>
            <div class="row g-2">
                <div class="col-md-4">
                    <select class="form-select form-select-sm" id="${parId}_entrada_calle">
                        <option value="">Calle...</option>
                    </select>
                </div>
                <div class="col-md-4">
                    <input type="number" class="form-control form-control-sm" id="${parId}_entrada_carril" placeholder="Carril (1-N)" min="1">
                    <small class="text-white-50" id="${parId}_entrada_carril_hint">Carril 1 a N</small>
                </div>
                <div class="col-md-4">
                    <input type="number" class="form-control form-control-sm" id="${parId}_entrada_indice" placeholder="Posición (1-N)" min="1">
                    <small class="text-white-50" id="${parId}_entrada_indice_hint">Posición 1 a N</small>
                </div>
            </div>
        </div>

        <!-- SALIDA -->
        <div class="bg-primary bg-opacity-25 p-2 rounded">
            <label class="form-label small mb-1 text-white"><strong>🔵 SALIDA</strong></label>
            <div class="row g-2">
                <div class="col-md-4">
                    <select class="form-select form-select-sm" id="${parId}_salida_calle">
                        <option value="">Calle...</option>
                    </select>
                </div>
                <div class="col-md-4">
                    <input type="number" class="form-control form-control-sm" id="${parId}_salida_carril" placeholder="Carril (1-N)" min="1">
                    <small class="text-white-50" id="${parId}_salida_carril_hint">Carril 1 a N</small>
                </div>
                <div class="col-md-4">
                    <input type="number" class="form-control form-control-sm" id="${parId}_salida_indice" placeholder="Posición (1-N)" min="1">
                    <small class="text-white-50" id="${parId}_salida_indice_hint">Posición 1 a N</small>
                </div>
            </div>
        </div>
    `;

    lista.appendChild(div);
    console.log('✅ Div agregado al DOM, contenido de lista:', lista.innerHTML);

    // Forzar reflow para que el navegador actualice la visualización
    lista.style.display = 'none';
    lista.offsetHeight; // Forzar reflow
    lista.style.display = 'block';

    // Poblar selectores de calles
    poblarSelectoresCalles(parId);

    // Configurar validación dinámica
    configurarValidacionPar(parId);

    console.log(`➕ Par de conexión ${window.contadorPares} agregado`);
    console.log('📊 Total de pares en lista:', lista.querySelectorAll('.par-conexion').length);
}

/**
 * Elimina un par de conexiones
 */
function eliminarParConexion(parId) {
    const par = document.getElementById(parId);
    if (par) {
        par.remove();
        console.log(`🗑️ Par de conexión ${parId} eliminado`);
    }
}

/**
 * Configura la validación dinámica para un par de conexiones
 */
function configurarValidacionPar(parId) {
    const selectEntrada = document.getElementById(`${parId}_entrada_calle`);
    const selectSalida = document.getElementById(`${parId}_salida_calle`);

    const inputEntradaCarril = document.getElementById(`${parId}_entrada_carril`);
    const inputEntradaIndice = document.getElementById(`${parId}_entrada_indice`);
    const inputSalidaCarril = document.getElementById(`${parId}_salida_carril`);
    const inputSalidaIndice = document.getElementById(`${parId}_salida_indice`);

    // Validar entrada cuando se selecciona la calle
    selectEntrada?.addEventListener('change', () => {
        actualizarLimitesYValidar(selectEntrada.value, inputEntradaCarril, inputEntradaIndice, parId, 'entrada');
    });

    // Validar salida cuando se selecciona la calle
    selectSalida?.addEventListener('change', () => {
        actualizarLimitesYValidar(selectSalida.value, inputSalidaCarril, inputSalidaIndice, parId, 'salida');
    });

    // Validar en tiempo real cuando se cambia el valor
    inputEntradaCarril?.addEventListener('input', () => {
        validarInput(selectEntrada.value, inputEntradaCarril, 'carril', parId, 'entrada');
        validarNoTraslape(parId);
    });

    inputEntradaIndice?.addEventListener('input', () => {
        validarInput(selectEntrada.value, inputEntradaIndice, 'indice', parId, 'entrada');
        validarNoTraslape(parId);
    });

    inputSalidaCarril?.addEventListener('input', () => {
        validarInput(selectSalida.value, inputSalidaCarril, 'carril', parId, 'salida');
        validarNoTraslape(parId);
    });

    inputSalidaIndice?.addEventListener('input', () => {
        validarInput(selectSalida.value, inputSalidaIndice, 'indice', parId, 'salida');
        validarNoTraslape(parId);
    });
}

/**
 * Actualiza los límites y hints basados en la calle seleccionada
 */
function actualizarLimitesYValidar(calleId, inputCarril, inputIndice, parId, tipo) {
    if (!calleId || !window.calles) return;

    const calle = window.calles.find(c => (c.id || c.nombre) === calleId);
    if (!calle) return;

    // Actualizar atributos max
    inputCarril.max = calle.carriles;
    inputIndice.max = calle.tamano;

    // Actualizar hints
    const hintCarril = document.getElementById(`${parId}_${tipo}_carril_hint`);
    const hintIndice = document.getElementById(`${parId}_${tipo}_indice_hint`);

    if (hintCarril) hintCarril.textContent = `Carril 1 a ${calle.carriles}`;
    if (hintIndice) hintIndice.textContent = `Posición 1 a ${calle.tamano}`;

    // Validar valores actuales
    validarInput(calleId, inputCarril, 'carril', parId, tipo);
    validarInput(calleId, inputIndice, 'indice', parId, tipo);
}

/**
 * Valida que la entrada y salida no estén en la misma celda del mismo carril
 */
function validarNoTraslape(parId) {
    const selectEntrada = document.getElementById(`${parId}_entrada_calle`);
    const selectSalida = document.getElementById(`${parId}_salida_calle`);

    const inputEntradaCarril = document.getElementById(`${parId}_entrada_carril`);
    const inputEntradaIndice = document.getElementById(`${parId}_entrada_indice`);
    const inputSalidaCarril = document.getElementById(`${parId}_salida_carril`);
    const inputSalidaIndice = document.getElementById(`${parId}_salida_indice`);

    // Solo validar si todos los campos tienen valores
    if (!selectEntrada?.value || !selectSalida?.value ||
        !inputEntradaCarril?.value || !inputEntradaIndice?.value ||
        !inputSalidaCarril?.value || !inputSalidaIndice?.value) {
        return;
    }

    const entradaCarril = parseInt(inputEntradaCarril.value);
    const entradaIndice = parseInt(inputEntradaIndice.value);
    const salidaCarril = parseInt(inputSalidaCarril.value);
    const salidaIndice = parseInt(inputSalidaIndice.value);

    // Verificar si es la misma celda en el mismo carril
    const mismaCalleEntrada = selectEntrada.value;
    const mismaCalleSalida = selectSalida.value;
    const mismoCarril = entradaCarril === salidaCarril;
    const mismaIndice = entradaIndice === salidaIndice;

    if (mismaCalleEntrada === mismaCalleSalida && mismoCarril && mismaIndice) {
        // Marcar ambos como inválidos
        inputEntradaCarril.classList.add('is-invalid');
        inputEntradaIndice.classList.add('is-invalid');
        inputSalidaCarril.classList.add('is-invalid');
        inputSalidaIndice.classList.add('is-invalid');

        // Agregar mensaje de error si no existe
        let errorMsg = document.getElementById(`${parId}_traslape_error`);
        if (!errorMsg) {
            errorMsg = document.createElement('div');
            errorMsg.id = `${parId}_traslape_error`;
            errorMsg.className = 'alert alert-danger alert-sm mt-2';
            errorMsg.innerHTML = '<strong>⚠️ Error:</strong> La entrada y salida no pueden estar en la misma celda del mismo carril.';
            document.getElementById(parId).appendChild(errorMsg);
        }
    } else {
        // Remover mensaje de error si existe
        const errorMsg = document.getElementById(`${parId}_traslape_error`);
        if (errorMsg) {
            errorMsg.remove();
        }
    }
}

/**
 * Valida un input individual
 */
function validarInput(calleId, input, tipoCampo, parId, tipoConexion) {
    if (!calleId || !window.calles || !input.value) {
        input.classList.remove('is-invalid', 'is-valid');
        return;
    }

    const calle = window.calles.find(c => (c.id || c.nombre) === calleId);
    if (!calle) return;

    const valor = parseInt(input.value);
    let esValido = false;

    if (tipoCampo === 'carril') {
        esValido = valor >= 1 && valor <= calle.carriles;
    } else if (tipoCampo === 'indice') {
        esValido = valor >= 1 && valor <= calle.tamano;
    }

    if (esValido) {
        input.classList.remove('is-invalid');
        input.classList.add('is-valid');
    } else {
        input.classList.remove('is-valid');
        input.classList.add('is-invalid');
    }
}

/**
 * Pobla los selectores de calles con las calles disponibles
 */
function poblarSelectoresCalles(parId) {
    const selectEntrada = document.getElementById(`${parId}_entrada_calle`);
    const selectSalida = document.getElementById(`${parId}_salida_calle`);

    if (!selectEntrada || !selectSalida || !window.calles) return;

    window.calles.forEach(calle => {
        const optionEntrada = document.createElement('option');
        optionEntrada.value = calle.id || calle.nombre;
        optionEntrada.textContent = `${calle.nombre} (${calle.carriles} carriles, ${calle.tamano} celdas)`;
        selectEntrada.appendChild(optionEntrada);

        const optionSalida = document.createElement('option');
        optionSalida.value = calle.id || calle.nombre;
        optionSalida.textContent = `${calle.nombre} (${calle.carriles} carriles, ${calle.tamano} celdas)`;
        selectSalida.appendChild(optionSalida);
    });
}

/**
 * Recolecta todas las conexiones configuradas
 */
function recolectarConexiones() {
    const lista = document.getElementById('listaConexionesEdificio');
    if (!lista) {
        console.error('❌ listaConexionesEdificio no encontrado al recolectar');
        return [];
    }

    console.log('🔍 Recolectando conexiones de lista:', lista);

    const pares = lista.querySelectorAll('.par-conexion');
    const conexiones = [];

    console.log(`📊 Encontrados ${pares.length} pares de conexión`);

    pares.forEach(par => {
        const parId = par.id;
        console.log(`🔍 Procesando par: ${parId}`);

        // Entrada (usuario ingresa 1-N, convertimos a 0-(N-1))
        const entradaCalle = document.getElementById(`${parId}_entrada_calle`)?.value;
        const entradaCarrilUser = parseInt(document.getElementById(`${parId}_entrada_carril`)?.value);
        const entradaIndiceUser = parseInt(document.getElementById(`${parId}_entrada_indice`)?.value);

        // Convertir de 1-indexed (usuario) a 0-indexed (código)
        const entradaCarril = entradaCarrilUser - 1;
        const entradaIndice = entradaIndiceUser - 1;

        console.log(`  🟢 ENTRADA - Calle: "${entradaCalle}", Carril: ${entradaCarrilUser} → ${entradaCarril}, Índice: ${entradaIndiceUser} → ${entradaIndice}`);

        // Salida (usuario ingresa 1-N, convertimos a 0-(N-1))
        const salidaCalle = document.getElementById(`${parId}_salida_calle`)?.value;
        const salidaCarrilUser = parseInt(document.getElementById(`${parId}_salida_carril`)?.value);
        const salidaIndiceUser = parseInt(document.getElementById(`${parId}_salida_indice`)?.value);

        // Convertir de 1-indexed (usuario) a 0-indexed (código)
        const salidaCarril = salidaCarrilUser - 1;
        const salidaIndice = salidaIndiceUser - 1;

        console.log(`  🔵 SALIDA - Calle: "${salidaCalle}", Carril: ${salidaCarrilUser} → ${salidaCarril}, Índice: ${salidaIndiceUser} → ${salidaIndice}`);

        if (entradaCalle && !isNaN(entradaCarril) && !isNaN(entradaIndice) && entradaCarril >= 0 && entradaIndice >= 0) {
            conexiones.push({
                tipo: 'entrada',
                calleId: entradaCalle,
                carril: entradaCarril,
                indice: entradaIndice
            });
            console.log('  ✅ Entrada agregada');
        } else {
            console.log('  ⚠️ Entrada no válida');
        }

        if (salidaCalle && !isNaN(salidaCarril) && !isNaN(salidaIndice) && salidaCarril >= 0 && salidaIndice >= 0) {
            conexiones.push({
                tipo: 'salida',
                calleId: salidaCalle,
                carril: salidaCarril,
                indice: salidaIndice
            });
            console.log('  ✅ Salida agregada');
        } else {
            console.log('  ⚠️ Salida no válida');
        }
    });

    console.log(`✅ Total de conexiones recolectadas: ${conexiones.length}`);
    return conexiones;
}

/**
 * Recolecta las probabilidades de entrada/salida
 */
function recolectarProbabilidades() {
    const probEntrada = [];
    const probSalida = [];

    for (let hora = 0; hora < 24; hora++) {
        const sliderEntrada = document.getElementById(`probEntrada_${hora}`);
        const sliderSalida = document.getElementById(`probSalida_${hora}`);

        // IMPORTANTE: Verificar que el elemento existe y obtener su valor (incluyendo 0)
        const valorEntrada = sliderEntrada ? parseInt(sliderEntrada.value) / 100 : 0.3;
        const valorSalida = sliderSalida ? parseInt(sliderSalida.value) / 100 : 0.2;

        probEntrada.push(valorEntrada);
        probSalida.push(valorSalida);
    }

    return { probEntrada, probSalida };
}

// Exponer funciones globalmente
window.toggleEstacionamientoConfig = toggleEstacionamientoConfig;
window.inicializarSlidersProbabilidades = inicializarSlidersProbabilidades;
window.aplicarPerfilHorario = aplicarPerfilHorario;
window.agregarParConexion = agregarParConexion;
window.eliminarParConexion = eliminarParConexion;
window.poblarSelectoresCalles = poblarSelectoresCalles;
window.recolectarConexiones = recolectarConexiones;
window.recolectarProbabilidades = recolectarProbabilidades;

console.log('✅ edificioUI.js cargado');
