/**
 * estacionamientos.js - Sistema de gestión de edificios como estacionamientos
 * Maneja la absorción y liberación de vehículos mediante conexiones de entrada/salida
 */

console.log('🏢 estacionamientos.js cargando...');

// Valores especiales para el arreglo de calles
const CELDA_ENTRADA_ESTACIONAMIENTO = 8;  // Marca celdas de entrada
const CELDA_SALIDA_ESTACIONAMIENTO = 9;   // Marca celdas de salida

function obtenerCalleConexionEstacionamiento(conexion) {
    return window.calles?.find(calle => calle.id === conexion?.calleId || calle.nombre === conexion?.calleId) || null;
}

function conexionEstacionamientoEsValida(conexion, calle = obtenerCalleConexionEstacionamiento(conexion)) {
    return Number.isInteger(conexion?.carril) && conexion.carril >= 0 &&
        Number.isInteger(conexion?.indice) && conexion.indice >= 0 &&
        calle?.arreglo?.[conexion.carril]?.[conexion.indice] !== undefined;
}

// Pure validation: drafts must never change the live building or street maps.
function validarConfiguracionEstacionamiento(edificio, conexiones, capacidad) {
    if (!edificio) return 'Selecciona un edificio para configurar el estacionamiento.';
    if (!Number.isInteger(capacidad) || capacidad <= 0) return 'La capacidad debe ser un entero positivo.';
    const ocupacion = edificio.vehiculosActuales ?? 0;
    if (!Number.isInteger(ocupacion) || ocupacion < 0) return 'La ocupación debe ser un entero no negativo.';
    if (capacidad < ocupacion) return `La capacidad no puede ser menor que la ocupación actual (${ocupacion}).`;
    if (!Array.isArray(conexiones) || conexiones.length < 2 || conexiones.length > 20) {
        return 'Configura entre 1 y 10 pares completos de entrada y salida.';
    }
    const entradas = conexiones.filter(c => c?.tipo === 'entrada').length;
    const salidas = conexiones.filter(c => c?.tipo === 'salida').length;
    if (entradas !== salidas || entradas + salidas !== conexiones.length) {
        return 'Cada par necesita una entrada y una salida; completa ambos extremos.';
    }
    const usados = new Map();
    for (const conexion of conexiones) {
        const calle = obtenerCalleConexionEstacionamiento(conexion);
        if (!calle) return `Selecciona una calle existente para la ${conexion.tipo}.`;
        if (!conexionEstacionamientoEsValida(conexion, calle)) {
            return `Revisa el carril y la celda de la ${conexion.tipo} en «${calle.nombre}»: deben ser enteros dentro de la calle.`;
        }
        const clave = `${conexion.carril}-${conexion.indice}`;
        if (!usados.has(calle)) usados.set(calle, new Set());
        if (usados.get(calle).has(clave)) return 'Cada entrada y salida debe usar una celda diferente.';
        usados.get(calle).add(clave);
        const mapping = calle.conexionesEstacionamiento?.get(clave);
        const otroEdificio = (window.edificios || []).some(otro => otro !== edificio && otro.esEstacionamiento === true &&
            otro.conexiones?.some(c => obtenerCalleConexionEstacionamiento(c) === calle && c.carril === conexion.carril && c.indice === conexion.indice));
        if ((mapping && !conexionPerteneceAEdificio(mapping, edificio)) || otroEdificio) {
            return `La celda ${conexion.indice} del carril ${conexion.carril} en «${calle.nombre}» ya pertenece a otro estacionamiento. Elige otra celda.`;
        }
    }
    return null;
}

function conexionPerteneceAEdificio(mapping, edificio) {
    return mapping.edificio ? mapping.edificio === edificio : edificio.id !== undefined && mapping.edificioId === edificio.id;
}

function quitarMapeosPropiosEstacionamiento(edificio) {
    for (const calle of window.calles || []) {
        for (const [clave, mapping] of calle.conexionesEstacionamiento || []) {
            if (conexionPerteneceAEdificio(mapping, edificio)) calle.conexionesEstacionamiento.delete(clave);
        }
    }
}

function edificioTieneConexionesEstacionamientoFuncionales(edificio) {
    if (edificio?.esEstacionamiento !== true || !Array.isArray(edificio.conexiones)) {
        return false;
    }

    return validarConfiguracionEstacionamiento(edificio, edificio.conexiones, edificio.capacidadMaxima) === null;
}

window.edificioTieneConexionesEstacionamientoFuncionales = edificioTieneConexionesEstacionamientoFuncionales;

/**
 * Convierte un edificio en estacionamiento y configura sus conexiones
 * @param {Object} edificio - El edificio a convertir
 * @param {Array} conexiones - Array de conexiones {tipo, calleId, carril, indice}
 * @param {number} capacidad - Capacidad máxima de vehículos
 */
