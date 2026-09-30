import { afterAll, beforeAll, expect, test } from 'vitest'
import { openSimulator } from './helpers/simulator.mjs'

let simulator
beforeAll(async () => {
    simulator = await openSimulator()
    await simulator.page.waitForFunction(() => typeof Chart !== 'undefined' && densityChartInstance !== null && typeof JSZip !== 'undefined')
}, 60000)
afterAll(async () => { await simulator?.close() })

test('exports seven readable PNGs in a ZIP without changing hidden charts or opening the heatmap', async () => {
    const result = await simulator.page.evaluate(async () => {
        // Keep the metrics accordion hidden, and exercise dark-mode chart options.
        document.body.classList.add('dark-mode')
        actualizarColoresGraficas(true)
        for (let i = 0; i < 30; i++) document.getElementById('btnPaso').click()
        updateMetricsHistory(calculateMetrics())
        updateCharts()
        const source = JSON.stringify(densityChartInstance.data)
        const originalCreate = URL.createObjectURL
        let exported
        URL.createObjectURL = blob => { exported = blob; return originalCreate(blob) }
        document.getElementById('btnExportarImagenes').click()
        while (document.getElementById('btnExportarImagenes').disabled) {
            await new Promise(resolve => setTimeout(resolve, 20))
        }
        URL.createObjectURL = originalCreate
        if (!exported) return { error: 'No ZIP produced' }
        const zip = await JSZip.loadAsync(exported)
        const images = await Promise.all(Object.values(zip.files).map(async file => {
            const blob = new Blob([await file.async('uint8array')], { type: 'image/png' })
            const bitmap = await createImageBitmap(blob)
            const canvas = document.createElement('canvas')
            canvas.width = bitmap.width
            canvas.height = bitmap.height
            const ctx = canvas.getContext('2d')
            ctx.drawImage(bitmap, 0, 0)
            const pixel = [...ctx.getImageData(0, 0, 1, 1).data]
            const pixels = ctx.getImageData(48, 48, canvas.width - 96, canvas.height - 96).data
            let coloredPixels = 0
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i] < 240 || pixels[i + 1] < 240 || pixels[i + 2] < 240) coloredPixels++
            }
            bitmap.close()
            return { name: file.name, width: canvas.width, height: canvas.height, pixel, coloredPixels }
        }))
        return {
            images,
            unchanged: source === JSON.stringify(densityChartInstance.data),
            modalOpen: document.getElementById('modalMapaCalor').classList.contains('show'),
            buttonLabel: document.getElementById('btnExportarImagenes').textContent.trim()
        }
    })
    expect(result.error, simulator.consoleErrors.join('\n')).toBeUndefined()
    expect(result.images.map(image => image.name).sort()).toEqual([
        'densidad.png', 'entropia.png', 'flujo_vehicular.png', 'mapa_de_calor.png',
        'resumen.png', 'tasa_de_cambio.png', 'velocidad.png'
    ])
    for (const image of result.images) {
        expect(image.width).toBe(1600)
        expect(image.height).toBeGreaterThan(200)
        expect(image.pixel).toEqual([255, 255, 255, 255])
        expect(image.coloredPixels).toBeGreaterThan(1000)
    }
    expect(result.unchanged).toBe(true)
    expect(result.modalOpen).toBe(false)
    expect(result.buttonLabel).toBe('Exportar imágenes')
}, 30000)

test('warns rather than downloading when no metrics are available', async () => {
    const result = await simulator.page.evaluate(() => {
        clearMetricHistories()
        let warned = false
        const original = window.mostrarAdvertencia
        window.mostrarAdvertencia = () => { warned = true }
        document.getElementById('btnExportarImagenes').click()
        window.mostrarAdvertencia = original
        return { warned, disabled: document.getElementById('btnExportarImagenes').disabled }
    })
    expect(result).toEqual({ warned: true, disabled: false })
})
