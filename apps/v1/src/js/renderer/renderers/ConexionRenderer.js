/**
 * ConexionRenderer.js - Renderizador de conexiones
 * Maneja la visualización de líneas de conexión entre calles
 */

class ConexionRenderer {
    constructor(sceneManager, assetLoader) {
        this.scene = sceneManager;
        this.assets = assetLoader;
    }

    renderAll(conexiones) {
        if (!conexiones || !window.mostrarConexiones) return;

        // Solo renderizar si no están ya renderizadas
        if (this.scene.conexionGraphics.size > 0) return;

        // Limpiar conexiones anteriores (por si acaso)
        this.clearAll();

        conexiones.forEach(conexion => {
            this.renderConexion(conexion);
        });
    }

    renderConexion(conexion) {
        // Calcular posición de origen
        const posOrig = conexion.posOrigen === -1 ? conexion.origen.tamano - 1 : conexion.posOrigen;

        // Calcular coordenadas del origen
        let coordOrigen;
        if (conexion.origen.esCurva && conexion.origen.vertices && conexion.origen.vertices.length > 0) {
            if (typeof window.obtenerCoordenadasGlobalesCeldaConCurva === 'function') {
                coordOrigen = window.obtenerCoordenadasGlobalesCeldaConCurva(conexion.origen, conexion.carrilOrigen, posOrig);
            } else if (typeof window.obtenerCoordenadasGlobalesCelda === 'function') {
                coordOrigen = window.obtenerCoordenadasGlobalesCelda(conexion.origen, conexion.carrilOrigen, posOrig);
            } else {
                console.warn('No se encontró función para calcular coordenadas');
                return;
            }
        } else {
            if (typeof window.obtenerCoordenadasGlobalesCelda === 'function') {
                coordOrigen = window.obtenerCoordenadasGlobalesCelda(conexion.origen, conexion.carrilOrigen, posOrig);
            } else {
                console.warn('No se encontró función para calcular coordenadas');
                return;
            }
        }

        // Calcular coordenadas del destino
        let coordDestino;
        if (conexion.destino.esCurva && conexion.destino.vertices && conexion.destino.vertices.length > 0) {
            if (typeof window.obtenerCoordenadasGlobalesCeldaConCurva === 'function') {
                coordDestino = window.obtenerCoordenadasGlobalesCeldaConCurva(conexion.destino, conexion.carrilDestino, conexion.posDestino);
            } else if (typeof window.obtenerCoordenadasGlobalesCelda === 'function') {
                coordDestino = window.obtenerCoordenadasGlobalesCelda(conexion.destino, conexion.carrilDestino, conexion.posDestino);
            } else {
                console.warn('No se encontró función para calcular coordenadas');
                return;
            }
        } else {
            if (typeof window.obtenerCoordenadasGlobalesCelda === 'function') {
                coordDestino = window.obtenerCoordenadasGlobalesCelda(conexion.destino, conexion.carrilDestino, conexion.posDestino);
            } else {
                console.warn('No se encontró función para calcular coordenadas');
                return;
            }
        }

        const x1 = coordOrigen.x;
        const y1 = coordOrigen.y;
        const x2 = coordDestino.x;
        const y2 = coordDestino.y;

        const graphics = new PIXI.Graphics();

        // Determinar color según tipo
        let color;
        if (conexion.bloqueada) {
            color = 0xFF3333; // Rojo para bloqueadas
        } else if (conexion.tipo === 'probabilistica') {
            color = 0x9966FF; // Morado para probabilísticas
        } else if (conexion.tipo === 'incorporacion') {
            color = 0xFF8C00; // Naranja para incorporación
        } else {
            color = 0x6BFF8B; // Verde para lineales
        }

        const lineWidth = conexion.bloqueada ? 1.5 : 1;

        // Dibujar línea con patrón según tipo
        if (conexion.tipo === 'probabilistica') {
            // Línea punteada para probabilísticas
            this.drawDashedLine(graphics, x1, y1, x2, y2, color, lineWidth, [3, 3]);
        } else if (conexion.tipo === 'incorporacion') {
            // Línea con guiones para incorporación
            this.drawDashedLine(graphics, x1, y1, x2, y2, color, lineWidth, [5, 3]);
        } else if (conexion.bloqueada) {
            // Línea punteada corta para bloqueadas
            this.drawDashedLine(graphics, x1, y1, x2, y2, color, lineWidth, [2, 2]);
        } else {
            // Línea sólida
            graphics.lineStyle(lineWidth, color, 0.8);
            graphics.moveTo(x1, y1);
            graphics.lineTo(x2, y2);
        }

        // Dibujar flecha al final
        this.drawArrow(graphics, x1, y1, x2, y2, color);

        // Agregar a la capa de conexiones
        this.scene.getLayer('connections').addChild(graphics);
        this.scene.conexionGraphics.set(conexion, graphics);
    }

    // Método auxiliar para dibujar líneas punteadas
    drawDashedLine(graphics, x1, y1, x2, y2, color, lineWidth, dashPattern) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const dashLength = dashPattern[0];
        const gapLength = dashPattern[1];
        const totalPattern = dashLength + gapLength;
        const numSegments = Math.floor(distance / totalPattern);

        graphics.lineStyle(lineWidth, color, 0.8);

