import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup() {
    const window = { celda_tamano: 5 };
    const context = { window, celda_tamano: 5, TIPOS: { CONEXION: 'conexion' }, console };
    window.obtenerCoordenadasGlobalesCelda = (street, lane, index) => {
        const rad = -street.angulo * Math.PI / 180;
        const x = (index + 0.5) * 5, y = (lane + 0.5) * 5;
        return { x: street.x + x * Math.cos(rad) - y * Math.sin(rad), y: street.y + x * Math.sin(rad) + y * Math.cos(rad) };
    };
    context.obtenerCoordenadasGlobalesCelda = window.obtenerCoordenadasGlobalesCelda;
    for (const name of ['curvas.js', 'cellGeometryIndex.js']) {
        runInNewContext(readFileSync(new URL(`../src/js/core/${name}`, import.meta.url), 'utf8'), context);
    }
    return window;
}

function scan(window, roads, x, y) {
    let best = null, distance = Infinity;
    roads.forEach((calle, calleIndex) => {
        for (let carril = 0; carril < calle.carriles; carril++) for (let indice = 0; indice < calle.tamano; indice++) {
            const center = calle.esCurva && (calle.bezierControls || calle.vertices?.length)
                ? window.obtenerCoordenadasGlobalesCeldaConCurva(calle, carril, indice)
                : window.obtenerCoordenadasGlobalesCelda(calle, carril, indice);
            const d = Math.hypot(center.x - x, center.y - y);
            if (d < distance) { distance = d; best = { calle, calleIndex, carril, indice }; }
        }
    });
    return distance < 5 ? best : null;
}

describe('cell geometry index', () => {
    it('can drop cached cell centers when replacing a simulation', () => {
        const w = setup();
        const oldRoad = { x: 0, y: 0, angulo: 0, tamano: 2, carriles: 1 };
        expect(w.cellGeometryIndex.findNearest(2.5, 2.5, [oldRoad])?.calle).toBe(oldRoad);
        w.cellGeometryIndex.clear();
        expect(w.cellGeometryIndex.findNearest(2.5, 2.5, [])).toBeNull();
        const newRoad = { x: 0, y: 0, angulo: 0, tamano: 2, carriles: 1 };
        expect(w.cellGeometryIndex.findNearest(2.5, 2.5, [newRoad])?.calle).toBe(newRoad);
    });

    it('matches the scan, including overlapping ties, thresholds and negative coordinates', () => {
        const w = setup();
        const straight = { x: -25, y: -25, angulo: 0, tamano: 10, carriles: 2 };
        const curved = { x: 7, y: -9, angulo: 15, tamano: 20, carriles: 2, esCurva: true,
            vertices: [{ indiceCelda: 0, anguloOffset: 0 }, { indiceCelda: 10, anguloOffset: 55 }, { indiceCelda: 19, anguloOffset: 0 }] };
        const roads = [straight, { ...straight }, curved];
        for (let x = -35; x < 80; x += 1.7) for (let y = -38; y < 35; y += 2.3) {
            expect(w.cellGeometryIndex.findNearest(x, y, roads)).toEqual(scan(w, roads, x, y));
        }
        expect(w.cellGeometryIndex.findNearest(1000, 1000, roads)).toBeNull();
    });

    it('refreshes after direct edits, replacement and explicit invalidation', () => {
        const w = setup();
        const road = { x: 0, y: 0, angulo: 0, tamano: 12, carriles: 1, esCurva: true,
            vertices: [{ indiceCelda: 0, anguloOffset: 0 }, { indiceCelda: 11, anguloOffset: 0 }] };
        const roads = [road];
        const check = () => {
            for (let x = -20; x <= 100; x += 4) for (let y = -30; y <= 50; y += 4)
                expect(w.cellGeometryIndex.findNearest(x, y, roads)).toEqual(scan(w, roads, x, y));
        };
        check();
        road.x = -13; road.y = 8; road.vertices[1].anguloOffset = 65;
        check();
        road.tamano = 17; road.carriles = 3; road.angulo = 20;
        check();
        w.cellGeometryIndex.invalidate(road);
        check();
        roads[0] = { x: 40, y: 20, angulo: 90, tamano: 3, carriles: 1 };
        check();
        w.cellGeometryIndex.invalidate();
        check();
    });

    it('updates Bezier control points and preserves the strict distance boundary', () => {
        const w = setup();
        w.streetBezier = { coordinates: (street, lane, index) => ({
            x: street.x + street.bezierControls[0].x + index * 5,
            y: street.y + street.bezierControls[0].y + lane * 5,
            angulo: 0
        }) };
        const road = { x: 0, y: 0, angulo: 0, tamano: 2, carriles: 1, esCurva: true,
            vertices: [{ indiceCelda: 0, anguloOffset: 0 }], bezierControls: [{ x: 10, y: 10 }] };
        expect(w.cellGeometryIndex.findNearest(10, 10, [road])).toEqual({ calle: road, calleIndex: 0, carril: 0, indice: 0 });
        road.bezierControls[0].y = 30;
        expect(w.cellGeometryIndex.findNearest(10, 10, [road])).toBeNull();
        expect(w.cellGeometryIndex.findNearest(10, 35, [road])).toBeNull();
        expect(w.cellGeometryIndex.findNearest(10, 30, [road])).toEqual({ calle: road, calleIndex: 0, carril: 0, indice: 0 });
    });

    it('finds Bezier cells with no legacy vertices only at their curved position', () => {
        const w = setup();
        w.streetBezier = { coordinates: (street, lane, index) => ({
            x: street.x + index * 5, y: street.y + 40 + lane * 5, angulo: 0
        }) };
        const road = { x: 0, y: 0, angulo: 0, tamano: 12, carriles: 1,
            esCurva: true, bezierControls: [{ x: 20, y: 40 }], vertices: [] };
        expect(w.cellGeometryIndex.findNearest(2.5, 40, [road])).toEqual({ calle: road, calleIndex: 0, carril: 0, indice: 0 });
        expect(w.cellGeometryIndex.findNearest(2.5, 2.5, [road])).toBeNull();
        expect(w.cellGeometryIndex.nearbyStreets(2.5, 40, [road]).has(road)).toBe(true);
        expect(w.cellGeometryIndex.nearbyStreets(2.5, 2.5, [road]).has(road)).toBe(false);
    });

    it('reindexes moved multi-section anchors and handles when edited directly', () => {
        const w = setup();
        w.obtenerCoordenadasGlobalesCeldaConCurva = (street, lane, index) => ({
            x: street.bezierSegments[0].end.x + street.bezierSegments[1].controls[0].x + index * 5,
            y: street.bezierSegments[0].end.y + lane * 5
        });
        const road = { x: 0, y: 0, endX: 40, endY: 40, angulo: 0, tamano: 2, carriles: 1,
            esCurva: true, vertices: [], bezierSegments: [
                { controls: [], end: { x: 10, y: 10 } },
                { controls: [{ x: 10, y: 20 }], end: { x: 40, y: 40 } }
            ] };
        expect(w.cellGeometryIndex.findNearest(20, 10, [road])?.calle).toBe(road);
        road.bezierSegments[0].end.y = 40;
        expect(w.cellGeometryIndex.findNearest(20, 10, [road])).toBeNull();
        expect(w.cellGeometryIndex.findNearest(20, 40, [road])?.calle).toBe(road);
        road.bezierSegments[1].controls[0].x = 30;
        expect(w.cellGeometryIndex.findNearest(20, 40, [road])).toBeNull();
        expect(w.cellGeometryIndex.findNearest(40, 40, [road])?.calle).toBe(road);
    });
});
