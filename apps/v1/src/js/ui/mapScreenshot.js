// Captura PNG del mapa recortada al contenido real: calles, edificios e
// imagen de referencia. No usa la vista actual de la cámara, así que el mapa
// completo sale centrado aunque el usuario esté haciendo zoom o paneo.
(() => {
    const DEFAULT_MAX_DIMENSION = 2400;
    const DEFAULT_PADDING = 12;
    const MAX_EXPORT_SCALE = 8;

    const text = (key, options) => typeof window.tr === 'function' ? window.tr(key, options) : key;

    function emptyBounds() {
        return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    }

    function includePoint(bounds, x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        bounds.minX = Math.min(bounds.minX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxX = Math.max(bounds.maxX, x);
        bounds.maxY = Math.max(bounds.maxY, y);
    }

    function includeBounds(bounds, other) {
        if (!other) return;
        includePoint(bounds, other.minX, other.minY);
        includePoint(bounds, other.maxX, other.maxY);
    }

    // Rectángulo centrado en (cx, cy) y girado como lo dibujan ambos motores.
    function includeRotatedRect(bounds, cx, cy, width, height, angleDegrees) {
        const safeWidth = Math.abs(Number(width) || 0);
        const safeHeight = Math.abs(Number(height) || 0);
        if (!(safeWidth > 0) || !(safeHeight > 0)) return;
        const radians = (Number(angleDegrees) || 0) * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const halfWidth = safeWidth / 2;
        const halfHeight = safeHeight / 2;
        for (const [dx, dy] of [
            [-halfWidth, -halfHeight],
            [halfWidth, -halfHeight],
            [-halfWidth, halfHeight],
            [halfWidth, halfHeight]
        ]) {
            includePoint(bounds, cx + dx * cos - dy * sin, cy + dx * sin + dy * cos);
        }
    }

    function includeStreetCells(bounds, calle, lanes, cells, cellSize) {
        if (typeof window.obtenerCoordenadasGlobalesCeldaConCurva !== 'function') return false;
        try {
            // El centro de cada celda más el tamaño de celda cubre el ancho
            // de la calle y las curvas/Bézier sin depender del renderizador.
            for (let lane = 0; lane < lanes; lane++) {
                for (let index = 0; index < cells; index++) {
                    const point = window.obtenerCoordenadasGlobalesCeldaConCurva(calle, lane, index);
                    if (!point) continue;
                    includePoint(bounds, point.x - cellSize, point.y - cellSize);
                    includePoint(bounds, point.x + cellSize, point.y + cellSize);
                }
            }
            return true;
        } catch {
            return false;
        }
    }

    function includeRectangularStreet(bounds, calle, lanes, cells, cellSize) {
        const radians = -(Number(calle.angulo) || 0) * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const width = cells * cellSize;
        const height = lanes * cellSize;
        const originX = Number(calle.x) || 0;
        const originY = Number(calle.y) || 0;
        for (const [localX, localY] of [[0, 0], [width, 0], [0, height], [width, height]]) {
            includePoint(bounds, originX + localX * cos - localY * sin, originY + localX * sin + localY * cos);
        }
    }

    function includeRoundaboutStreet(bounds, calle) {
        if (calle.geometryType !== 'roundabout' || !window.roundaboutStreet?.bounds) return false;
        try {
            includeBounds(bounds, window.roundaboutStreet.bounds(calle));
            return true;
        } catch {
            return false;
        }
    }

    function includeStreet(bounds, calle) {
        if (!calle) return false;
        if (includeRoundaboutStreet(bounds, calle)) return true;
        const cellSize = Number(window.celda_tamano) || 5;
        const lanes = Math.max(0, Number(calle.carriles) || 0);
        const cells = Math.max(0, Number(calle.tamano) || 0);
        const curved = Boolean(calle.esCurva || calle.bezierControls);
        if (curved && lanes > 0 && cells > 0 && includeStreetCells(bounds, calle, lanes, cells, cellSize)) {
            return true;
        }
        includeRectangularStreet(bounds, calle, lanes, cells, cellSize);
        return true;
    }

    function includeBuilding(bounds, edificio) {
        if (!edificio) return false;
        if (edificio.geometryType === 'polygon') {
            const vertices = Array.isArray(edificio.vertices) ? edificio.vertices : [];
            for (const point of vertices) includePoint(bounds, Number(point?.x), Number(point?.y));
            return vertices.length > 0;
        }
        includeRotatedRect(
            bounds,
            Number(edificio.x) || 0,
            Number(edificio.y) || 0,
            Number(edificio.width) || 100,
            Number(edificio.height) || 100,
            Number(edificio.angle) || 0
        );
        return true;
    }

    function includeReferenceImage(bounds) {
        const reference = window.referenceImage;
        if (!reference || reference.visible === false) return false;
        const width = Number(reference.width) || 0;
        const height = Number(reference.height) || 0;
        if (!(width > 0) || !(height > 0)) return false;
        const x = Number(reference.x) || 0;
        const y = Number(reference.y) || 0;
        includeRotatedRect(bounds, x + width / 2, y + height / 2, width, height, Number(reference.rotation) || 0);
        return true;
    }

    function boundsContent({ padding = DEFAULT_PADDING } = {}) {
        const bounds = emptyBounds();
        let hasContent = false;
        for (const calle of window.calles || []) hasContent = includeStreet(bounds, calle) || hasContent;
        for (const edificio of window.edificios || []) hasContent = includeBuilding(bounds, edificio) || hasContent;
        hasContent = includeReferenceImage(bounds) || hasContent;
        if (!hasContent || !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) return null;

        const safePadding = Math.max(0, Number(padding) || 0);
        return {
            minX: bounds.minX - safePadding,
            minY: bounds.minY - safePadding,
            maxX: bounds.maxX + safePadding,
            maxY: bounds.maxY + safePadding
        };
    }

    function exportViewport(bounds, maxDimension = DEFAULT_MAX_DIMENSION) {
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;
        if (!(width > 0) || !(height > 0)) {
            throw new Error('El contenido del mapa no tiene dimensiones para capturar');
        }
        const scale = Math.min(Number(maxDimension) / Math.max(width, height), MAX_EXPORT_SCALE);
        const pixelWidth = Math.max(1, Math.round(width * scale));
        const pixelHeight = Math.max(1, Math.round(height * scale));
        return {
            scale,
            width: pixelWidth,
            height: pixelHeight,
            offsetX: -bounds.minX * scale,
            offsetY: -bounds.minY * scale
        };
    }

    function backgroundCss() {
        try {
            return window.mapBackgroundCycle?.getBackgroundColorCss?.() || '#c6cbcd';
        } catch {
            return '#c6cbcd';
        }
    }

    function backgroundNumber() {
        try {
            const color = window.mapBackgroundCycle?.getBackgroundColor?.();
            if (Number.isFinite(color)) return color;
        } catch {
            // Usa el color CSS de respaldo.
        }
        return Number.parseInt(backgroundCss().replace('#', ''), 16) || 0xc6cbcd;
    }

    function pixiCaptureContext() {
        const pixi = window.pixiApp;
        const app = pixi?.app;
        const renderer = app?.renderer;
        const camera = pixi?.cameraController;
        const scene = pixi?.sceneManager;
        if (!window.USE_PIXI || !renderer?.extract || !camera || !scene) return null;
        if (!window.PIXI?.RenderTexture?.create) return null;
        return { pixi, app, renderer, camera, scene };
    }

    function captureWithPixi(context, bounds, viewport) {
        const { app, renderer, camera, scene } = context;
        const previous = { scale: camera.scale, offsetX: camera.offsetX, offsetY: camera.offsetY };
        let texture = null;
        let background = null;
        try {
            texture = window.PIXI.RenderTexture.create({
                width: viewport.width,
                height: viewport.height,
                resolution: 1
            });
            // El RenderTexture se limpia a transparente. Sin este fondo, los
            // píxeles semitransparentes de la imagen de referencia se mezclan
            // con negro y pierden su color antes de extraer la captura.
            background = new window.PIXI.Graphics();
            background.beginFill(backgroundNumber(), 1);
            background.drawRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
            background.endFill();
            background.zIndex = -1;
            scene.mainContainer.addChild(background);
            // La captura puede ejecutarse antes del siguiente frame de Pixi.
            // Sincroniza tamaño, rotación, opacidad y visibilidad actuales.
            scene.referenceImageRenderer?.render?.();

            camera.scale = viewport.scale;
            camera.offsetX = viewport.offsetX;
            camera.offsetY = viewport.offsetY;
            camera.applyTransform();
            camera.updateGlobals();

            renderer.render(app.stage, { renderTexture: texture, clear: true });
            const rendered = renderer.extract.canvas(texture);
            const output = document.createElement('canvas');
            output.width = viewport.width;
            output.height = viewport.height;
            const outputContext = output.getContext('2d');
            outputContext.fillStyle = backgroundCss();
            outputContext.fillRect(0, 0, output.width, output.height);
            outputContext.drawImage(rendered, 0, 0, output.width, output.height);
            return output;
        } finally {
            if (background) {
                scene.mainContainer.removeChild(background);
                background.destroy();
            }
            texture?.destroy(true);
            camera.scale = previous.scale;
            camera.offsetX = previous.offsetX;
            camera.offsetY = previous.offsetY;
            camera.applyTransform();
            camera.updateGlobals();
            try {
                renderer.render(app.stage);
            } catch {
                // La siguiente actualización del ticker restaurará la vista.
            }
        }
    }

    function captureWithCanvas(viewport) {
        if (typeof window.dibujarMapaEnCanvas !== 'function') {
            throw new Error('El renderizador Canvas 2D no está disponible para la captura');
        }
        const output = document.createElement('canvas');
        output.width = viewport.width;
        output.height = viewport.height;
        window.dibujarMapaEnCanvas(output, {
            escala: viewport.scale,
            offsetX: viewport.offsetX,
            offsetY: viewport.offsetY
        });
        return output;
    }

    function capture(options = {}) {
        const bounds = boundsContent({
            padding: options.padding === undefined ? DEFAULT_PADDING : options.padding
        });
        if (!bounds) throw new Error(text('notifications.map.screenshotEmpty'));
        const viewport = exportViewport(bounds, options.maxDimension || DEFAULT_MAX_DIMENSION);
        const pixi = pixiCaptureContext();
        return pixi
            ? captureWithPixi(pixi, bounds, viewport)
            : captureWithCanvas(viewport);
    }

    function pngBlob(canvas) {
        return new Promise((resolve, reject) => canvas.toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error('No se pudo generar la imagen PNG')),
            'image/png'
        ));
    }

    function fileName() {
        return `captura_pantalla_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    }

    async function download() {
        const canvas = capture();
        const blob = await pngBlob(canvas);
        const name = fileName();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { canvas, blob, fileName: name };
    }

    async function captureFromButton(button) {
        if (button.disabled) return;
        button.disabled = true;
        try {
            const result = await download();
            window.fluviNotify?.success('notifications.map.screenshotSaved', { file: result.fileName });
        } catch (error) {
            console.error('No se pudo generar la captura de pantalla del mapa:', error);
            const key = !boundsContent() ? 'notifications.map.screenshotEmpty' : 'notifications.map.screenshotFailed';
            window.fluviNotify?.error(key);
        } finally {
            button.disabled = false;
        }
    }

    function wireButton() {
        const button = document.getElementById('btnCapturaPantalla');
        if (button) button.addEventListener('click', () => captureFromButton(button));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireButton, { once: true });
    } else {
        wireButton();
    }

    window.mapScreenshot = Object.freeze({
        bounds: boundsContent,
        capture,
        download,
        fileName
    });
})();
