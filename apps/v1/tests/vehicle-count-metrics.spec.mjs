import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('../src/js/core/graficas.js', import.meta.url), 'utf8');
const calculate = source.slice(source.indexOf('function calculateMetrics()'), source.indexOf('/**\n * Actualiza el historial'));

function measure(streets, included = null) {
    const window = { calles: streets };
    runInNewContext(`let metricsUpdateCounter = 1, ENTROPY_UPDATE_INTERVAL = 60;
        let callesIncluidasEnMetricas = included, previousStreetStates = new Map();
        let lastEntropyValue = 0, lastFlowMeasure = null, lastFlowValue = 0, previousCarCount = 0;
        let elapsedMetricSeconds = 0, previousMetricStreets = [];
        ${calculate}
        window.calculateMetricsForTest = calculateMetrics;`, { window, included, console });
    return window.calculateMetricsForTest();
}

it('does not count an obstacle as a vehicle or as moving traffic', () => {
    const metrics = measure([{ tamano: 4, carriles: 1, arreglo: [[7, 0, 0, 0]] }]);

    expect(metrics.totalCars).toBe(0);
    expect(metrics.density).toBe('0.00');
    expect(metrics.speed).toBe('0.00');
    expect(metrics.throughput).toBe('0.00');
});

it('counts all six vehicle types while retaining blocked cells in physical capacity', () => {
    const metrics = measure([{ tamano: 8, carriles: 1, arreglo: [[1, 2, 3, 4, 5, 6, 7, 0]] }]);

    expect(metrics.totalCars).toBe(6);
    expect(metrics.density).toBe('75.00');
    // The only empty successor belongs to the obstacle, not to a vehicle.
    expect(metrics.speed).toBe('0.00');
});

it('aggregates vehicles and physical cells only across included streets and lanes', () => {
    const streets = [
        { tamano: 4, carriles: 2, arreglo: [[1, 0, 7, 0], [6, 0, 7, 0]] },
        { tamano: 2, carriles: 1, arreglo: [[2, 3]] }
    ];

    const selected = measure(streets, new Set([0]));
    expect(selected.totalCars).toBe(2);
    expect(selected.density).toBe('25.00');
    expect(selected.speed).toBe('100.00');

    const all = measure(streets);
    expect(all.totalCars).toBe(4);
    expect(all.density).toBe('40.00');
    expect(all.speed).toBe('50.00');
});

it('reports zero vehicle occupancy for empty roads or an empty selected scope', () => {
    const streets = [{ tamano: 4, carriles: 1, arreglo: [[0, 0, 0, 0]] }];
    for (const metrics of [measure(streets), measure(streets, new Set()), measure([])]) {
        expect(metrics.totalCars).toBe(0);
        expect(metrics.density).toBe('0.00');
        expect(metrics.speed).toBe('0.00');
    }
});
