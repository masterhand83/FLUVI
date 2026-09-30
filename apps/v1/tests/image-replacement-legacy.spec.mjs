import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

// Agreed seams: native file chooser, inspector/map UI, rendered screenshot
// pixels, and JSON export/import into a fresh application. No renderer mocks.
const OLD_COLOR = [18, 220, 131]
const NEW_COLOR = [232, 45, 99]

async function ready(sim, usePixi) {
	if (usePixi) await sim.page.waitForFunction(() => !!window.pixiApp?.sceneManager?.edificioRenderer, { timeout: 30000 })
	await sim.page.evaluate(() => {
		window.hideLoadingScreen?.()
		window.confirm = () => true
		window.alert = () => {}
	})
	await sim.page.waitForFunction(() => getComputedStyle(document.getElementById("loadingScreen")).display === "none")
}

async function choose(page, selector, path) {
	const button = await page.waitForSelector(selector, { visible: true, timeout: 5000 })
	const chooser = page.waitForFileChooser({ timeout: 5000 })
	try {
		await button.click()
	} catch (error) {
		await chooser.catch(() => {})
		throw error
	}
	await (await chooser).accept([path])
}

async function place(page, path) {
	const drawingPanel = await page.$('#headingMapDrawingTools button')
	if (drawingPanel) {
		await drawingPanel.evaluate(button => {
			if (button.getAttribute("aria-expanded") !== "true") button.click()
		})
		await page.waitForFunction(() => document.getElementById("collapseMapDrawingTools").classList.contains("show") && !document.getElementById("collapseMapDrawingTools").classList.contains("collapsing"))
	}
	await choose(page, "#uploadBuildingImageButton", path)
	await page.waitForFunction(() => window.drawBuildingTool.isActive(), { timeout: 5000 })
	const point = await page.$eval("#simuladorCanvas", canvas => {
		const rect = canvas.getBoundingClientRect()
		return { x: rect.left + rect.width * 0.65, y: rect.top + rect.height * 0.38 }
	})
	await page.mouse.click(point.x, point.y)
	await page.waitForFunction(() => window.edificios.length === 1)
}

async function edit(page, selector, value) {
	await page.$eval(selector, (input, value) => {
		input.value = String(value)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	}, value)
}

async function exportJson(page) {
	return page.evaluate(async () => {
		window.prompt = () => "Image replacement round trip"
		const original = URL.createObjectURL
		URL.createObjectURL = blob => {
			window.__replacementExport = blob.text()
			return "blob:image-replacement-test"
		}
		try {
			window.guardarSimulacion()
			return await window.__replacementExport
		} finally {
			URL.createObjectURL = original
		}
	})
}

async function savedBuilding(page, index = 0) {
	return JSON.parse(await exportJson(page)).edificios[index]
}

async function select(page, index = 0) {
	await page.$eval("#selectEdificio", (input, index) => {
		input.value = String(index)
		input.dispatchEvent(new Event("change", { bubbles: true }))
	}, index)
	await page.waitForSelector("#buildingInspector", { visible: true })
}

async function loadJson(page, json, count) {
	await page.evaluate(json => {
		window.cargarSimulacion({ target: { files: [new File([json], "image-map.json", { type: "application/json" })], value: "" } })
	}, json)
	await page.waitForFunction(count => window.edificios.length === count, { timeout: 10000 }, count)
}

async function legacyMap(page) {
	const map = JSON.parse(await exportJson(page))
	const centers = await page.evaluate(() => {
		const canvas = document.getElementById("simuladorCanvas")
		const screen = window.USE_PIXI ? window.pixiApp.app.screen : canvas
		return [0.45, 0.75].map(fraction => {
			const x = screen.width * fraction
			const y = screen.height * 0.4
			return window.USE_PIXI ? window.pixiApp.cameraController.screenToWorld(x, y) : { x: (x - window.offsetX) / window.escala, y: (y - window.offsetY) / window.escala }
		})
	})
	map.edificios = centers.map((center, index) => ({ id: `legacy-${index}`, label: index ? "CIC" : "ESCOM", ...center, width: 120, height: 60, angle: 0, color: "#0047a3" }))
	await loadJson(page, JSON.stringify(map), 2)
}

