import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { openSimulator } from './helpers/simulator.mjs'

const analyzerPath = fileURLToPath(new URL('../src/python/analizador.py', import.meta.url))
const pythonHelperPath = fileURLToPath(new URL('./helpers/read_metrics_export.py', import.meta.url))
const legacyCsvPath = fileURLToPath(new URL('./fixtures/legacy-metrics.csv', import.meta.url))
const legacyJsonPath = fileURLToPath(new URL('./fixtures/legacy-metrics.json', import.meta.url))

let simulator
afterEach(async () => {
    await simulator?.close()
    simulator = undefined
})

async function captureExports({ localizeDisplay = false } = {}) {
    simulator = await openSimulator()
    await simulator.page.waitForFunction(
        () => typeof Chart !== 'undefined' && typeof densityChartInstance !== 'undefined' && densityChartInstance !== null,
        { polling: 100, timeout: 10000 },
    )

    const result = await simulator.page.evaluate(async (localizeDisplay) => {
        // Start from a known clock and no history from page startup.
        window.resetSimulationMetrics()
        Object.assign(window.configuracionTiempo, {
            activo: true,
            diaActual: 1, // Lunes
            horaActual: 7,
            minutoActual: 0,
            segundoActual: 0,
            usarPerfiles: true,
        })

        const spanishDisplay = {
            day: window.obtenerDiaString(),
            full: window.obtenerTimestampVirtual(),
            short: window.obtenerTimestampCorto(),
        }

        let arrayDay = null
        if (localizeDisplay) {
            // Simulate a future translated display layer. Export formatting must
            // remain the legacy Spanish/numeric format regardless of these.
            window.NOMBRES_DIAS[1] = 'Monday'
            arrayDay = window.obtenerDiaString()
            window.obtenerDiaString = () => 'Monday'
            window.obtenerTimestampVirtual = () => 'Monday 7:00 AM'
            window.obtenerTimestampCorto = () => '7:00 AM'
        }

        const recordSample = () => {
            for (let i = 0; i < 10; i++) window.updateMetrics()
        }
        recordSample()
        window.configuracionTiempo.segundoActual = 2
        recordSample()

        const display = {
            day: window.obtenerDiaString(),
            full: window.obtenerTimestampVirtual(),
            short: window.obtenerTimestampCorto(),
            chartLabels: densityChartInstance?.data?.labels ?? null,
        }
        const blobs = []
        const downloads = []
        const originalCreateObjectURL = URL.createObjectURL
        const originalAnchorClick = HTMLAnchorElement.prototype.click
        URL.createObjectURL = blob => {
            blobs.push(blob)
            return `blob:metrics-export-${blobs.length}`
        }
        HTMLAnchorElement.prototype.click = function () {
            downloads.push({ name: this.download, blob: blobs.at(-1) })
        }
        try {
            document.getElementById('btnDescargarCSV').click()
            document.getElementById('btnDescargarJSON').click()
        } finally {
            URL.createObjectURL = originalCreateObjectURL
            HTMLAnchorElement.prototype.click = originalAnchorClick
        }

        const csvDownload = downloads.find(download => download.name.endsWith('.csv'))
        const jsonDownload = downloads.find(download => download.name.endsWith('.json'))
        return {
            csv: await csvDownload.blob.text(),
            json: await jsonDownload.blob.text(),
            names: downloads.map(download => download.name),
            display,
            spanishDisplay,
            arrayDay,
        }
    }, localizeDisplay)

    expect(simulator.pageErrors).toEqual([])
    expect(simulator.consoleErrors).toEqual([])
    return result
}

