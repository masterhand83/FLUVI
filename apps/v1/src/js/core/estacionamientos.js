/**
 * estacionamientos.js - Sistema de gestión de edificios como estacionamientos
 * Maneja la absorción y liberación de vehículos mediante conexiones de entrada/salida
 */

console.log('🏢 estacionamientos.js cargando...');

// Valores especiales para el arreglo de calles
const CELDA_ENTRADA_ESTACIONAMIENTO = 8;  // Marca celdas de entrada
const CELDA_SALIDA_ESTACIONAMIENTO = 9;   // Marca celdas de salida

/**
 * Convierte un edificio en estacionamiento y configura sus conexiones
 * @param {Object} edificio - El edificio a convertir
 * @param {Array} conexiones - Array de conexiones {tipo, calleId, carril, indice}
 * @param {number} capacidad - Capacidad máxima de vehículos
 */
function configurarEstacionamiento(edificio, conexiones = [], capacidad = 50) {
    if (!edificio) {
        console.error('❌ Edificio no válido');
        return false;
    }

    // Validar que las conexiones vengan en pares
    const entradas = conexiones.filter(c => c.tipo === 'entrada');
    const salidas = conexiones.filter(c => c.tipo === 'salida');

    if (entradas.length !== salidas.length) {
        console.error(`❌ Las conexiones deben venir en pares: ${entradas.length} entradas vs ${salidas.length} salidas`);
        return false;
    }

    if (entradas.length === 0) {
        console.warn('⚠️ Edificio sin conexiones - será decorativo');
        edificio.esEstacionamiento = false;
        edificio.conexiones = [];
        return true;
    }

    if (entradas.length > 10) {
        console.error('❌ Máximo 10 pares de conexiones permitidos');
        return false;
    }

    // Configurar edificio como estacionamiento
    edificio.esEstacionamiento = true;
    edificio.capacidadMaxima = capacidad;

    // Solo inicializar vehiculosActuales si no existe
    if (edificio.vehiculosActuales === undefined) {
        edificio.vehiculosActuales = 0;
    }

    edificio.conexiones = conexiones;

    // Inicializar probabilidades por defecto SOLO si no existen
    // (para no sobrescribir valores configurados por el usuario)
    if (!edificio.probabilidadesEntrada || edificio.probabilidadesEntrada.length !== 24) {
        edificio.probabilidadesEntrada = new Array(24).fill(0.3); // 30% por defecto
    }

    if (!edificio.probabilidadesSalida || edificio.probabilidadesSalida.length !== 24) {
        edificio.probabilidadesSalida = new Array(24).fill(0.2);  // 20% por defecto
    }

    // Marcar las celdas en las calles
    conexiones.forEach(conexion => {
        const calle = window.calles.find(c => c.id === conexion.calleId || c.nombre === conexion.calleId);
        if (!calle) {
            console.error(`❌ Calle "${conexion.calleId}" no encontrada`);
            return;
        }

        const { carril, indice } = conexion;

        // Debugging: mostrar información de la calle
        console.log(`🔍 Verificando celda en calle "${calle.nombre}":`, {
            carril: carril,
            indice: indice,
            totalCarriles: calle.carriles,
            tamanoCalle: calle.tamano,
            tieneArreglo: !!calle.arreglo,
            existeCarril: !!calle.arreglo[carril],
            longitudCarril: calle.arreglo[carril]?.length
        });

        if (!calle.arreglo[carril] || calle.arreglo[carril][indice] === undefined) {
            console.error(`❌ Celda inválida: ${conexion.calleId}[${carril}][${indice}]`);
            console.error(`   Calle tiene ${calle.carriles} carriles (0-${calle.carriles-1}) y tamaño ${calle.tamano} (0-${calle.tamano-1})`);
            return;
        }

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

    console.log(`🏢 Estacionamiento "${edificio.label}" configurado: ${entradas.length} pares, capacidad ${capacidad}`);
    return true;
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
    if (!edificio || !edificio.conexiones) return;

    edificio.conexiones.forEach(conexion => {
        const calle = window.calles.find(c => c.id === conexion.calleId || c.nombre === conexion.calleId);
        if (calle && calle.conexionesEstacionamiento) {
            // Eliminar del mapa de conexiones
            const claveConexion = `${conexion.carril}-${conexion.indice}`;
            calle.conexionesEstacionamiento.delete(claveConexion);
        }
    });

    edificio.conexiones = [];
    edificio.esEstacionamiento = false;

    console.log(`🧹 Conexiones de "${edificio.label}" eliminadas`);
}

// Exponer funciones globalmente
window.configurarEstacionamiento = configurarEstacionamiento;
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
