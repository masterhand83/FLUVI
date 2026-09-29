import assert from "node:assert/strict"
import { openSimulator } from "../helpers/simulator.mjs"

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function prepareScene(page) {
	await page.evaluate(() => {
		window.hideLoadingScreen?.()
		window.confirm = () => true
		window.alert = () => {}
		document.getElementById("btnNuevaSimulacion").click()
	})
	await page.waitForFunction(() => getComputedStyle(document.getElementById("loadingScreen")).display === "none")
	await page.waitForFunction(() => window.edificios?.length === 0)
	if (await page.evaluate(() => window.USE_PIXI)) {
		await page.waitForFunction(() => !!window.pixiApp?.sceneManager, { timeout: 30000 })
	}

	await page.evaluate(() => {
		const canvas = document.getElementById("simuladorCanvas")
		const screen = window.USE_PIXI ? window.pixiApp.app.screen : { width: canvas.width, height: canvas.height }
		const worldAt = (x, y) => window.USE_PIXI
			? window.pixiApp.cameraController.screenToWorld(x, y)
			: { x: (x - window.offsetX) / window.escala, y: (y - window.offsetY) / window.escala }
		const streetId = "parking-smoke-street"
		window.calles.push(window.crearCalle(streetId, 2, "conexion", 0, 0, 0, 0, 1))
		const parkingConnections = [
			{ tipo: "entrada", calleId: streetId, carril: 0, indice: 0, probabilidad: 1 },
			{ tipo: "salida", calleId: streetId, carril: 0, indice: 1, probabilidad: 1 },
		]
		const positions = [0.27, 0.43, 0.59, 0.75].map((fraction) => worldAt(screen.width * fraction, screen.height * 0.48))
		const make = (label, position, props = {}) => ({
			id: `parking-smoke-${label}`,
			label,
		x: position.x,
		y: position.y,
		width: 96,
		height: 64,
		angle: 0,
		color: "#0066FF",
		esEstacionamiento: false,
		conexiones: [],
		...props,
	})
		const buildings = [
			make("Blue fill functional parking", positions[0], { esEstacionamiento: true, conexiones: parkingConnections }),
			make("ESCOM", positions[1], { esEstacionamiento: true, conexiones: parkingConnections, color: "#8B4513" }),
			make("Estacionamiento decorativo", positions[2]),
			make("ESCOM", positions[3], {
				imagen: "estacionamiento",
				color: "#8B4513",
				esEstacionamiento: true,
				conexiones: [
					{ tipo: "entrada", calleId: "missing-street", carril: 0, indice: 0 },
					{ tipo: "salida", calleId: "missing-street", carril: 0, indice: 1 },
				],
			}),
		]
		buildings.forEach((building, index) => { building.index = index })
		window.edificios.splice(0, window.edificios.length, ...buildings)
		if (window.USE_PIXI) {
			window.pixiApp.sceneManager.renderAll()
			window.pixiApp.app.renderer.render(window.pixiApp.app.stage)
		}
		window.renderizarCanvas?.()
	})
	await page.waitForFunction(() => !window.USE_PIXI || window.pixiApp.sceneManager.edificioSprites.size === 4)
	await wait(250)
}

async function outlinePixels(page, index) {
	return page.evaluate(async (buildingIndex) => {
		const canvas = document.getElementById("simuladorCanvas")
		const building = window.edificios[buildingIndex]
		let pixelsCanvas
		let origin = { x: 0, y: 0 }
		if (window.USE_PIXI) {
			const { app } = window.pixiApp
			const extracted = app.renderer.extract.canvas(app.stage)
			const bounds = app.stage.getBounds()
			origin = { x: bounds.x, y: bounds.y }
			pixelsCanvas = document.createElement("canvas")
			pixelsCanvas.width = extracted.width
			pixelsCanvas.height = extracted.height
			pixelsCanvas.getContext("2d").drawImage(extracted, 0, 0)
		} else {
			pixelsCanvas = canvas
		}
		const scale = window.USE_PIXI ? window.pixiApp.app.renderer.resolution : 1
		const center = window.USE_PIXI
			? window.pixiApp.cameraController.worldToScreen(building.x, building.y)
			: { x: building.x * window.escala + window.offsetX, y: building.y * window.escala + window.offsetY }
		const screenScale = window.USE_PIXI ? window.pixiApp.cameraController.scale : window.escala
		const edgeY = Math.round((center.y - origin.y - building.height * screenScale / 2) * scale)
		const left = Math.round((center.x - origin.x - building.width * screenScale / 2) * scale)
		const right = Math.round((center.x - origin.x + building.width * screenScale / 2) * scale)
		const context = pixelsCanvas.getContext("2d", { willReadFrequently: true })
		const data = context.getImageData(0, 0, pixelsCanvas.width, pixelsCanvas.height).data
		const pixelAt = (x, y) => {
			const offset = (y * pixelsCanvas.width + x) * 4
			return data.slice(offset, offset + 4)
		}
		const countColor = (top, bottom, matches) => {
			let count = 0
			for (let y = Math.max(0, top); y < Math.min(pixelsCanvas.height, bottom); y++) {
				for (let x = Math.max(0, left + 8); x < Math.min(pixelsCanvas.width, right - 8); x++) {
					if (matches(pixelAt(x, y))) count++
				}
			}
			return count
		}
		// Restrict the probe to pixels just outside the top edge: a blue building
		// fill must not be mistaken for the independent outline.
		const blue = countColor(edgeY - 7, edgeY, ([r, g, b, a]) => a > 180 && b > 220 && g > 70 && g < 145 && r < 40)
		const gold = countColor(edgeY + 1, edgeY + 8, ([r, g, b, a]) => a > 180 && r > 180 && g > 130 && b < 80)
		return { blue, gold }
	}, index)
}

