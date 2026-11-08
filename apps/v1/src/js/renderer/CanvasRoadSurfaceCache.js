// Classic-script factory; the Canvas seam owns the single runtime instance.
// Only detached RGBA road rasters are owned here, never overlays or cell state.
window.createCanvasRoadSurfaceCache = function ({
    drawSurface, cellSize, artworkReady,
    createCanvas = () => document.createElement('canvas'),
    budget = 32 * 1024 * 1024
}) {
    const entries = new Map();
    const padding = 2;
    const maxDimension = 8192;
    const maxPixels = 8 * 1024 * 1024;
    let bytes = 0;

    function release(canvas) {
        canvas.width = 0;
        canvas.height = 0;
    }
    function invalidate(street) {
        const entry = entries.get(street);
        if (!entry) return;
        entries.delete(street);
        bytes -= entry.bytes;
        release(entry.canvas);
    }
    function clear() {
        for (const street of entries.keys()) invalidate(street);
    }
    function dimensions(street, size) {
        const width = Math.ceil(street.tamano * size) + padding * 2;
        const height = Math.ceil(street.carriles * size) + padding * 2;
        const cost = width * height * 4;
        if (![street.x, street.y, street.angulo, size, width, height].every(Number.isFinite) ||
            !Number.isInteger(street.tamano) || !Number.isInteger(street.carriles) ||
            size <= 0 || width <= padding * 2 || height <= padding * 2 ||
            width > maxDimension || height > maxDimension || width * height > maxPixels || cost > budget) return null;
        return { width, height, cost };
    }
    function prepare(street, size, signature) {
        const bounds = dimensions(street, size);
        if (!bounds) return null;
        const { width, height, cost } = bounds;
        // Release replacements and LRU victims BEFORE allocating: old + new
        // backing stores must never temporarily exceed the owned budget.
        while (bytes + cost > budget && entries.size) invalidate(entries.keys().next().value);
        let canvas;
        try {
            canvas = createCanvas();
            canvas.width = 0;
            canvas.height = height;
            canvas.width = width;
            const raster = canvas.getContext('2d');
            if (!raster || canvas.width !== width || canvas.height !== height) throw new Error('Raster allocation failed');
            raster.translate(padding, padding);
            drawSurface(raster, { ...street, x: 0, y: 0, angulo: 0 });
        } catch {
            if (canvas) release(canvas);
            return null;
        }
        bytes += cost;
        return { canvas, bytes: cost, signature };
    }
    function draw(context, street) {
        const size = cellSize();
        const signature = [street.x, street.y, street.angulo, street.tamano, street.carriles, size].join('|');
        let entry = entries.get(street);
        const eligible = !street.esCurva && street.geometryType !== 'roundabout' && artworkReady();
        if (entry && (!eligible || entry.signature !== signature)) {
            invalidate(street);
            entry = null;
        }
        if (!eligible) return drawSurface(context, street);
        if (!entry) {
            entry = prepare(street, size, signature);
            if (!entry) return drawSurface(context, street);
        }
        // Map insertion order is recency order; one variant per street.
        entries.delete(street);
        entries.set(street, entry);
        context.save();
        context.translate(street.x, street.y);
        context.rotate(-street.angulo * Math.PI / 180);
        context.drawImage(entry.canvas, -padding, -padding);
        context.restore();
    }
    return { draw, invalidate, clear, get bytes() { return bytes; } };
};
