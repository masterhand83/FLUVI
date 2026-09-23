import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

describe.each([
	["Canvas", false],
	["Pixi", true],
])("local reference image in %s mode", (_mode, usePixi) => {
	let sim
	let freshSim

	beforeAll(async () => {
		sim = await openSimulator({ usePixi })
		if (usePixi) await sim.page.waitForFunction(() => window.pixiApp?.sceneManager, { polling: 100, timeout: 30000 })
	}, 180000)

	afterAll(async () => {
		await freshSim?.close()
		await sim?.close()
	})

	it("places the image in map coordinates and persists it through a fresh-app JSON load", async () => {
		const referenceDataUrl = await sim.page.evaluate(() => {
			const canvas = document.createElement("canvas")
			canvas.width = 240
			canvas.height = 120
			const context = canvas.getContext("2d")
			context.fillStyle = "#ff00ff"
			context.fillRect(0, 0, canvas.width, canvas.height)
			return canvas.toDataURL("image/png")
		})
		const placed = await sim.page.evaluate(async (dataUrl) => {
			if (typeof window.setReferenceImage !== "function") {
				throw new Error("window.setReferenceImage is not available")
			}
			await window.setReferenceImage(dataUrl)
			const reference = window.referenceImage
			const bounds = window.calcularLimitesMapa()
			const view = window.USE_PIXI ? window.pixiApp.app.view : document.getElementById("simuladorCanvas")
			const scale = window.escala
			const visibleWidth = view.width / scale
			const visibleHeight = view.height / scale
			const left = -window.offsetX / scale
			const top = -window.offsetY / scale
			const visibleInMap =
				reference.x < bounds.maxX && reference.x + reference.width > bounds.minX &&
				reference.y < bounds.maxY && reference.y + reference.height > bounds.minY
			return {
				dataUrl: reference.dataUrl, x: reference.x, y: reference.y,
				width: reference.width, height: reference.height,
				imageLoaded: reference.image instanceof HTMLImageElement && reference.image.complete,
				visibleInMap,
				proportionsPreserved: Math.abs(reference.width / reference.height - 2) < 0.01,
				centeredInView: Math.abs(reference.x + reference.width / 2 - left - visibleWidth / 2) < 2 &&
					Math.abs(reference.y + reference.height / 2 - top - visibleHeight / 2) < 2,
				fittedInView: reference.width <= visibleWidth * 0.8 + 2 && reference.height <= visibleHeight * 0.8 + 2,
			}
		}, referenceDataUrl)
		const display = await sim.page.evaluate(() => {
			window.renderizarCanvas()
			if (window.USE_PIXI) {
				const sprite = window.pixiApp.sceneManager.referenceImageRenderer.sprite
				return { alpha: sprite.alpha, visible: sprite.visible, textureValid: sprite.texture.valid }
			}
			const canvas = document.getElementById("simuladorCanvas")
			const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data
			let magenta = 0
			for (let i = 0; i < pixels.length; i += 4) {
				// The default reference is translucent, so its magenta blends with the map background.
				if (pixels[i] > pixels[i + 1] + 50 && pixels[i + 2] > pixels[i + 1] + 50 && pixels[i + 3] > 200) magenta++
			}
			return { magenta }
		})
		if (usePixi) expect(display).toMatchObject({ alpha: 0.7, visible: true, textureValid: true })
		else expect(display.magenta).toBeGreaterThan(100)
		const json = await sim.page.evaluate(async () => {
			window.prompt = () => "Reference image round trip"
			window.alert = () => {}
			const createObjectURL = URL.createObjectURL
			URL.createObjectURL = (blob) => {
				window.__savedSimulationJSON = blob.text()
				return "blob:reference-image-test"
			}
			window.guardarSimulacion()
			URL.createObjectURL = createObjectURL
			return await window.__savedSimulationJSON
		})
		const saved = JSON.parse(json)
		freshSim = await openSimulator({ usePixi })
		if (usePixi) await freshSim.page.waitForFunction(() => window.pixiApp?.sceneManager, { polling: 100, timeout: 30000 })
		await freshSim.page.evaluate(async (savedJson) => {
			window.confirm = () => true
			window.alert = () => {}
			const file = new File([savedJson], "reference-image.json", { type: "application/json" })
			await window.cargarSimulacion({ target: { files: [file] } })
		}, json)
		await freshSim.page.waitForFunction(() => window.referenceImage?.image?.complete, { polling: 100, timeout: 10000 }).catch(async () => {
			const state = await freshSim.page.evaluate(() => ({
				referenceImage: window.referenceImage,
				alerts: window.__referenceImageTestAlerts,
			}))
			throw new Error(`JSON load did not restore the image: ${JSON.stringify(state)}`)
		})
		const restored = await freshSim.page.evaluate(() => {
			const { dataUrl, x, y, width, height, image } = window.referenceImage
			return { dataUrl, x, y, width, height, imageLoaded: image instanceof HTMLImageElement && image.complete }
		})

		expect(placed).toMatchObject({ dataUrl: referenceDataUrl, imageLoaded: true, visibleInMap: true, proportionsPreserved: true, centeredInView: true, fittedInView: true })
		expect(placed.width).toBeGreaterThan(0)
		expect(placed.height).toBeGreaterThan(0)
		expect(saved.imagenReferencia).toMatchObject({ dataUrl: referenceDataUrl, x: placed.x, y: placed.y, width: placed.width, height: placed.height })
		expect(restored).toMatchObject({ dataUrl: referenceDataUrl, x: placed.x, y: placed.y, width: placed.width, height: placed.height, imageLoaded: true })

		const replacement = await freshSim.page.evaluate(async () => {
			const canvas = document.createElement("canvas")
			canvas.width = 120
			canvas.height = 240
			canvas.getContext("2d").fillRect(0, 0, 120, 240)
			const file = new File([await (await fetch(canvas.toDataURL())).blob()], "replacement.png", { type: "image/png" })
			const input = document.getElementById("inputImagenReferencia")
			const transfer = new DataTransfer()
			transfer.items.add(file)
			input.files = transfer.files
			input.dispatchEvent(new Event("change", { bubbles: true }))
			return new Promise((resolve) => {
				const check = () => {
					if (window.referenceImage?.dataUrl !== canvas.toDataURL()) return setTimeout(check, 20)
					const { x, y, width, height } = window.referenceImage
					resolve({ x, y, width, height })
				}
				check()
			})
		})
		expect(replacement.x + replacement.width / 2).toBeCloseTo(placed.x + placed.width / 2)
		expect(replacement.y + replacement.height / 2).toBeCloseTo(placed.y + placed.height / 2)
		expect(replacement.width / replacement.height).toBeCloseTo(0.5)
		await freshSim.page.evaluate(() => document.getElementById("btnEliminarImagenReferencia").click())
		expect(await freshSim.page.evaluate(() => window.referenceImage)).toBeNull()
		await freshSim.page.evaluate((dataUrl) => window.setReferenceImage(dataUrl), referenceDataUrl)
		await freshSim.page.evaluate(() => window.nuevaSimulacion())
		expect(await freshSim.page.evaluate(() => window.referenceImage)).toBeNull()
		await freshSim.page.evaluate((dataUrl) => window.setReferenceImage(dataUrl), referenceDataUrl)
		await freshSim.page.evaluate((savedJson) => {
			const old = JSON.parse(savedJson)
			delete old.imagenReferencia
			const file = new File([JSON.stringify(old)], "old-map.json", { type: "application/json" })
			window.cargarSimulacion({ target: { files: [file] } })
		}, json)
		await freshSim.page.waitForFunction(() => window.calles?.length > 0, { polling: 100 })
		expect(await freshSim.page.evaluate(() => window.referenceImage)).toBeNull()
	}, 180000)
})
