import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

// Appearance creation has separate suites. These fixtures use public factories;
// all parking mutations go through the unified inspector's actual DOM events.
const MODES = ["rectangle", "polygon", "uploaded-image"]
const UI = {
	enabled: "#buildingInspectorParkingToggle",
	capacity: "#buildingInspectorParkingCapacity",
	status: "#buildingInspectorParkingError",
}

async function ready(sim, usePixi) {
	if (usePixi) await sim.page.waitForFunction(() => !!window.pixiApp?.sceneManager?.edificioRenderer, { timeout: 30000 })
	await sim.page.evaluate(() => {
		window.hideLoadingScreen?.()
		window.confirm = () => true
		window.alert = () => {}
	})
	await sim.page.waitForFunction(() => getComputedStyle(document.getElementById("loadingScreen")).display === "none")
}

async function fixture(page, mode) {
	await page.evaluate(async mode => {
		const canvas = document.getElementById("simuladorCanvas")
		const screen = window.USE_PIXI ? window.pixiApp.app.screen : canvas
		const center = window.USE_PIXI
			? window.pixiApp.cameraController.screenToWorld(screen.width * 0.65, screen.height * 0.4)
			: { x: (screen.width * 0.65 - window.offsetX) / window.escala, y: (screen.height * 0.4 - window.offsetY) / window.escala }
		for (const id of ["parking-road-a", "parking-road-b"]) {
			window.crearCalle(id, 8, "conexion", center.x - 200, center.y + 180, 0, 0, 2)
		}
		window.actualizarSelectores?.()
		const building = window.agregarEdificio(`Parking ${mode}`, center.x, center.y, 120, 80, 0)
		building.color = "#993333"
		if (mode === "polygon") {
			Object.assign(building, { geometryType: "polygon", appearanceMode: "polygon", vertices: [
				{ x: center.x - 60, y: center.y - 40 }, { x: center.x + 60, y: center.y - 40 },
				{ x: center.x + 45, y: center.y + 40 }, { x: center.x - 50, y: center.y + 30 },
			] })
		} else if (mode === "uploaded-image") {
			const artwork = document.createElement("canvas")
			artwork.width = 120; artwork.height = 80
			artwork.getContext("2d").fillStyle = "#993333"
			artwork.getContext("2d").fillRect(0, 0, 120, 80)
			const imageData = artwork.toDataURL("image/png")
			const imageElement = new Image()
			imageElement.src = imageData
			await imageElement.decode()
			Object.assign(building, { appearanceMode: mode, imageData, imageElement })
		}
		window.pixiApp?.sceneManager?.edificioRenderer.renderEdificio(building)
		const selector = document.getElementById("selectEdificio")
		selector.value = "0"
		selector.dispatchEvent(new Event("change", { bubbles: true }))
		window.buildingInspector.show(building)
		window.renderizarCanvas?.()
	}, mode)
	await page.waitForSelector(UI.enabled, { visible: true, timeout: 5000 })
}

async function edit(page, selector, value) {
	await page.$eval(selector, (input, value) => {
		input.value = String(value)
		input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }))
	}, value)
}

async function pairField(page, type, field, value) {
	const title = type === "entrada" ? "Entrada" : "Salida"
	const suffix = { calle: "Road", carril: "Lane", indice: "Cell" }[field]
	await edit(page, `#buildingInspectorParkingPair0${title}${suffix}`, value)
}

async function validPair(page, road = "parking-road-a", entrance = 2, exit = 5) {
	for (const [type, position] of [["entrada", entrance], ["salida", exit]]) {
		await pairField(page, type, "calle", road)
		await pairField(page, type, "carril", 1)
		await pairField(page, type, "indice", position)
	}
}

function state(page) {
	return page.evaluate(() => {
		const b = window.edificios[0]
		return {
			functional: window.edificioTieneConexionesEstacionamientoFuncionales(b),
			enabled: b.esEstacionamiento === true,
			connections: (b.conexiones || []).map(c => ({ tipo: c.tipo, calleId: c.calleId, carril: c.carril, indice: c.indice })),
			maps: window.calles.flatMap(road => [...(road.conexionesEstacionamiento || new Map())].map(([key, c]) => ({ road: road.id, key, type: c.tipo, owner: c.edificioId === b.id, reference: c.edificio === b }))),
			capacity: b.capacidadMaxima, occupancy: b.vehiculosActuales || 0,
			entry: b.probabilidadesEntrada, exit: b.probabilidadesSalida,
			selected: window.edificioSeleccionado === b,
		}
	})
}

function appearance(page) {
	return page.evaluate(() => {
		const b = window.edificios[0]
		return { label: b.label, x: b.x, y: b.y, width: b.width, height: b.height, angle: b.angle, color: b.color, mode: b.appearanceMode, geometry: b.geometryType, vertices: b.vertices, image: b.imageData }
	})
}

