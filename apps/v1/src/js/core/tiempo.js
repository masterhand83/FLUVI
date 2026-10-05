// ==================== SISTEMA DE TIEMPO VIRTUAL ====================
// Este módulo implementa un reloj virtual para la simulación de tráfico
// con perfiles dinámicos de probabilidad según día de la semana y hora

// ==================== VARIABLES DE ESTADO DEL TIEMPO ====================

// Constante física: cuánto tiempo simulado avanza por cada paso de simulación
// Basado en que cada celda representa 5 metros y velocidad urbana típica ~35 km/h (9.7 m/s)
// Tiempo para avanzar 5m a 9.7 m/s ≈ 0.5 segundos
// Usamos 2.0 segundos por paso para que el tiempo avance perceptiblemente
const SEGUNDOS_POR_PASO = 2.0;

const configuracionTiempo = {
    activo: true,                    // Si el sistema de tiempo está activo
    diaActual: 1,                    // 0=Domingo, 1=Lunes, ..., 6=Sábado
    horaActual: 7,                   // 0-23
    minutoActual: 0,                 // 0-59
    segundoActual: 0,                // 0-59
    usarPerfiles: true               // Si se aplican los perfiles de tráfico
};

// Cache para el multiplicador actual (optimización)
const multiplicadorCache = {
    valor: 1.0,
    ultimaHora: -1,
    ultimaDia: -1
};

// ==================== PERFILES DE TRÁFICO POR DÍA Y HORA ====================

/**
 * Multiplicadores personalizados por día de la semana y hora
 * Cada día tiene 24 valores (uno por hora) que pueden ser modificados
 * Rango recomendado: 0.0 (sin tráfico) a 3.0 (tráfico muy intenso)
 *
 * CONFIGURACIÓN POR DEFECTO (editable):
 * 0 = Domingo, 1 = Lunes, 2 = Martes, 3 = Miércoles, 4 = Jueves, 5 = Viernes, 6 = Sábado
 */
const MULTIPLICADORES_POR_DIA_HORA = {
    // 0 - Domingo (tráfico bajo)
    0: [
        0.0, 0.0, 0.1, 0.2, 0.2, 0.2,  // 00-05: Madrugada
        0.2, 0.2, 0.3, 0.3, 0.4, 0.6,  // 06-11: Mañana tranquila
        0.6, 0.7, 0.7, 0.7, 0.7, 0.6,  // 12-17: Tarde moderada
        0.6, 0.5, 0.2, 0.1, 0.0, 0.0   // 18-23: Noche calmada
    ],
    // 1 - Lunes (día laboral típico)
    1: [
        0.0, 0.05, 0.08, 0.1, 0.2, 0.1,  // 00-05: Madrugada
        0.4, 1.2, 1.4, 1.0, 0.6, 0.7,  // 06-11: Pico mañana moderado
        0.9, 1.0, 0.9, 0.8, 0.8, 1.1,  // 12-17: Mediodía y tarde
        1.4, 1.3, 1.1, 0.4, 0.2, 0.0   // 18-23: Pico tarde moderado
    ],
    // 2 - Martes (día laboral típico)
    2: [
        0.0, 0.05, 0.08, 0.2, 0.2, 0.2,  // 00-05: Madrugada
        0.4, 1.2, 1.4, 1.0, 0.7, 0.7,  // 06-11: Pico mañana moderado
        0.9, 1.0, 0.9, 0.8, 0.8, 1.1,  // 12-17: Mediodía y tarde
        1.5, 1.3, 1.1, 0.2, 0.1, 0.0   // 18-23: Pico tarde moderado
    ],
    // 3 - Miércoles (día laboral típico, mitad de semana)
    3: [
        0.0, 0.05, 0.08, 0.1, 0.2, 0.1,  // 00-05: Madrugada
        0.4, 1.3, 1.5, 1.0, 0.5, 0.7,  // 06-11: Pico mañana moderado-alto
        0.9, 1.1, 1.0, 0.8, 0.9, 1.2,  // 12-17: Mediodía y tarde
        1.5, 1.4, 1.2, 0.3, 0.2, 0.0   // 18-23: Pico tarde moderado-alto
    ],
    // 4 - Jueves (día laboral típico, casi fin de semana)
    4: [
        0.0, 0.05, 0.08, 0.2, 0.2, 0.2,  // 00-05: Madrugada
        0.4, 1.3, 1.5, 1.0, 0.7, 0.7,  // 06-11: Pico mañana moderado-alto
        0.9, 1.1, 1.0, 0.8, 1.0, 1.3,  // 12-17: Mediodía y tarde aumentando
        1.6, 1.5, 1.0, 0.2, 0.1, 0.0   // 18-23: Pico tarde alto
    ],
    // 5 - Viernes (día laboral, más tráfico en tarde)
    5: [
        0.0, 0.1, 0.1, 0.1, 0.2, 0.3,
        0.5, 1.5, 1.8, 1.3, 0.8, 0.8,
        1.0, 1.2, 1.1, 0.9, 1.7, 2.1,
        3.0, 2.5, 1, 0.5, 0.2, 0.0   // Viernes tarde más tráfico
    ],
    // 6 - Sábado (fin de semana)
    6: [
        0.0, 0.1, 0.2, 0.3, 0.3, 0.3,  // 00-05
        0.3, 0.3, 0.4, 0.5, 0.8, 0.9,  // 06-11: Actividad tarde
        1.0, 1.2, 1.3, 1.3, 1.2, 1.1,  // 12-17: Pico tarde
        1.0, 0.9, 0.5, 0.1, 0.1, 0.0   // 18-23
    ]
};