function configurarEstacionamiento(edificio, conexiones = [], capacidad = 50) {
    if (edificio && Array.isArray(conexiones) && conexiones.length === 0) {
        limpiarConexionesEdificio(edificio);
        return true;
    }
    const validacion = validarConfiguracionEstacionamiento(edificio, conexiones, capacidad);
    if (validacion) {
        console.error(validacion);
        return false;
    }

    const nuevasConexiones = conexiones.map(conexion => ({ ...conexion, edificioId: edificio.id }));
    quitarMapeosPropiosEstacionamiento(edificio);
    // Configurar edificio como estacionamiento
    edificio.esEstacionamiento = true;
    edificio.capacidadMaxima = capacidad;

    // Solo inicializar vehiculosActuales si no existe
    if (edificio.vehiculosActuales === undefined) {
        edificio.vehiculosActuales = 0;
    }

    edificio.conexiones = nuevasConexiones;

    // Inicializar probabilidades por defecto SOLO si no existen
    // (para no sobrescribir valores configurados por el usuario)
    if (!edificio.probabilidadesEntrada || edificio.probabilidadesEntrada.length !== 24) {
        edificio.probabilidadesEntrada = new Array(24).fill(0.3); // 30% por defecto
    }

    if (!edificio.probabilidadesSalida || edificio.probabilidadesSalida.length !== 24) {
        edificio.probabilidadesSalida = new Array(24).fill(0.2);  // 20% por defecto
    }

    // Marcar las celdas en las calles
    nuevasConexiones.forEach(conexion => {
        const calle = obtenerCalleConexionEstacionamiento(conexion);
        const { carril, indice } = conexion;

        // NO marcar la celda en el arreglo - debe permanecer transitable (0)
        // La celda debe permitir que vehículos pasen normalmente
        // La lógica de entrada/salida se maneja por separado

        // Crear mapa de conexiones si no existe
        if (!calle.conexionesEstacionamiento) {
            calle.conexionesEstacionamiento = new Map();
        }

        // Guardar la conexión en un mapa separado usando una clave única
        const claveConexion = `${carril}-${indice}`;
        calle.conexionesEstacionamiento.set(claveConexion, {
            tipo: conexion.tipo,
            edificioId: edificio.id,
            edificio: edificio,
            carril: carril,
            indice: indice
        });

        // Guardar referencia al edificio en la conexión
        conexion.edificioId = edificio.id;

        console.log(`✅ Conexión ${conexion.tipo} configurada: ${calle.nombre}[${carril}][${indice}] (celda transitable)`);
    });

    console.log(`🏢 Estacionamiento "${edificio.label}" configurado: ${nuevasConexiones.length / 2} pares, capacidad ${capacidad}`);
    actualizarVisualizacionEdificioEstacionamiento(edificio);
    return true;
}

function actualizarVisualizacionEdificioEstacionamiento(edificio) {
    const scene = window.pixiApp?.sceneManager;
    if (window.USE_PIXI && scene) {
        scene.edificioRenderer?.updateEdificioSprite(edificio);
        // renderEstacionamientos appends graphics; clear its previous generation
        // without touching ordinary road links before rebuilding parking links.
        for (const [clave, graphics] of scene.conexionGraphics || []) {
            if (typeof clave === 'string' && clave.startsWith('estacionamiento_')) {
                graphics.destroy();
                scene.conexionGraphics.delete(clave);
            }
        }
        scene.conexionRenderer?.renderEstacionamientos();
        if (window.mostrarContadores) scene.renderContadores?.();
        else scene.clearContadores?.();
    }
    window.renderizarCanvas?.();
}

/**
 * Procesa la entrada de un vehículo al estacionamiento
 * @param {Object} edificio - El edificio/estacionamiento
 * @param {number} tipoVehiculo - Tipo de vehículo (1-6)
 * @param {number} horaActual - Hora actual del simulador (0-23)
 * @returns {boolean} - true si el vehículo fue absorbido
 */
function procesarEntradaVehiculo(edificio, tipoVehiculo, horaActual) {
    if (!edificio || !edificio.esEstacionamiento) {
        return false;
    }

    // Verificar si hay espacio
    if (edificio.vehiculosActuales >= edificio.capacidadMaxima) {
        return false; // Estacionamiento lleno
    }

    // Obtener probabilidad de entrada para esta hora
    // IMPORTANTE: Usar ?? en lugar de || para permitir valor 0
    const probabilidadEntrada = edificio.probabilidadesEntrada[horaActual] ?? 0.3;

    // Evaluar si el vehículo decide entrar
    if (Math.random() < probabilidadEntrada) {
        edificio.vehiculosActuales++;
        console.log(`🚗➡️ Vehículo tipo ${tipoVehiculo} entró a "${edificio.label}" (${edificio.vehiculosActuales}/${edificio.capacidadMaxima})`);
        return true;
    }

    return false; // El vehículo decidió no entrar
}

/**
 * Intenta generar un vehículo desde el estacionamiento
 * @param {Object} edificio - El edificio/estacionamiento
 * @param {number} horaActual - Hora actual del simulador (0-23)
 * @returns {number|null} - Tipo de vehículo generado (1-6) o null si no se generó
 */
