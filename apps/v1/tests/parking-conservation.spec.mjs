import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const core = name => readFileSync(new URL(`../src/js/core/${name}.js`, import.meta.url), 'utf8');
const traffic = core('trafico');

function simulation(direction = 1, lanes = 1, length = 9, roundabout = false) {
    const window = { configuracionTiempo: { horaActual: 12 }, celda_tamano: 10 };
    const math = Object.create(Math);
    math.random = () => 0;
    runInNewContext(`const TIPOS = { GENERADOR: 'generador', CONEXION: 'conexion', DEVORADOR: 'devorador' };
        const TIPOS_CONEXION = { LINEAL: 'lineal', INCORPORACION: 'incorporacion', PROBABILISTICA: 'probabilistica' };
        let buildingInitialMap = false;
        ${core('reglas')}
        ${core('estacionamientos')}
        ${core('roundaboutStreet')}
        ${traffic.slice(traffic.indexOf('function crearCalle('), traffic.indexOf('// Clase para conexiones multi-carril'))}
        ${traffic.slice(traffic.indexOf('class ConexionCA {'), traffic.indexOf('// Calcula las coordenadas globales del CENTRO'))}
        ${traffic.slice(traffic.indexOf('function marcarCelulaEsperando('), traffic.indexOf('// ========== EXPONER VARIABLES GLOBALES PARA EL EDITOR'))}
        window.actualizarCalle = actualizarCalle;
        window.cambioCarril = cambioCarril;
        window.ConexionCA = ConexionCA;
        window.crearCalle = crearCalle;`, {
        window, calles: [], Math: math, console: { log() {} }, inicializarVertices() {},
    });
    const roads = [];
    const road = () => {
        const result = roundabout
            ? window.roundaboutStreet.createStreet({ nombre: `test-${roads.length}`, x: 0, y: 0,
                innerRadius: 20, carriles: lanes, probabilidadSaltoDeCarril: 0 })
            : window.crearCalle(`test-${roads.length}`, length, 'conexion', 0, 0, 0, 0, lanes, 0);
        result.laneDirections.fill(direction);
        roads.push(result);
        return result;
    };
    const street = road();
    street.conexionesEstacionamiento = new Map();
    const buildings = [];
    const building = (options = {}) => {
        const parking = { label: 'Parking', esEstacionamiento: true, vehiculosActuales: 0,
            capacidadMaxima: 20, probabilidadesEntrada: Array(24).fill(1),
            probabilidadesSalida: Array(24).fill(0), ...options };
        buildings.push(parking);
        return parking;
    };
    const endpoint = (parking, index, tipo = 'entrada', lane = 0) => {
        street.conexionesEstacionamiento.set(`${lane}-${index}`, { tipo, edificio: parking });
    };
    const total = () => roads.reduce((count, current) => count + current.arreglo.reduce((sum, lane) =>
        sum + lane.filter(value => value >= 1 && value <= 6).length, 0), 0) +
        buildings.reduce((sum, parking) => sum + parking.vehiculosActuales, 0);
    const connect = (target, source, destination = 4) => {
        const link = new window.ConexionCA(street, target, 0, 0, source, destination);
        street.conexionesSalida[0].push(link);
        return link;
    };
    // Relevant tick phases in paso order; generation is disabled for these connection streets.
    const tick = link => {
        const transferred = link.transferir();
        roads.forEach(window.cambioCarril);
        roads.forEach(window.actualizarCalle);
        return transferred;
    };
    return { street, building, endpoint, total, road, connect, tick,
        update: () => window.actualizarCalle(street) };
}

