// Independent oracle: execute the v1 lane-change function with a seeded RNG.
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const traffic = readFileSync(new URL('apps/v1/src/js/core/trafico.js', root), 'utf8');
const rules = readFileSync(new URL('apps/v1/src/js/core/reglas.js', root), 'utf8');
const functions = ['getLaneDirection', 'cambioCarril', 'actualizarCalle'].map(name => {
    const start = traffic.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`Missing ${name}`);
    return traffic.slice(start, traffic.indexOf('\n}', start) + 2);
}).join('\n');
const cases = [
    { name: 'forward', cells: '010000000000000', directions: [1, 1, 1], probability: 1 },
    { name: 'reverse', cells: '000100000000000', directions: [-1, -1, -1], probability: 1 },
    { name: 'opposite', cells: '010000000000000', directions: [1, -1, 1], probability: 1 },
    { name: 'crossing', cells: '010000200000000', directions: [1, 1, 1], probability: 1 },
    { name: 'reserved', cells: '010000000003000', directions: [1, 1, 1], probability: 1 },
    { name: 'occupied', cells: '010000070000000', directions: [1, 1, 1], probability: 1 },
    { name: 'blocker', cells: '017000000000000', directions: [1, 1, 1], probability: 1 },
    { name: 'waiting-source', cells: '010000000000000', directions: [1, 1, 1], probability: 1, waiting: 1 },
    { name: 'waiting-target', cells: '010000000000000', directions: [1, 1, 1], probability: 1, waiting: 7 },
    { name: 'reverse-waiting-source', cells: '000100000000000', directions: [-1, -1, -1], probability: 1, waiting: 3 },
    { name: 'reverse-waiting-target', cells: '000100000000000', directions: [-1, -1, -1], probability: 1, waiting: 7 },
    { name: 'endpoints', cells: '100020000000000', directions: [1, 1, 1], probability: 1 },
    { name: 'zero', cells: '017000000000000', directions: [1, 1, 1], probability: 0 },
    { name: 'probability', cells: '012000000000340', directions: [1, 1, 1], probability: 0.4 },
];
const rows = ['name,seed,probability,directions,waiting,before,after,updated,updated_again'];
for (const scenario of cases) {
    for (const seed of [1, 2, 42, 43, 99]) {
        let state = BigInt(seed);
        const math = Object.create(Math);
        math.random = () => {
            state = BigInt.asUintN(64, state + 0x9e3779b97f4a7c15n);
            let z = state;
            z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
            z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
            return Number((z ^ (z >> 31n)) >> 11n) / 2 ** 53;
        };
        const cells = [...scenario.cells].map(Number);
        const street = {
            carriles: 3, tamano: 5, laneDirections: scenario.directions,
            probabilidadSaltoDeCarril: scenario.probability,
            arreglo: [cells.slice(0, 5), cells.slice(5, 10), cells.slice(10)],
            celulasEsperando: Array.from({ length: 3 }, (_, lane) =>
                Array.from({ length: 5 }, (_, index) => lane * 5 + index === scenario.waiting)),
        };
        const [changed, updated, updatedAgain] = runInNewContext(`
            ${rules}
            const TIPOS = { DEVORADOR: 'devorador' };
            function tieneConexionSalida() { return false; }
            ${functions}
            cambioCarril(street);
            const changed = street.arreglo.flat().join('');
            actualizarCalle(street, 0);
            const updated = street.arreglo.flat().join('');
            actualizarCalle(street, 0);
            [changed, updated, street.arreglo.flat().join('')];
        `, { Math: math, street, window: {} });
        rows.push([scenario.name, seed, scenario.probability,
            scenario.directions.map(d => d === 1 ? 'F' : 'R').join(''),
            scenario.waiting ?? '-', scenario.cells, changed, updated, updatedAgain].join(','));
    }
}
writeFileSync(new URL('crates/ca-core/tests/fixtures/lane-changes.csv', root), rows.join('\n') + '\n');