/**
 * Copia de seguridad de los multiplicadores por defecto
 * Se usa para restaurar valores originales si el usuario lo desea
 */
const MULTIPLICADORES_POR_DIA_HORA_DEFAULT = {
    0: [...MULTIPLICADORES_POR_DIA_HORA[0]],
    1: [...MULTIPLICADORES_POR_DIA_HORA[1]],
    2: [...MULTIPLICADORES_POR_DIA_HORA[2]],
    3: [...MULTIPLICADORES_POR_DIA_HORA[3]],
    4: [...MULTIPLICADORES_POR_DIA_HORA[4]],
    5: [...MULTIPLICADORES_POR_DIA_HORA[5]],
    6: [...MULTIPLICADORES_POR_DIA_HORA[6]]
};

/**
 * Perfiles de tráfico para cada día de la semana
 * Cada perfil contiene 24 valores (uno por hora) con el multiplicador de probabilidad
 * Los valores representan cuánto se multiplica la probabilidad de generación base
 * NOTA: Estos perfiles ya no se usan cuando hay multiplicadores personalizados activos
 */
const PERFILES_TRAFICO = {
    // Lunes a Viernes: Días laborales
    1: [ // Lunes
        0.2, 0.2, 0.2, 0.2, 0.2, 0.2,  // 00-05: Madrugada
        0.3, 1.5, 1.5, 0.8, 0.8, 0.8,  // 06-11: Pico mañana (07-09)
        1.0, 1.0, 0.9, 0.7, 0.7, 0.7,  // 12-17: Mediodía y tarde
        1.6, 1.6, 1.3, 0.5, 0.4, 0.3   // 18-23: Pico tarde (18-20)
    ],
    2: [ // Martes
        0.2, 0.2, 0.2, 0.2, 0.2, 0.2,
        0.3, 1.5, 1.5, 0.8, 0.8, 0.8,
        1.0, 1.0, 0.9, 0.7, 0.7, 0.7,
        1.6, 1.6, 1.3, 0.5, 0.4, 0.3
    ],
    3: [ // Miércoles
        0.2, 0.2, 0.2, 0.2, 0.2, 0.2,
        0.3, 1.5, 1.5, 0.8, 0.8, 0.8,
        1.0, 1.0, 0.9, 0.7, 0.7, 0.7,
        1.6, 1.6, 1.3, 0.5, 0.4, 0.3
    ],
    4: [ // Jueves
        0.2, 0.2, 0.2, 0.2, 0.2, 0.2,
        0.3, 1.5, 1.5, 0.8, 0.8, 0.8,
        1.0, 1.0, 0.9, 0.7, 0.7, 0.7,
        1.6, 1.6, 1.3, 0.5, 0.4, 0.3
    ],
    5: [ // Viernes
        0.2, 0.2, 0.2, 0.2, 0.2, 0.2,
        0.3, 1.5, 1.5, 0.8, 0.8, 0.8,
        1.0, 1.0, 0.9, 0.7, 0.7, 0.7,
        1.7, 1.7, 1.4, 0.7, 0.5, 0.4   // Viernes tarde más tráfico
    ],
    6: [ // Sábado
        0.3, 0.3, 0.3, 0.3, 0.3, 0.3,  // 00-05
        0.3, 0.3, 0.4, 0.5, 0.8, 0.8,  // 06-11: Más actividad tarde
        0.8, 0.9, 0.9, 1.1, 1.1, 1.1,  // 12-17: Pico tarde sábado
        1.1, 1.0, 0.8, 0.6, 0.5, 0.4   // 18-23
    ],
    0: [ // Domingo
        0.2, 0.2, 0.2, 0.2, 0.2, 0.2,  // 00-05
        0.2, 0.2, 0.3, 0.3, 0.4, 0.6,  // 06-11: Tranquilo
        0.6, 0.7, 0.7, 0.7, 0.7, 0.6,  // 12-17: Actividad moderada
        0.6, 0.5, 0.4, 0.3, 0.3, 0.2   // 18-23: Calmado
    ]
};

