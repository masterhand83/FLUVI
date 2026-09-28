// Shared, side-effect-free preview and commit boundary for Calle dependents.
(function () {
    function bounds(street, proposed) {
        return {
            tamano: proposed?.tamano ?? proposed?.size ?? street.tamano,
            carriles: proposed?.carriles ?? proposed?.lanes ?? street.carriles
        };
    }

    function mappingValid(link, street, dimensions) {
        if (link.origen === street) {
            const pos = link.posOrigen === -1 ? dimensions.tamano - 1 : link.posOrigen;
            if (!Number.isInteger(link.carrilOrigen) || !Number.isInteger(pos) || link.carrilOrigen < 0 ||
                link.carrilOrigen >= dimensions.carriles || pos < 0 || pos >= dimensions.tamano) return false;
        }
        if (link.destino === street && (!Number.isInteger(link.carrilDestino) || !Number.isInteger(link.posDestino) ||
            link.carrilDestino < 0 || link.carrilDestino >= dimensions.carriles || link.posDestino < 0 || link.posDestino >= dimensions.tamano)) return false;
        return true;
    }

    function parkingEntries(building) {
        const entries = building.conexiones || [];
        const ins = entries.filter(entry => entry.tipo === 'entrada');
        const outs = entries.filter(entry => entry.tipo === 'salida');
        return Array.from({ length: Math.min(ins.length, outs.length) }, (_, i) => [ins[i], outs[i]]);
    }

    function inspect(street, proposed) {
        const dimensions = bounds(street, proposed);
        const all = window.conexiones || [];
        const affected = all.filter(link => link.origen === street || link.destino === street);
        const survivingConnections = affected.filter(link => mappingValid(link, street, dimensions));
        const lostConnections = affected.filter(link => !mappingValid(link, street, dimensions));
        const buildings = window.edificios || [];
        const parkingPairs = buildings.flatMap(building => parkingEntries(building).map(pair => ({ building, pair }))
            .filter(({ pair }) => pair.some(entry => window.calles?.find(s => s.id === entry.calleId || s.nombre === entry.calleId) === street)));
        const survivingParkingPairs = parkingPairs.filter(({ pair }) => pair.every(entry => {
            const linked = window.calles?.find(s => s.id === entry.calleId || s.nombre === entry.calleId);
            const d = linked === street ? dimensions : linked;
            return linked && Number.isInteger(entry.carril) && Number.isInteger(entry.indice) && entry.carril >= 0 && entry.carril < d.carriles && entry.indice >= 0 && entry.indice < d.tamano;
        }));
        const lostParkingPairs = parkingPairs.filter(record => !survivingParkingPairs.includes(record));
        const marks = window.estadoEscenarios?.celdasBloqueadas;
        const scenarioMarkKeys = marks instanceof Map ? [...marks.keys()].filter(key => {
            const [id, lane, index] = key.split(':');
            return (id === String(street.id) || id === String(street.nombre)) && Number.isInteger(+lane) && Number.isInteger(+index);
        }) : [];
        const survivingScenarioMarkKeys = scenarioMarkKeys.filter(key => {
            const [, lane, index] = key.split(':');
            return +lane >= 0 && +lane < dimensions.carriles && +index >= 0 && +index < dimensions.tamano;
        });
        const lostScenarioMarkKeys = scenarioMarkKeys.filter(key => !survivingScenarioMarkKeys.includes(key));
        return { survivingConnections, lostConnections, parkingPairs: survivingParkingPairs, lostParkingPairs,
            survivingScenarioMarkKeys, lostScenarioMarkKeys,
            counts: { survivingConnections: survivingConnections.length, lostConnections: lostConnections.length,
                survivingParkingPairs: survivingParkingPairs.length, lostParkingPairs: lostParkingPairs.length,
                survivingScenarioMarks: survivingScenarioMarkKeys.length, lostScenarioMarks: lostScenarioMarkKeys.length } };
    }

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Atomic reconciliation joins indexed links, paired parking entries, waiting flags and active marks in one commit boundary.
    function commit(street, proposed) {
        const preview = inspect(street, proposed);
        const { tamano, carriles } = bounds(street, proposed);
        const oldLastCell = street.tamano - 1;
        const previousCells = street.arreglo || [], previousWaiting = street.celulasEsperando || [], previousVertices = street.vertices || [];
        street.tamano = tamano; street.carriles = carriles;
        street.arreglo = Array.from({ length: carriles }, (_, lane) => Array.from({ length: tamano }, (_, cell) => previousCells[lane]?.[cell] ?? 0));
        if (street.celulasEsperando) street.celulasEsperando = Array.from({ length: carriles }, (_, lane) => Array.from({ length: tamano }, (_, cell) => previousWaiting[lane]?.[cell] ?? false));
        if (previousVertices.length) street.vertices = Array.from({ length: tamano }, (_, index) => previousVertices[index] ? { ...previousVertices[index], indice: index } : { indice: index, angulo: 0 });
        const links = window.conexiones || [];
        for (const lost of preview.lostConnections) {
            const index = links.indexOf(lost);
            if (index !== -1) links.splice(index, 1);
        }
        for (const road of window.calles || []) road.conexionesSalida = Array.from({ length: road.carriles }, (_, lane) => links.filter(link => link.origen === road && link.carrilOrigen === lane));
        // A waiting flag belongs to the old effective end, not to the cell
        // that happens to inherit its numeric index after a resize.
        if (oldLastCell !== tamano - 1 && oldLastCell < tamano) {
            for (let lane = 0; lane < carriles; lane++) {
                if (preview.survivingConnections.some(link => link.origen === street && link.carrilOrigen === lane && link.posOrigen === -1) &&
                    !street.conexionesSalida[lane].some(link => link.posOrigen === oldLastCell)) {
                    if (street.celulasEsperando?.[lane]) street.celulasEsperando[lane][oldLastCell] = false;
                }
            }
        }
        for (const lost of preview.lostConnections) {
            const origin = lost.origen, pos = lost.posOrigen === -1 ? origin.tamano - 1 : lost.posOrigen;
            if (origin.celulasEsperando?.[lost.carrilOrigen]?.[pos] !== undefined &&
                !origin.conexionesSalida[lost.carrilOrigen].some(link => (link.posOrigen === -1 ? origin.tamano - 1 : link.posOrigen) === pos)) origin.celulasEsperando[lost.carrilOrigen][pos] = false;
        }
        for (const key of preview.lostScenarioMarkKeys) window.estadoEscenarios.celdasBloqueadas.delete(key);
        for (const road of window.calles || []) road.conexionesEstacionamiento?.clear();
        for (const building of window.edificios || []) {
            const records = parkingEntries(building);
            const survivors = records.filter(record => !preview.lostParkingPairs.some(lost => lost.building === building && lost.pair[0] === record[0] && lost.pair[1] === record[1]));
            if ((building.conexiones || []).some(entry => (window.calles || []).find(road => road.id === entry.calleId || road.nombre === entry.calleId) === street)) {
                building.conexiones = survivors.flat();
                if (!survivors.length) building.esEstacionamiento = false;
            }
            for (const entry of building.conexiones || []) {
                const road = (window.calles || []).find(item => item.id === entry.calleId || item.nombre === entry.calleId);
                if (!road) continue;
                road.conexionesEstacionamiento ||= new Map();
                road.conexionesEstacionamiento.set(`${entry.carril}-${entry.indice}`, { tipo: entry.tipo, edificioId: building.id, edificio: building, carril: entry.carril, indice: entry.indice });
            }
        }
        if (window.cellGeometryIndex?.invalidate) window.cellGeometryIndex.invalidate(street);
        if (window.inicializarIntersecciones) window.inicializarIntersecciones();
        if (window.construirMapaIntersecciones) window.construirMapaIntersecciones();
        return preview;
    }
    window.streetDependentPreview = { inspect, commit };
})();
