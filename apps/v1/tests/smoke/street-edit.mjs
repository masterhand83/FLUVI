import assert from "node:assert/strict"
import { openSimulator } from "../helpers/simulator.mjs"

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 67, usePixi, freezeFrames: false })
	const { page } = sim
	try {
		if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.sceneManager, { timeout: 30000 })
		await page.evaluate(() => window.hideLoadingScreen?.())
		await page.waitForFunction(() => !!window.drawStreetTool?.isActive && !!window.streetInspector?.finishFocusedEdit)
		assert.equal(await page.evaluate(() => window.isPaused), false)
		await page.$eval("#drawStreetButton", button => button.click())
		assert.equal(await page.evaluate(() => window.isPaused), true, "starting Draw pauses traffic")
		await page.keyboard.press("Escape")
		assert.equal(await page.evaluate(() => window.isPaused), true, "aborting Draw stays paused")
		await page.$eval("#btnPauseResume", button => button.click())
		assert.equal(await page.evaluate(() => window.isPaused), false, "traffic resumes only on explicit Resume")

		const point = await page.evaluate(() => {
			const canvas = document.getElementById("simuladorCanvas")
			const rect = canvas.getBoundingClientRect()
			const screen = { x: rect.width * 0.55, y: rect.height * 0.4 }
			const world = window.USE_PIXI ? window.pixiApp.cameraController.screenToWorld(screen.x, screen.y)
				: { x: (screen.x * canvas.width / rect.width - window.offsetX) / window.escala, y: (screen.y * canvas.height / rect.height - window.offsetY) / window.escala }
			const street = window.crearCalle("Editable street", 12, window.TIPOS.CONEXION, world.x, world.y, 0, 0, 1, 0.02)
			const index = window.calles.indexOf(street)
			for (const id of ["selectCalle", "selectCalleEditor"]) document.getElementById(id).add(new Option(street.nombre, index))
			const selector = document.getElementById("selectCalle")
			selector.value = String(index)
			selector.dispatchEvent(new Event("change", { bubbles: true }))
			window.calleSeleccionada = street
			window.pixiApp?.sceneManager?.renderAll()
			window.renderizarCanvas?.()
			return { x: rect.left + screen.x + 20 * window.escala * (window.USE_PIXI ? 1 : rect.width / canvas.width), y: rect.top + screen.y }
		})
		await page.waitForFunction(() => document.getElementById("streetInspectorName")?.value === "Editable street")
		await page.$eval("#streetInspectorX", input => { input.value = "not a number"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("blur")) })
		assert.ok(await page.$eval("#streetInspectorError", el => el.textContent.length > 0), "invalid field explains the problem")
		const originalX = await page.evaluate(() => window.calleSeleccionada.x)
		await page.$eval("#streetInspectorX", input => { input.value = "123.5"; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
		assert.equal(await page.evaluate(() => window.calleSeleccionada.x), 123.5, "Enter commits exact coordinate")
		await page.$eval("#streetInspectorName", input => { input.value = "Retorno M. ←"; input.dispatchEvent(new Event("blur")) })
		assert.equal(await page.evaluate(() => window.calleSeleccionada.nombre), "Editable street", "duplicate name is rejected")
		await page.$eval("#streetInspectorName", input => { input.value = "Unique editable street"; input.dispatchEvent(new Event("blur")) })
		assert.equal(await page.evaluate(() => window.calleSeleccionada.nombre), "Unique editable street", "unique name commits")
		await page.$eval("#streetInspectorCells", input => { input.value = "16"; input.dispatchEvent(new Event("blur")) })
		assert.equal(await page.evaluate(() => window.calleSeleccionada.arreglo[0].length), 16, "resize updates indexed cells")
		assert.equal(await page.evaluate(() => window.isPaused), true, "dimension change pauses traffic")
		await page.evaluate(() => { window.calleSeleccionada.arreglo[0][2] = 3 })
		await page.$eval("#streetInspectorCells", input => { input.value = "18"; input.dispatchEvent(new Event("blur")) })
		assert.equal(await page.evaluate(() => window.calleSeleccionada.arreglo[0][2]), 3, "in-bounds vehicles survive resizing")
		await page.$eval("#streetInspectorLanes", input => { input.value = "11"; input.dispatchEvent(new Event("blur")) })
		assert.equal(await page.evaluate(() => window.calleSeleccionada.carriles), 1, "lane limit rejects out-of-range input")
		await page.$eval("#streetInspectorType", input => { input.value = "generador"; input.dispatchEvent(new Event("change", { bubbles: true })) })
		assert.equal(await page.evaluate(() => window.calleSeleccionada.probabilidadGeneracion), 0.5, "generator type suggests 50%")
		await page.$eval("#streetInspectorGeneration", input => { input.value = "25"; input.dispatchEvent(new Event("blur")) })
		assert.equal(await page.evaluate(() => window.calleSeleccionada.probabilidadGeneracion), 0.25, "generation percentage stores as fraction")
		await page.$eval("#streetInspectorType", input => { input.value = "conexion"; input.dispatchEvent(new Event("change", { bubbles: true })) })
		assert.equal(await page.evaluate(() => window.calleSeleccionada.probabilidadGeneracion), 0, "switching away resets generation")
		await page.evaluate(() => document.querySelectorAll('.toast').forEach(toast => { toast.remove() }))
		await page.evaluate((x) => { window.calleSeleccionada.x = x; window.renderizarCanvas?.(); window.pixiApp?.sceneManager?.renderAll() }, originalX)
		await page.mouse.move(point.x, point.y)
		await page.mouse.down()
		await page.mouse.move(point.x + 25, point.y + 15, { steps: 4 })
		assert.notEqual(await page.evaluate(() => window.calleSeleccionada.x), originalX, "the Calle itself moves during drag")
		await page.keyboard.press("Escape")
		await page.mouse.up()
		assert.equal(await page.evaluate(() => window.calleSeleccionada.x), originalX, "Escape restores geometry")
		await page.mouse.move(point.x, point.y)
		await page.mouse.down()
		await page.mouse.move(25, 25, { steps: 4 })
		await page.mouse.up()
		assert.equal(await page.evaluate(() => window.calleSeleccionada.x), originalX, "release outside the map restores geometry")
		await page.mouse.move(point.x, point.y)
		await page.mouse.down()
		await page.mouse.move(point.x + 20, point.y + 12, { steps: 4 })
		await page.mouse.up()
		assert.notEqual(await page.evaluate(() => window.calleSeleccionada.x), originalX, "body drag commits on release")
		const end = await page.evaluate(() => {
			const street = window.calleSeleccionada
			const canvas = document.getElementById("simuladorCanvas")
			const rect = canvas.getBoundingClientRect()
			const angle = street.angulo * Math.PI / 180
			const x = street.x + Math.cos(angle) * street.tamano * window.celda_tamano
			const y = street.y - Math.sin(angle) * street.tamano * window.celda_tamano
			const widthScale = window.USE_PIXI ? 1 : rect.width / canvas.width
			const heightScale = window.USE_PIXI ? 1 : rect.height / canvas.height
			return { x: rect.left + (x * window.escala + window.offsetX) * widthScale,
				y: rect.top + (y * window.escala + window.offsetY) * heightScale, cells: street.tamano }
		})
		await page.mouse.move(end.x, end.y)
		await page.mouse.down()
		await page.mouse.move(end.x + 20, end.y, { steps: 4 })
		await page.mouse.up()
		assert.ok(await page.evaluate(() => window.calleSeleccionada.tamano) > end.cells, "endpoint drag grows cell count")
		assert.equal(await page.$eval("#streetInspectorCells", input => Number(input.value)), await page.evaluate(() => window.calleSeleccionada.tamano), "endpoint geometry stays synchronized with inspector")
		assert.equal(await page.evaluate(() => window.calleSeleccionada.arreglo[0][2]), 3, "endpoint resize preserves indexed vehicle")
		await page.mouse.move(point.x + 20, point.y + 12)
		await page.mouse.down()
		await page.mouse.move(point.x + 30, point.y + 12, { steps: 3 })
		await page.$eval("#btnPauseResume", button => button.click())
		assert.equal(await page.evaluate(() => window.streetGeometryEditor.gesture), null, "Resume finishes active gesture")
		assert.equal(await page.evaluate(() => window.isPaused), false)
		await page.mouse.up()
		await page.$eval("#btnPauseResume", button => button.click())
		await page.$eval("#streetInspectorY", input => { input.focus(); input.value = "345.25" })
		await page.$eval("#btnPauseResume", button => button.click())
		assert.equal(await page.evaluate(() => window.calleSeleccionada.y), 345.25, "Resume commits a valid focused field before running")
		assert.equal(await page.evaluate(() => window.isPaused), false)
		await page.$eval("#btnPauseResume", button => button.click())
		const beforeStep = await page.evaluate(() => {
			const street = window.calleSeleccionada
			window.__freshGenerator = window.crearCalle("Fresh generator", 12, window.TIPOS.GENERADOR, street.x, street.y + 50, 0, 1, 1)
			window.configuracionTiempo.usarPerfiles = false
			return window.__freshGenerator.arreglo[0].some(Boolean)
		})
		assert.equal(beforeStep, false, "new generator starts empty")
		await page.$eval("#btnPaso", button => button.click())
		assert.equal(await page.evaluate(() => window.__freshGenerator.arreglo[0].some(Boolean)), true, "the first step after Resume generates traffic")
		await page.evaluate(() => { window.confirm = () => false })
		await page.$eval("#streetInspectorDeleteStreet", button => button.click())
		assert.equal(await page.evaluate(() => window.calles.includes(window.calleSeleccionada)), true, "cancel keeps the selected street")
		assert.equal(await page.$eval("#streetInspector", inspector => inspector.hidden), false, "cancel keeps the inspector open")
		await page.evaluate(() => { window.confirm = () => true })
		await page.$eval("#streetInspectorDeleteStreet", button => button.click())
		assert.equal(await page.evaluate(() => window.calles.some(street => street.nombre === "Unique editable street")), false, "inspector removes the selected street")
		assert.equal(await page.evaluate(() => window.calleSeleccionada), null, "deletion clears the map selection")
		assert.equal(await page.$eval("#streetInspector", inspector => inspector.hidden), true, "deletion closes the inspector")
		assert.deepEqual(await page.evaluate(() => [document.getElementById("selectCalle").value, document.getElementById("selectCalleEditor").value]), ["", ""], "selectors no longer point to a shifted index")
		console.log(`✅ explicit pause and resume (${usePixi ? "Pixi" : "Canvas"})`)
	} finally {
		await sim.close()
	}
}
