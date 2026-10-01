// Closed street geometry with clockwise physical indexes; laneDirections
// controls travel direction independently. The center and radii are
// world-space units; sector zero begins at startAngle (degrees from +X).
(function (root) {
    const MAX_CELLS = 2500;

    function isRoundabout(street) { return street?.geometryType === 'roundabout'; }

    function validate(street, cellSize = root.celda_tamano) {
        if (!street || !isRoundabout(street) || street.tipo !== 'conexion' ||
            !Number.isFinite(street.x) || !Number.isFinite(street.y) ||
            !Number.isFinite(street.innerRadius) || !Number.isFinite(street.startAngle) ||
            !Number.isFinite(cellSize) || cellSize <= 0 ||
            !Number.isInteger(street.carriles) || street.carriles < 1 || street.carriles > 10 ||
            street.innerRadius <= 0) return { valid: false, reason: 'Invalid roundabout geometry' };
        const count = sectorCount(street.innerRadius, cellSize);
        return { valid: count >= 3 && count <= MAX_CELLS, cells: count,
            ...(count > MAX_CELLS ? { reason: 'too-long' } : {}) };
    }

    function sectorCount(innerRadius, cellSize) {
        return Math.round(2 * Math.PI * (innerRadius + cellSize / 2) / cellSize);
    }

    function createStreet({ nombre, x, y, innerRadius, startAngle = 0, carriles = 1,
        probabilidadSaltoDeCarril = 0.02 }, cellSize = root.celda_tamano) {
        const street = { id: nombre, nombre, geometryType: 'roundabout', tipo: 'conexion',
            x, y, innerRadius, startAngle, carriles, tamano: sectorCount(innerRadius, cellSize),
            angulo: startAngle, esCurva: false, vertices: [], laneDirections: Array(carriles).fill(1),
            probabilidadGeneracion: 0, probabilidadSaltoDeCarril };
        if (!validate(street, cellSize).valid || !Number.isFinite(probabilidadSaltoDeCarril) ||
            probabilidadSaltoDeCarril < 0 || probabilidadSaltoDeCarril > 1) {
            throw new RangeError('Invalid roundabout geometry or lane-change probability');
        }
        street.arreglo = Array.from({ length: carriles }, () => Array(street.tamano).fill(0));
        street.celulasEsperando = Array.from({ length: carriles }, () => Array(street.tamano).fill(false));
        street.conexionesSalida = Array.from({ length: carriles }, () => []);
        return street;
    }

    function neighbor(street, index, offset = 1) {
        return ((index + offset) % street.tamano + street.tamano) % street.tamano;
    }

    function coordinates(street, lane, index, cellSize = root.celda_tamano) {
        if (!validate(street, cellSize).valid || !Number.isInteger(lane) || lane < 0 || lane >= street.carriles ||
            !Number.isInteger(index) || index < 0 || index >= street.tamano) {
            throw new RangeError('Invalid roundabout cell');
        }
        const angle = (street.startAngle * Math.PI / 180) + 2 * Math.PI * (index + 0.5) / street.tamano;
        const radius = street.innerRadius + (lane + 0.5) * cellSize;
        return { x: street.x + radius * Math.cos(angle), y: street.y + radius * Math.sin(angle),
            angulo: -(angle * 180 / Math.PI + 90) };
    }

    function bounds(street, cellSize = root.celda_tamano) {
        if (!validate(street, cellSize).valid) throw new RangeError('Invalid roundabout geometry');
        const radius = street.innerRadius + street.carriles * cellSize;
        return { minX: street.x - radius, minY: street.y - radius,
            maxX: street.x + radius, maxY: street.y + radius };
    }

    root.roundaboutStreet = { isRoundabout, validate, createStreet, coordinates, bounds, neighbor, sectorCount };
})(window);
