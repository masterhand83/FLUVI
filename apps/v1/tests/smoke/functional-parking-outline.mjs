import assert from "node:assert/strict"
import { openSimulator } from "../helpers/simulator.mjs"

async function render(page) {
	await page.evaluate(() => {
		if (window.USE_PIXI) {
			window.pixiApp.sceneManager.renderAll()
			window.pixiApp.app.renderer.render(window.pixiApp.app.stage)
		} else {
			window.renderizarCanvas()
		}
	})
	await new Promise(resolve => setTimeout(resolve, 80))
}

async function visiblePixels(page) {
	const { footprints, width, height } = await page.evaluate(() => {
		const canvas = document.getElementById("simuladorCanvas")
		const rect = canvas.getBoundingClientRect()
		const screen = window.USE_PIXI ? window.pixiApp.app.screen : { width: canvas.width, height: canvas.height }
		const toScreen = (x, y) => {
			const point = window.USE_PIXI
				? window.pixiApp.cameraController.worldToScreen(x, y)
				: { x: x * window.escala + window.offsetX, y: y * window.escala + window.offsetY }
			return { x: rect.left + point.x * rect.width / screen.width, y: rect.top + point.y * rect.height / screen.height }
		}
		const footprints = Object.fromEntries(window.edificios.map(building => {
			const left = toScreen(building.x - building.width / 2, building.y).x
			const right = toScreen(building.x + building.width / 2, building.y).x
			const top = toScreen(building.x, building.y - building.height / 2).y
			const bottom = toScreen(building.x, building.y + building.height / 2).y
			return [building.testId, { left: Math.min(left, right), right: Math.max(left, right), top: Math.min(top, bottom), bottom: Math.max(top, bottom) }]
		}))
		return { footprints, width: window.innerWidth, height: window.innerHeight }
	})
	const png = await page.screenshot({ type: "png", encoding: "base64" })
	return page.evaluate(async ({ png, footprints, cssWidth, cssHeight }) => {
		const image = new Image()
		image.src = `data:image/png;base64,${png}`
		await image.decode()
		const surface = document.createElement("canvas")
		surface.width = image.naturalWidth
		surface.height = image.naturalHeight
		const context = surface.getContext("2d", { willReadFrequently: true })
		context.drawImage(image, 0, 0)
		const sx = surface.width / cssWidth
		const sy = surface.height / cssHeight
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this deliberately scans two independent colors around a rectangular framebuffer region
		const readFootprint = (bounds) => {
			const scaled = {
				left: bounds.left * sx,
				right: bounds.right * sx,
				top: bounds.top * sy,
				bottom: bounds.bottom * sy,
			}
			const margin = 14 * Math.max(sx, sy)
			const minX = Math.max(0, Math.floor(scaled.left - margin))
			const maxX = Math.min(surface.width - 1, Math.ceil(scaled.right + margin))
			const minY = Math.max(0, Math.floor(scaled.top - margin))
			const maxY = Math.min(surface.height - 1, Math.ceil(scaled.bottom + margin))
			const region = context.getImageData(minX, minY, maxX - minX + 1, maxY - minY + 1)
			let blueOutside = 0
			let selection = 0
			for (let y = minY; y <= maxY; y++) {
				for (let x = minX; x <= maxX; x++) {
					const offset = ((y - minY) * region.width + x - minX) * 4
					const pixel = region.data.subarray(offset, offset + 4)
					const dx = x < scaled.left ? scaled.left - x : x > scaled.right ? x - scaled.right : 0
					const dy = y < scaled.top ? scaled.top - y : y > scaled.bottom ? y - scaled.bottom : 0
					const outside = Math.hypot(dx, dy)
					const parkingBlue = pixel[3] > 200 && pixel[0] < 220 && pixel[2] > 248 && Math.abs(pixel[1] - (102 + pixel[0] * 0.6)) < 10
					if (outside >= 0.5 * Math.min(sx, sy) && outside <= margin && parkingBlue) blueOutside++
					if (pixel[3] > 200 && pixel[0] > 220 && pixel[1] >= 120 && pixel[1] <= 230 && pixel[2] < 70) selection++
				}
			}
			return { blueOutside, selection }
		}
		return Object.fromEntries(Object.entries(footprints).map(([id, bounds]) => [id, readFootprint(bounds)]))
	}, { png, footprints, cssWidth: width, cssHeight: height })
}

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 121, usePixi, freezeFrames: false })
	try {
		const { page } = sim
		if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.sceneManager, { timeout: 30000 })
		await page.evaluate(() => {
			window.hideLoadingScreen?.()
			window.confirm = () => true
			window.alert = () => {}
			document.getElementById("btnNuevaSimulacion").click()
			window.mostrarEtiquetas = false

			const canvas = document.getElementById("simuladorCanvas")
			const screen = window.USE_PIXI ? window.pixiApp.app.screen : { width: canvas.width, height: canvas.height }
			const toWorld = (x, y) => window.USE_PIXI
				? window.pixiApp.cameraController.screenToWorld(x, y)
				: { x: (x - window.offsetX) / window.escala, y: (y - window.offsetY) / window.escala }
			const center = (fx, fy) => toWorld(screen.width * fx, screen.height * fy)
			const horizontal = Math.abs(toWorld(screen.width * 0.12, 0).x - toWorld(0, 0).x)
			const vertical = Math.abs(toWorld(0, screen.height * 0.11).y - toWorld(0, 0).y)

			const streetPoint = center(0.45, 0.86)
			const street = window.crearCalle("Parking smoke street", 8, window.TIPOS.CONEXION, streetPoint.x, streetPoint.y, 0, 0, 1, 0)
			if (!window.calles.includes(street)) window.calles.push(street)
			const add = (testId, label, fx, fy, color, imagen) => {
				const point = center(fx, fy)
				const building = window.agregarEdificio(label, point.x, point.y, horizontal, vertical, 0)
				Object.assign(building, { testId, color, imagen, appearanceMode: imagen ? "image" : "rectangular" })
				building.index = window.edificios.indexOf(building)
				return building
			}
			const blueFill = add("blue-fill", "Azul funcional", 0.32, 0.38, "#0066FF")
			const image = add("image", "ESCOM", 0.68, 0.38, "#884422", "escom")
			add("decorative-label", "ESTACIONAMIENTO DECORATIVO", 0.32, 0.68, "#777777")
			add("decorative-image", "CIC", 0.68, 0.68, "#884422", "estacionamiento")
			window.__parkingSmoke = { street, blueFill, image }

			if (window.USE_PIXI) {
				const renderer = window.pixiApp.sceneManager.edificioRenderer
				for (const building of window.edificios) renderer.removeEdificioSprite(building)
				window.pixiApp.sceneManager.renderAll()
			}
			window.renderizarCanvas?.()
		})
		await render(page)

		let pixels = await visiblePixels(page)
		const baselinePixels = pixels

		const configured = await page.evaluate(() => {
			const connections = (entry, exit) => [
				{ tipo: "entrada", calleId: window.__parkingSmoke.street.id, carril: 0, indice: entry },
				{ tipo: "salida", calleId: window.__parkingSmoke.street.id, carril: 0, indice: exit },
			]
			return [
				window.configurarEstacionamiento(window.__parkingSmoke.blueFill, connections(0, 1), 20),
				window.configurarEstacionamiento(window.__parkingSmoke.image, connections(2, 3), 20),
			]
		})
		assert.deepEqual(configured, [true, true], "functional parking connections are valid")
		assert.deepEqual(await page.evaluate(() => [window.esEstacionamientoFuncional(window.__parkingSmoke.blueFill), window.esEstacionamientoFuncional(window.__parkingSmoke.image)]), [true, true], "configured buildings are functional parking")
		await render(page)
		pixels = await visiblePixels(page)
		const activePixels = pixels
		assert.ok(pixels["blue-fill"].blueOutside > baselinePixels["blue-fill"].blueOutside + 30, `same-blue fill visibly exposes a separate #0066FF functional parking outline (${baselinePixels["blue-fill"].blueOutside} -> ${pixels["blue-fill"].blueOutside})`)
		assert.ok(pixels.image.blueOutside > baselinePixels.image.blueOutside + 30, `image-backed functional parking visibly exposes a #0066FF outline (${baselinePixels.image.blueOutside} -> ${pixels.image.blueOutside})`)
		assert.ok(pixels["decorative-label"].blueOutside <= baselinePixels["decorative-label"].blueOutside + 12, "parking-themed label alone does not gain the outline")
		assert.ok(pixels["decorative-image"].blueOutside <= baselinePixels["decorative-image"].blueOutside + 12, "parking-themed image alone does not gain the outline")

		await page.evaluate(() => {
			window.edificioSeleccionado = window.__parkingSmoke.blueFill
			window.modoSeleccion = "constructor"
		})
		await render(page)
		pixels = await visiblePixels(page)
		assert.ok(pixels["blue-fill"].blueOutside > baselinePixels["blue-fill"].blueOutside + 30, "selected functional parking retains its blue outline")
		assert.ok(pixels["blue-fill"].selection > 20, "selection has a separately visible orange/gold outline")

		await page.$eval("#btnParkingOutlines", button => button.click())
		await new Promise(resolve => setTimeout(resolve, 80))
		pixels = await visiblePixels(page)
		assert.equal(await page.$eval("#btnParkingOutlines", button => button.getAttribute("aria-pressed")), "false", "toolbar reports that functional parking outlines are hidden")
		assert.ok(pixels["blue-fill"].blueOutside < activePixels["blue-fill"].blueOutside * 0.5, "toolbar hides the functional parking outline")
		assert.ok(pixels["blue-fill"].selection > 20, "selection remains visible while parking outlines are hidden")

		await page.$eval("#btnParkingOutlines", button => button.click())
		await new Promise(resolve => setTimeout(resolve, 80))
		pixels = await visiblePixels(page)
		assert.equal(await page.$eval("#btnParkingOutlines", button => button.getAttribute("aria-pressed")), "true", "toolbar reports that functional parking outlines are visible")
		assert.ok(pixels["blue-fill"].blueOutside > baselinePixels["blue-fill"].blueOutside + 30, "toolbar restores the functional parking outline")

		await page.evaluate(() => {
			window.edificioSeleccionado = null
			window.limpiarConexionesEdificio(window.__parkingSmoke.blueFill)
			window.limpiarConexionesEdificio(window.__parkingSmoke.image)
		})
		await render(page)
		pixels = await visiblePixels(page)
		assert.ok(pixels["blue-fill"].blueOutside < activePixels["blue-fill"].blueOutside * 0.5, `deactivation visibly removes the functional outline from the blue-fill building (${activePixels["blue-fill"].blueOutside} -> ${pixels["blue-fill"].blueOutside})`)
		assert.ok(pixels.image.blueOutside < activePixels.image.blueOutside * 0.5, `deactivation visibly removes the functional outline from the image-backed building (${activePixels.image.blueOutside} -> ${pixels.image.blueOutside})`)

		console.log(`✅ functional parking visible outline (${usePixi ? "Pixi" : "Canvas"})`)
	} finally {
		await sim.close()
	}
}
