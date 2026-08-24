/**
 * BackgroundAreaRenderer.js - Renderizador de áreas de fondo
 * Maneja la visualización eficiente de áreas de referencia visual (como el área del Politécnico)
 * Usa PIXI.Graphics para máxima eficiencia (no texturas pesadas)
 */

class BackgroundAreaRenderer {
    constructor(sceneManager) {
        this.scene = sceneManager;
        this.backgroundAreas = new Map(); // Map<area, PIXI.Graphics>
    }

    /**
     * Renderiza todas las áreas de fondo
     * @param {Array} areas - Array de objetos con {x, y, width, height, color, alpha, angle}
     */
    renderAll(areas) {
        if (!areas || areas.length === 0) {
            console.log('📐 BackgroundAreaRenderer: No hay áreas para renderizar');
            return;
        }

        console.log(`📐 BackgroundAreaRenderer: Renderizando ${areas.length} área(s) de fondo`);

        areas.forEach(area => {
            try {
                this.renderArea(area);
            } catch (error) {
                console.error(`❌ Error renderizando área de fondo:`, area, error);
            }
        });
    }

    /**
     * Renderiza un área de fondo individual
     * @param {Object} area - Objeto con propiedades del área
     * Soporta dos formatos:
     * 1. Rectángulo: {x, y, width, height, angle}
     * 2. Polígono: {vertices: [{x, y}, {x, y}, ...]} (mínimo 8 vértices)
     */
    renderArea(area) {
        // Si ya existe, no re-renderizar (es estático)
        if (this.backgroundAreas.has(area)) {
            console.log(`📐 Área "${area.label || 'sin nombre'}" ya renderizada, omitiendo...`);
            return;
        }

        // ULTRA OPTIMIZACIÓN: Usar Canvas HTML5 offline en lugar de PixiJS renderer
        // Esto es MUCHO más eficiente para polígonos grandes

        // Determinar color y opacidad
        const color = this.parseColor(area.color || area.backgroundColor || '#FFE4B5');
        const alpha = area.alpha !== undefined ? area.alpha : 0.3;

        let canvas, ctx, bounds;

        if (area.vertices && Array.isArray(area.vertices) && area.vertices.length >= 3) {
            // POLÍGONO - Calcular bounding box
            const xs = area.vertices.map(v => v.x);
            const ys = area.vertices.map(v => v.y);
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            const maxX = Math.max(...xs);
            const maxY = Math.max(...ys);

            bounds = { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };

            // Crear canvas offline
            canvas = document.createElement('canvas');
            canvas.width = bounds.width + 10; // +10 para el borde
            canvas.height = bounds.height + 10;
            ctx = canvas.getContext('2d');

            // Configurar estilo
            ctx.fillStyle = this.rgbaFromHex(color, alpha);
            if (area.showBorder !== false) {
                ctx.strokeStyle = this.rgbaFromHex(color, 0.8);
                ctx.lineWidth = 3;
            }

            // Dibujar polígono (trasladar coordenadas relativas al canvas)
            ctx.beginPath();
            area.vertices.forEach((v, i) => {
                const x = v.x - minX + 5;
                const y = v.y - minY + 5;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.closePath();
            ctx.fill();
            if (area.showBorder !== false) ctx.stroke();

            console.log(`📐 Polígono con ${area.vertices.length} vértices creado en Canvas (${canvas.width}x${canvas.height})`);

        } else if (area.width && area.height) {
            // RECTÁNGULO
            bounds = { minX: area.x || 0, minY: area.y || 0, width: area.width, height: area.height };

            canvas = document.createElement('canvas');
            canvas.width = area.width + 10;
            canvas.height = area.height + 10;
            ctx = canvas.getContext('2d');

            ctx.fillStyle = this.rgbaFromHex(color, alpha);
            ctx.fillRect(5, 5, area.width, area.height);

            if (area.showBorder !== false) {
                ctx.strokeStyle = this.rgbaFromHex(color, 0.8);
                ctx.lineWidth = 2;
                ctx.strokeRect(5, 5, area.width, area.height);
            }

            console.log(`📐 Rectángulo ${area.width}x${area.height} creado en Canvas`);
        } else {
            console.error(`❌ Área sin formato válido (necesita vertices[] o width/height):`, area);
            return;
        }

        // Convertir Canvas a Textura de PixiJS (MUCHO más eficiente que generateTexture)
        const texture = PIXI.Texture.from(canvas);

        // Crear Sprite con la textura
        const sprite = new PIXI.Sprite(texture);
        sprite.x = bounds.minX - 5;
        sprite.y = bounds.minY - 5;

        // Hacer NO interactivo (crítico para rendimiento)
        sprite.eventMode = 'none';
        sprite.interactiveChildren = false;

        // Guardar referencia
        this.backgroundAreas.set(area, sprite);

        // Agregar a la capa de background
        this.scene.getLayer('background').addChild(sprite);

        console.log(`✅ Área "${area.label || 'sin nombre'}" renderizada con Canvas HTML5 (método ultra-optimizado)`);
    }

    /**
     * Dibuja un polígono basado en vértices
     * @param {PIXI.Graphics} graphics - Graphics donde dibujar
     * @param {Array} vertices - Array de {x, y} con las coordenadas de los vértices
     * @param {number} color - Color en formato 0xRRGGBB
     * @param {number} alpha - Opacidad (0-1)
     * @param {boolean} showBorder - Si mostrar borde o no
     */
    drawPolygon(graphics, vertices, color, alpha, showBorder) {
        if (vertices.length < 3) {
            console.error('❌ Polígono necesita al menos 3 vértices');
            return;
        }

        // Crear array plano de coordenadas para PixiJS: [x1, y1, x2, y2, ...]
        const points = [];
        vertices.forEach(v => {
            points.push(v.x, v.y);
        });

        // Dibujar relleno
        graphics.beginFill(color, alpha);
        graphics.drawPolygon(points);
        graphics.endFill();

        // Dibujar borde opcional
        if (showBorder) {
            graphics.lineStyle(3, color, 0.8);
            graphics.drawPolygon(points);
        }
    }

    /**
     * Agrega un label de texto al área (opcional, para debugging)
     * @param {PIXI.Graphics} graphics - Graphics donde agregar el label
     * @param {Object} area - Datos del área
     */
    addLabel(graphics, area) {
        if (!area.showLabel) return; // Solo mostrar si está explícitamente activado

        // Calcular centro del polígono o usar centro del rectángulo
        let centerX, centerY;

        if (area.vertices && area.vertices.length > 0) {
            // Centro del polígono (promedio de vértices)
            centerX = area.vertices.reduce((sum, v) => sum + v.x, 0) / area.vertices.length;
            centerY = area.vertices.reduce((sum, v) => sum + v.y, 0) / area.vertices.length;
        } else {
            // Centro del rectángulo
            centerX = area.width / 2;
            centerY = area.height / 2;
        }

        const text = new PIXI.Text(area.label, {
            fontFamily: 'Arial',
            fontSize: 24,
            fill: 0x000000,
            align: 'center',
            fontWeight: 'bold',
            stroke: 0xFFFFFF,
            strokeThickness: 4
        });

        text.anchor.set(0.5);
        text.resolution = 2;
        text.x = centerX;
        text.y = centerY;
        text.alpha = 0.5; // Semi-transparente

        graphics.addChild(text);
    }

    /**
     * Parsea un color de string/number a número hexadecimal
     * @param {string|number} color - Color en formato "#RRGGBB" o 0xRRGGBB
     * @returns {number} Color en formato 0xRRGGBB
     */
    parseColor(color) {
        if (typeof color === 'number') {
            return color;
        }

        if (typeof color === 'string') {
            // Remover el # si existe
            let hex = color.replace('#', '');

            // Si tiene 8 caracteres (incluye alpha), tomar solo los 6 primeros (RGB)
            if (hex.length === 8) {
                hex = hex.substring(0, 6);
            }

            return parseInt('0x' + hex);
        }

        // Color por defecto (beige)
        return 0xFFE4B5;
    }

    /**
     * Convierte un color hexadecimal a formato rgba() para Canvas
     * @param {number} hexColor - Color en formato 0xRRGGBB
     * @param {number} alpha - Opacidad (0-1)
     * @returns {string} Color en formato "rgba(r, g, b, a)"
     */
    rgbaFromHex(hexColor, alpha) {
        const r = (hexColor >> 16) & 0xFF;
        const g = (hexColor >> 8) & 0xFF;
        const b = hexColor & 0xFF;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    /**
     * Limpia todas las áreas de fondo
     */
    clearAll() {
        this.backgroundAreas.forEach((sprite, area) => {
            // Destruir textura y sprite
            if (sprite.texture) {
                sprite.texture.destroy(true);
            }
            sprite.destroy({ children: true, texture: true, baseTexture: true });
        });
        this.backgroundAreas.clear();
        console.log('🗑️ Áreas de fondo limpiadas');
    }

    /**
     * Remueve un área específica
     * @param {Object} area - Área a remover
     */
    removeArea(area) {
        const sprite = this.backgroundAreas.get(area);
        if (sprite) {
            // Destruir textura y sprite
            if (sprite.texture) {
                sprite.texture.destroy(true);
            }
            sprite.destroy({ children: true, texture: true, baseTexture: true });
            this.backgroundAreas.delete(area);
        }
    }
}

// Exponer globalmente
window.BackgroundAreaRenderer = BackgroundAreaRenderer;
console.log('✓ BackgroundAreaRenderer cargado');
