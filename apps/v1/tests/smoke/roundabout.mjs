import assert from 'node:assert/strict'
import { openSimulator } from '../helpers/simulator.mjs'

for (const usePixi of [false, true]) {
    const sim = await openSimulator({ usePixi, freezeFrames: false })
    try {
        const { page } = sim
        if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.cameraController, { timeout: 30000 })
        await page.evaluate(() => {
            document.getElementById('loadingScreen').style.display = 'none'
            window.streetEditPause?.()
            document.getElementById('simuladorCanvas').style.width = '60%'
        })
        const loadedMapCount = await page.evaluate(() => window.calles.length)
        const center = await page.$eval('#simuladorCanvas', canvas => {
            const rect = canvas.getBoundingClientRect()
            return { x: rect.left + rect.width * 0.7, y: rect.top + rect.height * 0.35 }
        })
        const expected = await page.evaluate(({ x, y }) => {
            const canvas = document.getElementById('simuladorCanvas')
            const rect = canvas.getBoundingClientRect()
            const camera = window.USE_PIXI && window.pixiApp?.cameraController
            return camera ? camera.screenToWorld(
                (x - rect.left) * window.pixiApp.app.screen.width / rect.width,
                (y - rect.top) * window.pixiApp.app.screen.height / rect.height,
            ) : {
                x: ((x - rect.left) * canvas.width / rect.width - window.offsetX) / window.escala,
                y: ((y - rect.top) * canvas.height / rect.height - window.offsetY) / window.escala,
            }
        }, center)
        await page.click('#drawRoundaboutButton')
        await page.mouse.move(center.x, center.y)
        await page.mouse.down()
        await page.mouse.move(center.x + 60, center.y, { steps: 6 })
        await page.mouse.up()
        assert.equal(await page.evaluate(() => window.calles.length), loadedMapCount + 1,
            'dragging from the central island must work on the built-in map, even over a building')
        const placed = await page.evaluate(() => ({ x: window.calles.at(-1).x, y: window.calles.at(-1).y }))
        assert.ok(Math.hypot(placed.x - expected.x, placed.y - expected.y) < 0.01,
            `ring center must coincide with mouse-down world position: ${JSON.stringify({ placed, expected })}`)
        await page.evaluate(() => {
            window.calles.splice(0)
            window.edificios.splice(0)
            window.conexiones.splice(0)
            window.cellGeometryIndex.clear()
        })
        await page.click('#drawRoundaboutButton')
        assert.equal(await page.evaluate(() => window.drawRoundaboutTool.isActive()), true)
        await page.mouse.move(center.x, center.y)
        await page.mouse.down()
        await page.mouse.move(center.x + 60, center.y, { steps: 6 })
        await page.mouse.up()
        const result = await page.evaluate(() => {
            const street = window.calles[0]
            const ring = window.roundaboutStreet.coordinates(street, 0, 0)
            return {
                count: window.calles.length,
                selected: window.calleSeleccionada === street,
                geometryType: street.geometryType,
                lanes: street.carriles,
                chance: street.probabilidadSaltoDeCarril,
                centerHit: window.encontrarCalleEnPunto(street.x, street.y),
                roadHit: window.encontrarCalleEnPunto(ring.x, ring.y)?.calle === street,
                bounds: window.calcularLimitesMapa(),
                x: street.x,
                y: street.y,
            }
        })
        assert.equal(result.count, 1)
        assert.equal(result.selected, true)
        assert.equal(result.geometryType, 'roundabout')
        assert.equal(result.lanes, 1)
        assert.equal(result.chance, 0.02)
        assert.equal(result.centerHit, null, 'central island must not select the road')
        assert.equal(result.roadHit, true)
        assert.ok(result.bounds.minX < result.x && result.bounds.maxX > result.x)
        await page.$eval('#streetInspectorLanes', input => {
            input.value = '2'
            input.dispatchEvent(new Event('blur'))
        })
        assert.equal(await page.evaluate(() => window.calles[0].carriles), 2)
        const roadPoint = await page.evaluate(() => {
            const street = window.calles[0]
            const p = window.roundaboutStreet.coordinates(street, 0, Math.floor(street.tamano / 4))
            const canvas = document.getElementById('simuladorCanvas')
            const rect = canvas.getBoundingClientRect()
            const camera = window.USE_PIXI && window.pixiApp?.cameraController
            const q = camera ? camera.worldToScreen(p.x, p.y) : {
                x: p.x * window.escala + window.offsetX,
                y: p.y * window.escala + window.offsetY,
            }
            const width = camera ? window.pixiApp.app.screen.width : canvas.width
            const height = camera ? window.pixiApp.app.screen.height : canvas.height
            return { x: rect.left + q.x * rect.width / width, y: rect.top + q.y * rect.height / height }
        })
        await page.mouse.move(roadPoint.x, roadPoint.y)
        await page.mouse.down()
        await page.mouse.move(roadPoint.x + 15, roadPoint.y + 10, { steps: 5 })
        await page.mouse.up()
        const moved = await page.evaluate(() => ({ x: window.calles[0].x, y: window.calles[0].y }))
        assert.ok(Math.hypot(moved.x - result.x, moved.y - result.y) > 1, 'body drag moves the center')
        const beforeRadius = await page.evaluate(() => window.calles[0].innerRadius)
        const handle = await page.$eval('.street-endpoint-handle[data-kind="radius"]', element => {
            const rect = element.getBoundingClientRect()
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        })
        await page.mouse.move(handle.x, handle.y)
        await page.mouse.down()
        await page.mouse.move(handle.x + 20, handle.y, { steps: 5 })
        if (usePixi) {
            const kindDuringDrag = await page.evaluate(() => window.pixiApp.sceneManager.calleSprites.get(window.calles[0])?._geometryKind)
            assert.equal(kindDuringDrag, 'roundabout', 'radius preview must never use a straight-road sprite')
        }
        await page.mouse.up()
        assert.ok(await page.evaluate(before => window.calles[0].innerRadius > before, beforeRadius), 'radial handle resizes the inner edge')
        assert.equal(await page.$eval('#streetInspectorBezierControls', element => element.hidden), true,
            'resizing must not turn a glorieta into a Bézier street')
        console.log(`roundabout creation/edit/hit (${usePixi ? 'Pixi' : 'Canvas'}): passed`)
    } finally {
        await sim.close()
    }
}
