// ==================== SISTEMA DE MÉTRICAS Y GRÁFICAS ====================
// Este módulo contiene toda la funcionalidad relacionada con el cálculo,
// almacenamiento, visualización y exportación de métricas de tráfico

// ==================== VARIABLES GLOBALES ====================

// Historial de métricas con límite de 50 puntos de datos (solo para gráficas)
const metricsHistory = {
    timestamps: [],
    density: [],
    netGeneration: [], // Tasa de cambio de población (antes "flow")
    throughput: [], // Flujo vehicular real (Q = k × v)
    speed: [],
    entropy: [], // Entropía de Shannon del autómata celular
    maxDataPoints: 50
};

// Historial COMPLETO de métricas sin límite (para exportación CSV)
const completeMetricsHistory = {
    timestamps: [],
    density: [],
    netGeneration: [],
    throughput: [],
    speed: [],
    entropy: []
};

// Variables auxiliares para el cálculo de flujo vehicular
let previousCarCount = 0;
const flowMeasureInterval = 1000;
let lastFlowMeasure = null; // Inicializar como null, se establecerá en primera medición
let lastFlowValue = 0; // Almacena el último flujo calculado para evitar parpadeos

// Estado anterior de las calles para calcular transiciones del autómata celular
let previousStreetStates = new Map();

// Configuración de calles incluidas en las métricas
// Por defecto, todas las calles están incluidas (null = incluir todas)
// Si es un Set, solo se incluyen las calles cuyos índices estén en el Set
let callesIncluidasEnMetricas = null; // null = todas incluidas

// Lista de calles excluidas por defecto de las métricas
const CALLES_EXCLUIDAS_POR_DEFECTO = [
    'Retorno Wilfrido. ←',
    'Retorno Escalera ←',
    'Retorno Escalera →',
    'Retorno Wilfrido1 ←',
    'Retorno Wilfrido2 →',
    'Retorno Wilfrido3 →',
    'Retorno Wilfrido4 ←',
    'Retorno Wilfrido5 ←',
    'Retorno Wilfrido6 →',
    'Retorno Wilfrido7 ←',
    'Retorno Wilfrido8 →',
    'Retorno Wilfrido9 ←',
    'Retorno Wilfrido10 ←',
    'Retorno Wilfrido11 →',
    'Entrada a Cien Metros →',
    'Entrada a Av. IPN ←',
    'Salida Av. IPN ←',
    'Entrada ←',
    'Salida 1 →',
    'Salida 2 →',
    'Av. Wilfrido Massieu ←',
    'Av. IPN ←',
    'Av. Miguel Bernard →',
    'Av. Wilfrido Massieu →',
    'Av. Cien Metros ←',
    'Av. Miguel Othon de Mendizabal →',
    'Salida Cien Metros ←',
    'Calle M. Luisa Estampa Ort. →', //nuevas
    'Calle M. Luisa Estampa Ort. ←',
    'Salida Juan de Dios Batiz ←',
    'Salida Juan de Dios Batiz →',
    'Retorno torres →',
    'Retorno torres ←',
    'Retorno ESCOM →',
    'Retorno ESCOM ←',
    'Retorno Estampa →',
    'Retorno Estampa ←',
    'Salida de Juan de Dios Batiz ←',
    'Salida de Juan de Dios Batiz →',
    'Retorno Bernard →',
    'Retorno Bernard ←',
    'Entrada a Av. Juan de Dios Batiz ←',
    'Entrada Juan de Dios Batiz →'

    

];

// Modo de selección de calles desde el mapa
let modoSeleccionCallesActivo = false;

// Instancias de Chart.js para cada gráfica
let densityChartInstance = null;
let throughputChartInstance = null;
let netGenerationChartInstance = null;
let speedChartInstance = null;
let entropyChartInstance = null;

// ⚡ OPTIMIZACIÓN: Throttling adaptativo de métricas según dispositivo
const METRICS_UPDATE_INTERVAL = (window.pixiApp && window.pixiApp.isMobile) ? 15 : 10; // Móvil: cada 15 frames, Desktop: cada 10 frames
const ENTROPY_UPDATE_INTERVAL = 60; // Calcular entropía cada 60 frames (~1 vez/seg) - es muy costosa
let metricsUpdateCounter = 0;
let lastEntropyValue = 0; // Cachear último valor de entropía

console.log(`⚡ Métricas actualizándose cada ${METRICS_UPDATE_INTERVAL} frames (${(60/METRICS_UPDATE_INTERVAL).toFixed(1)} veces/seg @ 60 FPS)`);
console.log(`⚡ Entropía actualizándose cada ${ENTROPY_UPDATE_INTERVAL} frames (${(60/ENTROPY_UPDATE_INTERVAL).toFixed(1)} veces/seg @ 60 FPS) - optimización de CPU`);

// ==================== FUNCIONES DE INTERPRETACIÓN DE MÉTRICAS ====================

/**
 * Interpreta las métricas actuales y devuelve el estado del tráfico
 * @param {Object} metrics - Métricas calculadas (density, flow, speed)
 * @returns {Object} Estado interpretado con nivel, emoji, título, descripción y recomendaciones
 */
function interpretarMetricas(metrics) {
    const density = parseFloat(metrics.density);
    const throughput = parseFloat(metrics.throughput);
    const speed = parseFloat(metrics.speed);
    const netGeneration = parseFloat(metrics.netGeneration);

    // Determinar el estado del tráfico
    const estado = {
        nivel: '',
        emoji: '',
        color: '',
        titulo: '',
        descripcion: '',
        observaciones: [],
        clase: ''
    };

    // Análisis del estado del tráfico basado en la ecuación fundamental Q=k×v
    // Prioridad: 1) Colapso, 2) Óptimo (por throughput), 3) Congestionado, 4) Sub-utilizado, 5) Moderado

    if (density > 80 && speed < 15) {
        // COLAPSO CRÍTICO - Gridlock: alta densidad pero sin movimiento
        estado.nivel = 'COLAPSO';
        estado.emoji = '🔴';
        estado.color = '#dc3545';
        estado.titulo = 'COLAPSO DE TRÁFICO';
        estado.descripcion = 'Las calles están severamente congestionadas y casi paralizadas';
        estado.clase = 'status-critico';
        estado.observaciones = [
            'Densidad crítica detectada (>80%)',
            'Velocidad extremadamente baja (<15%)',
            `Flujo vehicular: ${throughput.toFixed(1)} veh/s - Casi nulo`,
            `Tasa cambio: ${netGeneration.toFixed(1)} veh/s - ${getNetGenerationLabel(netGeneration)}`,
            'Se requiere intervención: reducir generación o mejorar salidas'
        ];
    } else if (density >= 25 && density <= 60 && speed >= 50) {
        // ÓPTIMO - Basado en THROUGHPUT alto con condiciones balanceadas
        // Zona de máxima eficiencia según ecuación fundamental
        estado.nivel = 'ÓPTIMO';
        estado.emoji = '🟢';
        estado.color = '#198754';
        estado.titulo = 'FLUJO ÓPTIMO';
        estado.descripcion = 'Máxima eficiencia del sistema: buen balance entre densidad y velocidad';
        estado.clase = 'status-optimo';
        estado.observaciones = [
            `Densidad en zona óptima (${density.toFixed(0)}%)`,
            `Velocidad fluida (${speed.toFixed(0)}%)`,
            `Flujo vehicular alto: ${throughput.toFixed(1)} veh/s`,
            `Tasa cambio: ${netGeneration.toFixed(1)} veh/s - ${getNetGenerationLabel(netGeneration)}`,
            'Sistema funcionando al máximo rendimiento'
        ];
    } else if (density > 60 && speed < 35) {
        // CONGESTIONADO - Alta densidad con velocidad reducida
        estado.nivel = 'CONGESTIONADO';
        estado.emoji = '🟠';
        estado.color = '#fd7e14';
        estado.titulo = 'TRÁFICO CONGESTIONADO';
        estado.descripcion = 'Alta densidad vehicular con movimiento lento';
        estado.clase = 'status-alto';
        estado.observaciones = [
            `Densidad alta (${density.toFixed(0)}%)`,
            `Velocidad reducida (${speed.toFixed(0)}%)`,
            `Flujo vehicular: ${throughput.toFixed(1)} veh/s - ${getThroughputLabel(throughput)}`,
            netGeneration > 2 ? `⚠ Población creciendo (${netGeneration.toFixed(1)} veh/s)` : 'Población estable',
            'Riesgo de colapso si aumenta densidad'
        ];
    } else if (density < 25) {
        // SUB-UTILIZADO - Baja densidad Y bajo flujo
        estado.nivel = 'SUB-UTILIZADO';
        estado.emoji = '🔵';
        estado.color = '#0d6efd';
        estado.titulo = 'SISTEMA SUB-UTILIZADO';
        estado.descripcion = 'Baja ocupación de las calles, capacidad disponible';
        estado.clase = 'status-bajo';
        estado.observaciones = [
            `Densidad muy baja (${density.toFixed(0)}%)`,
            `Flujo vehicular bajo: ${throughput.toFixed(1)} veh/s`,
            `Velocidad: ${speed.toFixed(0)}% - ${getSpeedLabel(speed)}`,
            netGeneration > 1 ? `Creciendo lentamente (${netGeneration.toFixed(1)} veh/s)` : 'Población estable',
            'Considerar aumentar generación para aprovechar capacidad'
        ];
    } else {
        // MODERADO - Condiciones aceptables pero no óptimas
        estado.nivel = 'MODERADO';
        estado.emoji = '🟡';
        estado.color = '#ffc107';
        estado.titulo = 'FLUJO MODERADO';
        estado.descripcion = 'Condiciones de tráfico aceptables con margen de mejora';
        estado.clase = 'status-moderado';
        estado.observaciones = [
            `Densidad: ${density.toFixed(0)}% - ${getDensityLabel(density)}`,
            `Velocidad: ${speed.toFixed(0)}% - ${getSpeedLabel(speed)}`,
            `Flujo vehicular: ${throughput.toFixed(1)} veh/s - ${getThroughputLabel(throughput)}`,
            `Tasa cambio: ${netGeneration.toFixed(1)} veh/s - ${getNetGenerationLabel(netGeneration)}`,
            throughput < 2.5 ? 'Puede optimizarse para aumentar flujo' : 'Sistema funcionando normalmente'
        ];
    }

    return estado;
}

