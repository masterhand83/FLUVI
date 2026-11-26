// Independent oracle: run the unchanged v1 metric calculator.
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('apps/v1/src/js/core/graficas.js', root), 'utf8');
const start = source.indexOf('function calculateMetrics()');
const calculator = source.slice(start, source.indexOf('\n}', start) + 2);
const cases = [
    { name: 'mixed', cells: [[1, 0, 7, 2, 0], [0, 3, 4, 0, 7]], directions: [1, -1] },
    { name: 'reverse', cells: [[0, 1, 2, 0, 7]], directions: [-1] },
    { name: 'ends-wrap', cells: [[0, 0, 0, 6]], directions: [1] },
    { name: 'blocked', cells: [[7, 7, 7, 7]], directions: [1] },
    { name: 'full', cells: [[1, 2, 3, 4, 5, 6]], directions: [1] },
    { name: 'empty', cells: [[0, 0, 0, 0]], directions: [1] },
    { name: 'rounding', cells: [[1, 2, 3, 0, 7, 0, 0]], directions: [1] },
    { name: 'binary-below-half', cells: [Array.from({ length: 400 }, (_, i) => [0, 2, 4].includes(i) ? 1 : 0)], directions: [1] },
    { name: 'exact-half', cells: [Array.from({ length: 80 }, (_, i) => i === 0 ? 1 : 0)], directions: [1] },
];
for (const item of cases) {
    item.expected = runInNewContext(`
        let previousCarCount = 0, elapsedMetricSeconds = 2;
        let previousMetricStreets = [], lastFlowMeasure = null, lastFlowValue = 0;
        let previousStreetStates = new Map(), lastEntropyValue = 0;
        let callesIncluidasEnMetricas = null, metricsUpdateCounter = 60;
        const ENTROPY_UPDATE_INTERVAL = 60;
        ${calculator}
        calculateMetrics();
        elapsedMetricSeconds += 2;
        calculateMetrics();
    `, { window: {
        calles: [{ carriles: item.cells.length, tamano: item.cells[0].length, arreglo: item.cells }],
        getLaneDirection: (_, lane) => item.directions[lane],
    } });
}
writeFileSync(new URL('crates/ca-core/tests/fixtures/metrics-v1.json', root), JSON.stringify(cases, null, 2) + '\n');
