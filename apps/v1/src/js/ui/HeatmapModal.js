/**
 * HeatmapModal.js - Modal con mapa de calor estático
 * Renderiza UNA SOLA VEZ el estado actual del tráfico usando Canvas2D
 */

console.log('🌡️ HeatmapModal.js cargando...');

class HeatmapModal {
    constructor() {
        this.modal = null;
        this.isRendering = false;

        console.log('🌡️ HeatmapModal inicializado');
    }

    /**
     * Abre el modal y renderiza el mapa de calor con el estado actual
     */
    open() {
        if (this.isRendering) {
            console.warn('⚠️ Ya se está renderizando un mapa de calor');
            return;
        }

        if (!window.calles || window.calles.length === 0) {
            mostrarAdvertencia('Sin calles', 'No hay calles en el mapa para generar el mapa de calor');
            return;
        }

        console.log(`🌡️ Abriendo modal con ${window.calles.length} calles`);

        // Marcar como renderizando
        this.isRendering = true;

        // Cerrar tooltips abiertos
        const tooltips = document.querySelectorAll('.tooltip');
        tooltips.forEach(t => t.remove());

        // Obtener elementos del DOM
        const modalElement = document.getElementById('modalMapaCalor');
        const canvasContainer = document.getElementById('heatmapCanvasContainer');
        const loadingDiv = document.getElementById('heatmapLoading');
        const canvas = document.getElementById('heatmapCanvas');

        if (!modalElement || !canvas || !canvasContainer || !loadingDiv) {
            console.error('❌ No se encontraron los elementos del DOM');
            this.isRendering = false;
            return;
        }

        // Mostrar loading
        loadingDiv.style.display = 'block';
        canvasContainer.style.display = 'none';

        // Crear o reutilizar modal de Bootstrap
        if (!this.modal) {
            this.modal = new bootstrap.Modal(modalElement);
        }

        // Mostrar modal
        this.modal.show();

        // Renderizar cuando el modal esté visible
        setTimeout(() => {
            try {
                this.render();
            } catch (error) {
                console.error('❌ Error al renderizar:', error);
                mostrarError('Error', 'No se pudo generar el mapa de calor');
                loadingDiv.style.display = 'none';
            } finally {
                this.isRendering = false;
            }
        }, 200);
    }

    /**
     * Renderiza el mapa de calor usando Canvas2D simple
     */
    render() {
        const startTime = performance.now();
        console.log('🌡️ Generando mapa de calor...');

        const canvas = document.getElementById('heatmapCanvas');
        const canvasContainer = document.getElementById('heatmapCanvasContainer');
        const loadingDiv = document.getElementById('heatmapLoading');

        if (!canvas) {
            console.error('❌ Canvas no encontrado');
            return;
        }

        const ctx = canvas.getContext('2d');
        const CELL_SIZE = window.celda_tamano || 15;

        // Calcular bounding box simple
        console.log('📐 Calculando dimensiones...');
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        window.calles.forEach(calle => {
            if (!calle || !calle.arreglo || !window.obtenerCoordenadasGlobalesCeldaConCurva) return;

            // Revisar solo las esquinas para ser rápido
            const corners = [
                [0, 0],
                [0, calle.tamano - 1],
                [calle.carriles - 1, 0],
                [calle.carriles - 1, calle.tamano - 1]
            ];

            corners.forEach(([c, i]) => {
                const coords = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, c, i);
                if (coords && isFinite(coords.x) && isFinite(coords.y)) {
                    minX = Math.min(minX, coords.x);
                    minY = Math.min(minY, coords.y);
                    maxX = Math.max(maxX, coords.x);
                    maxY = Math.max(maxY, coords.y);
                }
            });
        });

        if (!isFinite(minX) || !isFinite(maxX)) {
            console.error('❌ No se pudo calcular el bounding box');
            mostrarError('Error', 'No se pudo calcular las dimensiones del mapa');
            loadingDiv.style.display = 'none';
            return;
        }

        // Agregar padding
        const padding = CELL_SIZE * 2;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        const worldWidth = maxX - minX;
        const worldHeight = maxY - minY;

        // Calcular tamaño del canvas que cabe en el modal
        const maxWidth = window.innerWidth * 0.85;
        const maxHeight = window.innerHeight * 0.6;

        const scaleX = maxWidth / worldWidth;
        const scaleY = maxHeight / worldHeight;
        const scale = Math.min(scaleX, scaleY, 1);

        canvas.width = Math.floor(worldWidth * scale);
        canvas.height = Math.floor(worldHeight * scale);

        console.log(`📏 Canvas: ${canvas.width}x${canvas.height} (escala: ${scale.toFixed(3)})`);

        // Configurar contexto
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(scale, scale);
        ctx.translate(-minX, -minY);

        let cellsRendered = 0;
        let callesConCeldas = 0;

        console.log('🎨 Renderizando calles...');