// Nombres de los días para display
const NOMBRES_DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// ==================== FUNCIONES DE TIEMPO ====================

/**
 * Avanza el tiempo virtual un paso constante
 * Cada llamada avanza SEGUNDOS_POR_PASO segundos simulados
 * El slider de velocidad solo afecta qué tan rápido se ejecutan los pasos, no el tiempo que representan
 * Debe llamarse en cada paso de simulación
 */
function avanzarTiempo() {
    if (!configuracionTiempo.activo) return;
    if (window.isPaused) return; // Solo avanzar si la simulación está corriendo

    // Avanzar tiempo de forma constante: cada paso = SEGUNDOS_POR_PASO segundos simulados
    configuracionTiempo.segundoActual += SEGUNDOS_POR_PASO;

    // Normalizar segundos -> minutos
    if (configuracionTiempo.segundoActual >= 60) {
        const minutosExtras = Math.floor(configuracionTiempo.segundoActual / 60);
        configuracionTiempo.segundoActual = configuracionTiempo.segundoActual % 60;
        configuracionTiempo.minutoActual += minutosExtras;
    }

    // Normalizar minutos -> horas
    if (configuracionTiempo.minutoActual >= 60) {
        const horasExtras = Math.floor(configuracionTiempo.minutoActual / 60);
        configuracionTiempo.minutoActual = configuracionTiempo.minutoActual % 60;
        configuracionTiempo.horaActual += horasExtras;
    }

    // Normalizar horas -> días
    if (configuracionTiempo.horaActual >= 24) {
        const diasExtras = Math.floor(configuracionTiempo.horaActual / 24);
        configuracionTiempo.horaActual = configuracionTiempo.horaActual % 24;
        configuracionTiempo.diaActual = (configuracionTiempo.diaActual + diasExtras) % 7;

        // Invalidar cache al cambiar de día
        multiplicadorCache.ultimaDia = -1;
    }
}

/**
 * Obtiene el multiplicador de tráfico actual según día y hora
 * Cada hora tiene su valor constante (SIN interpolación)
 * El slider de cada hora controla exclusivamente su rango (ej: 08:00-08:59)
 * AHORA usa MULTIPLICADORES_POR_DIA_HORA (configurables por día y hora)
 * @returns {number} Multiplicador de probabilidad (0.0 - 3.0)
 */
function obtenerMultiplicadorTrafico() {
    if (!configuracionTiempo.usarPerfiles) return 1.0;

    const dia = configuracionTiempo.diaActual;
    const hora = Math.floor(configuracionTiempo.horaActual);

    // Usar cache si el día y la hora no han cambiado (optimización)
    if (multiplicadorCache.ultimaDia === dia && multiplicadorCache.ultimaHora === hora) {
        return multiplicadorCache.valor;
    }

    // Obtener el perfil del día actual
    const perfilDia = MULTIPLICADORES_POR_DIA_HORA[dia];
    if (!perfilDia) {
        console.warn(`⚠️ No se encontró perfil para día ${dia}, usando 1.0`);
        return 1.0;
    }

    // Usar el multiplicador de la hora actual (SIN interpolación)
    // Cada hora mantiene su valor constante durante todo su rango (00-59 minutos)
    const multiplicador = perfilDia[hora];

    // Actualizar cache
    multiplicadorCache.valor = multiplicador;
    multiplicadorCache.ultimaHora = hora;
    multiplicadorCache.ultimaDia = dia;

    return multiplicador;
}