/**
 * Actualiza el panel de interpretación en la interfaz
 * @param {Object} estado - Estado interpretado del tráfico
 * @param {Object} metrics - Métricas actuales
 */
function actualizarPanelInterpretacion(estado, metrics) {
    const panel = document.getElementById('statusPanel');
    if (!panel) return;

    const density = parseFloat(metrics.density);
    const throughput = parseFloat(metrics.throughput);
    const netGeneration = parseFloat(metrics.netGeneration);
    const speed = parseFloat(metrics.speed);

    // Actualizar clase del panel
    panel.className = 'status-panel ' + estado.clase;

    // Actualizar contenido
    panel.innerHTML = `
        <div class="status-header">
            <span class="status-emoji">${estado.emoji}</span>
            <span class="status-title">${estado.titulo}</span>
        </div>
        <div class="status-description">
            ${estado.descripcion}
        </div>
        <div class="status-metrics">
            <div class="metric-item">
                <span class="metric-label">Densidad:</span>
                <span class="metric-value">${density.toFixed(1)}%</span>
                <span class="metric-desc">→ ${getDensityLabel(density)}</span>
            </div>
            <div class="metric-item">
                <span class="metric-label">Flujo vehicular:</span>
                <span class="metric-value">${throughput.toFixed(1)} veh/s</span>
                <span class="metric-desc">→ ${getThroughputLabel(throughput)}</span>
            </div>
            <div class="metric-item">
                <span class="metric-label">Velocidad:</span>
                <span class="metric-value">${speed.toFixed(1)}%</span>
                <span class="metric-desc">→ ${getSpeedLabel(speed)}</span>
            </div>
            <div class="metric-item">
                <span class="metric-label">Tasa cambio:</span>
                <span class="metric-value">${netGeneration.toFixed(1)} veh/s</span>
                <span class="metric-desc">→ ${getNetGenerationLabel(netGeneration)}</span>
            </div>
        </div>
        <div class="status-observations">
            <div class="observations-title">💡 ${estado.observaciones.length > 0 ? 'Observaciones:' : ''}</div>
            ${estado.observaciones.map(obs => `<div class="observation-item">• ${obs}</div>`).join('')}
        </div>
    `;
}

/**
 * Obtiene la etiqueta descriptiva para la densidad
 * Basado en teoría de tráfico: óptimo ~40-60%, crítico >85%
 */
function getDensityLabel(density) {
    if (density < 15) return 'Muy baja';
    if (density < 25) return 'Baja';
    if (density < 45) return 'Moderada';
    if (density < 60) return 'Buena ocupación';
    if (density < 75) return 'Alta';
    if (density < 85) return 'Muy alta';
    return 'Crítica';
}

/**
 * Obtiene la etiqueta descriptiva para la tasa de cambio neta (netGeneration)
 * Considera tanto crecimiento (+) como decrecimiento (-)
 */
function getNetGenerationLabel(netGen) {
    if (netGen < -3) return 'Decrecimiento rápido';
    if (netGen < -1) return 'Decrecimiento lento';
    if (netGen >= -1 && netGen <= 1) return 'Estable';
    if (netGen < 3) return 'Crecimiento lento';
    if (netGen < 6) return 'Crecimiento moderado';
    return 'Crecimiento rápido';
}

/**
 * Obtiene la etiqueta descriptiva para el throughput (flujo real Q=k×v)
 * Máximo práctico: ~4.0 veh/s (density=50% × speed=80% × 10)
 */
function getThroughputLabel(throughput) {
    if (throughput < 0.8) return 'Muy bajo';
    if (throughput < 2.0) return 'Bajo';
    if (throughput < 3.0) return 'Moderado';
    if (throughput < 4.0) return 'Bueno';
    if (throughput < 4.5) return 'Alto';
    return 'Excelente';
}

/**
 * Obtiene la etiqueta descriptiva para la velocidad
 * Ajustado para autómata celular con intersecciones (difícil alcanzar >80%)
 */
function getSpeedLabel(speed) {
    if (speed < 15) return 'Detenido';
    if (speed < 30) return 'Lento';
    if (speed < 50) return 'Moderado';
    if (speed < 70) return 'Fluido';
    if (speed < 80) return 'Muy fluido';
    return 'Excelente';
}

// ==================== FUNCIONES DE CÁLCULO DE MÉTRICAS ====================

/**
 * Calcula las métricas de tráfico actuales
 * @returns {Object} Objeto con densidad, flujo, velocidad, entropía y total de vehículos
 */