        // Renderizar cada calle
        window.calles.forEach(calle => {
            if (!calle || !calle.arreglo || !window.obtenerCoordenadasGlobalesCeldaConCurva) return;

            let cellsInCalle = 0;

            for (let c = 0; c < calle.carriles; c++) {
                if (!calle.arreglo[c]) continue;

                for (let i = 0; i < calle.tamano; i++) {
                    const valor = calle.arreglo[c][i];
                    const coords = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, c, i);

                    if (!coords || !isFinite(coords.x) || !isFinite(coords.y)) continue;

                    // Determinar color
                    let color, alpha;
                    if (valor >= 1 && valor <= 6) {
                        const density = (7 - valor) / 6;
                        color = this.getColorForDensity(density);
                        alpha = 0.8;
                    } else {
                        color = 'rgb(224, 224, 224)';
                        alpha = 0.2;
                    }

                    // Dibujar rectángulo rotado
                    ctx.save();
                    ctx.translate(coords.x, coords.y);
                    ctx.rotate(-coords.angulo * Math.PI / 180);
                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = color;
                    ctx.fillRect(-CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE);
                    ctx.restore();

                    cellsRendered++;
                    cellsInCalle++;
                }
            }

            if (cellsInCalle > 0) callesConCeldas++;
        });

        ctx.restore();

        // Mostrar canvas, ocultar loading
        loadingDiv.style.display = 'none';
        canvasContainer.style.display = 'block';

        const endTime = performance.now();
        const renderTime = (endTime - startTime).toFixed(2);

        console.log(`✅ Mapa generado en ${renderTime}ms`);
        console.log(`   📊 ${callesConCeldas}/${window.calles.length} calles`);
        console.log(`   📊 ${cellsRendered} celdas`);

        // Actualizar estadísticas en el modal
        this.updateStats(cellsRendered, callesConCeldas, renderTime);
    }

    /**
     * Calcula el color según la densidad (0-1)
     */
    getColorForDensity(density) {
        density = Math.max(0, Math.min(1, density));

        let r, g, b;

        if (density < 0.33) {
            // Verde a Amarillo
            const t = density / 0.33;
            r = Math.floor(0 + (255 - 0) * t);
            g = 255;
            b = 0;
        } else if (density < 0.66) {
            // Amarillo a Naranja
            const t = (density - 0.33) / 0.33;
            r = 255;
            g = Math.floor(255 - (100 * t));
            b = 0;
        } else {
            // Naranja a Rojo
            const t = (density - 0.66) / 0.34;
            r = 255;
            g = Math.floor(155 - (155 * t));
            b = 0;
        }

        return `rgb(${r}, ${g}, ${b})`;
    }

    /**
     * Actualiza las estadísticas del modal con datos en tiempo real
     */
    updateStats(cellsRendered, callesRendered, renderTime) {
        // Contar vehículos activos
        let vehiclesCount = 0;
        if (window.calles) {
            window.calles.forEach(calle => {
                if (!calle || !calle.arreglo) return;
                for (let c = 0; c < calle.carriles; c++) {
                    if (!calle.arreglo[c]) continue;
                    for (let i = 0; i < calle.tamano; i++) {
                        const valor = calle.arreglo[c][i];
                        if (valor >= 1 && valor <= 6) {
                            vehiclesCount++;
                        }
                    }
                }
            });
        }

        // Obtener hora simulada
        let simTime = '--:--:--';
        if (window.configuracionTiempo) {
            const h = String(Math.floor(window.configuracionTiempo.horaActual)).padStart(2, '0');
            const m = String(Math.floor(window.configuracionTiempo.minutoActual)).padStart(2, '0');
            const s = String(Math.floor(window.configuracionTiempo.segundoActual)).padStart(2, '0');
            simTime = `${h}:${m}:${s}`;
        }

        // Actualizar elementos del DOM
        const vehiclesEl = document.getElementById('heatmapVehicles');
        const streetsEl = document.getElementById('heatmapStreets');
        const timeEl = document.getElementById('heatmapTime');
        const simTimeEl = document.getElementById('heatmapSimTime');

        if (vehiclesEl) vehiclesEl.textContent = vehiclesCount.toLocaleString();
        if (streetsEl) streetsEl.textContent = `${callesRendered}/${window.calles ? window.calles.length : 0}`;
        if (timeEl) timeEl.textContent = `${renderTime}ms`;
        if (simTimeEl) simTimeEl.textContent = simTime;
    }
}

// Crear instancia global
window.heatmapModal = new HeatmapModal();

// Limpiar flag al cerrar modal
document.addEventListener('DOMContentLoaded', () => {
    const modalElement = document.getElementById('modalMapaCalor');
    if (modalElement) {
        modalElement.addEventListener('hidden.bs.modal', () => {
            if (window.heatmapModal) {
                window.heatmapModal.isRendering = false;
            }
        });
    }
});

console.log('✅ HeatmapModal.js cargado');
