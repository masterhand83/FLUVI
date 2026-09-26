import assert from "node:assert/strict"
import { openSimulator } from "../helpers/simulator.mjs"

// Public UI contract proposed for the map-first directed-link workflow:
// #createLinkButton, #linkDraftPanel, #linkMappingRows,
// #linkDirectionReverse, #linkSaveButton, #linkCancelButton.
// Each mapping row is [data-testid="link-mapping-row"] and exposes
// [data-testid="source-lane"|"source-cell"|"destination-lane"|"destination-cell"]
// inputs and an unmatched source lane marked [data-testid="link-unmatched-lane"]
// when lane counts differ. The issue requests a visible, correctable review rather than a
// particular layout, so assertions use these hooks and the public model.

const TEST_IDS = {
	start: "#createLinkButton",
	panel: "#linkDraftPanel",
	rows: "#linkMappingRows",
	reverse: "#linkDirectionReverse",
	save: "#linkSaveButton",
	cancel: "#linkCancelButton",
}

async function waitForUI(page) {
	await page.evaluate(() => { document.getElementById("loadingScreen").style.display = "none" })
	await page.waitForSelector(TEST_IDS.start, { visible: true, timeout: 10000 })
}

async function addStreet(page, name, screenX, screenY, lanes = 2) {
	return page.evaluate(({ name, screenX, screenY, lanes }) => {
		const canvas = document.getElementById("simuladorCanvas")
		const camera = window.pixiApp?.cameraController
		const point = camera
			? camera.screenToWorld(canvas.width * screenX, canvas.height * screenY)
			: { x: (canvas.width * screenX - window.offsetX) / window.escala, y: (canvas.height * screenY - window.offsetY) / window.escala }
		const street = window.crearCalle(name, 16, window.TIPOS.CONEXION, point.x, point.y, 0, 0, lanes, 0)
		window.pixiApp?.sceneManager?.renderAll()
		window.renderizarCanvas?.()
		return { id: street.id, name: street.nombre }
	}, { name, screenX, screenY, lanes })
}

async function clickStreet(page, streetId, lane = 0, cell = 4) {
	const point = await page.evaluate(({ streetId, lane, cell }) => {
		const street = window.calles.find((item) => item.id === streetId)
		if (!street) throw new Error(`street ${streetId} disappeared`)
		const canvas = document.getElementById("simuladorCanvas")
		const rect = canvas.getBoundingClientRect()
		const world = window.obtenerCoordenadasGlobalesCelda(street, lane, cell)
		const camera = window.pixiApp?.cameraController
		const screen = camera
			? camera.worldToScreen(world.x, world.y)
			: { x: world.x * window.escala + window.offsetX, y: world.y * window.escala + window.offsetY }
		return {
			x: rect.left + screen.x * rect.width / (camera ? window.pixiApp.app.screen.width : canvas.width),
			y: rect.top + screen.y * rect.height / (camera ? window.pixiApp.app.screen.height : canvas.height),
		}
	}, { streetId, lane, cell })
	await page.mouse.click(point.x, point.y)
}

async function createDraft(page, source, destination) {
	await page.click(TEST_IDS.start)
	await clickStreet(page, source.id)
	await clickStreet(page, destination.id)
	await page.waitForFunction(() => {
		const panel = document.querySelector("#linkDraftPanel")
		return panel && !panel.hidden && panel.getAttribute("aria-hidden") !== "true"
	})
}

async function rows(page) {
	return page.$$eval(`${TEST_IDS.rows} [data-testid="link-mapping-row"]`, (elements) =>
		elements.map((row) => Object.fromEntries(
			["source-lane", "source-cell", "destination-lane", "destination-cell"].map((key) => [
				key,
				row.querySelector(`[data-testid="${key}"]`)?.value ?? null,
			]),
		)),
	)
}