function calculateMetrics() {
    let totalCars = 0;
    let totalCells = 0;
    let carsInMotion = 0;

    // ⚡ OPTIMIZACIÓN: Calcular entropía solo cada 60 frames (muy costosa)
    const shouldCalculateEntropy = metricsUpdateCounter % ENTROPY_UPDATE_INTERVAL === 0;

    // Contador de las 8 transiciones de la regla del autómata celular para entropía de Shannon
    // Transiciones basadas en vecindario de 3 celdas (izquierda, centro, derecha)
    // Estado binario: 0 = sin carro, 1 = con carro (cualquier tipo 1-6)
    // Índice 0: 000 → resultado
    // Índice 1: 001 → resultado
    // Índice 2: 010 → resultado
    // Índice 3: 011 → resultado
    // Índice 4: 100 → resultado
    // Índice 5: 101 → resultado
    // Índice 6: 110 → resultado
    // Índice 7: 111 → resultado
    const transitionCount = shouldCalculateEntropy ? new Array(8).fill(0) : null;

    // Acceder a la variable global 'calles' definida en trafico.js
    if (!window.calles) {
        console.warn('No se encontró la variable global calles');
        return {
            density: 0,
            flow: 0,
            speed: 0,
            entropy: 0,
            totalCars: 0
        };
    }

    // Guardar estado actual y calcular transiciones
    const currentStates = new Map();

    window.calles.forEach((calle, calleIdx) => {
        // Filtrar calles según configuración (si callesIncluidasEnMetricas es null, incluir todas)
        if (callesIncluidasEnMetricas !== null && !callesIncluidasEnMetricas.has(calleIdx)) {
            // Esta calle está excluida de las métricas, omitir
            return;
        }

        for (let c = 0; c < calle.carriles; c++) {
            totalCells += calle.tamano;

            for (let i = 0; i < calle.tamano; i++) {
                const cellValue = calle.arreglo[c][i];
                const cellKey = `${calleIdx}-${c}-${i}`;

                // Guardar estado actual
                currentStates.set(cellKey, cellValue);

                // Contar vehículos
                if (cellValue > 0) {
                    totalCars++;
                    const nextIndex = (i + 1) % calle.tamano;
                    if (calle.arreglo[c][nextIndex] === 0) {
                        carsInMotion++;
                    }
                }

                // ⚡ OPTIMIZACIÓN: Calcular transiciones solo si shouldCalculateEntropy es true
                // Calcular transiciones basadas en vecindario de 3 celdas (izquierda, centro, derecha)
                // Solo si hay estado anterior disponible
                if (shouldCalculateEntropy && previousStreetStates.size > 0) {
                    // Obtener estado anterior de las 3 celdas del vecindario (en binario: 0 o 1)
                    const leftKey = `${calleIdx}-${c}-${i === 0 ? calle.tamano - 1 : i - 1}`;
                    const centerKey = `${calleIdx}-${c}-${i}`;
                    const rightKey = `${calleIdx}-${c}-${(i + 1) % calle.tamano}`;

                    // Convertir a estado binario: 0 = sin carro, 1 = con carro
                    const leftState = (previousStreetStates.get(leftKey) ?? 0) > 0 ? 1 : 0;
                    const centerState = (previousStreetStates.get(centerKey) ?? 0) > 0 ? 1 : 0;
                    const rightState = (previousStreetStates.get(rightKey) ?? 0) > 0 ? 1 : 0;

                    // Calcular índice de la regla (0-7) basado en configuración LCR (Left-Center-Right)
                    // Fórmula: índice = izquierda*4 + centro*2 + derecha
                    const ruleIndex = (leftState << 2) | (centerState << 1) | rightState;

                    // Incrementar contador de esta transición
                    transitionCount[ruleIndex]++;
                }
            }
        }
    });

    // ⚡ OPTIMIZACIÓN: Solo actualizar estado anterior si estamos calculando entropía
    if (shouldCalculateEntropy) {
        previousStreetStates = currentStates;
    }

    // Calcular densidad como porcentaje de ocupación
    const density = totalCells > 0 ? (totalCars / totalCells) * 100 : 0;

    // ⚡ OPTIMIZACIÓN: Calcular Entropía de Shannon solo cada 60 frames
    // H = -Σ(p_i * log2(p_i)) donde p_i es la proporción de cada tipo de transición
    let entropy = lastEntropyValue; // Usar valor cacheado por defecto

    if (shouldCalculateEntropy && totalCells > 0 && transitionCount) {
        entropy = 0; // Reiniciar para nuevo cálculo
        for (let i = 0; i < transitionCount.length; i++) {
            if (transitionCount[i] > 0) {
                const p_i = transitionCount[i] / totalCells;
                // Usar log2 = log(x) / log(2)
                entropy -= p_i * (Math.log(p_i) / Math.log(2));
            }
        }
        lastEntropyValue = entropy; // Cachear el nuevo valor
    }

    // Calcular tasa de cambio neta de población (antes llamado "flujo")
    // Usar tiempo virtual si está disponible, de lo contrario usar tiempo real
    const now = window.obtenerMillisVirtuales ? window.obtenerMillisVirtuales() : Date.now();

    // Inicializar en primera medición
    if (lastFlowMeasure === null) {
        lastFlowMeasure = now;
    }

    const timeDiff = (now - lastFlowMeasure) / 1000;

    // Solo actualizar cada segundo, pero mantener el último valor calculado
    if (timeDiff >= 1) {
        lastFlowValue = Math.abs(totalCars - previousCarCount) / timeDiff;
        previousCarCount = totalCars;
        lastFlowMeasure = now;
    }

    // Calcular velocidad promedio como porcentaje de vehículos en movimiento
    const avgSpeed = totalCars > 0 ? (carsInMotion / totalCars) * 100 : 0;

    // Calcular throughput real usando la ecuación fundamental del tráfico
    // Q = k × v (Flujo = Densidad × Velocidad)
    // Donde:
    // - k (densidad) = vehículos / celdas totales
    // - v (velocidad) = fracción de vehículos en movimiento
    // - Factor de escala temporal: asumiendo ~10 updates/segundo en promedio
    const densityRatio = totalCells > 0 ? totalCars / totalCells : 0;
    const speedRatio = avgSpeed / 100; // Convertir porcentaje a fracción
    const temporalScaleFactor = 10; // Aproximación de frames de simulación por segundo
    const throughput = densityRatio * speedRatio * temporalScaleFactor;

    return {
        density: density.toFixed(2),
        netGeneration: lastFlowValue.toFixed(2), // Tasa de cambio de población
        throughput: throughput.toFixed(2), // Flujo vehicular real (Q = k × v)
        speed: avgSpeed.toFixed(2),
        entropy: entropy.toFixed(3), // Entropía de Shannon (bits)
        totalCars: totalCars
    };
}

/**
 * Actualiza el historial de métricas con nuevos datos
 * @param {Object} metrics - Métricas calculadas
 */
function updateMetricsHistory(metrics) {
    // Usar tiempo virtual si está disponible, de lo contrario usar tiempo real
    let timeStr;
    if (window.obtenerTimestampCorto) {
        timeStr = window.obtenerTimestampCorto();
    } else {
        const now = new Date();
        timeStr = now.getHours().toString().padStart(2, '0') + ':' +
                  now.getMinutes().toString().padStart(2, '0') + ':' +
                  now.getSeconds().toString().padStart(2, '0');
    }

    // Agregar al historial limitado (para gráficas)
    metricsHistory.timestamps.push(timeStr);
    metricsHistory.density.push(parseFloat(metrics.density));
    metricsHistory.netGeneration.push(parseFloat(metrics.netGeneration));
    metricsHistory.throughput.push(parseFloat(metrics.throughput));
    metricsHistory.speed.push(parseFloat(metrics.speed));
    metricsHistory.entropy.push(parseFloat(metrics.entropy));

    // Agregar al historial COMPLETO (sin límite, para exportación)
    completeMetricsHistory.timestamps.push(timeStr);
    completeMetricsHistory.density.push(parseFloat(metrics.density));
    completeMetricsHistory.netGeneration.push(parseFloat(metrics.netGeneration));
    completeMetricsHistory.throughput.push(parseFloat(metrics.throughput));
    completeMetricsHistory.speed.push(parseFloat(metrics.speed));
    completeMetricsHistory.entropy.push(parseFloat(metrics.entropy));

    // Limitar el historial de gráficas al número máximo de puntos de datos
    if (metricsHistory.timestamps.length > metricsHistory.maxDataPoints) {
        metricsHistory.timestamps.shift();
        metricsHistory.density.shift();
        metricsHistory.netGeneration.shift();
        metricsHistory.throughput.shift();
        metricsHistory.speed.shift();
        metricsHistory.entropy.shift();
    }
}

/**
 * ⚡ OPTIMIZACIÓN: Actualiza las métricas con throttling adaptativo
 * Móvil: cada 15 frames (~2 veces/seg @ 30 FPS)
 * Desktop: cada 10 frames (~6 veces/seg @ 60 FPS)
 * Esta función debe ser llamada desde el loop de simulación
 */
