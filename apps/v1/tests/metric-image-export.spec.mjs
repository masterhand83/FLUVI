import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const metricsSource = readFileSync(new URL('../src/js/core/graficas.js', import.meta.url), 'utf8');
const exportSource = readFileSync(new URL('../src/js/ui/exportarImagenesMetricas.js', import.meta.url), 'utf8');

function openExport(sampleCount) {
    const charts = [];
    const texts = [];
    const files = [];
    const downloads = [];
    const button = { disabled: false, textContent: 'Exportar imágenes', addEventListener(_, listener) { this.click = listener; } };
    const context2d = new Proxy({}, { get: (_, key) => {
        if (key === 'measureText') return text => ({ width: text.length * 12 });
        if (key === 'fillText') return text => texts.push(text);
        if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
        return () => {};
    } });
    const canvas = () => ({ getContext: () => context2d, toBlob: callback => callback(new Blob(['png'])) });
    const panel = { querySelector: () => null, querySelectorAll: () => [] };
    const document = {
        addEventListener(_, listener) { listener(); },
        getElementById: id => id === 'btnExportarImagenes' ? button : id === 'statusPanel' ? panel : id.endsWith('Chart') ? canvas() : null,
        createElement: type => type === 'canvas' ? canvas() : { style: {}, click() {}, remove() {}, setAttribute() {} },
        body: { appendChild() {}, removeChild() {} }
    };
    function Chart(_, config) {
        this.config = config;
        this.data = config.data;
        this.update = () => {};
        this.destroy = () => {};
        charts.push(this);
    }
    function JSZip() {
        this.file = name => files.push(name);
        this.generateAsync = async () => new Blob(['zip']);
    }
    const window = {
        calles: [], addEventListener() {}, JSZip, Chart,
        obtenerTimestampCorto: () => '07:00:00',
        heatmapModal: { render: () => ({ width: 100, height: 100 }), getColorForDensity: () => '#ffffff' }
    };
    const context = {
        window, document, Chart, JSZip, Blob, console, SEGUNDOS_POR_PASO: 2,
        URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:export'; }, revokeObjectURL() {} },
        setTimeout() {}, mostrarAdvertencia() {}, mostrarError: message => { throw new Error(message); }
    };
    runInNewContext(`${metricsSource}
        for (let i = 0; i < ${sampleCount}; i++) {
            updateMetricsHistory({ density: i, throughput: i + 1, speed: i + 2, netGeneration: -i, entropy: i + 3 });
        }
        initializeCharts();
        updateCharts();
        window.histories = { metricsHistory, completeMetricsHistory };
        window.exportJSON = descargarMetricasJSON;
        ${exportSource}
    `, context);
    return { button, charts, texts, files, downloads, window };
}

it.each([3, 75])('exports all %i recorded samples without changing the live charts or JSON window', async sampleCount => {
    const app = openExport(sampleCount);
    const liveCharts = app.charts.slice();
    const liveData = liveCharts.map(chart => JSON.stringify(chart.data));
    const historiesBefore = JSON.stringify(app.window.histories);
    await app.button.click();

    const exportedCharts = app.charts.slice(5);
    expect(exportedCharts).toHaveLength(5);
    const keys = ['density', 'throughput', 'speed', 'netGeneration', 'entropy'];
    exportedCharts.forEach((chart, index) => {
        expect(chart.data.labels).toEqual(app.window.histories.completeMetricsHistory.timestamps);
        expect(chart.data.datasets[0].data).toEqual(app.window.histories.completeMetricsHistory[keys[index]]);
        expect(chart.data.labels).toHaveLength(sampleCount);
        expect(chart.data.datasets[0].data).not.toBe(app.window.histories.completeMetricsHistory[keys[index]]);
    });
    expect(app.texts).toContain(`Gráficas: historial completo (${sampleCount} mediciones desde la última limpieza o reinicio).`);
    expect(app.files).toHaveLength(7);
    expect(app.button.disabled).toBe(false);
    expect(app.button.textContent).toBe('Exportar imágenes');
    expect(liveCharts.map(chart => JSON.stringify(chart.data))).toEqual(liveData);
    expect(JSON.stringify(app.window.histories)).toBe(historiesBefore);

    app.window.exportJSON();
    const json = JSON.parse(await app.downloads.at(-1).text());
    expect(json.metadata.totalDataPoints).toBe(Math.min(sampleCount, 50));
    expect(json.metrics.density).toEqual(app.window.histories.metricsHistory.density);
});
