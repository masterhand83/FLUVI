import { describe, it, expect } from 'vitest'
import { openSimulator } from './helpers/simulator.mjs'
import { mkdir } from 'node:fs/promises'

async function prepare(page, usePixi) {
    if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.sceneManager)
    await page.evaluate(() => {
        window.hideLoadingScreen?.()
        window.confirm = () => true
        window.alert = () => {}
        document.getElementById('btnNuevaSimulacion').click()
    })
    await page.waitForFunction(() => window.calles.length === 0)
    await page.waitForFunction(() => getComputedStyle(document.getElementById('loadingScreen')).display === 'none')
}

async function camera(page, zoom) {
    await page.evaluate(zoom => {
        if (window.USE_PIXI) {
            const camera = window.pixiApp.cameraController
            camera.scale = zoom; camera.offsetX = 0; camera.offsetY = 0
            camera.applyTransform(); camera.updateGlobals()
        } else {
            escala = zoom; offsetX = 0; offsetY = 0
            window.offsetX = 0; window.offsetY = 0
        }
        window.renderizarCanvas()
    }, zoom)
}

async function wheelZoom(page, canvas, afterWheel) {
    await page.mouse.move(canvas.x + 300, canvas.y + 300)
    const scales = []
    for (let i = 0; i < 4; i++) {
        await page.mouse.wheel({ deltaY: -100 })
        await new Promise(resolve => setTimeout(resolve, 140))
        scales.push(await page.evaluate(() => window.USE_PIXI ? window.pixiApp.cameraController.scale : window.escala))
        await afterWheel?.()
    }
    return scales
}

async function wheelZoomSamples(page, canvas) {
    await page.mouse.move(canvas.x + 300, canvas.y + 300)
    const targetZooms = [1, 2, 4, 8, 16, 20]
    let targetIndex = 0
    const zoom = () => page.evaluate(() => window.USE_PIXI ? window.pixiApp.cameraController.scale : window.escala)
    const samples = []
    let current = await zoom()
    const capture = async () => {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        // The single visible name is anchored at map point (300, 300), under
        // the wheel pointer; this viewport crop also bounds pixel transfer.
        return { zoom: await zoom(), image: await pixels(page, [0, 0, 600, 500]) }
    }
    samples.push(await capture())
    while (current < 19.99) {
        const previous = current
        await page.mouse.wheel({ deltaY: -100 })
        await page.waitForFunction(previousScale => {
            const scale = window.USE_PIXI ? window.pixiApp.cameraController.scale : window.escala
            return scale > previousScale + 0.0001 || scale >= 19.99
        }, { polling: 20, timeout: 1500 }, previous)
        current = await zoom()
        while (targetIndex + 1 < targetZooms.length && current >= targetZooms[targetIndex + 1]) {
            targetIndex++
            samples.push(await capture())
        }
    }
    return samples
}

async function screenLabelFrame(page, worldCenter) {
    const { zoom, offset } = await page.evaluate(() => ({
        zoom: window.USE_PIXI ? window.pixiApp.cameraController.scale : window.escala,
        offset: window.USE_PIXI
            ? { x: window.pixiApp.cameraController.offsetX, y: window.pixiApp.cameraController.offsetY }
            : { x: window.offsetX, y: window.offsetY },
    }))
    const center = [worldCenter[0] * zoom + offset.x, worldCenter[1] * zoom + offset.y]
    const region = [center[0] - 150, center[1] - 20, 300, 40]
    return { zoom, image: await pixels(page, region) }
}

// Read the rendered framebuffer, never renderer label caches or text objects.
async function pixels(page, region) {
    return page.evaluate(region => {
        let source = document.getElementById('simuladorCanvas')
        if (window.USE_PIXI) {
            const { app } = window.pixiApp
            app.renderer.render(app.stage)
            source = app.renderer.extract.canvas()
        }
        const copy = document.createElement('canvas')
        copy.width = source.width; copy.height = source.height
        copy.getContext('2d').drawImage(source, 0, 0)
        const ratio = window.USE_PIXI ? window.pixiApp.app.renderer.resolution : 1
        const [x, y, width, height] = region.map(value => Math.round(value * ratio))
        return { data: [...copy.getContext('2d').getImageData(x, y, width, height).data], width, height, ratio }
    }, region)
}

