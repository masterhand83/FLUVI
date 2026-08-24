/**
 * CoordinateConverter.js - Conversión de coordenadas
 * Centraliza toda la lógica de transformación entre espacios de coordenadas
 */

class CoordinateConverter {
    /**
     * Convierte coordenadas de mundo a pantalla
     * @param {number} worldX - Coordenada X en espacio mundo
     * @param {number} worldY - Coordenada Y en espacio mundo
     * @param {CameraController} camera - Controlador de cámara
     * @returns {{x: number, y: number}}
     */
    static worldToScreen(worldX, worldY, camera) {
        return {
            x: worldX * camera.scale + camera.offsetX,
            y: worldY * camera.scale + camera.offsetY
        };
    }

    /**
     * Convierte coordenadas de pantalla a mundo
     * @param {number} screenX - Coordenada X en pantalla
     * @param {number} screenY - Coordenada Y en pantalla
     * @param {CameraController} camera - Controlador de cámara
     * @returns {{x: number, y: number}}
     */
    static screenToWorld(screenX, screenY, camera) {
        return {
            x: (screenX - camera.offsetX) / camera.scale,
            y: (screenY - camera.offsetY) / camera.scale
        };
    }

    /**
     * Convierte ángulo de grados a radianes (con ajuste de sistema de coordenadas)
     * @param {number} degrees - Ángulo en grados
     * @returns {number} Ángulo en radianes
     */
    static degreesToRadians(degrees) {
        return -degrees * Math.PI / 180;
    }

    /**
     * Convierte ángulo de radianes a grados (con ajuste de sistema de coordenadas)
     * @param {number} radians - Ángulo en radianes
     * @returns {number} Ángulo en grados
     */
    static radiansToDegrees(radians) {
        return -radians * 180 / Math.PI;
    }

    /**
     * Calcula bounding box de un rectángulo rotado
     * @param {number} x - Posición X
     * @param {number} y - Posición Y
     * @param {number} width - Ancho
     * @param {number} height - Alto
     * @param {number} angle - Ángulo en grados
     * @returns {{minX, minY, maxX, maxY}}
     */
    static getRotatedBounds(x, y, width, height, angle) {
        const rad = this.degreesToRadians(angle);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const corners = [
            { x: 0, y: 0 },
            { x: width, y: 0 },
            { x: 0, y: height },
            { x: width, y: height }
        ];

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        corners.forEach(corner => {
            const rotX = corner.x * cos - corner.y * sin;
            const rotY = corner.x * sin + corner.y * cos;
            const globalX = x + rotX;
            const globalY = y + rotY;

            minX = Math.min(minX, globalX);
            minY = Math.min(minY, globalY);
            maxX = Math.max(maxX, globalX);
            maxY = Math.max(maxY, globalY);
        });

        return { minX, minY, maxX, maxY };
    }
}

window.CoordinateConverter = CoordinateConverter;
console.log('✓ CoordinateConverter cargado');