function pythonCommand() {
    const direct = spawnSync('python3', ['-c', 'import pandas, numpy, matplotlib, scipy'], { encoding: 'utf8' })
    if (direct.status === 0) return { command: 'python3', args: [] }

    const uv = spawnSync('uv', ['--version'], { encoding: 'utf8' })
    if (uv.status === 0) {
        return {
            command: 'uv',
            args: ['run', '--quiet', '--with', 'pandas', '--with', 'numpy', '--with', 'matplotlib', '--with', 'scipy', 'python'],
        }
    }
    throw new Error('The Python analyzer test requires python3 with pandas/numpy/matplotlib/scipy, or uv.')
}

function parseWithAnalyzer(files) {
    const { command, args } = pythonCommand()
    const result = spawnSync(command, [
        ...args,
        pythonHelperPath,
        '--analizador', analyzerPath,
        '--legacy-csv', files.legacyCsv,
        '--legacy-json', files.legacyJson,
        '--new-csv', files.newCsv,
        '--new-json', files.newJson,
    ], {
        encoding: 'utf8',
        env: { ...process.env, MPLBACKEND: 'Agg', PYTHONDONTWRITEBYTECODE: '1' },
        timeout: 120000,
    })
    if (result.status !== 0) {
        throw new Error(`Python analyzer failed:\n${result.stderr || result.stdout}`)
    }
    return JSON.parse(result.stdout)
}

test('display translations cannot change export timestamps or metadata', async () => {
    const exported = await captureExports({ localizeDisplay: true })

    expect(exported.spanishDisplay).toEqual({
        day: 'Lunes',
        full: 'Lunes 07:00:00',
        short: '07:00:00',
    })
    expect(exported.arrayDay).toBe('Monday')
    expect(exported.display).toEqual({
        day: 'Monday',
        full: 'Monday 7:00 AM',
        short: '7:00 AM',
        chartLabels: ['7:00 AM', '7:00 AM'],
    })
    expect(exported.names).toEqual([
        'metricas_trafico_Lunes_07h00m.csv',
        'metricas_trafico_Lunes_07h00m.json',
    ])

    const lines = exported.csv.split('\n')
    expect(lines.slice(0, 5)).toEqual([
        'FLUVI - Simulador de Trafico - Exportacion de Metricas',
        'Tiempo Virtual: Lunes 07:00:02',
        'Perfiles Dinamicos Activos: Si',
        'Tiempo por Paso: 2 segundo(s) simulados',
        'Total de Mediciones: 2',
    ])
    expect(lines[5]).toBe('')
    expect(lines[6]).toBe('Marca de Tiempo,Densidad (%),Flujo (veh/s),Generacion Neta (veh/s),Velocidad (% movimiento),Entropia (bits)')
    expect(lines.slice(7, 9).map(line => line.split(',')[0])).toEqual(['07:00:00', '07:00:02'])
    expect(lines.slice(9, 12)).toEqual(['', 'ESTADISTICAS', 'Metrica,Promedio,Minimo,Maximo'])
    expect(lines.slice(12, 17).map(line => line.split(',')[0])).toEqual([
        'Densidad (%)',
        'Flujo (veh/s)',
        'Generacion Neta (veh/s)',
        'Velocidad (% movimiento)',
        'Entropia (bits)',
    ])
    for (const line of lines.slice(12, 17)) {
        const [, average, minimum, maximum] = line.split(',')
        for (const value of [average, minimum, maximum]) {
            expect(value).toMatch(/^-?\d+\.\d{2}$/)
        }
    }

    const json = JSON.parse(exported.json)
    expect(json.metadata.version).toBe('2.2')
    expect(json.metadata.virtualTime).toMatchObject({
        currentTime: 'Lunes 07:00:02',
        day: 'Lunes',
        hour: 7,
        minute: 0,
        second: 2,
        profilesActive: true,
        secondsPerStep: 2,
    })
    expect(typeof json.metadata.virtualTime.currentMultiplier).toBe('number')
    expect(typeof json.metadata.virtualTime.trafficDescription).toBe('string')
    expect(json.metrics.timestamps).toEqual(['07:00:00', '07:00:02'])
    expect(Object.keys(json.metrics)).toEqual([
        'timestamps', 'density', 'throughput', 'netGeneration', 'speed', 'entropy',
    ])
    expect(json.statistics.density.avg).toMatch(/^-?\d+\.\d{2}$/)
    expect(json.metadata.metricsDescription.density).toBe('Porcentaje de celdas ocupadas')
})

