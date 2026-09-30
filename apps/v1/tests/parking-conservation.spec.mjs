import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const core = name => readFileSync(new URL(`../src/js/core/${name}.js`, import.meta.url), 'utf8');
const traffic = core('trafico');

function simulation(direction = 1, lanes = 1, length = 9) {
    const window = { configuracionTiempo: { horaActual: 12 } };
    const math = Object.create(Math);
    math.random = () => 0;
    runInNewContext(`const TIPOS = { GENERADOR: 'generador', CONEXION: 'conexion', DEVORADOR: 'devorador' };
        let buildingInitialMap = false;
        ${core('reglas')}
        ${core('estacionamientos')}
        ${traffic.slice(traffic.indexOf('function crearCalle('), traffic.indexOf('// Clase para conexiones multi-carril'))}
        ${traffic.slice(traffic.indexOf('function marcarCelulaEsperando('), traffic.indexOf('// ========== EXPONER VARIABLES GLOBALES PARA EL EDITOR'))}
        window.actualizarCalle = actualizarCalle;
        window.crearCalle = crearCalle;`, {
        window, calles: [], Math: math, console: { log() {} }, inicializarVertices() {},
    });
    const street = window.crearCalle('test', length, 'conexion', 0, 0, 0, 0, lanes, 0);
    street.laneDirections.fill(direction);
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
    const total = () => street.arreglo.reduce((sum, lane) =>
        sum + lane.filter(value => value >= 1 && value <= 6).length, 0) +
        buildings.reduce((sum, parking) => sum + parking.vehiculosActuales, 0);
    return { street, building, endpoint, total, update: () => window.actualizarCalle(street) };
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