function updateMetrics() {
    metricsUpdateCounter++;

    if (metricsUpdateCounter % METRICS_UPDATE_INTERVAL === 0) {
        const metrics = calculateMetrics();
        updateMetricsHistory(metrics);
        updateCharts();

        // Interpretar métricas y actualizar panel de estado
        const estado = interpretarMetricas(metrics);
        actualizarPanelInterpretacion(estado, metrics);
    }
}

function clearMetricHistories() {
    for (const history of [metricsHistory, completeMetricsHistory]) {
        for (const key of ['timestamps', 'density', 'netGeneration', 'throughput', 'speed', 'entropy']) {
            history[key].length = 0;
        }
    }
}

/** Reset metric history and all state that carries measurements across ticks. */
function resetSimulationMetrics() {
    clearMetricHistories();

    previousCarCount = 0;
    lastFlowMeasure = null;
    lastFlowValue = 0;
    previousStreetStates.clear();
    lastEntropyValue = 0;
    metricsUpdateCounter = 0;
    callesIncluidasEnMetricas = null;
    updateCharts();

    const statusPanel = document.getElementById('statusPanel');
    if (statusPanel) {
        statusPanel.className = 'status-panel status-moderado mb-3';
        statusPanel.innerHTML = `
            <div class="status-header">
                <span class="status-emoji">🟡</span>
                <span class="status-title">INICIANDO...</span>
            </div>
            <div class="status-description">Esperando datos de simulación...</div>
        `;
    }

    // Discard checkbox nodes from the old map; opening the modal rebuilds them.
    const streetList = document.getElementById('listaCallesMetricas');
    if (streetList) streetList.innerHTML = '';
    actualizarContadorCallesIncluidas();
}

// ==================== FUNCIONES DE INICIALIZACIÓN Y ACTUALIZACIÓN DE GRÁFICAS ====================

/**
 * Inicializa las tres gráficas de Chart.js (densidad, flujo, velocidad)
 */
function initializeCharts() {
    if (!window.Chart) {
        console.error('Chart.js no está cargado');
        return;
    }

    // Configuración común para todas las gráficas
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false, // Desactivar animaciones para mejor rendimiento en tiempo real
        interaction: {
            intersect: false,
            mode: 'index'
        },
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                enabled: true,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                padding: 8,
                displayColors: false
            }
        },
        scales: {
            x: {
                display: true,
                grid: {
                    display: false
                },
                ticks: {
                    maxTicksLimit: 6,
                    font: {
                        size: 10
                    }
                }
            },
            y: {
                display: true,
                grid: {
                    color: 'rgba(0, 0, 0, 0.05)'
                },
                ticks: {
                    font: {
                        size: 10
                    }
                }
            }
        }
    };

    // Gráfica de Densidad
    const densityCtx = document.getElementById('densityChart');
    if (densityCtx) {
        densityChartInstance = new Chart(densityCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: '% Ocupación',
                    data: [],
                    borderColor: '#0d6efd',
                    backgroundColor: 'rgba(13, 110, 253, 0.2)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                ...commonOptions,
                plugins: {
                    ...commonOptions.plugins,
                    tooltip: {
                        enabled: true,
                        backgroundColor: 'rgba(0, 0, 0, 0.9)',
                        padding: 12,
                        displayColors: false,
                        titleFont: { size: 13, weight: 'bold' },
                        bodyFont: { size: 11 },
                        callbacks: {
                            title: (context) => 'Densidad de Tráfico',
                            label: (context) => {
                                const value = context.parsed.y;
                                return [
                                    `${value.toFixed(1)}% de ocupación`,
                                    '',
                                    getDensityLabel(value),
                                    '',
                                    'Ideal: 30-60%',
                                    '>80% = Congestión'
                                ];
                            }
                        }
                    }
                },
                scales: {
                    ...commonOptions.scales,
                    y: {
                        ...commonOptions.scales.y,
                        min: 0,
                        max: 100,
                        ticks: {
                            ...commonOptions.scales.y.ticks,
                            callback: (value) => value + '%'
                        }
                    }
                }
            }
        });
    }

    // Gráfica de Throughput (Flujo Vehicular Real Q=k×v)
    const throughputCtx = document.getElementById('throughputChart');
    if (throughputCtx) {
        throughputChartInstance = new Chart(throughputCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'veh/seg',
                    data: [],
                    borderColor: '#198754',
                    backgroundColor: 'rgba(25, 135, 84, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                ...commonOptions,
                plugins: {
                    ...commonOptions.plugins,
                    tooltip: {
                        enabled: true,
                        backgroundColor: 'rgba(0, 0, 0, 0.9)',
                        padding: 12,
                        displayColors: false,
                        titleFont: { size: 13, weight: 'bold' },
                        bodyFont: { size: 11 },
                        callbacks: {
                            title: (context) => 'Flujo vehicular',
                            label: (context) => {
                                const value = context.parsed.y;
                                return [
                                    `${value.toFixed(1)} vehículos/seg`,
                                    '',
                                    getThroughputLabel(value),
                                    '',
                                    'Flujo = Densidad% × Velocidad%',
                                    '≥4.5 veh/s = Excelente',
                                    '2.5-4 veh/s = Óptimo',
                                    '<2 veh/s = Bajo'
                                ];
                            }
                        }
                    }
                },
                scales: {
                    ...commonOptions.scales,
                    y: {
                        ...commonOptions.scales.y,
                        min: 0,
                        suggestedMax: 6
                    }
                }
            }
        });
    }

    // Gráfica de Tasa de Cambio (Net Generation)
    const netGenCtx = document.getElementById('netGenerationChart');
    if (netGenCtx) {
        netGenerationChartInstance = new Chart(netGenCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'veh/seg',
                    data: [],
                    borderColor: '#fd7e14',
                    backgroundColor: 'rgba(253, 126, 20, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                ...commonOptions,
                plugins: {
                    ...commonOptions.plugins,
                    tooltip: {
                        enabled: true,
                        backgroundColor: 'rgba(0, 0, 0, 0.9)',
                        padding: 12,
                        displayColors: false,
                        titleFont: { size: 13, weight: 'bold' },
                        bodyFont: { size: 11 },
                        callbacks: {
                            title: (context) => 'Tasa de Cambio',
                            label: (context) => {
                                const value = context.parsed.y;
                                return [
                                    `${value.toFixed(1)} vehículos/seg`,
                                    '',
                                    getNetGenerationLabel(value),
                                    '',
                                    'Cambio neto de población',
                                    '>6 veh/s = Crecimiento rápido',
                                    '<1 veh/s = Estable'
                                ];
                            }
                        }
                    }
                },
                scales: {
                    ...commonOptions.scales,
                    y: {
                        ...commonOptions.scales.y,
                        min: 0,
                        suggestedMax: 10
                    }
                }
            }
        });
    }

    // Gráfica de Velocidad
    const speedCtx = document.getElementById('speedChart');
    if (speedCtx) {
        speedChartInstance = new Chart(speedCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: '% Movimiento',
                    data: [],
                    borderColor: '#dc3545',
                    backgroundColor: 'rgba(220, 53, 69, 0.2)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                ...commonOptions,
                plugins: {
                    ...commonOptions.plugins,
                    tooltip: {
                        enabled: true,
                        backgroundColor: 'rgba(0, 0, 0, 0.9)',
                        padding: 12,
                        displayColors: false,
                        titleFont: { size: 13, weight: 'bold' },
                        bodyFont: { size: 11 },
                        callbacks: {
                            title: (context) => 'Velocidad Promedio',
                            label: (context) => {
                                const value = context.parsed.y;
                                return [
                                    `${value.toFixed(1)}% en movimiento`,
                                    '',
                                    getSpeedLabel(value),
                                    '',
                                    '>60% = Fluido',
                                    '<30% = Casi detenido'
                                ];
                            }
                        }
                    }
                },
                scales: {
                    ...commonOptions.scales,
                    y: {
                        ...commonOptions.scales.y,
                        min: 0,
                        max: 100,
                        ticks: {
                            ...commonOptions.scales.y.ticks,
                            callback: (value) => value + '%'
                        }
                    }
                }
            }
        });
    }

    // Gráfica de Entropía de Shannon
    const entropyCtx = document.getElementById('entropyChart');
    if (entropyCtx) {
        entropyChartInstance = new Chart(entropyCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'bits',
                    data: [],
                    borderColor: '#6f42c1',
                    backgroundColor: 'rgba(111, 66, 193, 0.2)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0
                }]
            },
            options: {
                ...commonOptions,
                plugins: {
                    ...commonOptions.plugins,
                    tooltip: {
                        enabled: true,
                        backgroundColor: 'rgba(0, 0, 0, 0.9)',
                        padding: 12,
                        displayColors: false,
                        titleFont: { size: 13, weight: 'bold' },
                        bodyFont: { size: 11 },
                        callbacks: {
                            title: (context) => 'Entropía de Shannon (AC)',
                            label: (context) => {
                                const value = context.parsed.y;
                                return [
                                    `${value.toFixed(3)} bits`,
                                    '',
                                    'Mide la diversidad de las',
                                    '8 TRANSICIONES del autómata',
                                    'basadas en vecindario (L-C-R)',
                                    '',
                                    'Transiciones medidas:',
                                    '• 000, 001, 010, 011',
                                    '• 100, 101, 110, 111',
                                    '',
                                    'Estado binario: 0=vacío, 1=carro',
                                    '',
                                    'Máximo: 3.000 bits (8 reglas)',
                                    '0 bits = Una sola transición',
                                    'Alto = Transiciones variadas'
                                ];
                            }
                        }
                    }
                },
                scales: {
                    ...commonOptions.scales,
                    y: {
                        ...commonOptions.scales.y,
                        min: 0,
                        max: 3.0,
                        ticks: {
                            ...commonOptions.scales.y.ticks,
                            callback: (value) => value.toFixed(1) + ' bits'
                        }
                    }
                }
            }
        });
    }

    console.log('✅ Gráficas de Chart.js inicializadas correctamente');
}