test('preserves Spanish clock displays and numeric day rollover', async () => {
    simulator = await openSimulator()
    const result = await simulator.page.evaluate(() => {
        Object.assign(window.configuracionTiempo, {
            activo: true,
            diaActual: 6, // Sábado
            horaActual: 23,
            minutoActual: 59,
            segundoActual: 59,
            usarPerfiles: true,
        })
        window.isPaused = false
        const read = () => ({
            dayIndex: window.configuracionTiempo.diaActual,
            display: window.obtenerTimestampVirtual(),
            exportTime: window.obtenerTimestampExportacion(),
            exportShort: window.obtenerTimestampCortoExportacion(),
            exportDay: window.obtenerDiaExportacion(),
        })
        const before = read()
        window.avanzarTiempo()
        return { before, after: read() }
    })

    expect(result.before).toEqual({
        dayIndex: 6,
        display: 'Sábado 23:59:59',
        exportTime: 'Sábado 23:59:59',
        exportShort: '23:59:59',
        exportDay: 'Sábado',
    })
    expect(result.after).toEqual({
        dayIndex: 0,
        display: 'Domingo 00:00:01',
        exportTime: 'Domingo 00:00:01',
        exportShort: '00:00:01',
        exportDay: 'Domingo',
    })
    expect(simulator.pageErrors).toEqual([])
})

test('legacy and newly generated CSV/JSON remain readable by the Python analyzer', async () => {
    // Use a translated-display session so the Python check protects the
    // compatibility property rather than only the default Spanish path.
    const exported = await captureExports({ localizeDisplay: true })
    const directory = await mkdtemp(join(tmpdir(), 'fluvi-export-reader-'))
    const files = {
        legacyCsv: legacyCsvPath,
        legacyJson: legacyJsonPath,
        newCsv: join(directory, 'new.csv'),
        newJson: join(directory, 'new.json'),
    }

    try {
        await writeFile(files.newCsv, exported.csv)
        await writeFile(files.newJson, exported.json)
        // Sanity-check the legacy fixture layout before invoking the reader.
        expect(await readFile(files.legacyCsv, 'utf8')).toContain('Marca de Tiempo,Densidad (%)')
        const parsed = parseWithAnalyzer(files)

        expect(parsed.legacyCsv).toMatchObject({
            rows: 3,
            timestamps: ['23:59:58', '00:00:00', '00:00:02'],
            days: ['Lunes', 'Martes', 'Martes'],
            density: [12.34, 13, 13.5],
        })
        expect(parsed.legacyJson).toMatchObject({
            rows: 2,
            timestamps: ['07:00:00', '07:00:02'],
            days: ['Lunes', 'Lunes'],
            density: [10.5, 11.25],
        })
        expect(parsed.newCsv).toMatchObject({
            rows: 2,
            timestamps: ['07:00:00', '07:00:02'],
            days: ['Lunes', 'Lunes'],
        })
        expect(parsed.newJson).toMatchObject({
            rows: 2,
            timestamps: ['07:00:00', '07:00:02'],
            days: ['Lunes', 'Lunes'],
        })
        for (const summary of Object.values(parsed)) {
            expect(summary.columns).toEqual(expect.arrayContaining([
                'Marca_Tiempo', 'Densidad', 'Flujo', 'Generacion', 'Velocidad', 'Entropia',
            ]))
        }
        expect(parsed.newJson.density).toEqual(parsed.newCsv.density)
        expect(parsed.newJson.tiempoSeg).toEqual(parsed.newCsv.tiempoSeg)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
