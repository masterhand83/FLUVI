import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('../src/js/core/trafico.js', import.meta.url), 'utf8');
const arrows = source.slice(source.indexOf('function dibujarDireccionesCarriles('), source.indexOf('// Función para dibujar calle con curvas'));
const vehicles = source.slice(source.indexOf('function dibujarCarros()'), source.indexOf('// Función para dibujar todas las conexiones'));

function canvasFor(street) {
    const rotations = [];
    const ctx = new Proxy({ rotations }, {
        get(target, key) {
            if (key === 'rotate') return angle => rotations.push(angle);
            if (key in target) return target[key];
            return () => {};
        },
        set(target, key, value) { target[key] = value; return true; }
    });
    const window = {
        getLaneDirection: (road, lane) => road.laneDirections?.[lane] ?? 1,
        obtenerCoordenadasGlobalesCeldaConCurva: (_road, lane, index) => ({ x: index * 5, y: lane * 5, angulo: 15 })
    };
    const context = { window, ctx, calles: [street], celda_tamano: 5,
        obtenerCoordenadasGlobalesCelda: (_road, lane, index) => ({ x: index * 5, y: lane * 5 }),
        obtenerCoordenadasGlobalesCeldaConCurva: window.obtenerCoordenadasGlobalesCeldaConCurva,
        obtenerImagenVehiculo: () => ({ complete: true, naturalHeight: 5 }),
        obtenerColorVehiculo: () => 'red' };
    runInNewContext(`const getLaneDirection = window.getLaneDirection;\n${arrows}\n${vehicles}\nwindow.drawArrows = dibujarDireccionesCarriles; window.drawCars = dibujarCarros;`, context);
    return { window, rotations };
}

it('shows opposing arrows and turns straight vehicles around without changing their cells', () => {
    const street = { tamano: 3, carriles: 2, x: 0, y: 0, angulo: 0,
        laneDirections: [-1, 1], arreglo: [[0, 2, 0], [0, 2, 0]] };
    const { window, rotations } = canvasFor(street);
    window.drawArrows(street);
    expect(rotations.filter(angle => angle === Math.PI)).toHaveLength(3);
    rotations.length = 0;
    window.drawCars();
    expect(rotations).toEqual([-0, Math.PI]);
    expect(street.arreglo).toEqual([[0, 2, 0], [0, 2, 0]]);
});

it('uses the curved vehicle path and reverses its local tangent for Bezier streets', () => {
    const street = { tamano: 2, carriles: 1, x: 0, y: 0, angulo: 0,
        esCurva: true, bezierGeometry: true, vertices: [], laneDirections: [-1], arreglo: [[0, 3]] };
    const { window, rotations } = canvasFor(street);
    window.drawCars();
    expect(rotations).toEqual([Math.PI - Math.PI / 12]);
});