/**
 * Obtiene el nombre del día actual
 * @returns {string} Nombre del día en español
 */
function obtenerDiaString() {
    return NOMBRES_DIAS[configuracionTiempo.diaActual];
}

/**
 * Obtiene timestamp virtual completo para display
 * @returns {string} Formato: "Lunes 14:35:42"
 */
function obtenerTimestampVirtual() {
    const dia = obtenerDiaString();
    const horas = Math.floor(configuracionTiempo.horaActual).toString().padStart(2, '0');
    const minutos = Math.floor(configuracionTiempo.minutoActual).toString().padStart(2, '0');
    const segundos = Math.floor(configuracionTiempo.segundoActual).toString().padStart(2, '0');

    return `${dia} ${horas}:${minutos}:${segundos}`;
}

/**
 * Obtiene timestamp virtual corto para gráficas
 * @returns {string} Formato: "14:35:42"
 */
function obtenerTimestampCorto() {
    const horas = Math.floor(configuracionTiempo.horaActual).toString().padStart(2, '0');
    const minutos = Math.floor(configuracionTiempo.minutoActual).toString().padStart(2, '0');
    const segundos = Math.floor(configuracionTiempo.segundoActual).toString().padStart(2, '0');

    return `${horas}:${minutos}:${segundos}`;
}

/**
 * Obtiene timestamp completo con día para exportación
 * @returns {string} Formato: "Lunes 14:35:42"
 */
function obtenerTimestampExportacion() {
    return obtenerTimestampVirtual();
}

/**
 * Obtiene el tiempo virtual en milisegundos (para cálculos de diferencias)
 * @returns {number} Milisegundos virtuales desde domingo 00:00:00
 */
function obtenerMillisVirtuales() {
    const dias = configuracionTiempo.diaActual;
    const horas = configuracionTiempo.horaActual;
    const minutos = configuracionTiempo.minutoActual;
    const segundos = configuracionTiempo.segundoActual;

    return ((dias * 24 + horas) * 60 + minutos) * 60 * 1000 + segundos * 1000;
}

/**
 * Obtiene información sobre el próximo cambio significativo de tráfico
 * @returns {Object} {horaProxima, multiplicadorProximo, minutosRestantes, descripcion}
 */
function obtenerProximoCambio() {
    if (!configuracionTiempo.usarPerfiles) return null;

    const dia = configuracionTiempo.diaActual;
    const horaActual = Math.floor(configuracionTiempo.horaActual);
    const perfil = MULTIPLICADORES_POR_DIA_HORA[dia];

    if (!perfil) return null;

    const multActual = perfil[horaActual];

    // Buscar la siguiente hora con un cambio significativo (>0.3 diferencia)
    for (let i = 1; i <= 24; i++) {
        const horaBusqueda = (horaActual + i) % 24;
        const multBusqueda = perfil[horaBusqueda];

        if (Math.abs(multBusqueda - multActual) > 0.3) {
            const minutosRestantesHora = 60 - configuracionTiempo.minutoActual;
            const minutosRestantesTotal = minutosRestantesHora + (i - 1) * 60;

            let descripcion = '';
            if (multBusqueda > 1.3) {
                descripcion = 'Hora pico';
            } else if (multBusqueda < 0.5) {
                descripcion = 'Tráfico bajo';
            } else {
                descripcion = 'Tráfico moderado';
            }

            return {
                horaProxima: horaBusqueda,
                multiplicadorProximo: multBusqueda,
                minutosRestantes: Math.floor(minutosRestantesTotal),
                descripcion: descripcion
            };
        }
    }

    return null;
}

/**
 * Obtiene descripción del estado de tráfico actual
 * @returns {string} Descripción del multiplicador actual
 */
function obtenerDescripcionTrafico() {
    const mult = obtenerMultiplicadorTrafico();

    if (mult >= 1.5) return 'Hora pico';
    if (mult >= 1.2) return 'Tráfico alto';
    if (mult >= 0.8) return 'Tráfico moderado';
    if (mult >= 0.5) return 'Tráfico bajo';
    return 'Tráfico muy bajo';
}

/**
 * Reinicia el tiempo virtual a Lunes 00:00:00
 */
