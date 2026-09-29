import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const core = name => readFileSync(new URL(`../src/js/core/${name}.js`, import.meta.url), 'utf8');

function setup() {
    const window = { celda_tamano: 10 };
    const context = { window, console, celda_tamano: 10 };
    runInNewContext(core('roundaboutStreet'), context);
    runInNewContext(`const TIPOS = { CONEXION: 'conexion', GENERADOR: 'generador', DEVORADOR: 'devorador' };
        const TIPOS_CONEXION = { LINEAL: 'lineal', INCORPORACION: 'incorporacion', PROBABILISTICA: 'probabilistica' };
        const reglas = {};
        ${core('trafico').slice(core('trafico').indexOf('function crearCalle('), core('trafico').indexOf('// Clase para conexiones multi-carril'))}
        ${core('trafico').slice(core('trafico').indexOf('class ConexionCA {'), core('trafico').indexOf('// Calcula las coordenadas globales del CENTRO'))}
        ${core('trafico').slice(core('trafico').indexOf('function marcarCelulaEsperando('), core('trafico').indexOf('// ========== EXPONER VARIABLES GLOBALES PARA EL EDITOR'))}
        window.actualizarCalle = actualizarCalle;
        window.cambioCarril = cambioCarril;
        window.ConexionCA = ConexionCA;`, context);
    return window;
}

const make = (w, options = {}) => w.roundaboutStreet.createStreet({
    nombre: 'Glorieta', x: 100, y: 200, innerRadius: 20, carriles: 2, ...options
});

describe('closed roundabout street', () => {
    it('routes cell coordinates and reindexes direct geometry edits', () => {
        const w = setup();
        const context = { window: w, console, celda_tamano: 10,
            obtenerCoordenadasGlobalesCelda: () => ({ x: 0, y: 0 }) };
        runInNewContext(core('curvas'), context);
        runInNewContext(core('cellGeometryIndex'), context);
        const street = make(w, { carriles: 1 });
        const point = w.obtenerCoordenadasGlobalesCeldaConCurva(street, 0, 0);
        expect(w.cellGeometryIndex.findNearest(point.x, point.y, [street])?.indice).toBe(0);
        street.x += 30;
        expect(w.cellGeometryIndex.findNearest(point.x + 30, point.y, [street])?.indice).toBe(0);
        street.startAngle += 90;
        const rotated = w.roundaboutStreet.coordinates(street, 0, 0);
        expect(w.cellGeometryIndex.findNearest(rotated.x, rotated.y, [street])?.indice).toBe(0);
    });

    it('validates geometry and uses equal clockwise sectors in all lanes', () => {
        const w = setup();
        const street = make(w, { startAngle: 90 });
        expect(street.tamano).toBe(Math.round(2 * Math.PI * 25 / 10));
        expect(street.tipo).toBe('conexion');
        expect(street.probabilidadSaltoDeCarril).toBe(0.02);
        expect(w.roundaboutStreet.neighbor(street, street.tamano - 1)).toBe(0);
        const inner = w.roundaboutStreet.coordinates(street, 0, 0);
        const outer = w.roundaboutStreet.coordinates(street, 1, 0);
        expect(Math.hypot(outer.x - street.x, outer.y - street.y) -
            Math.hypot(inner.x - street.x, inner.y - street.y)).toBeCloseTo(10);
        expect(w.roundaboutStreet.bounds(street).maxX).toBe(140);
        expect(() => make(w, { carriles: 11 })).toThrow('Invalid roundabout');
        expect(() => make(w, { innerRadius: 0 })).toThrow('Invalid roundabout');
        expect(() => make(w, { innerRadius: 100_000 })).toThrow('Invalid roundabout');
    });

    it('moves across the seam without changing vehicle types, duplicating or swallowing cars', () => {
        const w = setup();
        const street = make(w);
        street.arreglo[0][street.tamano - 1] = 6;
        street.arreglo[1][0] = 3;
        w.actualizarCalle(street);
        expect(street.arreglo[0][0]).toBe(6);
        expect(street.arreglo[0][street.tamano - 1]).toBe(0);
        expect(street.arreglo[1][1]).toBe(3);
        street.arreglo[0][1] = 7;
        w.actualizarCalle(street);
        expect(street.arreglo[0][0]).toBe(6);
        street.celulasEsperando[0][0] = true;
        w.actualizarCalle(street);
        expect(street.arreglo[0][0]).toBe(6);
    });

    it('handles explicit links, blocked destinations, seam parking and diagonal lane changes', () => {
        const w = setup();
        const street = make(w, { probabilidadSaltoDeCarril: 1 });
        const target = make(w);
        const source = street.tamano - 1;
        const link = new w.ConexionCA(street, target, 0, 0, source, 4);
        street.conexionesSalida[0].push(link);
        street.arreglo[0][source] = 5;
        target.arreglo[0][4] = 1;
        expect(link.transferir()).toBe(false);
        w.actualizarCalle(street);
        expect(street.arreglo[0][source]).toBe(5);
        target.arreglo[0][4] = 0;
        expect(link.transferir()).toBe(true);
        expect(target.arreglo[0][4]).toBe(5);
        street.conexionesSalida[0].length = 0;
        street.arreglo[0][source] = 2;
        const building = { esEstacionamiento: true };
        street.conexionesEstacionamiento = new Map([['0-0', { tipo: 'entrada', edificio: building }]]);
        w.procesarEntradaVehiculo = (_building, vehicle) => vehicle === 2;
        w.actualizarCalle(street);
        expect(street.arreglo[0][source]).toBe(0);
        street.conexionesEstacionamiento.clear();
        street.arreglo[0][source] = 4;
        const original = Math.random;
        Math.random = () => 0;
        try { w.cambioCarril(street); } finally { Math.random = original; }
        expect(street.arreglo[1][0]).toBe(4);
        expect(street.arreglo[0][source]).toBe(0);
    });
});
