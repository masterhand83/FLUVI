// World-space Bezier geometry for map-constructor streets.
(function (root) {
    const cache = new WeakMap();
    const cellSize = () => root.celda_tamano || 5;
    const api = {
        isBezier(street) {
            return !!street && (Array.isArray(street.bezierSegments) || Array.isArray(street.bezierControls));
        },
        segments(street) {
            if (Array.isArray(street.bezierSegments)) return street.bezierSegments.map(section => ({
                controls: section.controls.map(copyPoint), end: copyPoint(section.end)
            }));
            return [{ controls: (street.bezierControls || []).map(copyPoint), end: endPoint(street) }];
        },
        point(street, t) {
            const sections = api.segments(street);
            const u = Math.max(0, Math.min(1, t));
            const scaled = u * sections.length;
            const section = Math.min(sections.length - 1, Math.floor(scaled));
            const start = section ? sections[section - 1].end : { x: street.x, y: street.y };
            return evaluate([start, ...sections[section].controls, sections[section].end], scaled - section);
        },
        splitSegment(street, sectionIndex, t = 0.5) {
            const sections = api.segments(street);
            if (!Number.isInteger(sectionIndex) || sectionIndex < 0 || sectionIndex >= sections.length ||
                !Number.isFinite(t) || t <= 0 || t >= 1) throw new RangeError('Invalid Bezier split');
            const section = sections[sectionIndex];
            const start = sectionIndex ? sections[sectionIndex - 1].end : { x: street.x, y: street.y };
            const levels = [[start, ...section.controls, section.end]];
            while (levels.at(-1).length > 1) {
                const previous = levels.at(-1);
                levels.push(previous.slice(1).map((point, i) => interpolate(previous[i], point, t)));
            }
            const left = levels.slice(1).map(level => level[0]);
            const right = levels.slice(1, -1).reverse().map(level => level.at(-1));
            sections.splice(sectionIndex, 1,
                { controls: left.slice(0, -1), end: copyPoint(levels.at(-1)[0]) },
                { controls: right, end: copyPoint(section.end) });
            return sections;
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
            if (!validControls(street)) {
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
            if (hasLaneOverlap(lanes, cellSize() * 0.5, geometry.seams, street.carriles)) {
                return { valid: false, cells, length, reason: 'folded-lane-overlap' };
            }
            return { valid: true, cells, length, reason: null };
        }
    };

    function copyPoint(p) { return { x: p.x, y: p.y }; }
    function finitePoint(p) { return !!p && Number.isFinite(p.x) && Number.isFinite(p.y); }
    function samePoint(a, b) { return a.x === b.x && a.y === b.y; }
    function validControls(street) {
        if (!street || !Number.isFinite(street.x) || !Number.isFinite(street.y) || !api.isBezier(street)) return false;
        if (!Array.isArray(street.bezierSegments))
            return street.bezierControls.every(finitePoint) && finitePoint(endPoint(street));
        return street.bezierSegments.length > 0 &&
            street.bezierSegments.every(s => s && Array.isArray(s.controls) && s.controls.every(finitePoint) && finitePoint(s.end)) &&
            Number.isFinite(street.endX) && Number.isFinite(street.endY) &&
            samePoint(street.bezierSegments.at(-1).end, { x: street.endX, y: street.endY });
    }
    function interpolate(a, b, t) { return { x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t }; }
    function evaluate(points, t) {
        while (points.length > 1) points = points.slice(1).map((p, i) => interpolate(points[i], p, t));
        return points[0];
    }

    function endPoint(street) {
        if (Number.isFinite(street.endX) && Number.isFinite(street.endY)) return { x: street.endX, y: street.endY };
        const distance = (street.tamano || 0) * cellSize(), angle = -(street.angulo || 0) * Math.PI / 180;
        return { x: street.x + Math.cos(angle) * distance, y: street.y + Math.sin(angle) * distance };
    }
    function geometryFor(street) {
        const old = cache.get(street);
        const signature = `${street.x},${street.y},${street.endX},${street.endY},${street.tamano},${street.angulo},${cellSize()},${JSON.stringify(street.bezierSegments || street.bezierControls)}`;
        if (old && old.signature === signature) return old;
        // Sample by control-polygon scale rather than stale tamano. Eight
        // subdivisions per physical cell keep long curves accurate too.
        const sections = api.segments(street);
        const samples = [];
        const seams = [];
        let length = 0;
        for (let section = 0; section < sections.length; section++) {
            const start = section ? sections[section - 1].end : { x: street.x, y: street.y };
            length = sampleSection([start, ...sections[section].controls, sections[section].end], length, samples);
            if (section < sections.length - 1) seams.push(length);
        }
        const result = { signature, samples, length, seams };
        cache.set(street, result);
        return result;
    }
    function sampleSection(points, initialLength, samples) {
        const controlLength = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
        const count = Math.min(100000, Math.max(256, Math.ceil((controlLength / cellSize()) * 8)));
        let length = initialLength, previous;
        for (let i = 0; i <= count; i++) {
            const p = evaluate(points, i / count);
            if (previous) length += Math.hypot(p.x - previous.x, p.y - previous.y);
            // Never take a tangent across a C0 join: each side has its own angle.
            const neighbor = evaluate(points, (i === count ? i - 1 : i + 1) / count);
            const dx = i === count ? p.x - neighbor.x : neighbor.x - p.x;
            const dy = i === count ? p.y - neighbor.y : neighbor.y - p.y;
            samples.push({ ...p, distance: length, angle: Math.atan2(-dy, dx) * 180 / Math.PI });
            previous = p;
        }
        return length;
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
        return { x, y, angle: b.distance === a.distance ? b.angle : a.angle };
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
    function hasLaneOverlap(lanes, tolerance, seams = [], laneCount = 1) {
        const spatialIndex = createSpatialIndex(Math.max(tolerance * 2, cellSize()), tolerance);
        const segments = [];
        for (let lane = 0; lane < lanes.length; lane++) {
            for (let index = 0; index < lanes[lane].length - 1; index++) {
                const segment = { a: lanes[lane][index], b: lanes[lane][index + 1], lane, index };
                if (hasCollisionCandidate(segment, segments, spatialIndex.candidates(segment), tolerance, seams, laneCount)) return true;
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
    function hasCollisionCandidate(segment, segments, candidateIds, tolerance, seams, laneCount) {
        for (const id of candidateIds) {
            const other = segments[id];
            // Adjacent segments in one lane legitimately share an endpoint.
            if (other.lane === segment.lane && Math.abs(other.index - segment.index) <= 1) continue;
            // Offset centerlines can meet themselves or another lane locally at
            // a corner. Nonlocal self-overlap is still rejected as a fold.
            if (localCornerCollision(segment, other, seams, laneCount)) continue;
            if (segmentsOverlap(segment.a, segment.b, other.a, other.b) ||
                segmentsWithin(segment.a, segment.b, other.a, other.b, tolerance)) return true;
        }
        return false;
    }
    function localCornerCollision(a, b, seams, laneCount) {
        const radius = laneCount * cellSize();
        return Math.abs(a.index - b.index) <= laneCount * 2 && seams.some(seam =>
            Math.abs((a.index + 1) * cellSize() - seam) <= radius &&
            Math.abs((b.index + 1) * cellSize() - seam) <= radius);
    }
    root.streetBezier = api;
})(window);