        for (let i = 0; i < numSegments; i++) {
            const startRatio = (i * totalPattern) / distance;
            const endRatio = (i * totalPattern + dashLength) / distance;

            const startX = x1 + dx * startRatio;
            const startY = y1 + dy * startRatio;
            const endX = x1 + dx * endRatio;
            const endY = y1 + dy * endRatio;

            graphics.moveTo(startX, startY);
            graphics.lineTo(endX, endY);
        }
    }

    drawArrow(graphics, x1, y1, x2, y2, color) {
        const headLength = 6; // Longitud de la punta de la flecha (reducida)
        const angle = Math.atan2(y2 - y1, x2 - x1);

        // Punta de la flecha (triángulo pequeño)
        graphics.lineStyle(1, color, 0.8);
        graphics.beginFill(color, 0.8);
        graphics.moveTo(x2, y2);
        graphics.lineTo(
            x2 - headLength * Math.cos(angle - Math.PI / 6),
            y2 - headLength * Math.sin(angle - Math.PI / 6)
        );
        graphics.lineTo(
            x2 - headLength * Math.cos(angle + Math.PI / 6),
            y2 - headLength * Math.sin(angle + Math.PI / 6)
        );
        graphics.lineTo(x2, y2);
        graphics.endFill();
    }

    /**
     * Renderiza conexiones de estacionamiento (líneas desde edificios a celdas)
     */
    renderEstacionamientos() {
        if (!window.edificios || !window.calles) return;

        // Filtrar edificios que son estacionamientos
        const estacionamientos = window.edificios.filter(e => e.esEstacionamiento && e.conexiones && e.conexiones.length > 0);

        estacionamientos.forEach(edificio => {
            edificio.conexiones.forEach(conexion => {
                // Encontrar la calle
                const calle = window.calles.find(c => c.id === conexion.calleId || c.nombre === conexion.calleId);
                if (!calle) return;

                // Obtener coordenadas de la celda
                let coordCelda;
                if (calle.esCurva && calle.vertices && calle.vertices.length > 0) {
                    if (typeof window.obtenerCoordenadasGlobalesCeldaConCurva === 'function') {
                        coordCelda = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, conexion.carril, conexion.indice);
                    } else {
                        return;
                    }
                } else {
                    if (typeof window.obtenerCoordenadasGlobalesCelda === 'function') {
                        coordCelda = window.obtenerCoordenadasGlobalesCelda(calle, conexion.carril, conexion.indice);
                    } else {
                        return;
                    }
                }

                // Calcular punto en el perímetro del edificio más cercano a la celda
                const puntoEdificio = this.calcularPuntoPerimetro(edificio, coordCelda.x, coordCelda.y);

                // Crear gráficos para la línea
                const graphics = new PIXI.Graphics();

                // Color según tipo: verde para entrada, azul para salida
                const color = conexion.tipo === 'entrada' ? 0x00FF00 : 0x0000FF;
                const lineWidth = 1.5;

                // Dibujar línea punteada
                this.drawDashedLine(graphics, puntoEdificio.x, puntoEdificio.y, coordCelda.x, coordCelda.y, color, lineWidth, [5, 3]);

                // Dibujar círculo pequeño en la celda
                graphics.lineStyle(0);
                graphics.beginFill(color, 0.8);
                graphics.drawCircle(coordCelda.x, coordCelda.y, 3);
                graphics.endFill();

                // Agregar al layer de conexiones
                graphics.zIndex = 5;
                this.scene.getLayer('connections').addChild(graphics);

                // Guardar referencia para limpiar después
                const key = `estacionamiento_${edificio.id || edificio.label}_${conexion.tipo}_${conexion.carril}_${conexion.indice}`;
                this.scene.conexionGraphics.set(key, graphics);
            });
        });
    }

    /**
     * Calcula el punto en el perímetro del edificio más cercano a un punto dado
     */
    calcularPuntoPerimetro(edificio, targetX, targetY) {
        const cx = edificio.x;
        const cy = edificio.y;
        const w = edificio.width;
        const h = edificio.height;
        const angle = (edificio.angle || 0) * Math.PI / 180;

        // Calcular vector desde centro del edificio al punto objetivo
        const dx = targetX - cx;
        const dy = targetY - cy;

        // Rotar el vector al sistema de coordenadas del edificio
        const cos = Math.cos(-angle);
        const sin = Math.sin(-angle);
        const dxRot = dx * cos - dy * sin;
        const dyRot = dx * sin + dy * cos;

        // Calcular punto de intersección con el rectángulo
        let px, py;
        const ratio = Math.abs(dyRot * w / (dxRot * h));

        if (ratio > 1) {
            // Intersecta con lado superior o inferior
            py = dyRot > 0 ? h / 2 : -h / 2;
            px = (dxRot * h) / (2 * Math.abs(dyRot));
        } else {
            // Intersecta con lado izquierdo o derecho
            px = dxRot > 0 ? w / 2 : -w / 2;
            py = (dyRot * w) / (2 * Math.abs(dxRot));
        }

        // Rotar de vuelta al sistema global
        const pxGlobal = px * cos - py * sin + cx;
        const pyGlobal = px * sin + py * cos + cy;

        return { x: pxGlobal, y: pyGlobal };
    }

    clearAll() {
        this.scene.conexionGraphics.forEach((graphics, conexion) => {
            graphics.destroy();
        });
        this.scene.conexionGraphics.clear();
        this.scene.getLayer('connections').removeChildren();
    }
}

window.ConexionRenderer = ConexionRenderer;
console.log('✓ ConexionRenderer cargado');
