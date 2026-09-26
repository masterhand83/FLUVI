// World-space Bezier geometry for map-constructor streets.
(function (root) {
    const cache = new WeakMap();
    const cellSize = () => root.celda_tamano || 5;
    const api = {
        point(street, t) {
            const points = [{ x: street.x, y: street.y }, ...(street.bezierControls || []), endPoint(street)];
            const u = Math.max(0, Math.min(1, t));
            while (points.length > 1) {
                for (let i = 0; i < points.length - 1; i++) {
                    points[i] = { x: points[i].x * (1 - u) + points[i + 1].x * u, y: points[i].y * (1 - u) + points[i + 1].y * u };
                }
                points.pop();
            }
            return points[0];
        },
        coordinates(street, lane, index) {
            const geometry = geometryFor(street);
            const target = Math.max(0, (index + 0.5) * cellSize());
            const position = atDistance(geometry.samples, target);
            const offset = (lane - (street.carriles - 1) / 2) * cellSize();
            const radians = -position.angle * Math.PI / 180;
            return { x: position.x - Math.sin(radians) * offset, y: position.y + Math.cos(radians) * offset, angulo: position.angle };
        },
        validate(street) {
            if (!street || !Number.isFinite(street.x) || !Number.isFinite(street.y) || !Array.isArray(street.bezierControls) ||
                !street.bezierControls.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)) ||
                !Number.isFinite(endPoint(street).x) || !Number.isFinite(endPoint(street).y)) {
                return { valid: false, cells: 0, length: 0, reason: 'invalid-controls' };
            }
            const geometry = geometryFor(street);
            const length = geometry.length;
            const spacing = cellSize();
            const cells = Math.round(length / spacing);
            if (!Number.isFinite(street.carriles) || street.carriles < 1) return { valid: false, cells, length, reason: 'invalid-size' };
            if (length < spacing) return { valid: false, cells, length, reason: 'too-short' };
            if (cells > 2500) return { valid: false, cells, length, reason: 'too-long' };

            // Build offset lane centerlines, then use a spatial hash to limit
            // exact segment checks to geometrically nearby candidates.
            const lanes = Array.from({ length: Math.floor(street.carriles) }, (_, lane) => {
                const points = [];
                for (let i = 0; i < cells; i++) points.push(api.coordinates(street, lane, i));
                return points;
            });
            if (hasLaneOverlap(lanes, cellSize() * 0.5)) {
                return { valid: false, cells, length, reason: 'folded-lane-overlap' };
            }
            return { valid: true, cells, length, reason: null };
        }
    };

    function endPoint(street) {
        if (Number.isFinite(street.endX) && Number.isFinite(street.endY)) return { x: street.endX, y: street.endY };
        const distance = (street.tamano || 0) * cellSize(), angle = -(street.angulo || 0) * Math.PI / 180;
        return { x: street.x + Math.cos(angle) * distance, y: street.y + Math.sin(angle) * distance };
    }
    function geometryFor(street) {
        const old = cache.get(street);
        const signature = `${street.x},${street.y},${street.endX},${street.endY},${street.tamano},${street.angulo},${cellSize()},${(street.bezierControls || []).map(p => `${p.x},${p.y}`).join(';')}`;
        if (old && old.signature === signature) return old;
        // Sample by control-polygon scale rather than stale tamano. Eight
        // subdivisions per physical cell keep long curves accurate too.
        const controlPoints = [{ x: street.x, y: street.y }, ...(street.bezierControls || []), endPoint(street)];
        const controlLength = controlPoints.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - controlPoints[i].x, p.y - controlPoints[i].y), 0);
        const count = Math.min(100000, Math.max(256, Math.ceil((controlLength / cellSize()) * 8)));
        const samples = [];
        let length = 0, previous;
        for (let i = 0; i <= count; i++) {
            const p = api.point(street, i / count);
            if (previous) length += Math.hypot(p.x - previous.x, p.y - previous.y);
            samples.push({ ...p, distance: length });
            previous = p;
        }
        const result = { signature, samples, length };
        cache.set(street, result);
        return result;
    }
    function atDistance(samples, target) {
        let lo = 0, hi = samples.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (samples[mid].distance < target) lo = mid + 1;
            else hi = mid;
        }
        const b = samples[lo], a = samples[Math.max(0, lo - 1)];
        const ratio = b.distance === a.distance ? 0 : Math.max(0, Math.min(1, (target - a.distance) / (b.distance - a.distance)));
        const x = a.x + (b.x - a.x) * ratio, y = a.y + (b.y - a.y) * ratio;
        const dx = b.x - a.x, dy = b.y - a.y;
        return { x, y, angle: Math.atan2(-dy, dx) * 180 / Math.PI };
    }
    function segmentsOverlap(a, b, c, d) {
        const eps = 1e-7;
        const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
        const on = (p, q, r) => Math.abs(orient(p, q, r)) <= eps && r.x >= Math.min(p.x, q.x) - eps && r.x <= Math.max(p.x, q.x) + eps && r.y >= Math.min(p.y, q.y) - eps && r.y <= Math.max(p.y, q.y) + eps;
        const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
        return (o1 * o2 < 0 && o3 * o4 < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
    }
    function segmentsWithin(a, b, c, d, distance) {
        const pointSegmentDistance = (p, a, b) => {
            const dx = b.x - a.x, dy = b.y - a.y;
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
            return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
        };
        return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b)) < distance;
    }
    function hasLaneOverlap(lanes, tolerance) {
        const spatialIndex = createSpatialIndex(Math.max(tolerance * 2, cellSize()), tolerance);
        const segments = [];
        for (let lane = 0; lane < lanes.length; lane++) {
            for (let index = 0; index < lanes[lane].length - 1; index++) {
                const segment = { a: lanes[lane][index], b: lanes[lane][index + 1], lane, index };
                if (hasCollisionCandidate(segment, segments, spatialIndex.candidates(segment), tolerance)) return true;
                segments.push(segment);
                spatialIndex.insert(segment, segments.length - 1);
            }
        }
        return false;
    }
    function createSpatialIndex(binSize, tolerance) {
        const buckets = new Map();
        const keysFor = (a, b) => {
            const minX = Math.floor((Math.min(a.x, b.x) - tolerance) / binSize);
            const maxX = Math.floor((Math.max(a.x, b.x) + tolerance) / binSize);
            const minY = Math.floor((Math.min(a.y, b.y) - tolerance) / binSize);
            const maxY = Math.floor((Math.max(a.y, b.y) + tolerance) / binSize);
            const keys = [];
            for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) keys.push(`${x},${y}`);
            return keys;
        };
        return {
            candidates(segment) {
                const ids = new Set();
                for (const key of keysFor(segment.a, segment.b)) {
                    const bucket = buckets.get(key);
                    if (bucket) for (const id of bucket) ids.add(id);
                }
                return ids;
            },
            insert(segment, id) {
                for (const key of keysFor(segment.a, segment.b)) {
                    if (!buckets.has(key)) buckets.set(key, []);
                    buckets.get(key).push(id);
                }
            }
        };
    }
    function hasCollisionCandidate(segment, segments, candidateIds, tolerance) {
        for (const id of candidateIds) {
            const other = segments[id];
            // Adjacent segments in one lane legitimately share an endpoint.
            if (other.lane === segment.lane && Math.abs(other.index - segment.index) <= 1) continue;
            if (segmentsOverlap(segment.a, segment.b, other.a, other.b) ||
                segmentsWithin(segment.a, segment.b, other.a, other.b, tolerance)) return true;
        }
        return false;
    }
    root.streetBezier = api;
})(window);