async function refreshBuilding(page, index) {
	await page.evaluate((buildingIndex) => {
		const building = window.edificios[buildingIndex]
		if (window.USE_PIXI) {
			window.pixiApp.sceneManager.edificioRenderer.updateEdificioSprite(building)
			window.pixiApp.app.renderer.render(window.pixiApp.app.stage)
		}
		else window.renderizarCanvas?.()
	}, index)
	await wait(100)
}

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 93, usePixi, freezeFrames: false })
	try {
		const { page } = sim
		await prepareScene(page)
		assert.equal(await page.evaluate(() => window.USE_PIXI
			? window.pixiApp.sceneManager.edificioSprites.get(window.edificios[1]) instanceof PIXI.Sprite
			: buildingImageMap.ESCOM.complete && buildingImageMap.ESCOM.naturalHeight > 0), true,
		"image-backed building uses its bundled image")
		if (usePixi) {
			assert.equal(await page.evaluate(() => window.pixiApp.sceneManager.edificioSprites.get(window.edificios[3]) instanceof PIXI.Sprite), true,
				"decorative parking uses its bundled image in Pixi")
		}

		for (const index of [0, 1]) {
			const pixels = await outlinePixels(page, index)
			assert.ok(pixels.blue > 0, `${usePixi ? "Pixi" : "Canvas"}: functional parking ${index} has visible blue outline pixels`)
		}
		for (const index of [2, 3]) {
			const pixels = await outlinePixels(page, index)
			assert.equal(pixels.blue, 0, `${usePixi ? "Pixi" : "Canvas"}: decorative building ${index} has no blue outline pixels`)
		}

		await page.evaluate(() => { window.edificioSeleccionado = window.edificios[0] })
		await refreshBuilding(page, 0)
		let selected = await outlinePixels(page, 0)
		assert.ok(selected.blue > 0, `${usePixi ? "Pixi" : "Canvas"}: blue outline remains visible while selected`)
		assert.ok(selected.gold > 0, `${usePixi ? "Pixi" : "Canvas"}: selection outline is separately visible`)

		await page.evaluate(() => { window.edificioSeleccionado = window.edificios[1] })
		await refreshBuilding(page, 1)
		selected = await outlinePixels(page, 1)
		assert.ok(selected.blue > 0, `${usePixi ? "Pixi" : "Canvas"}: image-backed parking keeps blue outline while selected`)
		assert.ok(selected.gold > 0, `${usePixi ? "Pixi" : "Canvas"}: image-backed selection outline is separately visible ${JSON.stringify(selected)}`)

		await page.evaluate(() => { window.edificioSeleccionado = window.edificios[2] })
		await refreshBuilding(page, 2)
		const decorativeSelected = await outlinePixels(page, 2)
		assert.equal(decorativeSelected.blue, 0, `${usePixi ? "Pixi" : "Canvas"}: selection does not give decorative building a parking outline`)
		assert.ok(decorativeSelected.gold > 0, `${usePixi ? "Pixi" : "Canvas"}: decorative selection outline remains visible`)

		await page.evaluate(() => {
			window.edificioSeleccionado = window.edificios[0]
			window.configurarEstacionamiento(window.edificios[0], [])
		})
		assert.equal((await outlinePixels(page, 0)).blue, 0, `${usePixi ? "Pixi" : "Canvas"}: deactivation removes outline while selected`)

		await page.evaluate(() => {
			window.configurarEstacionamiento(window.edificios[0], [
				{ tipo: "entrada", calleId: "parking-smoke-street", carril: 0, indice: 0, probabilidad: 1 },
				{ tipo: "salida", calleId: "parking-smoke-street", carril: 0, indice: 1, probabilidad: 1 },
			])
		})
		await wait(100)
		assert.ok((await outlinePixels(page, 0)).blue > 0, `${usePixi ? "Pixi" : "Canvas"}: activation restores outline without deselecting`)
		await page.evaluate(() => { window.edificioSeleccionado = null })
		await refreshBuilding(page, 0)
		assert.ok((await outlinePixels(page, 0)).blue > 0, `${usePixi ? "Pixi" : "Canvas"}: unselected functional parking retains outline`)
		console.log(`✅ functional parking visible outline (${usePixi ? "Pixi" : "Canvas"})`)
	} finally {
		await sim.close()
	}
}