function intentarGenerarSalida(edificio, horaActual) {
    if (!edificio || !edificio.esEstacionamiento) {
        return null;
    }

    // Verificar si hay vehículos
    if (edificio.vehiculosActuales <= 0) {
        return null;
    }

    // Obtener probabilidad de salida para esta hora
    // IMPORTANTE: Usar ?? en lugar de || para permitir valor 0
    const probabilidadSalida = edificio.probabilidadesSalida[horaActual] ?? 0.2;

    // Evaluar si sale un vehículo
    if (Math.random() < probabilidadSalida) {
        edificio.vehiculosActuales--;

        // Generar tipo de vehículo aleatorio (1-6)
        const tipoVehiculo = Math.floor(Math.random() * 6) + 1;

        console.log(`🚗⬅️ Vehículo tipo ${tipoVehiculo} salió de "${edificio.label}" (${edificio.vehiculosActuales}/${edificio.capacidadMaxima})`);
        return tipoVehiculo;
    }

    return null;
}

/**
 * Obtiene el edificio asociado a una celda específica
 * @param {string} calleId - ID de la calle
 * @param {number} carril - Índice del carril
 * @param {number} indice - Índice de la celda
 * @returns {Object|null} - Edificio encontrado o null
 */
function obtenerEdificioPorCelda(calleId, carril, indice) {
    if (!window.edificios) return null;

    return window.edificios.find(edificio => {
        if (!edificio.esEstacionamiento) return false;

        return edificio.conexiones.some(conexion =>
            (conexion.calleId === calleId) &&
            conexion.carril === carril &&
            conexion.indice === indice
        );
    });
}

/**
 * Obtiene todas las conexiones de salida de un edificio
 * @param {Object} edificio - El edificio
 * @returns {Array} - Array de conexiones de salida
 */
function obtenerConexionesSalida(edificio) {
    if (!edificio || !edificio.esEstacionamiento) return [];
    return edificio.conexiones.filter(c => c.tipo === 'salida');
}

/**
 * Configura probabilidades de entrada/salida para horas pico
 * @param {Object} edificio - El edificio
 * @param {Object} config - {horasPicoEntrada: [7,8,9], horasPicoSalida: [17,18,19]}
 */
function configurarHorasPico(edificio, config) {
    if (!edificio || !edificio.esEstacionamiento) {
        console.error('❌ Edificio no válido o no es estacionamiento');
        return;
    }

    const {
        horasPicoEntrada = [7, 8, 9, 17, 18],
        horasPicoSalida = [12, 13, 17, 18, 19],
        probEntradaPico = 0.6,
        probEntradaNormal = 0.2,
        probSalidaPico = 0.5,
        probSalidaNormal = 0.1
    } = config;

    // Configurar probabilidades de entrada
    for (let hora = 0; hora < 24; hora++) {
        edificio.probabilidadesEntrada[hora] = horasPicoEntrada.includes(hora)
            ? probEntradaPico
            : probEntradaNormal;
    }

    // Configurar probabilidades de salida
    for (let hora = 0; hora < 24; hora++) {
        edificio.probabilidadesSalida[hora] = horasPicoSalida.includes(hora)
            ? probSalidaPico
            : probSalidaNormal;
    }

    console.log(`⏰ Horas pico configuradas para "${edificio.label}"`);
}

/**
 * Resetea el contador de vehículos de un estacionamiento
 * @param {Object} edificio - El edificio
 */
function resetearEstacionamiento(edificio) {
    if (!edificio || !edificio.esEstacionamiento) return;
    edificio.vehiculosActuales = 0;
    console.log(`🔄 Estacionamiento "${edificio.label}" reseteado`);
}

/**
 * Elimina las marcas de conexiones de un edificio de las calles
 * @param {Object} edificio - El edificio
 */
function limpiarConexionesEdificio(edificio) {
    if (!edificio) return;
    quitarMapeosPropiosEstacionamiento(edificio);
    edificio.conexiones = [];
    edificio.esEstacionamiento = false;
    edificio.vehiculosActuales = 0;
    actualizarVisualizacionEdificioEstacionamiento(edificio);

    console.log(`🧹 Conexiones de "${edificio.label}" eliminadas`);
}

// Exponer funciones globalmente
window.configurarEstacionamiento = configurarEstacionamiento;
window.validarConfiguracionEstacionamiento = validarConfiguracionEstacionamiento;
window.procesarEntradaVehiculo = procesarEntradaVehiculo;
window.intentarGenerarSalida = intentarGenerarSalida;
window.obtenerEdificioPorCelda = obtenerEdificioPorCelda;
window.obtenerConexionesSalida = obtenerConexionesSalida;
window.configurarHorasPico = configurarHorasPico;
window.resetearEstacionamiento = resetearEstacionamiento;
window.limpiarConexionesEdificio = limpiarConexionesEdificio;

// Constantes globales
window.CELDA_ENTRADA_ESTACIONAMIENTO = CELDA_ENTRADA_ESTACIONAMIENTO;
window.CELDA_SALIDA_ESTACIONAMIENTO = CELDA_SALIDA_ESTACIONAMIENTO;

console.log('✅ estacionamientos.js cargado');
