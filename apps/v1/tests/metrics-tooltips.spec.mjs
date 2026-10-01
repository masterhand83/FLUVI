import { afterAll, beforeAll, expect, test } from 'vitest'
import { openSimulator } from './helpers/simulator.mjs'

let simulator
beforeAll(async () => {
    simulator = await openSimulator({ freezeFrames: false })
    await simulator.page.waitForFunction(() => typeof Chart !== 'undefined' && densityChartInstance !== null)
    await simulator.page.waitForFunction(() => getComputedStyle(document.getElementById('loadingScreen')).display === 'none')
    await simulator.page.evaluate(() => {
        const pause = document.getElementById('btnPauseResume')
        if (pause.textContent.includes('⏸')) pause.click()
    })
}, 60000)
afterAll(async () => { await simulator?.close() })

test('all metric tooltips fit their chart and remain anchored to low, middle, and high samples', async () => {
    const placements = await simulator.page.evaluate(() => {
        const charts = [densityChartInstance, throughputChartInstance, speedChartInstance,
            netGenerationChartInstance, entropyChartInstance]
        const placements = []
        for (const chart of charts) {
            // Reveal the real sidebar chart without animation or accordion timing.
            for (let parent = chart.canvas.parentElement; parent; parent = parent.parentElement) {
                if (parent.classList.contains('collapse')) parent.classList.add('show')
            }
            chart.resize()
            const max = chart.options.scales.y.max || chart.options.scales.y.suggestedMax
            chart.data.labels = ['08:00:00', '08:00:02', '08:00:04']
            chart.data.datasets[0].data = [0, max / 2, max]
            chart.update('none')
            for (let index = 0; index < 3; index++) {
                const point = chart.getDatasetMeta(0).data[index]
                chart.tooltip.setActiveElements([{ datasetIndex: 0, index }], { x: point.x, y: point.y })
                chart.draw()
                const tooltip = chart.tooltip
                placements.push({ id: chart.canvas.id, index,
                    x: tooltip.x, y: tooltip.y, width: tooltip.width, height: tooltip.height,
                    canvasWidth: chart.width, canvasHeight: chart.height,
                    caretX: tooltip.caretX, caretY: tooltip.caretY, pointX: point.x, pointY: point.y,
                    title: tooltip.title, timestamp: chart.data.labels[index] })
            }
        }
        return placements
    })
    for (const placement of placements) {
        const label = `${placement.id} sample ${placement.index}: ${JSON.stringify(placement)}`
        expect(placement.x, label).toBeGreaterThanOrEqual(0)
        expect(placement.y, label).toBeGreaterThanOrEqual(0)
        expect(placement.x + placement.width, label).toBeLessThanOrEqual(placement.canvasWidth)
        expect(placement.y + placement.height, label).toBeLessThanOrEqual(placement.canvasHeight)
        expect(placement.caretX, label).toBeCloseTo(placement.pointX)
        expect(placement.caretY, label).toBeCloseTo(placement.pointY)
        expect(placement.title, label).toContain(placement.timestamp)
    }
})

test('real pointer hover stays anchored after a live chart update and clears on mouseout', async () => {
    for (const id of ['densityChart', 'throughputChart', 'speedChart', 'netGenerationChart', 'entropyChart']) {
        const point = await simulator.page.evaluate(id => {
            const canvas = document.getElementById(id)
            canvas.scrollIntoView({ block: 'center', behavior: 'instant' })
            const chart = Chart.getChart(canvas)
            const point = chart.getDatasetMeta(0).data[1]
            const bounds = canvas.getBoundingClientRect()
            return { x: bounds.left + point.x, y: bounds.top + point.y }
        }, id)
        await simulator.page.mouse.move(point.x, point.y)
        await simulator.page.waitForFunction(id => {
            const tooltip = Chart.getChart(id).tooltip
            return tooltip.opacity === 1 && tooltip.dataPoints[0]?.dataIndex === 1
        }, { timeout: 5000 }, id)
        const result = await simulator.page.evaluate(id => {
            const chart = Chart.getChart(id)
            // Move this sample vertically as an ordinary metrics refresh would.
            chart.data.datasets[0].data[1] *= 0.5
            chart.update('none')
            const point = chart.getDatasetMeta(0).data[1]
            const tooltip = chart.tooltip
            return {
                index: tooltip.dataPoints[0].dataIndex,
                caretX: tooltip.caretX, caretY: tooltip.caretY,
                pointX: point.x, pointY: point.y,
                bottom: tooltip.y + tooltip.height, height: chart.height
            }
        }, id)
        expect(result.index, id).toBe(1)
        expect(result.caretX, id).toBeCloseTo(result.pointX)
        expect(result.caretY, id).toBeCloseTo(result.pointY)
        expect(result.bottom, id).toBeLessThanOrEqual(result.height)
        await simulator.page.mouse.move(1400, 20)
        await simulator.page.waitForFunction(id => Chart.getChart(id).tooltip.opacity === 0, {}, id)
    }
})