async function feedback(page) {
	const result = await page.$eval(UI.status, el => ({ text: el.textContent.trim(), visible: !!el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" }))
	expect(result.visible).toBe(true)
	expect(result.text).toMatch(/par|entrada|salida|calle|carril|posici|capacidad|ocup|vehículo/i)
}

async function outlines(page) {
	// Read real displayed pixels, not renderer bookkeeping. No manual building
	// refresh here: enable/disable must update the paused scene on its own.
	const clip = await page.evaluate(() => {
		const b = window.edificios[0]
		const canvas = document.getElementById("simuladorCanvas")
		const rect = canvas.getBoundingClientRect()
		const screen = window.USE_PIXI ? window.pixiApp.app.screen : canvas
		const raw = window.USE_PIXI ? window.pixiApp.cameraController.worldToScreen(b.x, b.y) : { x: b.x * window.escala + window.offsetX, y: b.y * window.escala + window.offsetY }
		const scale = window.USE_PIXI ? window.pixiApp.cameraController.scale : window.escala
		const width = (b.width * scale + 24) * rect.width / screen.width
		const height = (b.height * scale + 24) * rect.height / screen.height
		return { x: Math.floor(rect.left + raw.x * rect.width / screen.width - width / 2), y: Math.floor(rect.top + raw.y * rect.height / screen.height - height / 2), width: Math.ceil(width), height: Math.ceil(height) }
	})
	const data = await page.screenshot({ encoding: "base64", clip })
	return page.evaluate(async data => {
		const image = new Image()
		image.src = `data:image/png;base64,${data}`
		await image.decode()
		const canvas = document.createElement("canvas")
		canvas.width = image.width; canvas.height = image.height
		const ctx = canvas.getContext("2d")
		ctx.drawImage(image, 0, 0)
		const pixels = ctx.getImageData(0, 0, image.width, image.height).data
		let blue = 0, gold = 0
		// The upper horizontal edge is shared by all fixtures. Avoid corner and
		// center editing handles (also blue) and sample the independent outlines.
		for (let y = 4; y < 20; y++) {
			for (let x = 20; x < image.width - 20; x++) {
				const i = (y * image.width + x) * 4
				const [r, g, b] = pixels.slice(i, i + 3)
				if (r < 40 && g > 70 && g < 145 && b > 220) blue++
				if (r > 180 && g > 130 && b < 80) gold++
			}
		}
		return { blue, gold }
	}, data)
}

async function exportJson(page) {
	return page.evaluate(async () => {
		window.prompt = () => "Parking inspector round trip"
		const original = URL.createObjectURL
		URL.createObjectURL = blob => { window.__parkingExport = blob.text(); return "blob:parking-inspector-test" }
		try { window.guardarSimulacion(); return await window.__parkingExport }
		finally { URL.createObjectURL = original }
	})
}

async function enable(page) {
	await page.click(UI.enabled)
	await validPair(page)
	expect((await state(page)).functional).toBe(true)
}

describe.each([["Canvas", false], ["Pixi", true]])("parking building inspector in %s", (_, usePixi) => {
	let sim, fresh
	beforeAll(async () => { sim = await openSimulator({ usePixi, freezeFrames: false }); await ready(sim, usePixi) }, 180000)
	beforeEach(async () => {
		await sim.page.evaluate(() => { window.confirm = () => true; document.getElementById("btnNuevaSimulacion").click() })
		await sim.page.waitForFunction(() => window.edificios.length === 0)
	})
	afterAll(async () => { await fresh?.close(); await sim?.close() })

	it.each(MODES)("validates %s drafts, atomically replaces mappings, applies capacity/probabilities, and disables without confirmation", async mode => {
		const page = sim.page
		await fixture(page, mode)
		const originalAppearance = await appearance(page)
		expect((await state(page)).functional).toBe(false)
		expect((await outlines(page)).blue).toBe(0)
		await page.click(UI.enabled)
		await feedback(page)
		expect(await state(page)).toMatchObject({ enabled: false, functional: false, maps: [] })
		await pairField(page, "entrada", "calle", "parking-road-a")
		await pairField(page, "entrada", "carril", 1)
		await pairField(page, "entrada", "indice", 99)
		expect(await state(page)).toMatchObject({ enabled: false, functional: false, maps: [] })
		await validPair(page)
		const live = await state(page)
		expect(live).toMatchObject({ enabled: true, functional: true, selected: true })
		expect(live.maps).toEqual([
			{ road: "parking-road-a", key: "0-1", type: "entrada", owner: true, reference: true },
			{ road: "parking-road-a", key: "0-4", type: "salida", owner: true, reference: true },
		])
		await expect.poll(async () => (await outlines(page)).blue, { timeout: 5000 }).toBeGreaterThan(0)
		const enabledOutline = await outlines(page)

		await pairField(page, "salida", "indice", "")
		await pairField(page, "entrada", "calle", "parking-road-b")
		await pairField(page, "entrada", "indice", 3)
		await pairField(page, "salida", "calle", "parking-road-b")
		await feedback(page)
		expect((await state(page)).connections).toEqual(live.connections)
		expect((await state(page)).maps).toEqual(live.maps)
		await pairField(page, "salida", "indice", 6)
		const replaced = await state(page)
		expect(replaced.maps).toEqual([
			{ road: "parking-road-b", key: "0-2", type: "entrada", owner: true, reference: true },
			{ road: "parking-road-b", key: "0-5", type: "salida", owner: true, reference: true },
		])
		expect(replaced.connections.map(c => c.calleId)).toEqual(["parking-road-b", "parking-road-b"])

		await edit(page, UI.capacity, 12)
		expect((await state(page)).capacity).toBe(12)
		// Occupancy is deterministic fixture state, not a stochastic timer race.
		await page.evaluate(() => { window.edificios[0].vehiculosActuales = 4 })
		await edit(page, UI.capacity, 3)
		await feedback(page)
		expect(await state(page)).toMatchObject({ capacity: 12, occupancy: 4 })
		await edit(page, UI.capacity, 4)
		expect((await state(page)).capacity).toBe(4)
		for (const [type, value] of [["Entrada", 0.75], ["Salida", 0]]) {
			await edit(page, `#buildingInspectorParking${type}0`, value * 100)
			expect((await state(page))[type === "Entrada" ? "entry" : "exit"][0]).toBe(value)
		}
		await page.evaluate(() => { window.__parkingConfirms = 0; window.confirm = () => { window.__parkingConfirms++; return false } })
		await page.click(UI.enabled)
		expect(await page.evaluate(() => window.__parkingConfirms)).toBe(0)
		expect(await state(page)).toMatchObject({ enabled: false, functional: false, occupancy: 0, connections: [], maps: [], selected: true })
		expect(await appearance(page)).toEqual(originalAppearance)
		await expect.poll(async () => (await outlines(page)).blue, { timeout: 5000 }).toBe(0)
		expect((await outlines(page)).gold).toBeGreaterThan(0)
		expect(enabledOutline.gold, "functional parking must not hide selection").toBeGreaterThan(0)
	}, 30000)

	it.each(MODES)("restores valid %s parking in a fresh app without promoting legacy decorative names/images", async mode => {
		await fixture(sim.page, mode)
		await enable(sim.page)
		await edit(sim.page, UI.capacity, 19)
		await edit(sim.page, "#buildingInspectorParkingEntrada0", 100)
		await edit(sim.page, "#buildingInspectorParkingSalida0", 75)
		await sim.page.evaluate(() => {
			window.procesarEntradaVehiculo(window.edificios[0], 1, 0)
			window.procesarEntradaVehiculo(window.edificios[0], 2, 0)
		})
		const expected = await state(sim.page)
		expect(expected.occupancy).toBe(2)
		const expectedAppearance = await appearance(sim.page)
		const saved = JSON.parse(await exportJson(sim.page))
		saved.edificios.push(
			{ id: "legacy-parking-name", label: "Estacionamiento decorativo", x: 20, y: 20, width: 40, height: 30, angle: 0, color: "#993333" },
			{ id: "legacy-parking-image", label: "Legacy artwork", imagen: "estacionamiento", x: 80, y: 20, width: 40, height: 30, angle: 0 },
		)
		fresh = await openSimulator({ usePixi, freezeFrames: false })
		try {
			await ready(fresh, usePixi)
			await fresh.page.evaluate(json => window.cargarSimulacion({ target: { files: [new File([json], "parking.json", { type: "application/json" })], value: "" } }), JSON.stringify(saved))
			await fresh.page.waitForFunction(() => window.edificios.length === 3 && window.edificioTieneConexionesEstacionamientoFuncionales(window.edificios[0]), { timeout: 10000 })
			if (mode === "uploaded-image") await fresh.page.waitForFunction(() => window.edificios[0].imageElement?.naturalWidth === 120)
			const restored = await state(fresh.page)
			expect(restored.connections).toEqual(expected.connections)
			expect(restored.maps).toEqual(expected.maps)
			expect(restored).toMatchObject({ functional: true, capacity: 19, entry: expected.entry, exit: expected.exit })
			expect(await appearance(fresh.page)).toEqual(expectedAppearance)
			expect(await fresh.page.evaluate(() => window.edificios.slice(1).map(b => window.edificioTieneConexionesEstacionamientoFuncionales(b)))).toEqual([false, false])
			await fresh.page.evaluate(() => { window.edificioSeleccionado = window.edificios[0]; window.buildingInspector.show(window.edificios[0]) })
			await fresh.page.click(UI.enabled)
			expect(await state(fresh.page)).toMatchObject({ functional: false, occupancy: 0, maps: [], selected: true })
		} finally { await fresh.close(); fresh = null }
	}, 180000)
})
