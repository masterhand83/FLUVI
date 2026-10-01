import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('../src/js/core/graficas.js', import.meta.url), 'utf8');

function openMetrics() {
    let calendarMillis = 0;
    const street = { tamano: 8, carriles: 1, arreglo: [[1, 2, 0, 0, 0, 0, 0, 0]] };
    const window = {
        calles: [street],
        addEventListener() {},
        obtenerMillisVirtuales: () => calendarMillis,
        obtenerTimestampCorto: () => '07:00:00'
    };
    const document = { addEventListener() {}, getElementById: () => null };
    runInNewContext(`${source}
        window.calculateMetrics = calculateMetrics;
        window.getNetGenerationLabel = getNetGenerationLabel;
        window.interpretarMetricas = interpretarMetricas;
        window.metricsHistory = metricsHistory;
        window.completeMetricsHistory = completeMetricsHistory;
    `, { window, document, console, SEGUNDOS_POR_PASO: 2 });
    return {
        window,
        street,
        sample: () => Number(window.calculateMetrics().netGeneration),
        steps(count, advanceCalendar = true) {
            for (let i = 0; i < count; i++) {
                if (advanceCalendar) calendarMillis += 2000;
                window.updateMetrics();
            }
        },
        setCalendar(value) { calendarMillis = value; }
    };
}

it('initializes population and time together, without reporting unchanged vehicles as growth', () => {
    const metrics = openMetrics();
    expect(metrics.sample()).toBe(0);
    metrics.steps(1);
    expect(metrics.sample()).toBe(0);
});

it('preserves the sign of population decreases and increases', () => {
    const metrics = openMetrics();
    metrics.sample();
    metrics.street.arreglo[0][1] = 0;
    metrics.steps(1);
    expect(metrics.sample()).toBe(-0.5);
    metrics.street.arreglo[0][1] = 2;
    metrics.steps(1);
    expect(metrics.sample()).toBe(0.5);
});

it('uses completed steps, not frozen, edited, or wrapped calendar time', () => {
    for (const calendar of [0, -604800000, 604800000]) {
        const metrics = openMetrics();
        metrics.sample();
        metrics.street.arreglo[0][1] = 0;
        metrics.setCalendar(calendar);
        // Calendar edits and reads are not simulation steps.
        expect(metrics.sample()).toBe(0);
        metrics.steps(3, false);
        // One vehicle lost over three two-second steps.
        expect(metrics.sample()).toBe(-0.17);
        expect(metrics.sample()).toBe(-0.17);
    }
});

it('starts a fresh baseline when the selected streets change', () => {
    const metrics = openMetrics();
    const { window } = metrics;
    window.calles.push({ tamano: 2, carriles: 1, arreglo: [[3, 4]] });
    metrics.sample();
    for (const select of [
        () => window.excluirCalle(1),
        () => window.incluirCalle(1),
        () => window.excluirTodasLasCalles(),
        () => window.incluirTodasLasCalles()
    ]) {
        select();
        metrics.steps(1);
        expect(metrics.sample()).toBe(0);
        metrics.steps(1);
        expect(metrics.sample()).toBe(0);
    }
    metrics.street.arreglo[0][1] = 0;
    metrics.steps(1);
    expect(metrics.sample()).toBe(-0.5);
});

it('allows negative rates on the chart and describes them as population decreases', () => {
    let chart;
    function Chart(element, config) { chart = config; }
    const window = { Chart, addEventListener() {} };
    const document = {
        addEventListener() {},
        getElementById: id => id === 'netGenerationChart' ? {} : null
    };
    runInNewContext(source, { window, document, Chart, console, SEGUNDOS_POR_PASO: 2 });
    window.initializeCharts();
    expect(chart.options.scales.y.min).toBeUndefined();
    const tooltip = chart.options.plugins.tooltip.callbacks.label({ parsed: { y: -0.5 } });
    expect(tooltip).toContain('Decrecimiento lento');
    expect(tooltip).toContain('-0.5 vehículos/seg simulado');
});

it('uses all completed steps between throttled samples and stores signed values in both histories', () => {
    const metrics = openMetrics();
    metrics.steps(10); // First scheduled sample initializes the baseline.
    metrics.street.arreglo[0][1] = 0;
    metrics.steps(10);
    // One vehicle lost over twenty simulated seconds, not one rendering frame.
    expect(metrics.sample()).toBe(-0.05);
    expect(Array.from(metrics.window.metricsHistory.netGeneration)).toEqual([0, -0.05]);
    expect(Array.from(metrics.window.completeMetricsHistory.netGeneration)).toEqual([0, -0.05]);
});

it('resets rate state with the simulation and detects index-based scope changes after road removal', () => {
    const metrics = openMetrics();
    metrics.sample();
    metrics.street.arreglo[0][1] = 0;
    metrics.steps(1);
    expect(metrics.sample()).toBe(-0.5);
    metrics.window.resetSimulationMetrics();
    expect(metrics.sample()).toBe(0);
    metrics.steps(1);
    expect(metrics.sample()).toBe(0);

    metrics.window.calles.push({ tamano: 2, carriles: 1, arreglo: [[3, 4]] });
    metrics.window.excluirCalle(1);
    metrics.sample();
    metrics.window.calles.shift(); // Index 0 now refers to a different street.
    metrics.steps(1);
    expect(metrics.sample()).toBe(0);
});

it('describes population decreases consistently in every traffic-status branch', () => {
    const metrics = openMetrics();
    for (const [density, speed] of [[90, 0], [40, 70], [70, 20], [10, 80], [50, 40]]) {
        const status = metrics.window.interpretarMetricas({ density, speed, throughput: 1, netGeneration: -0.5 });
        expect(status.observaciones.join(' ')).toContain('Decrecimiento lento');
        expect(status.observaciones).not.toContain('Población estable');
    }
});
