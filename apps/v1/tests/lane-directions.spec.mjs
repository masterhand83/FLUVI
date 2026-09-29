import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/js/core/trafico.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../src/js/core/reglas.js', import.meta.url), 'utf8');

function simulation() {
    const window = {};
    const context = { window, console, Math: Object.create(Math), calles: [], inicializarVertices() {} };
    context.Math.random = () => 0;
    runInNewContext(`const TIPOS = { GENERADOR: 'generador', CONEXION: 'conexion', DEVORADOR: 'devorador' };
        const TIPOS_CONEXION = { LINEAL: 'lineal', INCORPORACION: 'incorporacion', PROBABILISTICA: 'probabilistica' };
        let buildingInitialMap = false;
        ${rules}
        ${source.slice(source.indexOf('function crearCalle('), source.indexOf('// Clase para conexiones multi-carril'))}
        ${source.slice(source.indexOf('class ConexionCA {'), source.indexOf('// Calcula las coordenadas globales del CENTRO'))}
        ${source.slice(source.indexOf('function marcarCelulaEsperando('), source.indexOf('// ========== EXPONER VARIABLES GLOBALES PARA EL EDITOR'))}
        ${source.slice(source.indexOf('function crearConexionLineal('), source.indexOf('function registrarConexiones('))}
        window.crearCalle = crearCalle;
        window.ConexionCA = ConexionCA;
        window.generarCelulas = generarCelulas;
        window.actualizarCalle = actualizarCalle;
        window.cambioCarril = cambioCarril;
        window.getLaneDirection = getLaneDirection;
        window.getLaneEntryCell = getLaneEntryCell;
        window.getLaneExitCell = getLaneExitCell;
        window.effectiveSourceCell = effectiveSourceCell;
        window.isConnectionDirectionCompatible = isConnectionDirectionCompatible;
        window.crearConexionLineal = crearConexionLineal;
        window.crearConexionIncorporacion = crearConexionIncorporacion;
        window.crearConexionProbabilistica = crearConexionProbabilistica;`, context);
    const road = (type = 'conexion', lanes = 1, length = 5) => window.crearCalle('test', length, type, 0, 0, 0, 0, lanes, 1);
    return { w: window, road, setRandom: value => { context.Math.random = () => value; } };
}