/**
 * Actualiza los datos de las cinco gráficas
 */
function updateCharts() {
    if (!window.Chart) return;

    // Actualizar gráfica de densidad
    if (densityChartInstance) {
        densityChartInstance.data.labels = metricsHistory.timestamps;
        densityChartInstance.data.datasets[0].data = metricsHistory.density;
        densityChartInstance.update('none'); // 'none' evita animaciones
    }

    // Actualizar gráfica de throughput
    if (throughputChartInstance) {
        throughputChartInstance.data.labels = metricsHistory.timestamps;
        throughputChartInstance.data.datasets[0].data = metricsHistory.throughput;
        throughputChartInstance.update('none');
    }

    // Actualizar gráfica de tasa de cambio
    if (netGenerationChartInstance) {
        netGenerationChartInstance.data.labels = metricsHistory.timestamps;
        netGenerationChartInstance.data.datasets[0].data = metricsHistory.netGeneration;
        netGenerationChartInstance.update('none');
    }

    // Actualizar gráfica de velocidad
    if (speedChartInstance) {
        speedChartInstance.data.labels = metricsHistory.timestamps;
        speedChartInstance.data.datasets[0].data = metricsHistory.speed;
        speedChartInstance.update('none');
    }

    // Actualizar gráfica de entropía
    if (entropyChartInstance) {
        entropyChartInstance.data.labels = metricsHistory.timestamps;
        entropyChartInstance.data.datasets[0].data = metricsHistory.entropy;
        entropyChartInstance.update('none');
    }
}

/**
 * Actualiza los colores de las gráficas según el modo oscuro/claro
 * @param {boolean} modoOscuro - true para modo oscuro, false para modo claro
 */
function actualizarColoresGraficas(modoOscuro) {
    if (!densityChartInstance || !throughputChartInstance || !netGenerationChartInstance || !speedChartInstance || !entropyChartInstance) return;

    const gridColor = modoOscuro ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
    const tickColor = modoOscuro ? '#c0c0c0' : '#666';

    // Actualizar Densidad
    if (densityChartInstance) {
        densityChartInstance.options.scales.x.ticks.color = tickColor;
        densityChartInstance.options.scales.y.ticks.color = tickColor;
        densityChartInstance.options.scales.y.grid.color = gridColor;
        densityChartInstance.data.datasets[0].borderColor = modoOscuro ? '#5a9fd4' : '#0d6efd';
        densityChartInstance.data.datasets[0].backgroundColor = modoOscuro ? 'rgba(90, 159, 212, 0.2)' : 'rgba(13, 110, 253, 0.2)';
        densityChartInstance.update('none');
    }

    // Actualizar Throughput
    if (throughputChartInstance) {
        throughputChartInstance.options.scales.x.ticks.color = tickColor;
        throughputChartInstance.options.scales.y.ticks.color = tickColor;
        throughputChartInstance.options.scales.y.grid.color = gridColor;
        throughputChartInstance.data.datasets[0].borderColor = modoOscuro ? '#6dc98d' : '#198754';
        throughputChartInstance.data.datasets[0].backgroundColor = modoOscuro ? 'rgba(109, 201, 141, 0.1)' : 'rgba(25, 135, 84, 0.1)';
        throughputChartInstance.update('none');
    }

    // Actualizar Tasa de Cambio
    if (netGenerationChartInstance) {
        netGenerationChartInstance.options.scales.x.ticks.color = tickColor;
        netGenerationChartInstance.options.scales.y.ticks.color = tickColor;
        netGenerationChartInstance.options.scales.y.grid.color = gridColor;
        netGenerationChartInstance.data.datasets[0].borderColor = modoOscuro ? '#f5a76a' : '#fd7e14';
        netGenerationChartInstance.data.datasets[0].backgroundColor = modoOscuro ? 'rgba(245, 167, 106, 0.1)' : 'rgba(253, 126, 20, 0.1)';
        netGenerationChartInstance.update('none');
    }

    // Actualizar Velocidad
    if (speedChartInstance) {
        speedChartInstance.options.scales.x.ticks.color = tickColor;
        speedChartInstance.options.scales.y.ticks.color = tickColor;
        speedChartInstance.options.scales.y.grid.color = gridColor;
        speedChartInstance.data.datasets[0].borderColor = modoOscuro ? '#e8c888' : '#ffc107';
        speedChartInstance.data.datasets[0].backgroundColor = modoOscuro ? 'rgba(232, 200, 136, 0.1)' : 'rgba(255, 193, 7, 0.1)';
        speedChartInstance.update('none');
    }

    // Actualizar Entropía
    if (entropyChartInstance) {
        entropyChartInstance.options.scales.x.ticks.color = tickColor;
        entropyChartInstance.options.scales.y.ticks.color = tickColor;
        entropyChartInstance.options.scales.y.grid.color = gridColor;
        entropyChartInstance.data.datasets[0].borderColor = modoOscuro ? '#9d7dd3' : '#6f42c1';
        entropyChartInstance.data.datasets[0].backgroundColor = modoOscuro ? 'rgba(157, 125, 211, 0.2)' : 'rgba(111, 66, 193, 0.2)';
        entropyChartInstance.update('none');
    }
}

// ==================== FUNCIONES DE EXPORTACIÓN DE MÉTRICAS ====================

/**
 * Exporta las métricas a formato CSV (TODAS las medidas desde el inicio)
 */
