import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const metricsSource = readFileSync(new URL('../src/js/core/graficas.js', import.meta.url), 'utf8');
const exportSource = readFileSync(new URL('../src/js/ui/exportarImagenesMetricas.js', import.meta.url), 'utf8');
const esCatalog = JSON.parse(readFileSync(new URL('../src/locales/es/translation.json', import.meta.url), 'utf8'));

function catalogValue(key) {
    return key.split('.').reduce((value, part) => value?.[part], esCatalog);
}

function tr(key, params = {}) {
    let value = catalogValue(key);
    if (value === undefined && 'count' in params) {
        value = catalogValue(`${key}_${params.count === 1 ? 'one' : 'other'}`);
    }
    if (value === undefined) throw new Error(`Missing catalog key: ${key}`);
    return String(value).replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (match, name) => name in params ? String(params[name]) : match);
}

function openExport(sampleCount) {
    const charts = [];
    const files = [];
    const downloads = [];
    const context2d = new Proxy({}, { get: (_, key) => {
        if (key === 'measureText') return text => ({ width: text.length * 12 });
        if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
        return () => {};
    } });
    const canvas = () => ({ width: 1600, height: 900, getContext: () => context2d,
        toBlob: callback => callback(new Blob(['png'])) });
    const mapCanvas = canvas();
    const button = {
        disabled: false, textContent: 'Exportar todo (ZIP)',
        addEventListener(_, listener) { this.click = listener; },
        querySelector() { return null; }
    };
    const panel = { querySelector: () => null, querySelectorAll: () => [] };
    const document = {
        addEventListener(_, listener) { listener(); },
        getElementById: id => id === 'btnExportarTodo' ? button
            : id === 'statusPanel' ? panel
                : id === 'simuladorCanvas' ? mapCanvas
                    : id.endsWith('Chart') ? canvas() : null,
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
        this.file = (name, data) => files.push({ name, data });
        this.generateAsync = async () => new Blob(['zip']);
    }
    const window = {
        calles: [], addEventListener() {}, JSZip, Chart, tr, USE_PIXI: false,
        construirMetricasCSV: null, construirMetricasJSON: null,
        analizarMetricasParaExportacion: async () => ({
            estadisticas: { columns: ['index', 'Densidad'], rows: [['mean', 1]] },
            capacidad: { capacidad_maxima: 1 },
            imagenes: {
                temporal: 'data:image/png;base64,AQID',
                fundamentales: 'data:image/png;base64,BAUG',
                distribuciones: 'data:image/png;base64,BwgJ'
            }
        }),
        obtenerTimestampCorto: () => '07:00:00',
        obtenerTimestampExportacion: () => '2024-01-02 07:00:00',
        obtenerDiaExportacion: () => '2024-01-02',
        configuracionTiempo: { usarPerfiles: true, horaActual: 7, minutoActual: 0, segundoActual: 0 },
        SEGUNDOS_POR_PASO: 2,
        heatmapModal: {
            render: () => ({ width: 100, height: 100 }),
            getColorForDensity: () => '#ffffff'
        }
    };
    const context = {
        window, document, Chart, JSZip, Blob, Uint8Array, atob, console, tr,
        SEGUNDOS_POR_PASO: 2,
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
        ${exportSource}
    `, context);
    return { button, charts, files, downloads, window };
}

it('exports one ZIP with every metric, Python results, charts, map, summary, and heatmap', async () => {
    const app = openExport(3);
    const historiesBefore = JSON.stringify(app.window.histories);
    await app.button.click();

    const names = app.files.map(file => file.name);
    expect(names).toEqual(expect.arrayContaining([
        'metricas.csv',
        'metricas.json',
        'resumen.png',
        'mapa_actual.png',
        'mapa_de_calor.png',
        'graficas/densidad.png',
        'graficas/flujo_vehicular.png',
        'graficas/velocidad.png',
        'graficas/tasa_de_cambio.png',
        'graficas/entropia.png',
        'analisis_metricas.json',
        'analisis_temporal.png',
        'diagrama_fundamental.png',
        'distribuciones_correlaciones.png'
    ]));

    const csv = app.files.find(file => file.name === 'metricas.csv').data;
    expect(csv).toContain('Total de Mediciones: 3');
    expect(csv).toContain('Densidad (%)');

    const json = JSON.parse(app.files.find(file => file.name === 'metricas.json').data);
    expect(json.metadata.totalDataPoints).toBe(3);
    expect(json.metrics.density).toEqual([0, 1, 2]);

    const python = JSON.parse(app.files.find(file => file.name === 'analisis_metricas.json').data);
    expect(python.analysis.estadisticas.columns).toEqual(['index', 'Densidad']);
    expect(python.analysis.imagenes).toBeUndefined();

    const temporal = await app.files.find(file => file.name === 'analisis_temporal.png').data.arrayBuffer();
    expect([...new Uint8Array(temporal)]).toEqual([1, 2, 3]);

    expect(app.downloads).toHaveLength(1);
    expect(app.button.disabled).toBe(false);
    expect(app.button.textContent).toBe('Exportar todo (ZIP)');
    expect(JSON.stringify(app.window.histories)).toBe(historiesBefore);
});

it('still creates the ZIP and reports a warning when Python analysis fails', async () => {
    const app = openExport(3);
    app.window.analizarMetricasParaExportacion = async () => { throw new Error('Pyodide no disponible'); };
    await app.button.click();

    const names = app.files.map(file => file.name);
    expect(names).toContain('metricas.csv');
    expect(names).toContain('mapa_actual.png');
    expect(names).toContain('analisis_python_error.txt');
    expect(names).not.toContain('analisis_metricas.json');
    expect(app.files.find(file => file.name === 'analisis_python_error.txt').data).toBe('Pyodide no disponible');
    expect(app.downloads).toHaveLength(1);
    expect(app.button.disabled).toBe(false);
});