async function pixel(page, index = 0, sample = {}) {
	const point = await page.evaluate(({ index, sample }) => {
		window.renderizarCanvas?.()
		const b = window.edificios[index]
		const legacy = b.appearanceMode !== "uploaded-image" || b.imageRotationConvention === "legacy"
		const sign = sample.sign ?? (window.USE_PIXI && legacy ? -1 : 1)
		const angle = sign * b.angle * Math.PI / 180
		const dx = b.width * (sample.u ?? 0.25)
		const dy = b.height * (sample.v ?? 0.2)
		const x = b.x + dx * Math.cos(angle) - dy * Math.sin(angle)
		const y = b.y + dx * Math.sin(angle) + dy * Math.cos(angle)
		const canvas = document.getElementById("simuladorCanvas")
		const rect = canvas.getBoundingClientRect()
		const raw = window.USE_PIXI ? window.pixiApp.cameraController.worldToScreen(x, y) : { x: x * window.escala + window.offsetX, y: y * window.escala + window.offsetY }
		const screen = window.USE_PIXI ? window.pixiApp.app.screen : canvas
		return { x: rect.left + raw.x * rect.width / screen.width, y: rect.top + raw.y * rect.height / screen.height }
	}, { index, sample })
	const screenshot = await page.screenshot({ encoding: "base64", clip: { x: Math.floor(point.x), y: Math.floor(point.y), width: 1, height: 1 } })
	return page.evaluate(async data => {
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

async function expectArtwork(page, color, index = 0) {
	await page.mouse.move(1, 1)
	await expect.poll(async () => {
		const actual = await pixel(page, index)
		return Math.max(...actual.map((channel, i) => Math.abs(channel - color[i])))
	}, { timeout: 10000, interval: 200 }).toBeLessThan(12)
}

async function settledArtwork(page, index = 0) {
	// Old-map loads redraw asynchronously. Capture the comparison baseline
	// only once actual output settles, never from a previous map's frame.
	await page.mouse.move(1, 1)
	let previous
	let stable = 0
	await expect.poll(async () => {
		const actual = await pixel(page, index)
		stable = previous?.every((channel, i) => channel === actual[i]) ? stable + 1 : 0
		previous = actual
		return stable
	}, { timeout: 10000, interval: 200 }).toBeGreaterThanOrEqual(3)
	return previous
}

async function legacyHandlePoints(page, building, usePixi) {
	return page.evaluate(({ b, sign }) => {
		const canvas = document.getElementById("simuladorCanvas")
		const rect = canvas.getBoundingClientRect()
		const screen = window.USE_PIXI ? window.pixiApp.app.screen : canvas
		const angle = sign * b.angle * Math.PI / 180
		return [[b.width / 2, b.height / 2], [0, -b.height / 2 - 30 / window.escala]].map(([dx, dy]) => {
			const x = b.x + dx * Math.cos(angle) - dy * Math.sin(angle)
			const y = b.y + dx * Math.sin(angle) + dy * Math.cos(angle)
			const raw = window.USE_PIXI ? window.pixiApp.cameraController.worldToScreen(x, y) : { x: x * window.escala + window.offsetX, y: y * window.escala + window.offsetY }
			return { x: rect.left + raw.x * rect.width / screen.width, y: rect.top + raw.y * rect.height / screen.height }
		})
	}, { b: building, sign: usePixi ? -1 : 1 })
}

async function expectLegacyHandles(page, usePixi) {
	const expected = await legacyHandlePoints(page, await savedBuilding(page), usePixi)
	for (const [index, kind] of ["resize", "rotate"].entries()) {
		await expect.poll(async () => {
			const handle = await page.$(`.building-${kind}-handle:not([hidden])`)
			const box = await handle?.boundingBox()
			return box ? Math.hypot(box.x + box.width / 2 - expected[index].x, box.y + box.height / 2 - expected[index].y) : Infinity
		}).toBeLessThan(2)
	}
}

async function dragTo(page, kind, target) {
	const handle = await page.waitForSelector(`.building-${kind}-handle:not([hidden])`, { visible: true })
	const box = await handle.boundingBox()
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	await page.mouse.move(target.x, target.y, { steps: 5 })
	await page.mouse.up()
	await page.mouse.move(1, 1)
}

async function expectLegacyLongAxis(page, usePixi) {
	const sign = usePixi ? -1 : 1
	await expect.poll(async () => {
		const actual = await pixel(page, 0, { u: 0, v: 0.35, sign })
		return Math.max(...actual.map((channel, i) => Math.abs(channel - NEW_COLOR[i])))
	}).toBeLessThan(12)
	const mirrored = await pixel(page, 0, { u: 0, v: 0.35, sign: -sign })
	expect(Math.max(...mirrored.map((channel, i) => Math.abs(channel - NEW_COLOR[i])))).toBeGreaterThan(20)
}

describe.each([["Canvas", false], ["Pixi", true]])("image replacement and legacy Edificio in %s", (_, usePixi) => {
	let sim
	let fresh
	let directory
	let fixtures

	beforeAll(async () => {
		sim = await openSimulator({ usePixi, freezeFrames: false })
		await ready(sim, usePixi)
		directory = await mkdtemp("/tmp/opencode/image-replacement-")
		fixtures = {}
		for (const [name, mime, width, height, color] of [
			["old.png", "image/png", 240, 120, "#12dc83"],
			["new.png", "image/png", 60, 240, "#e82d63"],
			["new.jpg", "image/jpeg", 60, 240, "#e82d63"],
			["new.webp", "image/webp", 60, 240, "#e82d63"],
		]) {
			const data = await sim.page.evaluate(({ mime, width, height, color }) => {
				const canvas = document.createElement("canvas")
				canvas.width = width
				canvas.height = height
				const context = canvas.getContext("2d")
				context.fillStyle = color
				context.fillRect(0, 0, width, height)
				return canvas.toDataURL(mime, 1)
			}, { mime, width, height, color })
			fixtures[name] = { path: join(directory, name), data }
			await writeFile(fixtures[name].path, Buffer.from(data.split(",")[1], "base64"))
		}
		fixtures.invalid = [
			["unsupported.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="240"/>'],
			["renamed-gif.png", Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")],
			["oversized.png", Buffer.concat([Buffer.from(fixtures["new.png"].data.split(",")[1], "base64"), Buffer.alloc(5 * 1024 * 1024)])],
			// Valid PNG signature, but no decodable image: exercise decode failure
			// separately from format rejection.
			["undecodable.png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])],
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

	it("replaces different-proportion artwork at its own usable size, preserving center, rotation and selection", async () => {
		await place(sim.page, fixtures["old.png"].path)
		await edit(sim.page, "#buildingInspectorWidth", 200)
		await edit(sim.page, "#buildingInspectorAngle", 37)
		const before = await savedBuilding(sim.page)
		await expectArtwork(sim.page, OLD_COLOR)
		await choose(sim.page, "#buildingInspectorReplaceImage", fixtures["new.png"].path)
		await expect.poll(async () => (await savedBuilding(sim.page)).imageData).toBe(fixtures["new.png"].data)
		const after = await savedBuilding(sim.page)
		expect(after).toMatchObject({ x: before.x, y: before.y, angle: 37, appearanceMode: "uploaded-image", width: 30, height: 120 })
		expect(after.width).not.toBe(before.width)
		expect(after.height).not.toBe(before.height)
		expect(await sim.page.evaluate(() => window.edificioSeleccionado === window.edificios[0] && window.edificios.length === 1)).toBe(true)
		expect(await sim.page.$eval("#buildingInspector", el => el.hidden)).toBe(false)
		await expectArtwork(sim.page, NEW_COLOR)
	}, 30000)

	it.each(["jpg", "webp"])("accepts a real %s replacement and renders the new artwork", async extension => {
		await place(sim.page, fixtures["old.png"].path)
		await choose(sim.page, "#buildingInspectorReplaceImage", fixtures[`new.${extension}`].path)
		await expect.poll(async () => (await savedBuilding(sim.page)).imageData).toBe(fixtures[`new.${extension}`].data)
		expect(await savedBuilding(sim.page)).toMatchObject({ width: 30, height: 120 })
		await expectArtwork(sim.page, NEW_COLOR)
	}, 30000)

	it("rejects unsupported, disguised, oversized and undecodable replacements without changing artwork, geometry or selection", async () => {
		await place(sim.page, fixtures["old.png"].path)
		await edit(sim.page, "#buildingInspectorWidth", 180)
		await edit(sim.page, "#buildingInspectorAngle", 28)
		const before = await savedBuilding(sim.page)
		for (const [name] of fixtures.invalid) {
			await choose(sim.page, "#buildingInspectorReplaceImage", join(directory, name))
			await sim.page.waitForFunction(() => /no admitido|5 MB|no se pudo/i.test(document.getElementById("buildingInspectorImageStatus").textContent), { timeout: 5000 })
			expect(await sim.page.$eval("#buildingInspectorImageStatus", el => !!el.getClientRects().length && getComputedStyle(el).visibility !== "hidden")).toBe(true)
			expect(await savedBuilding(sim.page)).toEqual(before)
			expect(await sim.page.evaluate(() => window.edificioSeleccionado === window.edificios[0] && window.edificios.length === 1 && !window.drawBuildingTool.isActive())).toBe(true)
			await expectArtwork(sim.page, OLD_COLOR)
		}
		// A rejection must not poison subsequent valid replacement.
		await choose(sim.page, "#buildingInspectorReplaceImage", fixtures["new.png"].path)
		await expectArtwork(sim.page, NEW_COLOR)
	}, 30000)

	it("edits legacy bundled artwork proportionally, preserves its image on rename, and round-trips replacements beside unchanged legacy artwork", async () => {
		await legacyMap(sim.page)
		const before = await savedBuilding(sim.page)
		await select(sim.page, 1)
		await sim.page.mouse.move(1, 1)
		const legacyColor = await settledArtwork(sim.page, 1)
		await select(sim.page)
		const escomColor = await settledArtwork(sim.page)
		// These old-map entries really display bundled artwork, not their saved
		// blue rectangle fallback. Subsequent pixel comparisons guard its identity.
		expect(Math.max(...escomColor.map((channel, i) => Math.abs(channel - [0, 71, 163][i])))).toBeGreaterThan(20)
		expect(Math.max(...legacyColor.map((channel, i) => Math.abs(channel - [0, 71, 163][i])))).toBeGreaterThan(20)
		expect(await savedBuilding(sim.page)).toMatchObject(before)
		expect(await savedBuilding(sim.page)).not.toHaveProperty("appearanceMode")
		expect(await sim.page.$eval("#buildingColorPalette", el => el.closest("div").hidden)).toBe(true)
		expect(await sim.page.$eval("#buildingProportionLock", el => el.closest("label").hidden)).toBe(true)
		await edit(sim.page, "#buildingInspectorName", "Renamed campus artwork")
		await expectArtwork(sim.page, escomColor)
		await edit(sim.page, "#buildingInspectorWidth", 160)
		expect(await savedBuilding(sim.page)).toMatchObject({ label: "Renamed campus artwork", width: 160, height: 80 })
		await edit(sim.page, "#buildingInspectorHeight", 50)
		expect(await savedBuilding(sim.page)).toMatchObject({ width: 100, height: 50 })
		await edit(sim.page, "#buildingInspectorAngle", 23)
		const positioned = await savedBuilding(sim.page)
		await choose(sim.page, "#buildingInspectorReplaceImage", fixtures["new.png"].path)
		await expectArtwork(sim.page, NEW_COLOR)
		const replacement = await savedBuilding(sim.page)
		expect(replacement).toMatchObject({ x: positioned.x, y: positioned.y, angle: 23, label: "Renamed campus artwork", appearanceMode: "uploaded-image", imageData: fixtures["new.png"].data, width: 30, height: 120 })
		expect(await sim.page.evaluate(() => window.edificioSeleccionado === window.edificios[0])).toBe(true)
		await expectArtwork(sim.page, legacyColor, 1)
		const json = await exportJson(sim.page)
		const saved = JSON.parse(json).edificios
		expect(saved[1]).toMatchObject({ label: "CIC", width: 120, height: 60 })
		expect(saved[1]).not.toHaveProperty("imageData")
		for (const building of saved) {
			expect(building).not.toHaveProperty("imageElement")
			expect(building).not.toHaveProperty("texture")
			expect(building).not.toHaveProperty("sprite")
		}
		fresh = await openSimulator({ usePixi, freezeFrames: false })
		await ready(fresh, usePixi)
		await loadJson(fresh.page, json, 2)
		expect(JSON.parse(await exportJson(fresh.page)).edificios).toEqual(saved)
		await expectArtwork(fresh.page, NEW_COLOR)
		await expectArtwork(fresh.page, legacyColor, 1)
		await select(fresh.page)
		await edit(fresh.page, "#buildingInspectorHeight", 80)
		expect(await savedBuilding(fresh.page)).toMatchObject({ width: 20, height: 80 })
		await select(fresh.page, 1)
		await edit(fresh.page, "#buildingInspectorName", "Renamed unchanged CIC")
		await expectArtwork(fresh.page, legacyColor, 1)
		await fresh.close()
		fresh = null
	}, 180000)

	it("persists a renamed bundled image identity without converting it to uploaded artwork", async () => {
		await legacyMap(sim.page)
		await select(sim.page)
		await sim.page.mouse.move(1, 1)
		const color = await settledArtwork(sim.page)
		await edit(sim.page, "#buildingInspectorName", "Campus image with a new name")
		await expectArtwork(sim.page, color)
		const json = await exportJson(sim.page)
		const saved = JSON.parse(json).edificios[0]
		expect(saved).toMatchObject({ label: "Campus image with a new name", width: 120, height: 60 })
		expect(saved).not.toHaveProperty("imageData")
		fresh = await openSimulator({ usePixi, freezeFrames: false })
		await ready(fresh, usePixi)
		await loadJson(fresh.page, json, 2)
		await expectArtwork(fresh.page, color)
		await select(fresh.page)
		await edit(fresh.page, "#buildingInspectorWidth", 140)
		expect(await savedBuilding(fresh.page)).toMatchObject({ width: 140, height: 70 })
		await fresh.close()
		fresh = null
	}, 180000)

	it("keeps rotated nonsquare legacy pixels and resize/rotation handles aligned through replacement and fresh reload", async () => {
		await legacyMap(sim.page)
		await select(sim.page)
		await edit(sim.page, "#buildingInspectorWidth", 240)
		await edit(sim.page, "#buildingInspectorHeight", 60)
		// Legacy proportional edits retain the 2:1 ratio; import a historical
		// 4:1 footprint so opposite angle signs have clearly distinct bounds.
		const map = JSON.parse(await exportJson(sim.page))
		Object.assign(map.edificios[0], { width: 240, height: 60, angle: 0 })
		await loadJson(sim.page, JSON.stringify(map), 2)
		await select(sim.page)
		await settledArtwork(sim.page)
		const sign = usePixi ? -1 : 1
		const artSample = { u: 0.33, v: 0.12, sign }
		const straightColor = await pixel(sim.page, 0, artSample)
		await edit(sim.page, "#buildingInspectorAngle", 35)
		await sim.page.mouse.move(1, 1)
		await expect.poll(async () => {
			const actual = await pixel(sim.page, 0, artSample)
			return Math.max(...actual.map((channel, i) => Math.abs(channel - straightColor[i])))
		}).toBeLessThan(35)
		await expectLegacyHandles(sim.page, usePixi)

		// Exercise the visible resize corner, not just its DOM position.
		const before = await savedBuilding(sim.page)
		const larger = { ...before, width: 288, height: 72 }
		await dragTo(sim.page, "resize", (await legacyHandlePoints(sim.page, larger, usePixi))[0])
		expect(await savedBuilding(sim.page)).toMatchObject({ angle: 35, x: before.x, y: before.y })
		expect((await savedBuilding(sim.page)).width).toBeCloseTo(288, 0)
		expect((await savedBuilding(sim.page)).height).toBeCloseTo(72, 0)
		const rotated = { ...await savedBuilding(sim.page), angle: 55 }
		await dragTo(sim.page, "rotate", (await legacyHandlePoints(sim.page, rotated, usePixi))[1])
		expect((await savedBuilding(sim.page)).angle).toBeCloseTo(55, 0)
		await expectLegacyHandles(sim.page, usePixi)

		fresh = await openSimulator({ usePixi, freezeFrames: false })
		await ready(fresh, usePixi)
		await loadJson(fresh.page, await exportJson(sim.page), 2)
		await select(fresh.page)
		await settledArtwork(fresh.page)
		await expectLegacyHandles(fresh.page, usePixi)
		await expect.poll(async () => {
			const actual = await pixel(fresh.page, 0, artSample)
			return Math.max(...actual.map((channel, i) => Math.abs(channel - straightColor[i])))
		}).toBeLessThan(35)
		const legacyPosition = await savedBuilding(fresh.page)
		await choose(fresh.page, "#buildingInspectorReplaceImage", fixtures["new.png"].path)
		await expectArtwork(fresh.page, NEW_COLOR)
		expect(await savedBuilding(fresh.page)).toMatchObject({ angle: legacyPosition.angle, x: legacyPosition.x, y: legacyPosition.y, width: 30, height: 120, imageRotationConvention: "legacy" })
		await expectLegacyHandles(fresh.page, usePixi)
		await expectLegacyLongAxis(fresh.page, usePixi)
		const json = await exportJson(fresh.page)
		await fresh.close()
		fresh = await openSimulator({ usePixi, freezeFrames: false })
		await ready(fresh, usePixi)
		await loadJson(fresh.page, json, 2)
		await select(fresh.page)
		await expectArtwork(fresh.page, NEW_COLOR)
		await expectLegacyHandles(fresh.page, usePixi)
		// Far down the long axis: the mirrored-sign footprint cannot cover it.
		await expectLegacyLongAxis(fresh.page, usePixi)
		await fresh.close()
		fresh = null
	}, 180000)
})