function descargarMetricasCSV() {
    if (completeMetricsHistory.timestamps.length === 0) {
        alert('No hay métricas para exportar. Ejecuta la simulación primero.');
        return;
    }

    // Función auxiliar para calcular estadísticas
    const calcularEstadisticas = (arr) => {
        if (arr.length === 0) return { avg: 0, min: 0, max: 0 };
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        const min = Math.min(...arr);
        const max = Math.max(...arr);
        return { avg: avg.toFixed(2), min: min.toFixed(2), max: max.toFixed(2) };
    };

    // Calcular estadísticas del historial COMPLETO
    const densityStats = calcularEstadisticas(completeMetricsHistory.density);
    const throughputStats = calcularEstadisticas(completeMetricsHistory.throughput);
    const netGenStats = calcularEstadisticas(completeMetricsHistory.netGeneration);
    const speedStats = calcularEstadisticas(completeMetricsHistory.speed);
    const entropyStats = calcularEstadisticas(completeMetricsHistory.entropy);

    // Metadata del tiempo virtual (en español)
    let csvContent = '';
    if (window.configuracionTiempo && window.obtenerTimestampVirtual) {
        csvContent += 'FLUVI - Simulador de Trafico - Exportacion de Metricas\n';
        csvContent += `Tiempo Virtual: ${window.obtenerTimestampVirtual()}\n`;
        csvContent += `Perfiles Dinamicos Activos: ${window.configuracionTiempo.usarPerfiles ? 'Si' : 'No'}\n`;
        csvContent += `Tiempo por Paso: ${window.SEGUNDOS_POR_PASO || 1.0} segundo(s) simulados\n`;
        csvContent += `Total de Mediciones: ${completeMetricsHistory.timestamps.length}\n`;
        csvContent += '\n';
    }

    // Encabezado de datos (en español)
    csvContent += 'Marca de Tiempo,Densidad (%),Flujo (veh/s),Generacion Neta (veh/s),Velocidad (% movimiento),Entropia (bits)\n';

    // Datos de series temporales (TODAS las medidas desde el inicio)
    for (let i = 0; i < completeMetricsHistory.timestamps.length; i++) {
        csvContent += `${completeMetricsHistory.timestamps[i]},${completeMetricsHistory.density[i]},${completeMetricsHistory.throughput[i]},${completeMetricsHistory.netGeneration[i]},${completeMetricsHistory.speed[i]},${completeMetricsHistory.entropy[i]}\n`;
    }

    // Agregar línea en blanco y sección de estadísticas (en español)
    csvContent += '\n';
    csvContent += 'ESTADISTICAS\n';
    csvContent += 'Metrica,Promedio,Minimo,Maximo\n';
    csvContent += `Densidad (%),${densityStats.avg},${densityStats.min},${densityStats.max}\n`;
    csvContent += `Flujo (veh/s),${throughputStats.avg},${throughputStats.min},${throughputStats.max}\n`;
    csvContent += `Generacion Neta (veh/s),${netGenStats.avg},${netGenStats.min},${netGenStats.max}\n`;
    csvContent += `Velocidad (% movimiento),${speedStats.avg},${speedStats.min},${speedStats.max}\n`;
    csvContent += `Entropia (bits),${entropyStats.avg},${entropyStats.min},${entropyStats.max}\n`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    // Generar nombre de archivo con tiempo virtual si está disponible
    let fileName;
    if (window.configuracionTiempo && window.obtenerDiaString) {
        const dia = window.obtenerDiaString();
        const hora = Math.floor(window.configuracionTiempo.horaActual).toString().padStart(2, '0');
        const minuto = Math.floor(window.configuracionTiempo.minutoActual).toString().padStart(2, '0');
        fileName = `metricas_trafico_${dia}_${hora}h${minuto}m.csv`;
    } else {
        const now = new Date();
        fileName = `metricas_trafico_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.csv`;
    }

    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log(`✅ Métricas exportadas a CSV: ${fileName} (${completeMetricsHistory.timestamps.length} mediciones)`);
}

/**
 * Exporta las métricas a formato JSON
 */
function descargarMetricasJSON() {
    if (metricsHistory.timestamps.length === 0) {
        alert('No hay métricas para exportar. Ejecuta la simulación primero.');
        return;
    }

    const calcularEstadisticas = (arr) => {
        if (arr.length === 0) return { avg: 0, min: 0, max: 0 };
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        const min = Math.min(...arr);
        const max = Math.max(...arr);
        return { avg: avg.toFixed(2), min: min.toFixed(2), max: max.toFixed(2) };
    };

    // Construir metadata con información de tiempo virtual
    const metadata = {
        version: '2.2',
        exportDate: new Date().toISOString(),
        simulationName: 'FLUVI Traffic Simulation',
        totalDataPoints: metricsHistory.timestamps.length,
        metricsDescription: {
            density: 'Porcentaje de celdas ocupadas',
            throughput: 'Flujo vehicular real (Q = Densidad × Velocidad) en veh/s',
            netGeneration: 'Tasa de cambio neta de población vehicular en veh/s',
            speed: 'Porcentaje de vehículos en movimiento',
            entropy: 'Entropía de Shannon del autómata celular en bits (mide diversidad de las 8 transiciones basadas en vecindario de 3 celdas: 000, 001, 010, 011, 100, 101, 110, 111 con estado binario 0=vacío, 1=carro)'
        }
    };

    // Agregar información de tiempo virtual si está disponible
    if (window.configuracionTiempo && window.obtenerTimestampVirtual) {
        metadata.virtualTime = {
            currentTime: window.obtenerTimestampVirtual(),
            day: window.obtenerDiaString(),
            hour: Math.floor(window.configuracionTiempo.horaActual),
            minute: Math.floor(window.configuracionTiempo.minutoActual),
            second: Math.floor(window.configuracionTiempo.segundoActual),
            profilesActive: window.configuracionTiempo.usarPerfiles,
            secondsPerStep: window.SEGUNDOS_POR_PASO || 1.0,
            currentMultiplier: window.obtenerMultiplicadorTrafico ? window.obtenerMultiplicadorTrafico() : 1.0,
            trafficDescription: window.obtenerDescripcionTrafico ? window.obtenerDescripcionTrafico() : 'Unknown'
        };
    }

    const data = {
        metadata: metadata,
        metrics: {
            timestamps: metricsHistory.timestamps,
            density: metricsHistory.density,
            throughput: metricsHistory.throughput,
            netGeneration: metricsHistory.netGeneration,
            speed: metricsHistory.speed,
            entropy: metricsHistory.entropy
        },
        statistics: {
            density: calcularEstadisticas(metricsHistory.density),
            throughput: calcularEstadisticas(metricsHistory.throughput),
            netGeneration: calcularEstadisticas(metricsHistory.netGeneration),
            speed: calcularEstadisticas(metricsHistory.speed),
            entropy: calcularEstadisticas(metricsHistory.entropy)
        }
    };

    const jsonContent = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    // Generar nombre de archivo con tiempo virtual si está disponible
    let fileName;
    if (window.configuracionTiempo && window.obtenerDiaString) {
        const dia = window.obtenerDiaString();
        const hora = Math.floor(window.configuracionTiempo.horaActual).toString().padStart(2, '0');
        const minuto = Math.floor(window.configuracionTiempo.minutoActual).toString().padStart(2, '0');
        fileName = `metricas_trafico_${dia}_${hora}h${minuto}m.json`;
    } else {
        const now = new Date();
        fileName = `metricas_trafico_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.json`;
    }

    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log(`Métricas exportadas a JSON: ${fileName}`);
}

/**
 * Limpia el historial de métricas y actualiza las gráficas
 */
function limpiarMetricas() {
    if (completeMetricsHistory.timestamps.length === 0) {
        mostrarAdvertencia('Sin métricas', 'No hay métricas para limpiar.');
        return;
    }

    // Usar modal de confirmación de Bootstrap en lugar de confirm() nativo
    mostrarConfirmacion(
        '🗑️ Limpiar Métricas',
        '¿Estás seguro de que deseas limpiar todas las métricas?<br><br><strong>Esta acción no se puede deshacer.</strong>',
        () => {
            // Callback si el usuario confirma
            clearMetricHistories();
            updateCharts();

            console.log('✅ Métricas limpiadas exitosamente (historial completo y gráficas)');
            mostrarExito('✅ Métricas limpiadas', 'Todas las métricas han sido eliminadas exitosamente.');
        },
        null, // No hay callback para cancelar
        {
            btnConfirmText: '🗑️ Limpiar Todo',
            btnConfirmClass: 'btn-danger',
            btnCancelText: 'Cancelar'
        }
    );
}