function reiniciarTiempo() {
    configuracionTiempo.diaActual = 1; // Lunes
    configuracionTiempo.horaActual = 7; // 7 AM (hora pico mañana)
    configuracionTiempo.minutoActual = 0;
    configuracionTiempo.segundoActual = 0;
    configuracionTiempo.ultimoTickReal = null;

    // Invalidar cache
    multiplicadorCache.ultimaDia = -1;
    multiplicadorCache.ultimaHora = -1;

    console.log('⏰ Tiempo virtual reiniciado a Lunes 07:00:00');
}

/**
 * Activa o desactiva el uso de perfiles de tráfico
 * @param {boolean} usar
 */
function togglePerfiles(usar) {
    configuracionTiempo.usarPerfiles = usar;
    multiplicadorCache.ultimaDia = -1; // Invalidar cache
    sincronizarPerfilesUI();
    console.log(`⏰ Perfiles de tráfico: ${usar ? 'ACTIVADOS' : 'DESACTIVADOS'}`);
/* 
    // Controlar el estado del slider de generación
    const probabilidadSlider = document.getElementById('probabilidadSlider');
    const probabilidadValor = document.getElementById('probabilidadValor');

    if (probabilidadSlider && probabilidadValor) {
        if (usar) {
            // Perfiles ACTIVADOS -> Deshabilitar slider
            probabilidadSlider.disabled = true;
            probabilidadValor.classList.remove('bg-primary');
            probabilidadValor.classList.add('bg-secondary');
            console.log('🔒 Slider de generación deshabilitado (usando perfiles dinámicos)');
        } else {
            // Perfiles DESACTIVADOS -> Habilitar slider
            probabilidadSlider.disabled = false;
            probabilidadValor.classList.remove('bg-secondary');
            probabilidadValor.classList.add('bg-primary');

            // Aplicar la probabilidad global a todos los generadores
            if (window.calles && window.probabilidadGeneracionGeneral !== undefined) {
                window.calles.forEach(calle => {
                    if (calle.tipo === 'generador') {
                        calle.probabilidadGeneracion = window.probabilidadGeneracionGeneral;
                    }
                });
                console.log(`✅ Probabilidad global aplicada: ${(window.probabilidadGeneracionGeneral * 100).toFixed(0)}%`);
            }
            console.log('🔓 Slider de generación habilitado (control manual)');
        }
    } */
}

// Refresh controls without advancing the clock or counting a simulation step.
function sincronizarPerfilesUI() {
    const toggle = document.getElementById('togglePerfilesDinamicos');
    if (toggle) toggle.checked = configuracionTiempo.usarPerfiles;
    const multiplier = document.getElementById('infoTrafficMultiplier');
    if (multiplier) multiplier.textContent = obtenerMultiplicadorTrafico().toFixed(1) + '×';
}

/**
 * Obtiene el perfil del día actual como array
 * @returns {Array<number>} Array de 24 multiplicadores
 */
function obtenerPerfilDiaActual() {
    const dia = configuracionTiempo.diaActual;
    return [...(MULTIPLICADORES_POR_DIA_HORA[dia] || Array(24).fill(1.0))];
}

/**
 * Obtiene el perfil de un día específico
 * @param {number} dia - Día de la semana (0-6)
 * @returns {Array<number>} Array de 24 multiplicadores
 */
function obtenerPerfilDia(dia) {
    if (dia < 0 || dia > 6) {
        console.error('❌ Error: Día debe estar entre 0 y 6');
        return Array(24).fill(1.0);
    }
    return [...(MULTIPLICADORES_POR_DIA_HORA[dia] || Array(24).fill(1.0))];
}

/**
 * Actualiza los multiplicadores por hora para un día específico
 * @param {number} dia - Día de la semana (0-6)
 * @param {Array<number>} nuevosMultiplicadores - Array de 24 valores (0.0 - 3.0)
 */
