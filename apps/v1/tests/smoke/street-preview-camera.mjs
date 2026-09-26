import assert from "node:assert/strict"
import { openSimulator } from "../helpers/simulator.mjs"

for (const usePixi of [false, true]) {
	if (process.env.PREVIEW_MODE && process.env.PREVIEW_MODE !== (usePixi ? "Pixi" : "Canvas")) continue
	const sim = await openSimulator({ seed: 79, usePixi, freezeFrames: false })
	try {
		const { page } = sim
		if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.cameraController, { timeout: 30000 })
		await page.evaluate(() => window.hideLoadingScreen?.())
		await page.waitForFunction(() => !!window.streetGeometryEditor)
		const point = await page.evaluate(() => {
			const canvas = document.getElementById("simuladorCanvas")
			const rect = canvas.getBoundingClientRect()
			const sx = rect.width * 0.55, sy = rect.height * 0.45
			const world = window.USE_PIXI ? window.pixiApp.cameraController.screenToWorld(sx, sy)
				: { x: (sx * canvas.width / rect.width - window.offsetX) / window.escala,
					y: (sy * canvas.height / rect.height - window.offsetY) / window.escala }
			const street = window.crearCalle("Preview camera check", 15, window.TIPOS.CONEXION, world.x, world.y, 0, 0, 1)
			window.calleSeleccionada = street
			window.renderizarCanvas?.()
			window.pixiApp?.sceneManager?.renderAll()
			return { x: rect.left + sx + 25 * window.escala * (window.USE_PIXI ? 1 : rect.width / canvas.width), y: rect.top + sy }
		})
		await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.id === 'simuladorCanvas', {}, point)
		await page.mouse.move(point.x, point.y)
		await page.mouse.down()
		await page.mouse.move(point.x + 20, point.y + 10, { steps: 3 })
		assert.equal(await page.evaluate(() => window.streetGeometryEditor?.gesture?.kind), "body")
		const beforeZoom = await page.evaluate(() => window.escala)
		const beforeGeometry = await page.evaluate(() => ({ ...window.streetGeometryEditor.gesture.proposed }))
		await page.mouse.wheel({ deltaY: 180 })
		await page.waitForFunction(scale => window.escala !== scale, {}, beforeZoom)
		await new Promise(resolve => setTimeout(resolve, 100))
		const result = await page.evaluate(() => {
			const { proposed, street } = window.streetGeometryEditor.gesture
			const canvas = document.getElementById("simuladorCanvas")
			const rect = canvas.getBoundingClientRect()
			const preview = [...document.querySelectorAll('.street-draw-preview line')].find(line => line.getAttribute('stroke') === '#e87516')
			const expectedX = window.USE_PIXI ? window.pixiApp.cameraController.worldToScreen(proposed.x, proposed.y).x
				: (proposed.x * window.escala + window.offsetX) * rect.width / canvas.width
			const endX = proposed.x + proposed.tamano * window.celda_tamano * Math.cos(proposed.angulo * Math.PI / 180)
			const expectedEndX = window.USE_PIXI ? window.pixiApp.cameraController.worldToScreen(endX, proposed.y).x
				: (endX * window.escala + window.offsetX) * rect.width / canvas.width
			return { proposed: { ...proposed }, actualX: Number(preview.getAttribute('x1')), expectedX, actualWidth: Number(preview.getAttribute('stroke-width')),
				actualEndX: Number(preview.getAttribute('x2')), expectedEndX,
				expectedWidth: street.carriles * window.celda_tamano * window.escala * (window.USE_PIXI ? 1 : rect.width / canvas.width), scale: window.escala }
		})
		assert.ok(Number.isFinite(result.actualWidth), "preview has a visible, finite stroke width")
		assert.deepEqual(result.proposed, beforeGeometry, "zooming without moving the pointer keeps the proposed Calle fixed in world space")
		assert.ok(Math.abs(result.actualX - result.expectedX) < 2,
			`street preview tracks the street after zoom (${usePixi ? "Pixi" : "Canvas"}): ${JSON.stringify(result)}`)
		assert.ok(Math.abs(result.actualWidth - result.expectedWidth) < 0.1, "preview thickness scales with the street")
		assert.ok(Math.abs(result.actualEndX - result.expectedEndX) < 2, "preview length scales with the street")
		await page.keyboard.press("Escape")
		await page.mouse.up()
		await page.$eval('#drawStreetButton', button => button.click())
		const drawing = await page.evaluate(() => {
			const canvas = document.getElementById('simuladorCanvas')
			const rect = canvas.getBoundingClientRect()
			const worldAt = (x, y) => window.USE_PIXI ? window.pixiApp.cameraController.screenToWorld(x, y)
				: { x: (x * canvas.width / rect.width - window.offsetX) / window.escala,
					y: (y * canvas.height / rect.height - window.offsetY) / window.escala }
			for (let y = 110; y < rect.height - 100; y += 40) for (let x = 50; x < rect.width - 150; x += 40) {
				const world = worldAt(x, y)
				if (document.elementFromPoint(rect.left + x, rect.top + y) !== canvas) continue
				if (window.encontrarCalleEnPunto(world.x, world.y) || window.encontrarEdificioEnPunto(world.x, world.y)) continue
				return { screen: { x: rect.left + x, y: rect.top + y }, world }
			}
			throw new Error('No empty map position available')
		})
		await page.mouse.move(drawing.screen.x, drawing.screen.y)
		await page.mouse.down()
		await page.mouse.move(drawing.screen.x + 80, drawing.screen.y + 15, { steps: 3 })
		assert.equal(await page.evaluate(() => window.drawStreetTool.isActive()), true)
		const drawScale = await page.evaluate(() => window.escala)
		await page.mouse.wheel({ deltaY: -180 })
		await page.waitForFunction(scale => window.escala !== scale, {}, drawScale)
		await new Promise(resolve => setTimeout(resolve, 100))
		const drawPreview = await page.evaluate(({ x, y }) => {
			const line = [...document.querySelectorAll('.street-draw-preview line')].find(item => item.getAttribute('stroke') === '#1976d2')
			const canvas = document.getElementById('simuladorCanvas')
			const rect = canvas.getBoundingClientRect()
			const expectedX = window.USE_PIXI ? window.pixiApp.cameraController.worldToScreen(x, y).x
				: (x * window.escala + window.offsetX) * rect.width / canvas.width
			return { actualX: Number(line.getAttribute('x1')), expectedX }
		}, drawing.world)
		assert.ok(Math.abs(drawPreview.actualX - drawPreview.expectedX) < 2,
			`Draw preview tracks its world-space start after zoom (${usePixi ? "Pixi" : "Canvas"}): ${JSON.stringify(drawPreview)}`)
		await page.keyboard.press('Escape')
		await page.mouse.up()
		console.log(`✅ preview stays on street after zoom (${usePixi ? "Pixi" : "Canvas"})`)
	} finally {
		await sim.close()
	}
}