// ==================== INICIALIZACIÓN AL CARGAR LA PÁGINA ====================

window.addEventListener('load', () => {
    if (window.Chart) {
        initializeCharts();
    } else {
        console.error('Chart.js no se cargó correctamente');
    }
});

// ==================== EVENT LISTENERS PARA BOTONES DE EXPORTACIÓN ====================

document.addEventListener('DOMContentLoaded', () => {
    // Botón para descargar CSV
    const btnDescargarCSV = document.getElementById('btnDescargarCSV');
    if (btnDescargarCSV) {
        btnDescargarCSV.addEventListener('click', descargarMetricasCSV);
    }

    // Botón para descargar JSON
    const btnDescargarJSON = document.getElementById('btnDescargarJSON');
    if (btnDescargarJSON) {
        btnDescargarJSON.addEventListener('click', descargarMetricasJSON);
    }

    // Botón para limpiar métricas
    const btnLimpiarMetricas = document.getElementById('btnLimpiarMetricas');
    if (btnLimpiarMetricas) {
        btnLimpiarMetricas.addEventListener('click', limpiarMetricas);
    }

    // Botón para abrir modal de mapa de calor
    const btnMapaCalor = document.getElementById('btnMapaCalor');
    if (btnMapaCalor) {
        btnMapaCalor.addEventListener('click', () => {
            if (!window.heatmapModal) {
                mostrarError('Error', 'El módulo de mapa de calor no está cargado');
                return;
            }

            // Abrir el modal (se renderiza una sola vez al abrirse)
            window.heatmapModal.open();
            console.log('🌡️ Abriendo modal de mapa de calor');
        });
    }

    // Botón para abrir modal de configuración de calles en métricas
    const btnConfigCallesMetricas = document.getElementById('btnConfigCallesMetricas');
    if (btnConfigCallesMetricas) {
        btnConfigCallesMetricas.addEventListener('click', abrirModalConfiguracionCalles);
    }

    // Botón para seleccionar todas las calles
    const btnSeleccionarTodasCalles = document.getElementById('btnSeleccionarTodasCalles');
    if (btnSeleccionarTodasCalles) {
        btnSeleccionarTodasCalles.addEventListener('click', () => {
            incluirTodasLasCalles();
            actualizarListaCallesEnModal();

            // Actualizar overlays si el modo está activo
            if (modoSeleccionCallesActivo && window.pixiApp?.sceneManager && window.pixiApp?.sceneManager.calleRenderer) {
                if (typeof window.pixiApp?.sceneManager.calleRenderer.updateAllMetricsOverlays === 'function') {
                    window.pixiApp?.sceneManager.calleRenderer.updateAllMetricsOverlays();
                }
            }
        });
    }

    // Botón para deseleccionar todas las calles
    const btnDeseleccionarTodasCalles = document.getElementById('btnDeseleccionarTodasCalles');
    if (btnDeseleccionarTodasCalles) {
        btnDeseleccionarTodasCalles.addEventListener('click', () => {
            excluirTodasLasCalles();
            actualizarListaCallesEnModal();

            // Actualizar overlays si el modo está activo
            if (modoSeleccionCallesActivo && window.pixiApp?.sceneManager && window.pixiApp?.sceneManager.calleRenderer) {
                if (typeof window.pixiApp?.sceneManager.calleRenderer.updateAllMetricsOverlays === 'function') {
                    window.pixiApp?.sceneManager.calleRenderer.updateAllMetricsOverlays();
                }
            }
        });
    }

    // Botón para activar/desactivar modo de selección de calles desde el mapa
    const btnModoSeleccionCalles = document.getElementById('btnModoSeleccionCalles');
    if (btnModoSeleccionCalles) {
        btnModoSeleccionCalles.addEventListener('click', () => {
            const nuevoEstado = !modoSeleccionCallesActivo;
            activarModoSeleccionCalles(nuevoEstado);
        });
    }
});

// ==================== FUNCIONES DE GESTIÓN DE CALLES EN MÉTRICAS ====================

/**
 * Inicializa la configuración de calles excluidas por defecto
 * Debe llamarse después de que window.calles esté disponible
 */
function inicializarCallesExcluidasPorDefecto() {
    if (!window.calles || window.calles.length === 0) {
        console.warn('⚠️ No se pueden inicializar calles excluidas: window.calles no disponible');
        return;
    }

    let callesExcluidas = 0;

    // Recorrer todas las calles y excluir las que están en la lista
    window.calles.forEach((calle, idx) => {
        if (CALLES_EXCLUIDAS_POR_DEFECTO.includes(calle.nombre)) {
            excluirCalle(idx);
            callesExcluidas++;
        }
    });

    console.log(`🚫 Inicialización: ${callesExcluidas} calles excluidas por defecto de las métricas`);
}

/**
 * Incluye todas las calles en el cálculo de métricas
 */
function incluirTodasLasCalles() {
    callesIncluidasEnMetricas = null;
    console.log('✅ Todas las calles incluidas en métricas');
}

/**
 * Excluye todas las calles del cálculo de métricas
 */
function excluirTodasLasCalles() {
    callesIncluidasEnMetricas = new Set();
    console.log('⚠️ Todas las calles excluidas de métricas');
}

/**
 * Incluye una calle específica en el cálculo de métricas
 * @param {number} calleIdx - Índice de la calle a incluir
 */
function incluirCalle(calleIdx) {
    // Si es null, crear un Set con todas las calles
    if (callesIncluidasEnMetricas === null) {
        callesIncluidasEnMetricas = new Set();
        if (window.calles) {
            for (let i = 0; i < window.calles.length; i++) {
                callesIncluidasEnMetricas.add(i);
            }
        }
    }
    callesIncluidasEnMetricas.add(calleIdx);
}

/**
 * Excluye una calle específica del cálculo de métricas
 * @param {number} calleIdx - Índice de la calle a excluir
 */
function excluirCalle(calleIdx) {
    // Si es null, crear un Set con todas las calles excepto esta
    if (callesIncluidasEnMetricas === null) {
        callesIncluidasEnMetricas = new Set();
        if (window.calles) {
            for (let i = 0; i < window.calles.length; i++) {
                if (i !== calleIdx) {
                    callesIncluidasEnMetricas.add(i);
                }
            }
        }
    } else {
        callesIncluidasEnMetricas.delete(calleIdx);
    }
}

/**
 * Verifica si una calle está incluida en las métricas
 * @param {number} calleIdx - Índice de la calle
 * @returns {boolean} true si está incluida, false si no
 */
function calleEstaIncluidaEnMetricas(calleIdx) {
    if (callesIncluidasEnMetricas === null) {
        return true; // Todas incluidas por defecto
    }
    return callesIncluidasEnMetricas.has(calleIdx);
}

/**
 * Obtiene un arreglo con los índices de las calles incluidas
 * @returns {number[]} Arreglo de índices de calles incluidas
 */
function obtenerCallesIncluidasEnMetricas() {
    if (callesIncluidasEnMetricas === null) {
        // Todas incluidas
        if (!window.calles) return [];
        return Array.from({ length: window.calles.length }, (_, i) => i);
    }
    return Array.from(callesIncluidasEnMetricas);
}

/**
 * Obtiene la cantidad de calles incluidas
 * @returns {number} Número de calles incluidas
 */
function obtenerCantidadCallesIncluidas() {
    if (callesIncluidasEnMetricas === null) {
        return window.calles ? window.calles.length : 0;
    }
    return callesIncluidasEnMetricas.size;
}

/**
 * Abre el modal de configuración de calles en métricas
 */
