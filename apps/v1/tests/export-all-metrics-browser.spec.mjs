import { afterAll, beforeAll, expect, test } from 'vitest'
import { openSimulator } from './helpers/simulator.mjs'

const simulators = []

beforeAll(async () => {
    simulators.push(await openSimulator({ usePixi: false }))
    simulators.push(await openSimulator({ usePixi: true }))
}, 120000)

afterAll(async () => {
    for (const simulator of simulators) await simulator?.close()
})

async function exportCompleteZip(page) {
    return page.evaluate(async () => {
        clearMetricHistories()
        for (let i = 0; i < 10; i++) document.getElementById('btnPaso').click()
        updateMetricsHistory(calculateMetrics())
        updateCharts()

        const sample = document.createElement('canvas')
        sample.width = 2
        sample.height = 2
        const sampleContext = sample.getContext('2d')
        sampleContext.fillStyle = '#ff0000'
        sampleContext.fillRect(0, 0, 2, 2)
        const image = sample.toDataURL('image/png')
        window.analizarMetricasParaExportacion = async () => ({
            estadisticas: { columns: ['index', 'Densidad'], rows: [['mean', 1]] },
            capacidad: { capacidad_maxima: 1 },
            imagenes: { temporal: image, fundamentales: image, distribuciones: image },
        })

        const originalCreate = URL.createObjectURL
        let exported
        URL.createObjectURL = blob => { exported = blob; return originalCreate(blob) }
        document.getElementById('btnExportarTodo').click()
        while (document.getElementById('btnExportarTodo').disabled) {
            await new Promise(resolve => setTimeout(resolve, 20))
        }
        URL.createObjectURL = originalCreate
        if (!exported) return { error: 'No ZIP produced' }

        const zip = await JSZip.loadAsync(exported)
        const names = Object.keys(zip.files).sort()
        const csv = await zip.file('metricas.csv').async('string')
        const json = JSON.parse(await zip.file('metricas.json').async('string'))
        const python = JSON.parse(await zip.file('analisis_metricas.json').async('string'))
        const map = await zip.file('mapa_actual.png').async('blob')
        const bitmap = await createImageBitmap(map)
        const pixels = document.createElement('canvas')
        pixels.width = bitmap.width
        pixels.height = bitmap.height
        const context = pixels.getContext('2d')
        context.drawImage(bitmap, 0, 0)
        const data = context.getImageData(0, 0, Math.min(bitmap.width, 400), Math.min(bitmap.height, 400)).data
        let colored = 0
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 0 && (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245)) colored++
        }
        bitmap.close()
        return {
            names,
            csvHasHeader: csv.includes('Marca de Tiempo,Densidad'),
            jsonPoints: json.metadata.totalDataPoints,
            pythonKeys: Object.keys(python.analysis).sort(),
            map: { width: pixels.width, height: pixels.height, colored },
            label: document.getElementById('btnExportarTodo').textContent.trim(),
            disabled: document.getElementById('btnExportarTodo').disabled,
        }
    })
}

test.each([
    ['Canvas 2D', 0],
    ['PixiJS', 1],
])('exports the complete ZIP from the %s renderer', async (_, index) => {
    const simulator = simulators[index]
    const result = await exportCompleteZip(simulator.page)
    expect(result.error, simulator.consoleErrors.join('\n')).toBeUndefined()
    expect(result.names).toEqual(expect.arrayContaining([
        'analisis_metricas.json',
        'analisis_temporal.png',
        'diagrama_fundamental.png',
        'distribuciones_correlaciones.png',
        'graficas/densidad.png',
        'graficas/entropia.png',
        'graficas/flujo_vehicular.png',
        'graficas/tasa_de_cambio.png',
        'graficas/velocidad.png',
        'mapa_actual.png',
        'mapa_de_calor.png',
        'metricas.csv',
        'metricas.json',
        'resumen.png',
    ]))
    expect(result.csvHasHeader).toBe(true)
    expect(result.jsonPoints).toBeGreaterThan(0)
    expect(result.pythonKeys).toEqual(['capacidad', 'estadisticas'])
    expect(result.map.width).toBeGreaterThan(0)
    expect(result.map.height).toBeGreaterThan(0)
    expect(result.map.colored).toBeGreaterThan(100)
    expect(result.label).toBe('Exportar todo (ZIP)')
    expect(result.disabled).toBe(false)
}, 60000)