function difference(before, after) {
    const points = []
    for (let i = 0; i < before.data.length; i += 4) {
        if (Math.max(...[0, 1, 2].map(channel => Math.abs(before.data[i + channel] - after.data[i + channel]))) > 35) {
            points.push({ x: (i / 4 % before.width) / before.ratio, y: Math.floor(i / 4 / before.width) / before.ratio })
        }
    }
    if (!points.length) return { count: 0, width: 0, height: 0 }
    const xs = points.map(p => p.x), ys = points.map(p => p.y)
    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length
    const xx = points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0)
    const yy = points.reduce((sum, p) => sum + (p.y - meanY) ** 2, 0)
    const xy = points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0)
    return { count: points.length, width: Math.max(...xs) - Math.min(...xs) + 1,
        height: Math.max(...ys) - Math.min(...ys) + 1,
        angle: Math.atan2(2 * xy, xx - yy) * 90 / Math.PI,
        x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
}

describe.each([false, true])('map labels (Pixi=%s)', (usePixi) => {
    it('renders a subtle transparent dark backdrop behind names', async () => {
        const sim = await openSimulator({ usePixi, freezeFrames: false })
        try {
            const { page } = sim
            await prepare(page, usePixi)
            await page.evaluate(() => {
                const building = window.agregarEdificio('Backdrop', 300, 300, 200, 100, 0)
                building.appearanceMode = 'rectangular'; building.color = '#FFFFFF'
                window.pixiApp?.sceneManager?.edificioRenderer.removeEdificioSprite(building)
                window.pixiApp?.sceneManager?.renderAll()
            })
            await camera(page, 1)
            await page.select('#labelVisibility', 'off')
            const region = await page.evaluate(() => {
                const context = document.createElement('canvas').getContext('2d')
                context.font = `${window.labelFontSize}px Arial`
                return [300 + context.measureText('Backdrop').width / 2 + 3, 300, 1, 1]
            })
            const off = await pixels(page, region)
            await page.select('#labelVisibility', 'buildings')
            const on = await pixels(page, region)
            for (let channel = 0; channel < 3; channel++) {
                const darkening = off.data[channel] - on.data[channel]
                expect(darkening).toBeGreaterThan(5)
                expect(darkening).toBeLessThan(35)
            }
            expect(sim.pageErrors).toEqual([])
        } finally { await sim.close() }
    }, 60000)

    it.skipIf(!usePixi)('keeps 20px labels fixed through wheel high zooms', async () => {
        const sim = await openSimulator({ usePixi, freezeFrames: false })
        try {
            const { page } = sim
            await prepare(page, usePixi)
            await page.evaluate(() => {
                if (!window.isPaused) document.getElementById('btnPauseResume').click()
                window.crearCalle('', 400, 'conexion', 0, 0, 0, 0, 1)
                window.crearCalle('', 400, 'conexion', 0, 0, -90, 0, 1)
                window.crearCalle('High zoom street label', 40, 'conexion', 200, 297.5, 0, 0, 1)
                window.agregarEdificio('High zoom building label', 300, 300, 40, 40, 0)
                window.pixiApp?.sceneManager?.renderAll()
            })
            expect(await page.evaluate(() => window.isPaused)).toBe(true)
            const canvas = await page.$eval('#simuladorCanvas', element => {
                const rect = element.getBoundingClientRect()
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            })
            const measurements = []
            await camera(page, 1)
            await page.select('#labelVisibility', 'off')
            const off = await wheelZoomSamples(page, canvas)
            for (const [category, visibility] of [['street', 'streets'], ['building', 'buildings']]) {
                await camera(page, 1)
                await page.$eval('#labelFontSize', input => {
                    input.value = '20'; input.dispatchEvent(new Event('input', { bubbles: true }))
                })
                await page.select('#labelVisibility', visibility)
                const on = await wheelZoomSamples(page, canvas)
                expect(on.map(frame => frame.zoom)).toEqual(off.map(frame => frame.zoom))
                expect(on.at(-1).zoom).toBeGreaterThanOrEqual(19.99)
                for (let i = 0; i < on.length; i++) {
                    const diff = difference(off[i].image, on[i].image)
                    measurements.push({ category, size: 20, zoom: on[i].zoom, width: diff.width, height: diff.height })
                }
            }
            expect(sim.pageErrors).toEqual([])
            for (const category of ['street', 'building']) {
                const group = measurements.filter(item => item.category === category)
                const sampledZooms = group.map(({ zoom }) => zoom)
                expect(sampledZooms[0]).toBe(1)
                expect(sampledZooms[1]).toBeCloseTo(2.14, 1)
                expect(sampledZooms[2]).toBeCloseTo(4.18, 1)
                expect(sampledZooms[3]).toBeCloseTo(8.14, 1)
                expect(sampledZooms[4]).toBeCloseTo(17.45, 1)
                expect(sampledZooms[5]).toBe(20)
            }
            const violations = measurements.filter(sample => {
                const baseline = measurements.find(item => item.category === sample.category && item.zoom === 1)
                return Math.abs(sample.width - baseline.width) > 2 || Math.abs(sample.height - baseline.height) > 2
            })
            expect(violations, JSON.stringify({ measurements, violations })).toEqual([])
        } finally { await sim.close() }
    }, 120000)

    it('keeps both label categories fixed-sized during real wheel zooms', async () => {
        const sim = await openSimulator({ usePixi, freezeFrames: false })
        try {
            const { page } = sim
            await prepare(page, usePixi)
            await page.evaluate(() => {
                if (!window.isPaused) document.getElementById('btnPauseResume').click()
                // Wide unnamed roads keep the camera limits broad without adding
                // extra names near the two measured labels.
                window.crearCalle('', 400, 'conexion', 0, 0, 0, 0, 1)
                window.crearCalle('', 400, 'conexion', 0, 0, -90, 0, 1)
                window.crearCalle('Wheel street label', 40, 'conexion', 200, 280, 0, 0, 1)
                window.agregarEdificio('Wheel building label', 300, 330, 40, 40, 0)
                window.pixiApp?.sceneManager?.renderAll()
            })
            expect(await page.evaluate(() => window.isPaused)).toBe(true)
            const canvas = await page.$eval('#simuladorCanvas', element => {
                const rect = element.getBoundingClientRect()
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            })
            expect(canvas.width).toBeGreaterThan(600)
            const centers = [[300, 282.5], [300, 330]]
            const captureSequence = async () => {
                const frames = [await Promise.all(centers.map(center => screenLabelFrame(page, center)))]
                const zooms = await wheelZoom(page, canvas, async () => {
                    frames.push(await Promise.all(centers.map(center => screenLabelFrame(page, center))))
                })
                return { frames, zooms }
            }

            // Build rendered-pixel baselines with labels off through the exact
            // wheel sequence; then replay that sequence with both labels enabled.
            await camera(page, 1)
            await page.select('#labelVisibility', 'off')
            const off14 = await captureSequence()
            await camera(page, 1)
            await page.$eval('#labelFontSize', input => { input.value = '14'; input.dispatchEvent(new Event('input', { bubbles: true })) })
            await page.select('#labelVisibility', 'both')
            const on14 = await captureSequence()

            const measureSequence = (off, on, size) => {
                expect(on.zooms).toEqual(off.zooms)
                const measurements = []
                for (let frame = 0; frame < on.frames.length; frame++) {
                    for (let category = 0; category < centers.length; category++) {
                        const diff = difference(off.frames[frame][category].image, on.frames[frame][category].image)
                        expect(diff.count, `font ${size}, zoom ${on.frames[frame][category].zoom}, category ${category}`).toBeGreaterThan(20)
                        measurements.push({ size, zoom: on.frames[frame][category].zoom, category, width: diff.width, height: diff.height })
                    }
                }
                for (const category of [0, 1]) {
                    const categoryMeasures = measurements.filter(item => item.category === category)
                    const reference = categoryMeasures[0]
                    for (const item of categoryMeasures.slice(1)) {
                        expect(Math.abs(item.width - reference.width), `width ${JSON.stringify(item)}`).toBeLessThanOrEqual(2)
                        expect(Math.abs(item.height - reference.height), `height ${JSON.stringify(item)}`).toBeLessThanOrEqual(4)
                    }
                }
                return measurements
            }
            const measurements14 = measureSequence(off14, on14, 14)

            // Change to 23px with labels still enabled, then use actual wheel
            // zooms again. No label-visibility toggle follows any zoom event.
            await page.$eval('#labelFontSize', input => { input.value = '23'; input.dispatchEvent(new Event('input', { bubbles: true })) })
            await camera(page, 1)
            const off23 = { frames: off14.frames, zooms: off14.zooms }
            const on23 = await captureSequence()
            const measurements23 = measureSequence(off23, on23, 23)
            expect(measurements23[0].height).toBeGreaterThan(measurements14[0].height)
            expect(sim.pageErrors).toEqual([])
        } finally { await sim.close() }
    }, 60000)

    it('offers one session-only Spanish visibility choice, initially Off', async () => {
        const sim = await openSimulator({ usePixi, freezeFrames: false })
        try {
            const { page } = sim
            if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.sceneManager)
            await page.evaluate(() => window.hideLoadingScreen?.())
            expect(await page.$eval('#labelVisibility', select => ({
                value: select.value,
                options: [...select.options].map(option => option.textContent),
            }))).toEqual({ value: 'off', options: ['Sin etiquetas', 'Calles', 'Edificios', 'Ambos'] })
            expect(await page.$eval('#labelVisibility', select => select.closest('#collapseMapDrawingTools') !== null)).toBe(true)
            expect(await page.$eval('#collapseMapDrawingTools #labelFontSize', input => ({
                value: input.value, type: input.type, min: input.min, step: input.step,
            }))).toEqual({ value: '14', type: 'number', min: '1', step: '1' })
            expect(await page.$$eval('#labelVisibility, #labelFontSize', controls =>
                controls.length === 2 && controls.every(control => control.closest('#controlBar') === null))).toBe(true)
            await page.$eval('#labelFontSize', input => { input.value = '23'; input.dispatchEvent(new Event('input', { bubbles: true })) })
            await page.select('#labelVisibility', 'both')
            await page.evaluate(() => {
                window.confirm = () => true
                document.getElementById('btnNuevaSimulacion').click()
            })
            await page.waitForFunction(() => window.calles.length === 0)
            expect(await page.$eval('#labelVisibility', select => select.value)).toBe('both')
            expect(await page.$eval('#labelFontSize', input => input.value)).toBe('23')
            const json = await page.evaluate(async () => {
                window.crearCalle('Saved street', 8, 'conexion', 100, 100, 0, 0, 1)
                window.agregarEdificio('Saved building', 250, 240, 40, 40, 0)
                window.prompt = () => 'Labels map'
                const createURL = URL.createObjectURL
                let exported
                URL.createObjectURL = blob => { exported = blob.text(); return 'blob:labels-test' }
                window.guardarSimulacion()
                URL.createObjectURL = createURL
                return await exported
            })
            const saved = JSON.parse(json)
            expect(saved).not.toHaveProperty('labelVisibility')
            expect(saved).not.toHaveProperty('mostrarEtiquetas')
            expect(saved).not.toHaveProperty('labelFontSize')
            expect(saved.calles[0].nombre).toBe('Saved street')
            expect(saved.edificios[0].label).toBe('Saved building')
            await page.select('#labelVisibility', 'buildings')
            await page.evaluate(json => {
                window.cargarSimulacion({ target: { files: [new File([json], 'labels-map.json')], value: '' } })
            }, json)
            await page.waitForFunction(() => window.calles[0]?.nombre === 'Saved street')
            expect(await page.$eval('#labelVisibility', select => select.value)).toBe('buildings')
            expect(await page.$eval('#labelFontSize', input => input.value)).toBe('23')
            await page.reload({ waitUntil: 'domcontentloaded' })
            expect(await page.$eval('#labelVisibility', select => select.value)).toBe('off')
            expect(await page.$eval('#labelFontSize', input => input.value)).toBe('14')
        } finally { await sim.close() }
    }, 60000)

    it('places one full street name at the actual distance midpoint with an upright local tangent', async () => {
        const sim = await openSimulator({ usePixi, freezeFrames: false })
        try {
            const { page } = sim
            for (const [kind, expected] of [
                ['long', [300, 185, 0]], ['short', [300, 185, 0]],
                ['legacy', [186.6025, 130, -30]],
                // Independent numerical integration of this non-uniform cubic:
                // t=0.73972 at half its length, not its parameter midpoint.
                ['bezier', [266.9300, 155.9458, 13.2472]],
                ['roundabout', [248.0385, 150, -60]],
            ]) {
                await prepare(page, usePixi)
                await page.select('#labelVisibility', 'off')
                await page.evaluate(kind => {
                    let street
                    if (kind === 'roundabout') {
                        street = window.roundaboutStreet.createStreet({ nombre: 'Complete street name', x: 300, y: 180, innerRadius: 55, carriles: 2, startAngle: 30 })
                        window.calles.push(street)
                    } else {
                        street = window.crearCalle('Complete street name', kind === 'long' ? 210 : kind === 'short' ? 4 : 40,
                            'conexion', kind === 'long' ? -225 : kind === 'short' ? 290 : 100, 180, 0, 0, 2)
                        if (kind === 'legacy') Object.assign(street, { esCurva: true, vertices: [{ indiceCelda: 0, anguloOffset: 30 }, { indiceCelda: 39, anguloOffset: 30 }] })
                        if (kind === 'bezier') {
                            Object.assign(street, { esCurva: true, vertices: [], bezierControls: [{ x: 105, y: 20 }, { x: 110, y: 180 }], endX: 500, endY: 180 })
                            street.tamano = window.streetBezier.validate(street).cells
                            street.arreglo = Array.from({ length: 2 }, () => Array(street.tamano).fill(0))
                        }
                    }
                    window.pixiApp?.sceneManager?.renderAll()
                }, kind)
                await camera(page, 1)
                await new Promise(resolve => setTimeout(resolve, 200))
                const region = [0, 25, 650, 300]
                const before = await pixels(page, region)
                await page.select('#labelVisibility', 'streets')
                const diff = difference(before, await pixels(page, region))
                expect(diff.count, kind).toBeGreaterThan(30)
                expect(Math.abs(diff.x - expected[0]), `${kind}: x`).toBeLessThan(5)
                expect(Math.abs(diff.y + 25 - expected[1]), `${kind}: y`).toBeLessThan(5)
                expect(Math.abs(diff.angle - expected[2]), `${kind}: tangent`).toBeLessThan(5)
                expect(diff.width, `${kind}: no repeats`).toBeLessThan(170)
                if (kind === 'bezier') {
                    await mkdir('/tmp/opencode/v1-label-evidence', { recursive: true })
                    await page.screenshot({ path: `/tmp/opencode/v1-label-evidence/${usePixi ? 'pixi' : 'canvas'}-curve.png` })
                }
            }
            expect(sim.pageErrors).toEqual([])
        } finally { await sim.close() }
    }, 120000)

    it('centers horizontal names for every building appearance and keeps overlapping names', async () => {
        const sim = await openSimulator({ usePixi, freezeFrames: false })
        try {
            const { page } = sim
            await prepare(page, usePixi)
            await page.evaluate(async () => {
                const artwork = document.createElement('canvas')
                artwork.width = 40; artwork.height = 20
                artwork.getContext('2d').fillStyle = '#176ba0'
                artwork.getContext('2d').fillRect(0, 0, 40, 20)
                const imageData = artwork.toDataURL()
                const imageElement = new Image()
                imageElement.src = imageData
                await imageElement.decode()
                for (const [index, kind] of ['rectangle', 'polygon', 'bundled', 'uploaded'].entries()) {
                    const x = 130 + index * 150
                    const building = window.agregarEdificio('Full name', x, 230, 35, 25, 67)
                    if (kind === 'polygon') Object.assign(building, { geometryType: 'polygon', vertices: [{ x: x - 20, y: 210 }, { x: x + 20, y: 210 }, { x: x + 20, y: 250 }, { x: x - 20, y: 250 }] })
                    if (kind === 'bundled') Object.assign(building, { imagen: 'escom', canvasImageKey: 'ESCOM' })
                    if (kind === 'uploaded') Object.assign(building, { appearanceMode: 'uploaded-image', imageData, imageElement })
                }
                window.agregarEdificio('CONO', 130, 330, 35, 25, 0)
                window.pixiApp?.sceneManager?.renderAll()
            })
            await camera(page, 1)
            await new Promise(resolve => setTimeout(resolve, 300))
            const regions = [0, 1, 2, 3].map(index => [30 + index * 150, 210, 200, 40])
            const off = await Promise.all(regions.map(region => pixels(page, region)))
            const coneRegion = [30, 310, 200, 40]
            const cone = await pixels(page, coneRegion)
            await page.select('#labelVisibility', 'buildings')
            for (let i = 0; i < 4; i++) {
                const diff = difference(off[i], await pixels(page, regions[i]))
                expect(diff.count).toBeGreaterThan(40)
                expect(Math.abs(diff.x - 100)).toBeLessThan(3)
                expect(Math.abs(diff.y - 20)).toBeLessThan(3)
                expect(Math.abs(diff.angle)).toBeLessThan(3)
                expect(diff.width).toBeGreaterThan(35)
                expect(diff.height).toBeLessThan(18)
            }
            expect(difference(cone, await pixels(page, coneRegion)).count).toBe(0)
            await mkdir('/tmp/opencode/v1-label-evidence', { recursive: true })
            await page.screenshot({ path: `/tmp/opencode/v1-label-evidence/${usePixi ? 'pixi' : 'canvas'}-buildings.png` })
            await page.evaluate(() => {
                // Two full names deliberately overlap; neither is suppressed.
                window.edificios[0].label = 'First overlapping long name'
                window.edificios[1].label = 'Second overlapping long name'
                window.edificios[1].x = window.edificios[0].x + 15
                window.edificios[1].vertices = window.edificios[1].vertices.map(p => ({ x: p.x - 135, y: p.y + 5 }))
                window.pixiApp?.sceneManager?.renderAll()
                window.renderizarCanvas()
            })
            const overlap = await pixels(page, [0, 200, 300, 70])
            for (const index of [0, 1]) {
                const name = await page.evaluate(index => {
                    const building = window.edificios[index]
                    const name = building.label
                    building.label = ''
                    window.pixiApp?.sceneManager?.renderAll(); window.renderizarCanvas()
                    return name
                }, index)
                expect(difference(overlap, await pixels(page, [0, 200, 300, 70])).count).toBeGreaterThan(30)
                await page.evaluate(({ index, name }) => {
                    window.edificios[index].label = name
                    window.pixiApp?.sceneManager?.renderAll(); window.renderizarCanvas()
                }, { index, name })
            }
            expect(sim.pageErrors).toEqual([])
        } finally { await sim.close() }
    }, 120000)

    it('updates visibility while paused and keeps the selected screen-space size at every zoom', async () => {
        const sim = await openSimulator({ usePixi, freezeFrames: false })
        try {
            const { page } = sim
            await prepare(page, usePixi)
            await page.evaluate(() => {
                window.crearCalle('Street name', 40, 'conexion', 100, 100, 0, 0, 2)
                window.agregarEdificio('Building name', 250, 240, 40, 40, 67)
                window.pixiApp?.sceneManager?.renderAll()
            })
            await camera(page, 1)
            await new Promise(resolve => setTimeout(resolve, 300))
            const regions = [[90, 80, 230, 60], [140, 215, 220, 50]]
            const off = await Promise.all(regions.map(region => pixels(page, region)))
            for (const [mode, visible] of [['streets', [true, false]], ['buildings', [false, true]], ['both', [true, true]], ['off', [false, false]]]) {
                await page.select('#labelVisibility', mode)
                for (let i = 0; i < 2; i++) {
                    const diff = difference(off[i], await pixels(page, regions[i]))
                    expect(diff.count > 0, `${mode}: category ${i}`).toBe(visible[i])
                }
            }
            const sizes = []
            const streetSizes = []
            await page.select('#labelVisibility', 'both')
            const defaultStreet = await pixels(page, regions[0])
            const defaultBuilding = await pixels(page, regions[1])
            await page.$eval('#labelFontSize', input => { input.value = '23'; input.dispatchEvent(new Event('input', { bubbles: true })) })
            expect(difference(defaultStreet, await pixels(page, regions[0])).count).toBeGreaterThan(30)
            expect(difference(defaultBuilding, await pixels(page, regions[1])).count).toBeGreaterThan(30)
            for (const zoom of [0.25, 0.5, 1, 2]) {
                await page.evaluate(zoom => {
                    window.edificios[0].x = 250 / zoom
                    window.edificios[0].y = 240 / zoom
                    window.calles[0].x = 100 / zoom
                    window.calles[0].y = 100 / zoom
                    window.pixiApp?.sceneManager?.renderAll()
                }, zoom)
                await camera(page, zoom)
                const center = [250, 240]
                const region = [center[0] - 110, center[1] - 20, 220, 40]
                await page.select('#labelVisibility', 'off')
                const before = await pixels(page, region)
                await page.select('#labelVisibility', 'buildings')
                const diff = difference(before, await pixels(page, region))
                expect(diff.count).toBeGreaterThan(0)
                expect(Math.abs(diff.x - 110)).toBeLessThan(3)
                expect(Math.abs(diff.y - 20)).toBeLessThan(3)
                sizes.push(diff)
                const streetRegion = [90, 80, 230, 60]
                await page.select('#labelVisibility', 'off')
                const streetBefore = await pixels(page, streetRegion)
                await page.select('#labelVisibility', 'streets')
                streetSizes.push(difference(streetBefore, await pixels(page, streetRegion)))
            }
            for (const size of sizes) expect(size.width).toBeGreaterThan(60)
            expect(sizes[0].width / sizes[2].width).toBeCloseTo(1, 1)
            expect(sizes[1].width / sizes[2].width).toBeCloseTo(1, 1)
            expect(sizes[3].width / sizes[2].width).toBeCloseTo(1, 1)
            for (const size of streetSizes) expect(size.width).toBeGreaterThan(20)
            // Raster bounds can vary by a few pixels as glyph antialiasing lands
            // differently at the shifted camera positions; inverse zoom sizing
            // would still produce a much larger ratio change.
            expect(streetSizes[0].width / streetSizes[2].width).toBeCloseTo(1, 0)
            expect(streetSizes[1].width / streetSizes[2].width).toBeCloseTo(1, 0)
            expect(streetSizes[3].width / streetSizes[2].width).toBeCloseTo(1, 0)
            expect(sizes[2].height).toBeGreaterThanOrEqual(19)
            expect(sizes[2].height).toBeLessThan(30)
            expect(sizes[2].width).toBeGreaterThan(40) // full name beyond its building
            await page.select('#labelVisibility', 'buildings')
            const selected = await pixels(page, [140, 215, 220, 50])
            for (const invalid of ['', '0', '-2', '1.5', 'Infinity']) {
                await page.$eval('#labelFontSize', (input, value) => {
                    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }))
                }, invalid)
                expect(difference(selected, await pixels(page, [140, 215, 220, 50])).count, invalid).toBe(0)
            }
            expect(sim.pageErrors).toEqual([])
        } finally { await sim.close() }
    }, 60000)

    it('refreshes renamed and edited objects through inspector controls while paused, including high-DPI zoom', async () => {
        const sim = await openSimulator({ usePixi, freezeFrames: false })
        try {
            const { page } = sim
            await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
            await prepare(page, usePixi)
            await page.evaluate(() => {
                const street = window.crearCalle('Old street', 8, 'conexion', 100, 100, 0, 0, 1)
                for (const id of ['selectCalle', 'selectCalleEditor']) document.getElementById(id).add(new Option(street.nombre, '0'))
                window.agregarEdificio('Old building', 250, 240, 40, 40, 0)
                window.pixiApp?.sceneManager?.renderAll()
            })
            await camera(page, 1)
            await page.select('#selectCalle', '0')
            await page.waitForFunction(() => document.getElementById('streetInspectorName').value === 'Old street')
            for (const [id, value] of [['streetInspectorName', 'Renamed complete street'], ['streetInspectorX', '400'], ['streetInspectorY', '170'], ['streetInspectorAngle', '180'], ['streetInspectorCells', '12'], ['streetInspectorLanes', '2']]) {
                await page.$eval(`#${id}`, (input, value) => { input.value = value; input.dispatchEvent(new Event('blur')) }, value)
            }
            await page.select('#selectEdificio', '0')
            await page.waitForFunction(() => document.getElementById('buildingInspectorName').value === 'Old building')
            for (const [id, value] of [['buildingInspectorName', 'Renamed complete building'], ['buildingInspectorX', '300'], ['buildingInspectorY', '300'], ['buildingInspectorWidth', '120'], ['buildingInspectorHeight', '70'], ['buildingInspectorAngle', '67']]) {
                await page.$eval(`#${id}`, (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }, value)
            }
            expect(await page.evaluate(() => window.isPaused)).toBe(true)
            await camera(page, 1)
            await page.select('#labelVisibility', 'off')
            const regions = [[250, 145, 240, 40], [170, 280, 260, 40]]
            const off = await Promise.all(regions.map(region => pixels(page, region)))
            await page.select('#labelVisibility', 'both')
            for (const [index, center] of [[0, [120, 20]], [1, [130, 20]]]) {
                const diff = difference(off[index], await pixels(page, regions[index]))
                expect(Math.abs(diff.x - center[0])).toBeLessThan(4)
                expect(Math.abs(diff.y - center[1])).toBeLessThan(4)
                expect(Math.abs(diff.angle)).toBeLessThan(4)
                expect(diff.width).toBeGreaterThan(120)
                expect(diff.height).toBeLessThan(18)
            }
            const zoomOneSize = difference(off[1], await pixels(page, regions[1]))
            // Establish the unlabeled view at zoom 2, then leave labels enabled
            // throughout a continuous camera change and compare with zoom 1.
            await camera(page, 2)
            await page.select('#labelVisibility', 'off')
            const zoomRegion = [480, 580, 240, 40]
            const before = await pixels(page, zoomRegion)
            await camera(page, 1)
            await page.select('#labelVisibility', 'both')
            await camera(page, 1.5)
            await camera(page, 2)
            const diff = difference(before, await pixels(page, zoomRegion))
            expect(diff.width).toBeCloseTo(zoomOneSize.width, -1)
            expect(Math.abs(diff.height - zoomOneSize.height)).toBeLessThanOrEqual(2)
            expect(sim.pageErrors).toEqual([])
        } finally { await sim.close() }
    }, 120000)
})