describe.each([1, -1])('parking conservation in lane direction %i', direction => {
    it.each([1, 2, 3, 4, 5, 6])('absorbs vehicle type %i on the entrance without a downstream copy', vehicle => {
        const { street, building, endpoint, total, update } = simulation(direction);
        const parking = building();
        endpoint(parking, 4);
        street.arreglo[0][4] = vehicle;
        expect(total()).toBe(1);
        update();
        expect(parking.vehiculosActuales).toBe(1);
        expect(Array.from(street.arreglo[0])).toEqual(Array(9).fill(0));
        expect(total()).toBe(1);
    });

    it('absorbs an upstream vehicle without leaving a road copy', () => {
        const { street, building, endpoint, total, update } = simulation(direction);
        const parking = building();
        endpoint(parking, 4);
        street.arreglo[0][4 - direction] = 3;
        update();
        expect(parking.vehiculosActuales).toBe(1);
        expect(Array.from(street.arreglo[0])).toEqual(Array(9).fill(0));
        expect(total()).toBe(1);
    });

    it('keeps the following vehicle blocked until the next update and resets consumed tracking', () => {
        const { street, building, endpoint, total, update } = simulation(direction);
        const parking = building({ capacidadMaxima: 1 });
        endpoint(parking, 4);
        street.arreglo[0][4] = 2;
        street.arreglo[0][4 - direction] = 6;
        update();
        const expected = Array(9).fill(0);
        expected[4 - direction] = 6;
        expect(Array.from(street.arreglo[0])).toEqual(expected);
        expect(parking.vehiculosActuales).toBe(1);
        expect(total()).toBe(2);
        update();
        expected[4 - direction] = 0;
        expected[4] = 6;
        expect(Array.from(street.arreglo[0])).toEqual(expected);
        expect(total()).toBe(2);
        update();
        expected[4] = 0;
        expected[4 + direction] = 6;
        expect(Array.from(street.arreglo[0])).toEqual(expected);
        expect(total()).toBe(2);
    });

    it('does not let adjacent entrances absorb the same source twice', () => {
        const { street, building, endpoint, total, update } = simulation(direction);
        const first = building();
        const second = building();
        endpoint(first, 4);
        endpoint(second, 4 + direction);
        street.arreglo[0][4] = 5;
        update();
        expect(first.vehiculosActuales + second.vehiculosActuales).toBe(1);
        // Physical-index traversal determines which entrance gets the vehicle.
        expect(first.vehiculosActuales).toBe(direction === 1 ? 1 : 0);
        expect(Array.from(street.arreglo[0])).toEqual(Array(9).fill(0));
        expect(total()).toBe(1);
    });

    it('counts adjacent entrances for the same building only once', () => {
        const { street, building, endpoint, total, update } = simulation(direction);
        const parking = building();
        endpoint(parking, 4);
        endpoint(parking, 4 + direction);
        street.arreglo[0][4] = 5;
        update();
        expect(parking.vehiculosActuales).toBe(1);
        expect(Array.from(street.arreglo[0])).toEqual(Array(9).fill(0));
        expect(total()).toBe(1);
    });

    it('uses physical-index precedence regardless of map insertion order', () => {
        const { street, building, endpoint, total, update } = simulation(direction);
        const first = building();
        const second = building();
        endpoint(second, 4 + direction);
        endpoint(first, 4);
        street.arreglo[0][4] = 5;
        update();
        expect(first.vehiculosActuales).toBe(direction === 1 ? 1 : 0);
        expect(second.vehiculosActuales).toBe(direction === 1 ? 0 : 1);
        expect(Array.from(street.arreglo[0])).toEqual(Array(9).fill(0));
        expect(total()).toBe(1);
    });

    it('leaves a rejected source eligible for a later entrance', () => {
        const { street, building, endpoint, total, update } = simulation(direction);
        const rejected = building({ probabilidadesEntrada: Array(24).fill(0) });
        const accepted = building();
        // Both entrances see the source at 4; the lower physical index is attempted first.
        endpoint(rejected, Math.min(4, 4 + direction));
        endpoint(accepted, Math.max(4, 4 + direction));
        street.arreglo[0][4] = 5;
        update();
        expect(rejected.vehiculosActuales).toBe(0);
        expect(accepted.vehiculosActuales).toBe(1);
        expect(Array.from(street.arreglo[0])).toEqual(Array(9).fill(0));
        expect(total()).toBe(1);
    });

    it('does not accept anticipated entry at a waiting entrance cell', () => {
        const { street, building, endpoint, total, update, road, connect } = simulation(direction);
        const parking = building();
        endpoint(parking, 4);
        street.arreglo[0][4 - direction] = 3;
        // An outgoing link holds the non-waiting source during CA movement.
        connect(road(), 4 - direction);
        street.celulasEsperando[0][4] = true;
        update();
        expect(parking.vehiculosActuales).toBe(0);
        const expected = Array(9).fill(0);
        expected[4 - direction] = 3;
        expect(Array.from(street.arreglo[0])).toEqual(expected);
        expect(Array.from(street.celulasEsperando[0])).toEqual(Array(9).fill(false));
        expect(total()).toBe(1);
    });

    it('allows entry on the update after a source waiting flag is cleared', () => {
        const { street, building, endpoint, total, update } = simulation(direction);
        const parking = building();
        endpoint(parking, 4);
        street.arreglo[0][4 - direction] = 3;
        street.celulasEsperando[0][4 - direction] = true;
        update();
        expect(parking.vehiculosActuales).toBe(0);
        expect(street.arreglo[0][4 - direction]).toBe(3);
        expect(total()).toBe(1);
        update();
        expect(parking.vehiculosActuales).toBe(1);
        expect(Array.from(street.arreglo[0])).toEqual(Array(9).fill(0));
        expect(total()).toBe(1);
    });

    it('protects a waiting source from anticipated entry', () => {
        const { street, building, endpoint, total, update } = simulation(direction);
        const parking = building();
        endpoint(parking, 4);
        street.arreglo[0][4 - direction] = 3;
        street.celulasEsperando[0][4 - direction] = true;
        update();
        expect(parking.vehiculosActuales).toBe(0);
        expect(street.arreglo[0][4 - direction]).toBe(3);
        expect(total()).toBe(1);
        expect(Array.from(street.celulasEsperando[0])).toEqual(Array(9).fill(false));
    });

    it('does not absorb a vehicle waiting directly on the entrance', () => {
        const { street, building, endpoint, total, update } = simulation(direction);
        const parking = building();
        endpoint(parking, 4);
        street.arreglo[0][4] = 2;
        street.celulasEsperando[0][4] = true;
        update();
        expect(parking.vehiculosActuales).toBe(0);
        expect(street.arreglo[0][4]).toBe(2);
        expect(total()).toBe(1);
    });

    it.each(['probability', 'capacity'])('preserves normal movement when entry is rejected by %s', reason => {
        const { street, building, endpoint, total, update } = simulation(direction);
        const parking = building(reason === 'probability'
            ? { probabilidadesEntrada: Array(24).fill(0) }
            : { capacidadMaxima: 1, vehiculosActuales: 1 });
        endpoint(parking, 4);
        street.arreglo[0][4] = 5;
        const before = total();
        update();
        const expected = Array(9).fill(0);
        expected[4 + direction] = 5;
        expect(Array.from(street.arreglo[0])).toEqual(expected);
        expect(parking.vehiculosActuales).toBe(reason === 'capacity' ? 1 : 0);
        expect(total()).toBe(before);
    });

    it('preserves a blocker downstream of an absorbed source', () => {
        const { street, building, endpoint, total, update } = simulation(direction);
        const parking = building();
        endpoint(parking, 4);
        street.arreglo[0][4] = 6;
        street.arreglo[0][4 + direction] = 7;
        update();
        const expected = Array(9).fill(0);
        expected[4 + direction] = 7;
        expect(Array.from(street.arreglo[0])).toEqual(expected);
        expect(parking.vehiculosActuales).toBe(1);
        expect(total()).toBe(1);
    });

    it('creates exactly one road vehicle on departure without moving it in the same update', () => {
        const { street, building, endpoint, total, update } = simulation(direction);
        const parking = building({ vehiculosActuales: 1, probabilidadesSalida: Array(24).fill(1) });
        endpoint(parking, 4, 'salida');
        update();
        const expected = Array(9).fill(0);
        expected[4] = 1;
        expect(Array.from(street.arreglo[0])).toEqual(expected);
        expect(parking.vehiculosActuales).toBe(0);
        expect(total()).toBe(1);
        update();
        expected[4] = 0;
        expected[4 + direction] = 1;
        expect(Array.from(street.arreglo[0])).toEqual(expected);
        expect(total()).toBe(1);
    });

    it('blocks departure while the upstream cell is occupied', () => {
        const { street, building, endpoint, total, update } = simulation(direction);
        const parking = building({ vehiculosActuales: 1, probabilidadesSalida: Array(24).fill(1) });
        endpoint(parking, 4, 'salida');
        street.arreglo[0][4 - direction] = 4;
        update();
        expect(parking.vehiculosActuales).toBe(1);
        expect(street.arreglo[0][4]).toBe(4);
        expect(total()).toBe(2);
    });

    it('conserves vehicles over repeated entry and exit updates away from external boundaries', () => {
        const { street, building, endpoint, total, update } = simulation(direction, 1, 31);
        const parking = building({ vehiculosActuales: 2, probabilidadesSalida: Array(24).fill(1) });
        endpoint(parking, 15);
        endpoint(parking, 15 + 5 * direction, 'salida');
        street.arreglo[0][15] = 2;
        street.arreglo[0][15 - direction] = 6;
        for (let tick = 0; tick < 5; tick++) {
            update();
            expect(total()).toBe(4);
        }
    });
});

