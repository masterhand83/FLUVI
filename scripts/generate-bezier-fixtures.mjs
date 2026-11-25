// Independent reference: execute v1's public geometry API, without browser setup.
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const window = { celda_tamano: 5 };
runInNewContext(readFileSync('apps/v1/src/js/core/bezierStreet.js', 'utf8'), { window });
const cases = [
    { nombre: 'Quadratic', x: 10, y: 20, endX: 110, endY: 20,
        bezierControls: [{ x: 60, y: 70 }] },
    { nombre: 'Cubic', x: -20, y: 5, endX: 100, endY: 60,
        bezierControls: [{ x: 0, y: -40 }, { x: 80, y: 100 }] },
    { nombre: 'Rounded seam', x: 0, y: 0, endX: 100, endY: 100,
        bezierControls: [], bezierSegments: [
            { controls: [], end: { x: 100, y: 0 } },
            { controls: [], end: { x: 100, y: 100 } },
        ] },
    { nombre: 'Fold', x: 0, y: 0, endX: 100, endY: 0,
        bezierControls: [{ x: 200, y: 100 }, { x: -100, y: 100 }] },
];
const fixtures = cases.map(fields => {
    const street = { tipo: 'conexion', angulo: 0, tamano: 20, carriles: 2,
        esCurva: true, bezierGeometry: true, vertices: [], ...fields };
    const validation = window.streetBezier.validate(street);
    street.tamano = validation.cells;
    return {
        street, valid: validation.valid,
        centers: Array.from({ length: street.carriles }, (_, lane) =>
            Array.from({ length: street.tamano }, (_, index) => {
                const p = window.streetBezier.coordinates(street, lane, index);
                return [p.x / 5, p.y / 5];
            })),
    };
});
writeFileSync('crates/ca-core/tests/fixtures/bezier-v1.json', `${JSON.stringify(fixtures, null, 2)}\n`);
