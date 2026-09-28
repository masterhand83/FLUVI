// Spatial lookup for cell centers. Classic script; load after curvas.js, before
// any runtime lookup (trafico.js may be loaded either before or after this).
(function (root) {
    const indexedStreets = new Map();
    let buckets = new Map();
    let size = 0;

    function signature(street) {
        // Include contents, not just array identity: editor handles and JSON loading
        // can modify points directly without calling invalidate().
        return [street.x, street.y, street.angulo, street.tamano, street.carriles,
            street.esCurva, street.endX, street.endY, street.bezierGeometry,
            (street.vertices || []).map(v => `${v.indiceCelda},${v.anguloOffset}`).join(';'),
            (street.bezierControls || []).map(p => `${p.x},${p.y}`).join(';')].join('|');
    }

    function key(x, y) { return `${x},${y}`; }

    function remove(calle) {
        const record = indexedStreets.get(calle);
        if (!record) return;
        for (const bucketKey of record.keys) {
            const remaining = buckets.get(bucketKey).filter(candidate => candidate.calle !== calle);
            if (remaining.length) buckets.set(bucketKey, remaining);
            else buckets.delete(bucketKey);
        }
        indexedStreets.delete(calle);
    }

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Bucketing retains the same curved/straight dispatch and finite-coordinate guard as hit-testing.
    function add(calle, currentSignature, cellSize) {
        const keys = new Set();
        const entries = [];
        for (let carril = 0; carril < calle.carriles; carril++) {
            for (let indice = 0; indice < calle.tamano; indice++) {
                // Match encontrarCeldaMasCercana's historical curve dispatch.
                const curved = calle.esCurva && (calle.bezierControls || (calle.vertices && calle.vertices.length > 0));
                const center = curved
                    ? root.obtenerCoordenadasGlobalesCeldaConCurva(calle, carril, indice)
                    : root.obtenerCoordenadasGlobalesCelda(calle, carril, indice);
                if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) continue;
                const bucketKey = key(Math.floor(center.x / cellSize), Math.floor(center.y / cellSize));
                keys.add(bucketKey);
                entries.push({ bucketKey, x: center.x, y: center.y, calle, carril, indice });
            }
        }
        // Do not publish partially generated geometry if coordinate calculation fails.
        for (const entry of entries) {
            if (!buckets.has(entry.bucketKey)) buckets.set(entry.bucketKey, []);
            buckets.get(entry.bucketKey).push(entry);
        }
        indexedStreets.set(calle, { signature: currentSignature, keys });
    }

    function sync(list, cellSize) {
        if (size !== cellSize) {
            buckets = new Map();
            indexedStreets.clear();
            size = cellSize;
        }
        const active = new Set(list);
        for (const calle of indexedStreets.keys()) if (!active.has(calle)) remove(calle);
        for (const calle of list) {
            const currentSignature = signature(calle);
            const old = indexedStreets.get(calle);
            if (old?.signature === currentSignature) continue;
            if (old) remove(calle);
            add(calle, currentSignature, cellSize);
        }
    }

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Exact nearest-cell tie order must be preserved across nine spatial bins.
    function findNearest(worldX, worldY, list = root.calles) {
        const cellSize = root.celda_tamano;
        if (!Array.isArray(list) || !(cellSize > 0) || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
        sync(list, cellSize);
        const order = new Map(list.map((calle, i) => [calle, i]));
        const gridX = Math.floor(worldX / cellSize);
        const gridY = Math.floor(worldY / cellSize);
        const limit = cellSize * cellSize;
        let best = null;
        let bestDistance = limit;
        // A point closer than one cell width can only lie in these nine bins.
        for (let x = gridX - 1; x <= gridX + 1; x++) {
            for (let y = gridY - 1; y <= gridY + 1; y++) {
                for (const candidate of buckets.get(key(x, y)) || []) {
                    const dx = worldX - candidate.x;
                    const dy = worldY - candidate.y;
                    const distance = dx * dx + dy * dy;
                    if (distance < bestDistance || (distance === bestDistance && best &&
                        (order.get(candidate.calle) < order.get(best.calle) ||
                         (candidate.calle === best.calle && (candidate.carril < best.carril ||
                          (candidate.carril === best.carril && candidate.indice < best.indice)))))) {
                        best = candidate;
                        bestDistance = distance;
                    }
                }
            }
        }
        return best ? { calle: best.calle, carril: best.carril, indice: best.indice, calleIndex: order.get(best.calle) } : null;
    }

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Nine-bin query preserves exact distance threshold for topmost curved-street selection.
    function nearbyStreets(worldX, worldY, list = root.calles) {
        const cellSize = root.celda_tamano;
        const result = new Set();
        if (!Array.isArray(list) || !(cellSize > 0) || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return result;
        sync(list, cellSize);
        const gridX = Math.floor(worldX / cellSize);
        const gridY = Math.floor(worldY / cellSize);
        for (let x = gridX - 1; x <= gridX + 1; x++) {
            for (let y = gridY - 1; y <= gridY + 1; y++) {
                for (const candidate of buckets.get(key(x, y)) || []) {
                    const dx = worldX - candidate.x, dy = worldY - candidate.y;
                    if (dx * dx + dy * dy < cellSize * cellSize) result.add(candidate.calle);
                }
            }
        }
        return result;
    }

    function invalidate(calle) {
        if (calle) {
            const record = indexedStreets.get(calle);
            if (record) record.signature = null;
        } else {
            for (const record of indexedStreets.values()) record.signature = null;
        }
        if (calle && root.invalidarGeometriaCurva) root.invalidarGeometriaCurva(calle);
    }

    root.cellGeometryIndex = { findNearest, nearbyStreets, invalidate };
})(window);
