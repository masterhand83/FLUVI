import assert from "node:assert/strict"
import { openSimulator } from "../helpers/simulator.mjs"

function screenPoint(canvas, x, y) {
	const rect = canvas.getBoundingClientRect()
	return { x: rect.left + x * rect.width, y: rect.top + y * rect.height }
}

async function gesture(page, from, to) {
	await page.mouse.move(from.x, from.y)
	await page.mouse.down()
	await page.mouse.move(to.x, to.y, { steps: 6 })
	await page.mouse.up()
}

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 53, usePixi, freezeFrames: false })
	const { page } = sim
	try {
		if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.sceneManager, { timeout: 30000 })
		await page.evaluate(() => window.hideLoadingScreen?.())
		await page.waitForFunction(() => document.getElementById("loadingScreen")?.style.display === "none")
		await page.waitForSelector("#drawStreetButton", { visible: true, timeout: 10000 })
		await page.waitForFunction(() => !!window.drawStreetTool?.isActive, { timeout: 10000 })

		const before = await page.evaluate(() => window.calles.length)
		await page.$eval("#drawStreetButton", (button) => button.click())
		await page.waitForFunction(() => window.drawStreetTool?.isActive?.() === true, { timeout: 5000 })

		const canvas = await page.$("#simuladorCanvas")
		// A short drag is rejected without consuming the drawing mode; the user can retry.
		let points = await page.evaluate((el) => {
			const r = el.getBoundingClientRect()
			const camera = window.pixiApp?.cameraController
			const worldAt = (x, y) => camera
				? camera.screenToWorld(x - r.left, y - r.top)
				: { x: (x - r.left - (window.offsetX || 0)) / (window.escala || 1), y: (y - r.top - (window.offsetY || 0)) / (window.escala || 1) }
			let start
			for (let y = r.top + 90; y < r.bottom - 80 && !start; y += 35) {
				for (let x = r.left + 40; x < r.right - 180; x += 35) {
					const world = worldAt(x, y)
					if (!window.encontrarCalleEnPunto?.(world.x, world.y) && !window.encontrarEdificioEnPunto?.(world.x, world.y)) {
						start = { x, y }
						break
					}
				}
			}
			if (!start) throw new Error("no empty map point available to start street draw")
			return {
				shortFrom: start,
				shortTo: { x: start.x + 2, y: start.y },
				from: start,
				to: { x: start.x + 140, y: start.y },
			}
		}, canvas)
		await gesture(page, points.shortFrom, points.shortTo)
		assert.equal(await page.evaluate(() => window.calles.length), before, "short gesture must not create a street")
		assert.equal(await page.evaluate(() => window.drawStreetTool?.isActive?.()), true, "short gesture must allow retry")

		let drawnEvent
		await page.evaluate(() => {
			window.__drawStreetEvents = []
			document.addEventListener("street-drawn", (event) => window.__drawStreetEvents.push(event.detail))
		})
		await gesture(page, points.from, points.to)
		await page.waitForFunction((initialCount) => window.calles.length > initialCount && window.__drawStreetEvents?.length > 0, { timeout: 10000 }, before).catch(async () => {
			throw new Error(`valid gesture did not draw; points=${JSON.stringify(points)}, active=${await page.evaluate(() => window.drawStreetTool?.isActive?.())}, pageErrors=${sim.pageErrors.join(" | ")}`)
		})
		drawnEvent = await page.evaluate(() => window.__drawStreetEvents.at(-1))
		const result = await page.evaluate((detail) => {
			const added = window.calles.at(-1)
			const cellSize = window.celda_tamano ?? 5
			return {
				addedId: added.id,
				streetCount: window.calles.length,
				selectedId: window.calleSeleccionada?.id ?? null,
				geometry: { x: added.x, y: added.y, tamano: added.tamano, carriles: added.carriles },
				cellSize,
				defaults: { tipo: added.tipo, carriles: added.carriles, generation: added.probabilidadGeneracion, laneChange: added.probabilidadSaltoDeCarril, seeded: added.arreglo.flat().some(Boolean) },
				eventCarriesStreet: detail?.calle?.id === added.id,
				toolActive: window.drawStreetTool.isActive(),
			}
		}, drawnEvent)
		assert.equal(result.streetCount, before + 1, "valid drag creates exactly one street")
		assert.ok(result.geometry.tamano > 0, "created street has positive length")
		assert.ok(result.geometry.carriles > 0, "new street has a usable lane count")
		assert.equal(result.geometry.tamano, Math.round(140 / result.cellSize), "drag length quantizes to nearest model cell")
		assert.equal(result.selectedId, result.addedId, "new street becomes selected for inspection")
		assert.ok(result.eventCarriesStreet, "street-drawn event identifies the created street")
		assert.equal(result.toolActive, false, "completed draw exits the tool")
		assert.equal(result.defaults.tipo, "conexion")
		assert.equal(result.defaults.carriles, 1)
		assert.equal(result.defaults.generation, 0)
		assert.equal(result.defaults.laneChange, 0.02)
		assert.equal(result.defaults.seeded, false)
		await page.waitForFunction(() => !document.getElementById("streetInspector")?.hidden, { timeout: 5000 })
		const inspector = await page.evaluate(() => ({
			name: document.getElementById("streetInspectorName").value,
			cells: document.getElementById("streetInspectorCells").value,
			lanes: document.getElementById("streetInspectorLanes").value,
			type: document.getElementById("streetInspectorType").value,
		}))
		assert.equal(inspector.name, "Street 1", "inspector displays the created street")
		assert.equal(Number(inspector.cells), result.geometry.tamano, "inspector shows its cell count")
		assert.equal(Number(inspector.lanes), result.geometry.carriles, "inspector shows its lane count")
		assert.equal(inspector.type, result.defaults.tipo, "inspector shows its type")
		assert.ok(await page.evaluate(() => window.calleSeleccionada?.nombre), 'street is selected before closing the inspector')
		await page.click('#streetInspectorClose')
		await new Promise(resolve => setTimeout(resolve, 50))
		assert.equal(await page.$eval('#streetInspector', el => el.hidden), true, 'close button keeps inspector closed')
		assert.equal(await page.evaluate(() => window.calleSeleccionada?.nombre ?? null), null, 'closing the inspector deselects the street')
		assert.deepEqual(await page.evaluate(() => [document.getElementById('selectCalle').value, document.getElementById('selectCalleEditor').value]), ['', ''], 'close clears both street selectors')
		if (usePixi) assert.equal(await page.evaluate(() => [...window.pixiApp.sceneManager.calleSprites.values()].some(sprite => sprite.getChildByName('selectionBorder'))), false, 'close clears Pixi selection outline')
		const existing = await page.evaluate(() => {
			const calle = window.calles[0]
			const wasPaused = window.isPaused
			const selector = document.getElementById('selectCalle')
			selector.value = '0'
			selector.dispatchEvent(new Event('change', { bubbles: true }))
			return { name: calle.nombre, cells: calle.arreglo[0].length, wasPaused }
		})
		assert.equal(await page.$eval('#streetInspectorName', el => el.value), existing.name, 'existing street selection updates inspector')
		assert.equal(Number(await page.$eval('#streetInspectorCells', el => el.value)), existing.cells)
		assert.equal(await page.evaluate(() => window.isPaused), existing.wasPaused, 'selection does not pause traffic')
		await page.evaluate(() => {
			window.calleSeleccionada = null
			document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
		})
		await page.waitForFunction(() => document.getElementById('streetInspector').hidden)
		await page.evaluate(() => {
			const selector = document.getElementById('selectCalle')
			selector.value = '0'
			selector.dispatchEvent(new Event('change', { bubbles: true }))
		})
		console.log(`✅ draw street creation/defaults/selection/event (${usePixi ? "Pixi" : "Canvas"})`)

		// Escape cancels an in-progress gesture; clicking outside the canvas exits the tool.
		await page.click("#drawStreetButton")
		await page.waitForFunction(() => window.drawStreetTool?.isActive?.() === true)
		points = { from: points.from, to: points.to }
		await page.mouse.move(points.from.x, points.from.y)
		await page.mouse.down()
		await page.mouse.move(points.to.x, points.to.y, { steps: 3 })
		await page.keyboard.press("Escape")
		await page.mouse.up()
		assert.equal(await page.evaluate(() => window.calles.length), before + 1, "Escape cancels without creating a street")
		assert.equal(await page.evaluate(() => window.drawStreetTool?.isActive?.()), false, "Escape exits drawing mode")

		// Releasing outside the canvas aborts even when pointer capture retargets the event.
		await page.click("#drawStreetButton")
		await page.mouse.move(points.from.x, points.from.y)
		await page.mouse.down()
		await page.mouse.move(30, 30, { steps: 3 })
		await page.mouse.up()
		assert.equal(await page.evaluate(() => window.calles.length), before + 1, "outside click cancels an in-progress street")
		assert.equal(await page.evaluate(() => window.drawStreetTool?.isActive?.()), true, "outside cancellation leaves drawing mode ready")
		await page.click("#drawStreetButton")
		assert.equal(await page.evaluate(() => window.drawStreetTool?.isActive?.()), false, "draw button exits drawing mode")
		const beforeWheel = await page.evaluate(() => window.escala)
		const navigationPoint = await page.evaluate(() => {
			const rect = document.getElementById('simuladorCanvas').getBoundingClientRect()
			return { x: rect.left + rect.width * 0.6, y: rect.top + rect.height * 0.6 }
		})
		await page.mouse.move(navigationPoint.x, navigationPoint.y)
		await page.mouse.wheel({ deltaY: 160 })
		await page.waitForFunction((scale) => window.escala !== scale, { timeout: 5000 }, beforeWheel)
		assert.equal(await page.$eval('#streetInspector', el => el.hidden), false, 'inspector remains open while navigating the map')
		console.log(`✅ draw street retry, Escape cancellation and outside exit (${usePixi ? "Pixi" : "Canvas"})`)
	} finally {
		await sim.close()
	}
}