it('keeps consumed sources local to their lane on a mixed-direction street', () => {
    const { street, building, endpoint, total, update } = simulation(1, 2);
    street.laneDirections[1] = -1;
    const parking = building();
    endpoint(parking, 4);
    street.arreglo[0][4] = 2;
    street.arreglo[1][4] = 6;
    update();
    expect(Array.from(street.arreglo[0])).toEqual(Array(9).fill(0));
    expect(Array.from(street.arreglo[1])).toEqual([0, 0, 0, 6, 0, 0, 0, 0, 0]);
    expect(parking.vehiculosActuales).toBe(1);
    expect(total()).toBe(2);
});

it('allows the same source index to be consumed independently in separate lanes', () => {
    const { street, building, endpoint, total, update } = simulation(1, 2);
    street.laneDirections[1] = -1;
    const parking = building();
    endpoint(parking, 4, 'entrada', 0);
    endpoint(parking, 4, 'entrada', 1);
    street.arreglo[0][4] = 2;
    street.arreglo[1][4] = 6;
    update();
    expect(street.arreglo.map(lane => Array.from(lane))).toEqual([Array(9).fill(0), Array(9).fill(0)]);
    expect(parking.vehiculosActuales).toBe(2);
    expect(total()).toBe(2);
});

describe('roundabout parking conservation at the wrap seam', () => {
    it.each([false, true])('absorbs once across adjacent entrances (shared building: %s)', shared => {
        const { street, building, endpoint, total, update } = simulation(1, 1, 9, true);
        const direct = building();
        const anticipated = shared ? direct : building();
        const source = street.tamano - 1;
        endpoint(direct, source);
        endpoint(anticipated, 0);
        street.arreglo[0][source] = 6;
        update();
        // Cell zero is inspected before the last physical cell, independent of insertion order.
        expect(anticipated.vehiculosActuales).toBe(1);
        expect(direct.vehiculosActuales).toBe(shared ? 1 : 0);
        expect(Array.from(street.arreglo[0])).toEqual(Array(street.tamano).fill(0));
        expect(total()).toBe(1);
    });

    it.each(['source', 'entrance'])('respects a waiting %s at a seam entrance', waitingCell => {
        const { street, building, endpoint, total, update } = simulation(1, 1, 9, true);
        const parking = building();
        const source = street.tamano - 1;
        endpoint(parking, 0);
        street.arreglo[0][source] = 3;
        street.celulasEsperando[0][waitingCell === 'source' ? source : 0] = true;
        update();
        expect(parking.vehiculosActuales).toBe(0);
        const expected = Array(street.tamano).fill(0);
        expected[source] = 3;
        expect(Array.from(street.arreglo[0])).toEqual(expected);
        expect(Array.from(street.celulasEsperando[0])).toEqual(Array(street.tamano).fill(false));
        expect(total()).toBe(1);
        update();
        expect(parking.vehiculosActuales).toBe(1);
        expect(Array.from(street.arreglo[0])).toEqual(Array(street.tamano).fill(0));
        expect(total()).toBe(1);
    });
});

