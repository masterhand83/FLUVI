import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

// Public seams: native chooser, map gestures, unified inspector, rendered pixels,
// and constructor JSON export/import. Fixtures are real browser-encoded images.
const FORMATS = [["png", "image/png"], ["jpg", "image/jpeg"], ["webp", "image/webp"]]
const ART_COLOR = [18, 220, 131]

async function ready(sim, usePixi) {
	if (usePixi) await sim.page.waitForFunction(() => !!window.pixiApp?.sceneManager?.edificioRenderer, { timeout: 30000 })
	await sim.page.evaluate(() => {
		window.hideLoadingScreen?.()
		window.confirm = () => true
		window.alert = () => {}
	})
	await sim.page.waitForFunction(() => getComputedStyle(document.getElementById("loadingScreen")).display === "none")
}

async function upload(page, path) {
	const drawingPanel = await page.$('#headingMapDrawingTools button')
	if (drawingPanel) {
		await drawingPanel.evaluate(button => {
			if (button.getAttribute("aria-expanded") !== "true") button.click()
		})
		await page.waitForFunction(() => document.getElementById("collapseMapDrawingTools").classList.contains("show") && !document.getElementById("collapseMapDrawingTools").classList.contains("collapsing"))
	}
	// Waiting before clicking catches the native chooser, not a synthetic FileList.
	const chooser = page.waitForFileChooser({ timeout: 5000 })
	try {
		await page.click("#uploadBuildingImageButton")
	} catch (error) {
		await chooser.catch(() => {})
		throw error
	}
	await (await chooser).accept([path])
}

async function placementPoint(page) {
	return page.evaluate(() => {
		const canvas = document.getElementById("simuladorCanvas")
		const rect = canvas.getBoundingClientRect()
		const screen = window.USE_PIXI ? window.pixiApp.app.screen : canvas
		const raw = { x: screen.width * 0.65, y: screen.height * 0.38 }
		const world = window.USE_PIXI
			? window.pixiApp.cameraController.screenToWorld(raw.x, raw.y)
			: { x: (raw.x - window.offsetX) / window.escala, y: (raw.y - window.offsetY) / window.escala }
		return { x: rect.left + rect.width * 0.65, y: rect.top + rect.height * 0.38, world }
	})
}

async function place(page, path) {
	await upload(page, path)
	await page.waitForFunction(() => window.drawBuildingTool.isActive(), { timeout: 5000 })
	expect(await page.evaluate(() => window.edificios.length)).toBe(0)
	const point = await placementPoint(page)
	await page.mouse.click(point.x, point.y)
	await page.waitForFunction(() => window.edificios.length === 1, { timeout: 5000 })
	return point
}

function geometry(page) {
	return page.evaluate(() => {
		const b = window.edificios[0]
		return { x: b.x, y: b.y, width: b.width, height: b.height, angle: b.angle }
	})
}

async function edit(page, selector, value) {
	await page.$eval(selector, (input, value) => {
		input.value = String(value)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	}, value)
}

async function dragHandle(page, selector, dx, dy) {
	const handle = await page.waitForSelector(`${selector}:not([hidden])`, { visible: true, timeout: 5000 })
	const box = await handle.boundingBox()
	const x = box.x + box.width / 2
	const y = box.y + box.height / 2
	await page.mouse.move(x, y)
	await page.mouse.down()
	await page.mouse.move(x + dx, y + dy, { steps: 5 })
	await page.mouse.up()
}

async function imagePixel(page) {
	// Sample actual browser output, shared by WebGL Pixi and Canvas 2D. The point
	// is inside the artwork but away from the label, outline, and center handle.
	const point = await page.evaluate(() => {
		window.renderizarCanvas?.()
		const b = window.edificios[0]
		const angle = b.angle * Math.PI / 180
		const dx = b.width * 0.25
		const dy = b.height * 0.2
		const x = b.x + dx * Math.cos(angle) - dy * Math.sin(angle)
		const y = b.y + dx * Math.sin(angle) + dy * Math.cos(angle)
		const canvas = document.getElementById("simuladorCanvas")
		const rect = canvas.getBoundingClientRect()
		const raw = window.USE_PIXI ? window.pixiApp.cameraController.worldToScreen(x, y) : { x: x * window.escala + window.offsetX, y: y * window.escala + window.offsetY }
		const screen = window.USE_PIXI ? window.pixiApp.app.screen : canvas
		return { x: rect.left + raw.x * rect.width / screen.width, y: rect.top + raw.y * rect.height / screen.height }
	})
	const screenshot = await page.screenshot({ encoding: "base64", clip: { x: Math.floor(point.x), y: Math.floor(point.y), width: 1, height: 1 } })
	return page.evaluate(async (data) => {
		const image = new Image()
		image.src = `data:image/png;base64,${data}`
		await image.decode()
		const canvas = document.createElement("canvas")
		canvas.width = canvas.height = 1
		const context = canvas.getContext("2d")
		context.drawImage(image, 0, 0)
		return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
	}, screenshot)
}