function abrirModalConfiguracionCalles() {
    const modal = document.getElementById('modalConfigCallesMetricas');
    if (!modal) {
        console.error('Modal de configuración de calles no encontrado');
        return;
    }

    // Actualizar la lista de calles
    actualizarListaCallesEnModal();

    // Abrir el modal usando Bootstrap
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

/**
 * Actualiza la lista de calles en el modal de configuración
 */
function actualizarListaCallesEnModal() {
    const container = document.getElementById('listaCallesMetricas');
    if (!container || !window.calles) return;

    // Limpiar contenido actual
    container.innerHTML = '';

    // Crear checkboxes para cada calle
    window.streetListUI.sortedEntries(window.calles).forEach(({ street: calle, index: idx }) => {
        const isIncluded = calleEstaIncluidaEnMetricas(idx);

        const div = document.createElement('div');
        div.className = 'form-check';
        div.innerHTML = `
            <input class="form-check-input" type="checkbox" id="calleMetrica${idx}"
                   data-calle-idx="${idx}" ${isIncluded ? 'checked' : ''}>
            <label class="form-check-label" for="calleMetrica${idx}">
                ${calle.nombre || `Calle ${idx + 1}`}
                <span class="text-muted" style="font-size: 0.85em;">
                    (${calle.carriles} carril${calle.carriles > 1 ? 'es' : ''}, ${calle.tamano} celdas)
                </span>
            </label>
        `;

        // Agregar event listener al checkbox
        const checkbox = div.querySelector('input');
        checkbox.addEventListener('change', (e) => {
            const calleIdx = parseInt(e.target.dataset.calleIdx);
            if (e.target.checked) {
                incluirCalle(calleIdx);
            } else {
                excluirCalle(calleIdx);
            }
            actualizarContadorCallesIncluidas();

            // Actualizar overlay si el modo está activo
            if (modoSeleccionCallesActivo && window.pixiApp?.sceneManager && window.pixiApp?.sceneManager.calleRenderer && window.calles) {
                const calle = window.calles[calleIdx];
                if (calle) {
                    if (calle.esCurva) {
                        window.pixiApp?.sceneManager.calleRenderer.removeCalleSprite(calle);
                        window.pixiApp?.sceneManager.calleRenderer.renderCalleCurva(calle);
                    } else {
                        if (typeof window.pixiApp?.sceneManager.calleRenderer.updateMetricsOverlay === 'function') {
                            window.pixiApp?.sceneManager.calleRenderer.updateMetricsOverlay(calle);
                        }
                    }
                }
            }
        });

        container.appendChild(div);
    });

    actualizarContadorCallesIncluidas();
}

/**
 * Actualiza el contador de calles incluidas en el modal
 */
function actualizarContadorCallesIncluidas() {
    const contador = document.getElementById('contadorCallesIncluidas');
    if (contador) {
        const incluidas = obtenerCantidadCallesIncluidas();
        const total = window.calles ? window.calles.length : 0;
        contador.textContent = `${incluidas} de ${total} calles incluidas`;
    }
}

/**
 * Activa o desactiva el modo de selección de calles desde el mapa
 * @param {boolean} activar - true para activar, false para desactivar
 */
function activarModoSeleccionCalles(activar) {
    modoSeleccionCallesActivo = activar;

    console.log(`🎯 ${activar ? 'ACTIVANDO' : 'DESACTIVANDO'} modo de selección de calles...`);

    // Actualizar botón en la UI
    const btn = document.getElementById('btnModoSeleccionCalles');
    if (btn) {
        if (activar) {
            btn.classList.add('active');
            btn.classList.remove('btn-outline-primary');
            btn.classList.add('btn-primary');
            btn.innerHTML = '🎯 Modo Selección: ON';
            console.log('✅ Modo de selección de calles ACTIVADO - Click en las calles para incluir/excluir');
        } else {
            btn.classList.remove('active');
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-outline-primary');
            btn.innerHTML = '🎯 Seleccionar desde Mapa';
            console.log('⏹️ Modo de selección de calles DESACTIVADO');
        }
    }

    // Actualizar overlays de todas las calles
    const sceneManager = window.pixiApp?.sceneManager;
    if (sceneManager && sceneManager.calleRenderer) {
        console.log(`📊 Actualizando overlays para ${window.calles ? window.calles.length : 0} calles...`);
        if (typeof sceneManager.calleRenderer.updateAllMetricsOverlays === 'function') {
            sceneManager.calleRenderer.updateAllMetricsOverlays();
            console.log('✅ Overlays actualizados');
        } else {
            console.error('❌ Función updateAllMetricsOverlays no encontrada');
        }
    } else {
        console.error('❌ pixiApp, sceneManager o calleRenderer no encontrados');
        console.log('Debug - window.pixiApp:', window.pixiApp);
        console.log('Debug - sceneManager:', sceneManager);
    }
}

/**
 * Verifica si el modo de selección de calles está activo
 * @returns {boolean} true si está activo
 */
function esModoSeleccionCallesActivo() {
    return modoSeleccionCallesActivo;
}

/**
 * Maneja el click en una calle para incluir/excluir de métricas
 * Esta función debe ser llamada desde el click handler de las calles
 * @param {number} calleIdx - Índice de la calle clickeada
 */
function toggleCalleEnMetricas(calleIdx) {
    if (!modoSeleccionCallesActivo) {
        return; // Solo funciona si el modo está activo
    }

    const estaIncluida = calleEstaIncluidaEnMetricas(calleIdx);

    if (estaIncluida) {
        excluirCalle(calleIdx);
        console.log(`❌ Calle ${calleIdx} excluida de métricas`);
    } else {
        incluirCalle(calleIdx);
        console.log(`✅ Calle ${calleIdx} incluida en métricas`);
    }

    // Actualizar contador si el modal está abierto
    actualizarContadorCallesIncluidas();

    // Actualizar checkboxes si el modal está abierto
    const checkbox = document.getElementById(`calleMetrica${calleIdx}`);
    if (checkbox) {
        checkbox.checked = !estaIncluida;
    }

    // Actualizar overlay de la calle específica
    if (window.pixiApp?.sceneManager && window.pixiApp?.sceneManager.calleRenderer && window.calles) {
        const calle = window.calles[calleIdx];
        if (calle) {
            if (calle.esCurva) {
                // Para calles curvas, reconstruir
                window.pixiApp?.sceneManager.calleRenderer.removeCalleSprite(calle);
                window.pixiApp?.sceneManager.calleRenderer.renderCalleCurva(calle);
            } else {
                // Para calles rectas, solo actualizar overlay
                if (typeof window.pixiApp?.sceneManager.calleRenderer.updateMetricsOverlay === 'function') {
                    window.pixiApp?.sceneManager.calleRenderer.updateMetricsOverlay(calle);
                }
            }
        }
    }
}

// ==================== EXPONER FUNCIONES AL SCOPE GLOBAL ====================

// Exponer funciones necesarias para ser llamadas desde otros módulos
window.updateMetrics = updateMetrics;
window.actualizarColoresGraficas = actualizarColoresGraficas;
window.initializeCharts = initializeCharts;
window.updateCharts = updateCharts;
window.descargarMetricasCSV = descargarMetricasCSV;
window.descargarMetricasJSON = descargarMetricasJSON;
window.limpiarMetricas = limpiarMetricas;
window.resetSimulationMetrics = resetSimulationMetrics;

// Exponer funciones de gestión de calles en métricas
window.inicializarCallesExcluidasPorDefecto = inicializarCallesExcluidasPorDefecto;
window.incluirTodasLasCalles = incluirTodasLasCalles;
window.excluirTodasLasCalles = excluirTodasLasCalles;
window.incluirCalle = incluirCalle;
window.excluirCalle = excluirCalle;
window.calleEstaIncluidaEnMetricas = calleEstaIncluidaEnMetricas;
window.obtenerCallesIncluidasEnMetricas = obtenerCallesIncluidasEnMetricas;
window.obtenerCantidadCallesIncluidas = obtenerCantidadCallesIncluidas;
window.abrirModalConfiguracionCalles = abrirModalConfiguracionCalles;
window.activarModoSeleccionCalles = activarModoSeleccionCalles;
window.esModoSeleccionCallesActivo = esModoSeleccionCallesActivo;
window.toggleCalleEnMetricas = toggleCalleEnMetricas;
