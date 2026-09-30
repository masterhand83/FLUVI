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
            await page.select('#labelVisibility', 'both')
            await page.evaluate(() => {
                window.confirm = () => true
                document.getElementById('btnNuevaSimulacion').click()
            })
            await page.waitForFunction(() => window.calles.length === 0)
            expect(await page.$eval('#labelVisibility', select => select.value)).toBe('both')
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
            expect(saved.calles[0].nombre).toBe('Saved street')
            expect(saved.edificios[0].label).toBe('Saved building')
            await page.select('#labelVisibility', 'buildings')
            await page.evaluate(json => {
                window.cargarSimulacion({ target: { files: [new File([json], 'labels-map.json')], value: '' } })
            }, json)
            await page.waitForFunction(() => window.calles[0]?.nombre === 'Saved street')
            expect(await page.$eval('#labelVisibility', select => select.value)).toBe('buildings')
            await page.reload({ waitUntil: 'domcontentloaded' })
            expect(await page.$eval('#labelVisibility', select => select.value)).toBe('off')
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

    it('updates visibility while paused and uses capped inverse screen-space zoom sizing', async () => {
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
            for (const zoom of [0.25, 0.5, 1, 2]) {
                await page.evaluate(zoom => {
                    window.edificios[0].x = 250 / zoom
                    window.edificios[0].y = 240 / zoom
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
            }
            expect(sizes[0].width / sizes[2].width).toBeCloseTo(20 / 14, 1)
            expect(sizes[1].width / sizes[2].width).toBeCloseTo(20 / 14, 1)
            expect(sizes[3].width / sizes[2].width).toBeCloseTo(0.5, 1)
            expect(sizes[2].height).toBeLessThan(18)
            expect(sizes[2].width).toBeGreaterThan(40) // full name beyond its building
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
            // Establish the unlabeled view first, then leave labels enabled
            // throughout a continuous camera change (no toggle to mask a bug).
            await camera(page, 2)
            await page.select('#labelVisibility', 'off')
            const zoomRegion = [480, 580, 240, 40]
            const before = await pixels(page, zoomRegion)
            await camera(page, 1)
            await page.select('#labelVisibility', 'both')
            await camera(page, 1.5)
            await camera(page, 2)
            const diff = difference(before, await pixels(page, zoomRegion))
            expect(diff.width).toBeGreaterThan(65)
            expect(diff.width).toBeLessThan(100)
            expect(diff.height).toBeLessThan(12)
            expect(sim.pageErrors).toEqual([])
        } finally { await sim.close() }
    }, 120000)
})