function actualizarMultiplicadoresDia(dia, nuevosMultiplicadores) {
    if (dia < 0 || dia > 6) {
        console.error('❌ Error: Día debe estar entre 0 y 6');
        return false;
    }

    if (!Array.isArray(nuevosMultiplicadores) || nuevosMultiplicadores.length !== 24) {
        console.error('❌ Error: Se requiere un array de 24 valores');
        return false;
    }

    // Validar que todos los valores estén en el rango permitido
    for (let i = 0; i < 24; i++) {
        const valor = parseFloat(nuevosMultiplicadores[i]);
        if (isNaN(valor) || valor < 0 || valor > 3) {
            console.error(`❌ Error: Valor inválido en hora ${i}: ${nuevosMultiplicadores[i]}`);
            return false;
        }
    }

    // Actualizar el perfil del día
    MULTIPLICADORES_POR_DIA_HORA[dia] = nuevosMultiplicadores;

    // Invalidar cache para forzar recalculo
    multiplicadorCache.ultimaHora = -1;
    multiplicadorCache.ultimaDia = -1;

    console.log(`✅ Multiplicadores para ${NOMBRES_DIAS[dia]} actualizados correctamente`);
    return true;
}

/**
 * Actualiza los multiplicadores de TODOS los días con los mismos valores
 * @param {Array<number>} nuevosMultiplicadores - Array de 24 valores (0.0 - 3.0)
 */
function actualizarMultiplicadoresTodosDias(nuevosMultiplicadores) {
    if (!Array.isArray(nuevosMultiplicadores) || nuevosMultiplicadores.length !== 24) {
        console.error('❌ Error: Se requiere un array de 24 valores');
        return false;
    }

    for (let dia = 0; dia <= 6; dia++) {
        if (!actualizarMultiplicadoresDia(dia, [...nuevosMultiplicadores])) {
            return false;
        }
    }

    console.log('✅ Multiplicadores actualizados para todos los días');
    return true;
}

/**
 * Obtiene los multiplicadores actuales por hora (del día actual)
 * @returns {Array<number>} Array de 24 multiplicadores
 */
function obtenerMultiplicadoresPorHora() {
    return obtenerPerfilDiaActual();
}

/**
 * Restaura los multiplicadores por hora a los valores por defecto
 * @param {number|null} dia - Día específico a restaurar, o null para todos
 */
function restaurarMultiplicadoresDefault(dia = null) {
    if (dia !== null) {
        // Restaurar solo un día específico
        if (dia >= 0 && dia <= 6) {
            MULTIPLICADORES_POR_DIA_HORA[dia] = [...MULTIPLICADORES_POR_DIA_HORA_DEFAULT[dia]];
            console.log(`✅ Multiplicadores de ${NOMBRES_DIAS[dia]} restaurados a valores por defecto`);
        }
    } else {
        // Restaurar todos los días
        for (let d = 0; d <= 6; d++) {
            MULTIPLICADORES_POR_DIA_HORA[d] = [...MULTIPLICADORES_POR_DIA_HORA_DEFAULT[d]];
        }
        console.log('✅ Multiplicadores de todos los días restaurados a valores por defecto');
    }

    multiplicadorCache.ultimaHora = -1;
    multiplicadorCache.ultimaDia = -1;
}

/**
 * Obtiene todos los multiplicadores (7 días x 24 horas)
 * @returns {Object} Objeto con los multiplicadores de cada día
 */
function obtenerTodosMultiplicadores() {
    return {
        0: [...MULTIPLICADORES_POR_DIA_HORA[0]],
        1: [...MULTIPLICADORES_POR_DIA_HORA[1]],
        2: [...MULTIPLICADORES_POR_DIA_HORA[2]],
        3: [...MULTIPLICADORES_POR_DIA_HORA[3]],
        4: [...MULTIPLICADORES_POR_DIA_HORA[4]],
        5: [...MULTIPLICADORES_POR_DIA_HORA[5]],
        6: [...MULTIPLICADORES_POR_DIA_HORA[6]]
    };
}

// ==================== SERIALIZACIÓN JSON ====================

/**
 * Serializa la configuración de tiempo a JSON
 * @returns {Object} Objeto con la configuración
 */
function tiempoToJSON() {
    return {
        activo: configuracionTiempo.activo,
        diaActual: configuracionTiempo.diaActual,
        horaActual: Math.floor(configuracionTiempo.horaActual),
        minutoActual: Math.floor(configuracionTiempo.minutoActual),
        segundoActual: Math.floor(configuracionTiempo.segundoActual),
        usarPerfiles: configuracionTiempo.usarPerfiles,
        segundosPorPaso: SEGUNDOS_POR_PASO, // Guardar la constante para referencia
        multiplicadoresPorDiaHora: obtenerTodosMultiplicadores() // Guardar multiplicadores de todos los días
    };
}