async function editFirstRow(page, field, value) {
	await page.$eval(`${TEST_IDS.rows} [data-testid="link-mapping-row"] [data-testid="${field}"]`, (input, next) => {
		input.value = String(next)
		input.dispatchEvent(new Event("input", { bubbles: true }))
		input.dispatchEvent(new Event("change", { bubbles: true }))
	}, value)
}

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 105, usePixi, freezeFrames: false })
	const { page } = sim
	try {
		if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.sceneManager, { timeout: 30000 })
		await waitForUI(page)
		await page.evaluate(() => window.streetEditPause?.())

		// Put two deliberately separated test streets into the public map model;
		// the interaction itself still uses the user's Create link + map clicks.
		const streets = {
			source: await addStreet(page, "Link test source", 0.25, 0.2, 2),
			destination: await addStreet(page, "Link test destination", 0.25, 0.7, 1),
		}
		const initialLinks = await page.evaluate(() => window.conexiones.length)
		const alternative = await addStreet(page, "Link correction", 0.7, 0.2, 2)

		// Draft review is visible and spells out the directed last-cell → first-cell
		// mapping for matching lanes; the extra source lane is visibly unmatched.
		await createDraft(page, streets.source, streets.destination)
		assert.equal(await page.evaluate(() => window.conexiones.length), initialLinks, "map picks do not connect streets before Save")
		const initialRows = await rows(page)
		assert.equal(initialRows.length, 1, "Lineal defaults to lane pairs up to the smaller lane count")
		assert.equal(Number(initialRows[0]["source-lane"]), 0)
		assert.ok([15, -1].includes(Number(initialRows[0]["source-cell"])), "source defaults to its final cell (or the equivalent last-cell sentinel)")
		assert.equal(Number(initialRows[0]["destination-lane"]), 0)
		assert.equal(Number(initialRows[0]["destination-cell"]), 0, "destination defaults to its first cell")
		assert.ok(await page.$(`${TEST_IDS.rows} [data-testid="link-unmatched-lane"]`), "the unmatched source lane is visible")
		const visibleReview = await page.$eval(TEST_IDS.rows, (el) => getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0)
		assert.ok(visibleReview, "mapping rows are visibly reviewable")

		// Correct both street choices, then reverse direction. Escape discards only
		// this draft; it must not mutate existing links.
		await page.waitForSelector("#linkSourceStreet")
		await page.select("#linkSourceStreet", alternative.id)
		await page.select("#linkDestinationStreet", streets.source.id)
		await page.click(TEST_IDS.reverse)
		assert.equal(await page.$eval("#linkSourceStreet", (el) => el.value), streets.source.id)
		assert.equal(await page.$eval("#linkDestinationStreet", (el) => el.value), alternative.id)
		await page.keyboard.press("Escape")
		await page.waitForFunction(() => document.querySelector("#linkDraftPanel")?.hidden)
		assert.equal(await page.evaluate(() => window.conexiones.length), initialLinks, "Escape removes no persisted or existing link")

		// A valid draft commits a directed, last-cell-to-first-cell transfer, and a
		// vehicle placed at that endpoint moves across it on an explicit step.
		await createDraft(page, streets.source, streets.destination)
		await page.click(TEST_IDS.save)
		await page.waitForFunction((count) => window.conexiones.length === count + 1, {}, initialLinks)
		const saved = await page.evaluate(({ sourceId, destinationId }) => {
			const link = window.conexiones.at(-1)
			const source = window.calles.find((street) => street.id === sourceId)
			const destination = window.calles.find((street) => street.id === destinationId)
			source.arreglo[0][source.tamano - 1] = 1
			const transferred = link.transferir()
			return { transferred, sourceOccupied: source.arreglo[0][source.tamano - 1], destinationValue: destination.arreglo[0][0] }
		}, { sourceId: streets.source.id, destinationId: streets.destination.id })
		assert.equal(saved.transferred, true, "saved mapping transfers a vehicle")
		assert.equal(saved.sourceOccupied, 0, "transfer consumes the source endpoint vehicle")
		assert.equal(saved.destinationValue, 1, "transfer delivers the vehicle to the mapped destination cell")

		// Cancel is the other explicit draft-discard path.
		const beforeCancel = await page.evaluate(() => window.conexiones.length)
		await createDraft(page, streets.source, alternative)
		await page.click(TEST_IDS.cancel)
		await page.waitForFunction(() => document.querySelector("#linkDraftPanel")?.hidden)
		assert.equal(await page.evaluate(() => window.conexiones.length), beforeCancel)

		// Out-of-range mapping and exact directed duplicate are blocked without
		// adding a connection. A different destination cell remains allowed.
		await createDraft(page, streets.source, streets.destination)
		await editFirstRow(page, "destination-cell", 999)
		await page.click(TEST_IDS.save)
		assert.equal(await page.evaluate(() => window.conexiones.length), beforeCancel, "out-of-range mapping is rejected")
		assert.ok(await page.$eval(TEST_IDS.panel, (el) => el.getAttribute("aria-invalid") === "true" || el.querySelector("[role=alert]")?.textContent.trim()), "invalid mapping has visible feedback")
		assert.ok(await page.$eval(`${TEST_IDS.rows} [data-testid="link-mapping-row"]`, (row) => row.classList.contains("is-invalid")), "the offending mapping stays highlighted for correction")
		await editFirstRow(page, "destination-cell", 1)
		assert.match(await page.$eval("#linkDraftNotice", (el) => el.textContent), /solapamiento/i, "nonidentical endpoint overlap is informational")
		await page.click(TEST_IDS.save)
		await page.waitForFunction((count) => window.conexiones.length === count + 1, {}, beforeCancel)
		await createDraft(page, streets.source, streets.destination)
		await page.click(TEST_IDS.save)
		assert.equal(await page.evaluate(() => window.conexiones.length), beforeCancel + 1, "an exact directed duplicate is rejected")
		assert.ok(await page.$eval(TEST_IDS.panel, (el) => el.getAttribute("aria-invalid") === "true" || el.querySelector("[role=alert]")?.textContent.trim()), "duplicate rejection has visible feedback")
		await page.click(TEST_IDS.cancel)

		// A legacy mapping of another type with an explicit final-cell index is
		// still the same directed transfer as a new Lineal last-cell mapping.
		const crossTypeCount = await page.evaluate(({ sourceId, destinationId }) => {
			const source = window.calles.find((street) => street.id === sourceId)
			const destination = window.calles.find((street) => street.id === destinationId)
			const [mapping] = window.crearConexionLineal(source, destination, 1)
			mapping.tipo = "INCORPORACION"
			mapping.posOrigen = source.tamano - 1
			window.registrarConexiones([mapping])
			window.conexiones.push(mapping)
			return window.conexiones.length
		}, { sourceId: streets.source.id, destinationId: alternative.id })
		await createDraft(page, streets.source, alternative)
		await page.click(TEST_IDS.save)
		assert.equal(await page.evaluate(() => window.conexiones.length), crossTypeCount, "effective last-cell duplicate is rejected across types")
		assert.ok(await page.$eval(TEST_IDS.panel, (el) => el.getAttribute("aria-invalid") === "true" || el.querySelector("[role=alert]")?.textContent.trim()), "cross-type duplicate has visible feedback")

		console.log(`✅ directed Lineal link creation, review, correction, cancellation and validation (${usePixi ? "Pixi" : "Canvas"})`)
	} finally {
		await sim.close()
	}
}
