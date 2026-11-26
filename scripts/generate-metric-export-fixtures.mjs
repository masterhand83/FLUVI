// Independent oracle: evaluate the unchanged v1 public export builders.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('apps/v1/src/js/core/graficas.js', root), 'utf8');
const extract = name => {
    const start = source.indexOf(`function ${name}(`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
};
const directory = new URL('crates/ca-app/tests/fixtures/metric-exports/', root);
mkdirSync(directory, { recursive: true });
const points = Array.from({ length: 55 }, (_, i) => ({
    second: i * 2,
    density: i === 0 ? 99.99 : i / 2,
    throughput: i / 4,
    netGeneration: (i % 5 - 2) / 2,
    speed: 100 - i,
    entropy: i / 1000
}));
writeFileSync(new URL('input.json', directory), JSON.stringify(points, null, 2) + '\n');
for (const language of ['es', 'en']) {
    for (const empty of [false, true]) {
        const data = empty ? [] : points;
        const history = {
            timestamps: data.map(p => `Miércoles 23:${String(58 + Math.floor(p.second / 60)).padStart(2, '0')}:${String(p.second % 60).padStart(2, '0')}`),
            density: data.map(p => p.density),
            throughput: data.map(p => p.throughput),
            netGeneration: data.map(p => p.netGeneration),
            speed: data.map(p => p.speed),
            entropy: data.map(p => p.entropy)
        };
        history.exportTimestamps = history.timestamps;
        const live = Object.fromEntries(Object.entries(history).map(([key, values]) => [key, values.slice(-50)]));
        const result = runInNewContext(`
            ${extract('construirMetricasCSV')}
            ${extract('construirMetricasJSON')}
            [construirMetricasCSV(), construirMetricasJSON(), construirMetricasJSON(completeMetricsHistory)]
        `, {
            completeMetricsHistory: history,
            metricsHistory: live,
            Date: class extends Date { constructor() { super('2026-11-26T12:34:56.789Z'); } },
            window: {
                fluviI18n: { activeLanguage: language },
                configuracionTiempo: { horaActual: 23, minutoActual: 59, segundoActual: 48, usarPerfiles: true },
                SEGUNDOS_POR_PASO: 2,
                obtenerTimestampExportacion: () => 'Miércoles 23:59:48',
                obtenerDiaExportacion: () => 'Miércoles',
                obtenerMultiplicadorTrafico: () => 0,
                obtenerDescripcionTrafico: () => 'Tráfico muy bajo'
            }
        });
        for (const [index, name] of ['all.csv', 'live.json', 'all.json'].entries()) {
            const path = new URL(`${empty ? 'empty-' : ''}${name}`, directory);
            if (language === 'es') writeFileSync(path, result[index].content);
            else if (readFileSync(path, 'utf8') !== result[index].content) throw new Error('Language changed export');
        }
    }
}