async function expectVisibleArtwork(page) {
	// Pixi intentionally fades hovered buildings; inspect their normal appearance.
	await page.mouse.move(1, 1)
	await expect.poll(async () => {
		const pixel = await imagePixel(page)
		return Math.max(...pixel.map((channel, i) => Math.abs(channel - ART_COLOR[i])))
	}, { timeout: 10000, interval: 200 }).toBeLessThan(12)
}

async function exportJson(page) {
	return page.evaluate(async () => {
		window.prompt = () => "Uploaded artwork round trip"
		const original = URL.createObjectURL
		URL.createObjectURL = (blob) => {
			window.__imageBuildingExport = blob.text()
			return "blob:uploaded-image-building-test"
		}
		try {
			window.guardarSimulacion()
			return await window.__imageBuildingExport
		} finally {
			URL.createObjectURL = original
		}
	})
}

async function loadJson(page, json) {
	await page.evaluate((json) => {
		const file = new File([json], "uploaded-buildings.json", { type: "application/json" })
		window.cargarSimulacion({ target: { files: [file], value: "" } })
	}, json)
	await page.waitForFunction(() => {
		const image = window.edificios?.[0]?.imageElement
		return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
	}, { timeout: 10000 })
}

describe.each([["Canvas", false], ["Pixi", true]])("uploaded-image Edificio in %s", (_, usePixi) => {
	let sim
	let directory
	let fixtures
	let fresh

	beforeAll(async () => {
		sim = await openSimulator({ usePixi, freezeFrames: false })
		await ready(sim, usePixi)
		directory = await mkdtemp("/tmp/opencode/uploaded-building-")
		fixtures = {}
		for (const [extension, mime] of FORMATS) {
			const data = await sim.page.evaluate((mime) => {
				const canvas = document.createElement("canvas")
				canvas.width = 240
				canvas.height = 120
				const context = canvas.getContext("2d")
				context.fillStyle = "#12dc83"
				context.fillRect(0, 0, canvas.width, canvas.height)
				return canvas.toDataURL(mime, 1)
			}, mime)
			expect(data.startsWith(`data:${mime};base64,`)).toBe(true)
			fixtures[extension] = { path: join(directory, `artwork.${extension}`), data }
			await writeFile(fixtures[extension].path, Buffer.from(data.split(",")[1], "base64"))
		}
		fixtures.invalid = [
			["unsupported.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="green"/></svg>'],
			["renamed-gif.png", Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")],
			["oversized.png", Buffer.concat([Buffer.from(fixtures.png.data.split(",")[1], "base64"), Buffer.alloc(5 * 1024 * 1024)])],
			["corrupt.png", "not a decodable PNG"],
		]
		for (const [name, bytes] of fixtures.invalid) await writeFile(join(directory, name), bytes)
	}, 180000)

	beforeEach(async () => {
		await sim.page.evaluate(() => document.getElementById("btnNuevaSimulacion").click())
		await sim.page.waitForFunction(() => window.edificios.length === 0)
	})

	afterAll(async () => {
		await fresh?.close()
		await sim?.close()
		if (directory) await rm(directory, { recursive: true, force: true })
	})

	it.each(FORMATS)("uploads a real %s file and places exactly one proportional building with a center click", async (extension) => {
		const point = await place(sim.page, fixtures[extension].path)
		const result = await sim.page.evaluate(() => {
			const b = window.edificios[0]
			return {
				mode: b.appearanceMode, data: b.imageData, selected: window.edificioSeleccionado === b,
				decoded: b.imageElement instanceof HTMLImageElement && b.imageElement.complete,
				naturalWidth: b.imageElement?.naturalWidth, naturalHeight: b.imageElement?.naturalHeight,
				toolActive: window.drawBuildingTool.isActive(),
			}
		})
		expect(result).toEqual({ mode: "uploaded-image", data: fixtures[extension].data, selected: true, decoded: true, naturalWidth: 240, naturalHeight: 120, toolActive: false })
		const b = await geometry(sim.page)
		expect(b.x).toBeCloseTo(point.world.x, 3)
		expect(b.y).toBeCloseTo(point.world.y, 3)
		expect(b.width / b.height).toBeCloseTo(2, 5)
		expect(b.width).toBeGreaterThan(0)
		expect(b.height).toBeGreaterThan(0)
		expect(await sim.page.$eval("#buildingInspector", el => el.hidden)).toBe(false)
		await expectVisibleArtwork(sim.page)
		await sim.page.mouse.click(point.x + 160, point.y + 80)
		expect(await sim.page.evaluate(() => window.edificios.length)).toBe(1)
	}, 30000)

	it("rejects unsupported, oversized, and corrupt uploads with visible feedback and no placement", async () => {
		for (const [name] of fixtures.invalid) {
			await sim.page.evaluate(() => { document.getElementById("buildingImageStatus").textContent = "" })
			await upload(sim.page, join(directory, name))
			await sim.page.waitForFunction(() => /no admitido|5 MB|no se pudo/i.test(document.getElementById("buildingImageStatus").textContent), { timeout: 5000 })
			expect(await sim.page.$eval("#buildingImageStatus", el => !!el.getClientRects().length && getComputedStyle(el).visibility !== "hidden")).toBe(true)
			expect(await sim.page.evaluate(() => window.drawBuildingTool.isActive())).toBe(false)
			const point = await placementPoint(sim.page)
			await sim.page.mouse.click(point.x, point.y)
			expect(await sim.page.evaluate(() => window.edificios.length)).toBe(0)
		}
		// Rejection must not poison the next valid upload.
		await place(sim.page, fixtures.png.path)
	}, 30000)

	it("edits proportionally with inspector and handles, selects rotated bounds, and restores embedded artwork on a fresh app", async () => {
		await place(sim.page, fixtures.png.path)
		await edit(sim.page, "#buildingInspectorName", "Persistent uploaded artwork")
		await edit(sim.page, "#buildingInspectorWidth", 160)
		expect(await geometry(sim.page)).toMatchObject({ width: 160, height: 80 })
		await edit(sim.page, "#buildingInspectorHeight", 60)
		expect(await geometry(sim.page)).toMatchObject({ width: 120, height: 60 })
		let before = await geometry(sim.page)
		await dragHandle(sim.page, ".building-move-handle", 25, 12)
		let after = await geometry(sim.page)
		expect(after.x).not.toBe(before.x)
		expect(after.y).not.toBe(before.y)
		expect(after.width).toBe(before.width)
		expect(after.height).toBe(before.height)
		before = after
		await dragHandle(sim.page, ".building-resize-handle", 24, 15)
		after = await geometry(sim.page)
		expect(after.width).not.toBe(before.width)
		expect(after.width / after.height).toBeCloseTo(2, 5)
		before = after
		await dragHandle(sim.page, ".building-rotate-handle", 35, 20)
		after = await geometry(sim.page)
		expect(after.angle).not.toBe(before.angle)
		expect(after.width).toBe(before.width)
		expect(after.height).toBe(before.height)
		await edit(sim.page, "#buildingInspectorAngle", 45)
		await dragHandle(sim.page, ".building-resize-handle", 18, 10)
		expect((await geometry(sim.page)).width / (await geometry(sim.page)).height).toBeCloseTo(2, 5)

		await sim.page.click("#buildingInspectorClose")
		const point = await sim.page.evaluate(() => {
			const b = window.edificios[0]
			const angle = b.angle * Math.PI / 180
			// Near a rotated edge: inside its oriented rectangle, not just its center.
			const x = b.x + b.width * 0.44 * Math.cos(angle)
			const y = b.y + b.width * 0.44 * Math.sin(angle)
			const outsideX = b.x + b.width * 0.65 * Math.cos(angle)
			const outsideY = b.y + b.width * 0.65 * Math.sin(angle)
			const inside = window.encontrarEdificioEnPunto(x, y)?.edificio === b
			const outside = window.encontrarEdificioEnPunto(outsideX, outsideY) === null
			const canvas = document.getElementById("simuladorCanvas")
			const rect = canvas.getBoundingClientRect()
			const raw = window.USE_PIXI ? window.pixiApp.cameraController.worldToScreen(x, y) : { x: x * window.escala + window.offsetX, y: y * window.escala + window.offsetY }
			const screen = window.USE_PIXI ? window.pixiApp.app.screen : canvas
			return { x: rect.left + raw.x * rect.width / screen.width, y: rect.top + raw.y * rect.height / screen.height, inside, outside }
		})
		expect(point.inside).toBe(true)
		expect(point.outside).toBe(true)
		await sim.page.keyboard.down("Control")
		await sim.page.mouse.click(point.x, point.y)
		await sim.page.keyboard.up("Control")
		expect(await sim.page.evaluate(() => window.edificioSeleccionado === window.edificios[0])).toBe(true)
		await expectVisibleArtwork(sim.page)
		const expectedGeometry = await geometry(sim.page)
		const json = await exportJson(sim.page)
		const saved = JSON.parse(json).edificios[0]
		expect(saved).toMatchObject({ ...expectedGeometry, appearanceMode: "uploaded-image", imageData: fixtures.png.data, label: "Persistent uploaded artwork" })
		expect(saved).not.toHaveProperty("imageElement")
		expect(saved).not.toHaveProperty("texture")
		expect(saved).not.toHaveProperty("sprite")

		fresh = await openSimulator({ usePixi, freezeFrames: false })
		await ready(fresh, usePixi)
		await loadJson(fresh.page, json)
		expect(await geometry(fresh.page)).toEqual(expectedGeometry)
		expect(await fresh.page.evaluate(() => window.edificios[0].imageData)).toBe(fixtures.png.data)
		await expectVisibleArtwork(fresh.page)
		await fresh.page.$eval("#selectEdificio", select => { select.value = "0"; select.dispatchEvent(new Event("change", { bubbles: true })) })
		await edit(fresh.page, "#buildingInspectorHeight", 50)
		expect(await geometry(fresh.page)).toMatchObject({ width: 100, height: 50 })
		await fresh.close()
		fresh = null
	}, 180000)

	it("does not replace a newer legacy map when an older image finishes decoding", async () => {
		await place(sim.page, fixtures.png.path)
		const json = await exportJson(sim.page)
		const newer = JSON.parse(json)
		newer.nombre = "Newer legacy map"
		newer.edificios = [{ id: "newer-legacy", label: "Newer legacy building", x: 320, y: 240, width: 90, height: 45, angle: 0, color: "#123456" }]
		// Delay only the old embedded image at the browser's decoding boundary.
		// Keep actual HTMLImageElements and release to the real decoder afterwards.
		await sim.page.evaluate((data) => {
			const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")
			window.__delayedBuildingImage = null
			window.__restoreImageSource = () => Object.defineProperty(HTMLImageElement.prototype, "src", original)
			Object.defineProperty(HTMLImageElement.prototype, "src", {
				...original,
				set(value) {
					if (value === data) {
						window.__delayedBuildingImage = this
						return
					}
					original.set.call(this, value)
				},
			})
		}, fixtures.png.data)
		try {
			await sim.page.evaluate((json) => {
				window.cargarSimulacion({ target: { files: [new File([json], "older.json", { type: "application/json" })], value: "" } })
			}, json)
			await sim.page.waitForFunction(() => !!window.__delayedBuildingImage, { timeout: 5000 })
			await sim.page.evaluate((json) => {
				window.cargarSimulacion({ target: { files: [new File([json], "newer.json", { type: "application/json" })], value: "" } })
			}, JSON.stringify(newer))
			await sim.page.waitForFunction(() => window.edificios[0]?.label === "Newer legacy building", { timeout: 5000 })
			await sim.page.evaluate(async (data) => {
				window.__restoreImageSource()
				const image = window.__delayedBuildingImage
				image.src = data
				await image.decode()
				// Allow the stale load's onload and promise continuations to finish.
				await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
			}, fixtures.png.data)
			expect(await sim.page.evaluate(() => window.edificios.map(b => ({ label: b.label, color: b.color, width: b.width, height: b.height })))).toEqual([{ label: "Newer legacy building", color: "#123456", width: 90, height: 45 }])
		} finally {
			await sim.page.evaluate(() => {
				window.__restoreImageSource?.()
				delete window.__restoreImageSource
				delete window.__delayedBuildingImage
			})
		}
	}, 30000)
})
