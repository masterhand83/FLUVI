import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('../src/js/core/graficas.js', import.meta.url), 'utf8');
const calculate = source.slice(source.indexOf('function calculateMetrics()'), source.indexOf('/**\n * Actualiza el historial'));

it('measures free space in the travel direction of each lane', () => {
    const street = { tamano: 4, carriles: 2, laneDirections: [-1, 1], arreglo: [[0, 1, 2, 0], [0, 1, 2, 0]] };
    const window = { calles: [street], getLaneDirection: (road, lane) => road.laneDirections[lane] };
    const context = { window, Map, console };
    runInNewContext(`let metricsUpdateCounter = 1, ENTROPY_UPDATE_INTERVAL = 60;
        let callesIncluidasEnMetricas = null, previousStreetStates = new Map();
        let lastEntropyValue = 0, lastFlowMeasure = null, lastFlowValue = 0, previousCarCount = 0;
        ${calculate}
        window.calculateMetricsForTest = calculateMetrics;`, context);

    // Reverse lane: cell 1 sees empty cell 0; forward lane: cell 2 sees empty cell 3.
    expect(window.calculateMetricsForTest().speed).toBe('50.00');
    street.laneDirections[0] = 1;
    street.arreglo[0] = [0, 1, 2, 2];
    expect(window.calculateMetricsForTest().speed).toBe('40.00');
});