/**
 * Carga la configuración de tiempo desde JSON
 * @param {Object} data - Objeto con la configuración
 */
function tiempoFromJSON(data) {
    if (!data) {
        console.warn('⏰ No se encontró configuración de tiempo, usando valores por defecto');
        return;
    }

    configuracionTiempo.activo = data.activo !== undefined ? data.activo : true;
    configuracionTiempo.diaActual = data.diaActual ?? 1;
    configuracionTiempo.horaActual = data.horaActual ?? 7;
    configuracionTiempo.minutoActual = data.minutoActual ?? 0;
    configuracionTiempo.segundoActual = data.segundoActual ?? 0;
    // Older maps do not declare a profile preference; preserve the current switch.
    configuracionTiempo.usarPerfiles = data.usarPerfiles ?? configuracionTiempo.usarPerfiles;

    // Cargar multiplicadores personalizados por día y hora si existen
    if (data.multiplicadoresPorDiaHora && typeof data.multiplicadoresPorDiaHora === 'object') {
        for (let dia = 0; dia <= 6; dia++) {
            if (Array.isArray(data.multiplicadoresPorDiaHora[dia]) && data.multiplicadoresPorDiaHora[dia].length === 24) {
                actualizarMultiplicadoresDia(dia, data.multiplicadoresPorDiaHora[dia]);
            }
        }
        console.log('⏰ Multiplicadores personalizados por día cargados');
    }
    // Compatibilidad con versión anterior (un solo array de 24 horas)
    else if (data.multiplicadoresPorHora && Array.isArray(data.multiplicadoresPorHora) && data.multiplicadoresPorHora.length === 24) {
        // Aplicar a todos los días
        actualizarMultiplicadoresTodosDias(data.multiplicadoresPorHora);
        console.log('⏰ Multiplicadores personalizados cargados (aplicados a todos los días)');
    }

    // Invalidar cache
    multiplicadorCache.ultimaDia = -1;
    multiplicadorCache.ultimaHora = -1;

    sincronizarPerfilesUI();

    console.log(`⏰ Configuración de tiempo cargada: ${obtenerTimestampVirtual()}`);
    console.log(`⏰ Cada paso de simulación = ${SEGUNDOS_POR_PASO} segundo(s) simulado(s)`);
}

// ==================== EXPONER AL SCOPE GLOBAL ====================

window.configuracionTiempo = configuracionTiempo;
window.multiplicadorCache = multiplicadorCache;
window.avanzarTiempo = avanzarTiempo;
window.obtenerMultiplicadorTrafico = obtenerMultiplicadorTrafico;
window.obtenerDiaString = obtenerDiaString;
window.obtenerTimestampVirtual = obtenerTimestampVirtual;
window.obtenerTimestampCorto = obtenerTimestampCorto;
window.obtenerTimestampExportacion = obtenerTimestampExportacion;
window.obtenerMillisVirtuales = obtenerMillisVirtuales;
window.obtenerProximoCambio = obtenerProximoCambio;
window.obtenerDescripcionTrafico = obtenerDescripcionTrafico;
window.reiniciarTiempo = reiniciarTiempo;
window.togglePerfiles = togglePerfiles;
window.obtenerPerfilDiaActual = obtenerPerfilDiaActual;
window.tiempoToJSON = tiempoToJSON;
window.tiempoFromJSON = tiempoFromJSON;
window.SEGUNDOS_POR_PASO = SEGUNDOS_POR_PASO;
window.NOMBRES_DIAS = NOMBRES_DIAS;
// Nuevas funciones para configurar multiplicadores por día
window.obtenerPerfilDia = obtenerPerfilDia;
window.actualizarMultiplicadoresDia = actualizarMultiplicadoresDia;
window.actualizarMultiplicadoresTodosDias = actualizarMultiplicadoresTodosDias;
window.obtenerMultiplicadoresPorHora = obtenerMultiplicadoresPorHora;
window.restaurarMultiplicadoresDefault = restaurarMultiplicadoresDefault;
window.obtenerTodosMultiplicadores = obtenerTodosMultiplicadores;

console.log('✅ Módulo de tiempo virtual cargado correctamente');
console.log(`⏰ Configuración: ${SEGUNDOS_POR_PASO} segundo(s) simulado(s) por paso`);