describe.each([
    ['forward street', 1, false],
    ['reverse street', -1, false],
    ['roundabout seam', 1, true],
])('street-transfer precedence on a %s', (_name, direction, roundabout) => {
    it('protects a source reserved by a real blocked transfer from anticipated entry', () => {
        const { street, building, endpoint, total, road, connect, tick } = simulation(direction, 1, 9, roundabout);
        const parking = building();
        const source = roundabout ? street.tamano - 1 : 4;
        endpoint(parking, roundabout ? 0 : source + direction);
        street.arreglo[0][source] = 5;
        const target = road();
        target.arreglo[0][4] = 2;
        const link = connect(target, source);
        expect(total()).toBe(2);
        expect(tick(link)).toBe(false);
        expect(link.bloqueada).toBe(true);
        expect(parking.vehiculosActuales).toBe(0);
        const expected = Array(street.tamano).fill(0);
        expected[source] = 5;
        expect(Array.from(street.arreglo[0])).toEqual(expected);
        expect(target.arreglo[0][4 + direction]).toBe(2);
        expect(street.celulasEsperando[0][source]).toBe(false);
        expect(total()).toBe(2);
    });

    it('does not park a vehicle already moved by a successful transfer', () => {
        const { street, building, endpoint, total, road, connect, tick } = simulation(direction, 1, 9, roundabout);
        const parking = building();
        const source = roundabout ? street.tamano - 1 : 4;
        endpoint(parking, source);
        endpoint(parking, roundabout ? 0 : source + direction);
        street.arreglo[0][source] = 5;
        const target = road();
        const link = connect(target, source);
        expect(total()).toBe(1);
        expect(tick(link)).toBe(true);
        expect(link.bloqueada).toBe(false);
        expect(parking.vehiculosActuales).toBe(0);
        expect(Array.from(street.arreglo[0])).toEqual(Array(street.tamano).fill(0));
        const expected = Array(target.tamano).fill(0);
        expected[4 + direction] = 5;
        expect(Array.from(target.arreglo[0])).toEqual(expected);
        expect(total()).toBe(1);
    });
});