describe('physical lane directions in the v1 simulation', () => {
    it('defaults to forward and keeps the old physical indexes, including -1', () => {
        const { w, road } = simulation();
        const street = road('conexion', 2);
        expect(Array.from(street.laneDirections)).toEqual([1, 1]);
        expect(w.getLaneDirection({ tamano: 5 }, 0)).toBe(1);
        street.laneDirections[1] = -1;
        expect([w.getLaneEntryCell(street, 1), w.getLaneExitCell(street, 1)]).toEqual([4, 0]);
        const link = new w.ConexionCA(street, road(), 1, 0);
        expect(w.effectiveSourceCell(link)).toBe(4);
        expect(w.isConnectionDirectionCompatible(link)).toBe(false);
        street.arreglo[1][2] = 3;
        expect(street.arreglo[1][2]).toBe(3); // reversing doesn't move existing cars
    });

    it('spawns at each entry and mirrors CA movement, waiting, blockers and swallowing', () => {
        const { w, road } = simulation();
        const street = road('generador', 2);
        street.probabilidadGeneracion = 1;
        street.laneDirections[1] = -1;
        w.generarCelulas(street);
        expect(Array.from(street.arreglo[0])).toEqual([1, 0, 0, 0, 0]);
        expect(Array.from(street.arreglo[1])).toEqual([0, 0, 0, 0, 1]);
        w.actualizarCalle(street);
        expect(Array.from(street.arreglo[0])).toEqual([0, 1, 0, 0, 0]);
        expect(Array.from(street.arreglo[1])).toEqual([0, 0, 0, 1, 0]);
        street.arreglo[1][2] = 7;
        w.actualizarCalle(street);
        expect(street.arreglo[1][3]).toBe(1);
        street.arreglo[1][2] = 0;
        street.celulasEsperando[1][3] = true;
        w.actualizarCalle(street);
        expect(street.arreglo[1][3]).toBe(1);
        const sink = road('devorador');
        sink.laneDirections[0] = -1;
        sink.arreglo[0][0] = 2;
        w.actualizarCalle(sink);
        expect(sink.arreglo[0][0]).toBe(0);
    });

    it('only changes into adjacent lanes going the same direction, advancing one physical cell', () => {
        const { w, road } = simulation();
        const street = road('conexion', 3, 6);
        street.laneDirections = [-1, 1, -1];
        street.arreglo[0][3] = 2;
        w.cambioCarril(street);
        expect(street.arreglo[0][3]).toBe(2);
        street.laneDirections[1] = -1;
        w.cambioCarril(street);
        expect(street.arreglo[1][2]).toBe(2);
        expect(street.arreglo[0][3]).toBe(0);
    });

    it('uses the upstream physical neighbor for reverse parking entrance and exit', () => {
        const { w, road } = simulation();
        const street = road();
        street.laneDirections[0] = -1;
        const building = { esEstacionamiento: true };
        street.conexionesEstacionamiento = new Map([['0-2', { tipo: 'entrada', edificio: building }]]);
        street.arreglo[0][3] = 4;
        w.procesarEntradaVehiculo = (_building, vehicle) => vehicle === 4;
        w.actualizarCalle(street);
        expect(Array.from(street.arreglo[0])).toEqual([0, 0, 0, 0, 0]);

        street.conexionesEstacionamiento.set('0-2', { tipo: 'salida', edificio: building });
        street.arreglo[0][3] = 2;
        let attempts = 0;
        w.intentarGenerarSalida = () => { attempts++; return 5; };
        w.actualizarCalle(street);
        expect(attempts).toBe(0); // upstream neighbor is occupied; its car may advance normally
        street.arreglo[0].fill(0);
        w.actualizarCalle(street);
        expect(street.arreglo[0][2]).toBe(5);
        expect(attempts).toBe(1);
    });

    it('rejects incompatible endpoints without consuming cars or pinning them at invalid exits', () => {
        const { w, road } = simulation();
        const source = road();
        const target = road();
        source.laneDirections[0] = -1;
        target.laneDirections[0] = -1;
        const implicit = new w.ConexionCA(source, target, 0, 0);
        source.arreglo[0][4] = 2;
        expect(implicit.transferir()).toBe(false);
        expect(implicit.bloqueada).toBe(false);
        expect(source.arreglo[0][4]).toBe(2);
        source.conexionesSalida[0].push(implicit);
        w.actualizarCalle(source);
        expect(source.arreglo[0][3]).toBe(2);
        const valid = new w.ConexionCA(source, target, 0, 0, 0, 4);
        source.arreglo[0][0] = 3;
        expect(w.isConnectionDirectionCompatible(valid)).toBe(true);
        expect(valid.transferir()).toBe(true);
        expect(target.arreglo[0][4]).toBe(3);
        const interior = new w.ConexionCA(source, target, 0, 0, 2, 2);
        expect(w.isConnectionDirectionCompatible(interior)).toBe(true);
        const wrongSource = new w.ConexionCA(source, target, 0, 0, 4, 4);
        const wrongDestination = new w.ConexionCA(source, target, 0, 0, 0, 0);
        expect(w.isConnectionDirectionCompatible(wrongSource)).toBe(false);
        expect(w.isConnectionDirectionCompatible(wrongDestination)).toBe(false);
    });

    it('retains legacy forward-lane connections into the final cell of a short street', () => {
        const { w, road } = simulation();
        const source = road('conexion', 2, 3);
        const target = road('conexion', 1, 2);
        const links = w.crearConexionIncorporacion(source, target);
        expect(links.map(link => link.posDestino)).toEqual([0, 1]);
        expect(links.every(w.isConnectionDirectionCompatible)).toBe(true);
    });

    it('creates direction-aware defaults and preserves an explicit source cell 0', () => {
        const { w, road } = simulation();
        const source = road('conexion', 2, 5);
        const target = road('conexion', 2, 5);
        source.laneDirections[0] = -1;
        target.laneDirections[0] = -1;
        const linear = w.crearConexionLineal(source, target);
        expect(linear.map(link => [link.posOrigen, link.posDestino])).toEqual([[0, 4], [-1, 0]]);
        expect(linear.every(w.isConnectionDirectionCompatible)).toBe(true);
        const merge = w.crearConexionIncorporacion(source, target, 0);
        expect(merge.map(link => [link.posOrigen, link.posDestino])).toEqual([[0, 4], [-1, 3]]);
        expect(merge.every(w.isConnectionDirectionCompatible)).toBe(true);
        const explicit = w.crearConexionProbabilistica(source, 0, target, [
            { carrilDestino: 0, posOrigen: 0, posDestino: 4, probabilidad: 1 }
        ]);
        expect(explicit[0].posOrigen).toBe(0);
        expect(w.isConnectionDirectionCompatible(explicit[0])).toBe(true);
    });
});
