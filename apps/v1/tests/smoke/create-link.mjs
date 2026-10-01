import assert from "node:assert/strict"
import { openSimulator } from "../helpers/simulator.mjs"

// Lineal lets users choose lane pairs, keeping directional endpoint cells.

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

async function previewCount(page, count) {
	await page.waitForFunction(expected => document.querySelectorAll('#linkDraftPreview [data-testid="link-preview-arrow"]').length === expected, {}, count)
	return page.$eval('#linkDraftPreview', svg => ({ hidden: svg.hidden, pointerEvents: getComputedStyle(svg).pointerEvents, paths: [...svg.querySelectorAll('path')].map(path => path.getAttribute('d')) }))
}

async function createDraft(page, source, destination) {
	await page.click(TEST_IDS.start)
	await clickStreet(page, source.id)
	await clickStreet(page, destination.id)
	await page.waitForFunction(() => {
		const panel = document.querySelector("#linkDraftPanel")
		return panel && !panel.hidden && panel.getAttribute("aria-hidden") !== "true" &&
			!!document.querySelector('#linkMappingRows [data-testid="link-lineal-summary"]')
	})
}

async function rows(page) {
	return page.$$eval(`${TEST_IDS.rows} [data-testid="link-mapping-row"]`, (elements) =>
		elements.map((row) => Object.fromEntries(
			["source-lane", "source-cell", "destination-lane", "destination-cell"].map((key) => [
				key,
				(() => { const el = row.querySelector(`[data-testid="${key}"]`); return el ? ("value" in el ? el.value : el.textContent.trim()) : null })(),
			]),
		)),
	)
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
			destination: await addStreet(page, "Link test destination", 0.25, 0.4, 1),
		}
		const initialLinks = await page.evaluate(() => window.conexiones.length)
		const alternative = await addStreet(page, "Link correction", 0.7, 0.2, 2)
		await page.click(TEST_IDS.start)
		await clickStreet(page, streets.source.id)
		assert.equal(await page.$$eval('#linkDraftPreview path', paths => paths.length), 0, "no ghost connection without a destination")
		const hoverPoint = await page.evaluate(id => {
			const street = window.calles.find(item => item.id === id)
			const canvas = document.querySelector('#simuladorCanvas'), rect = canvas.getBoundingClientRect()
			const world = window.obtenerCoordenadasGlobalesCelda(street, 0, 4)
			const camera = window.pixiApp?.cameraController
			const screen = camera ? camera.worldToScreen(world.x, world.y) : { x: world.x * window.escala + window.offsetX, y: world.y * window.escala + window.offsetY }
			return { x: rect.left + screen.x * rect.width / (camera ? window.pixiApp.app.screen.width : canvas.width), y: rect.top + screen.y * rect.height / (camera ? window.pixiApp.app.screen.height : canvas.height) }
		}, streets.destination.id)
		await page.mouse.move(hoverPoint.x, hoverPoint.y)
		assert.equal((await previewCount(page, 1)).pointerEvents, 'none', "hover shadow arrow does not intercept map selection")
		assert.equal(await page.evaluate(() => window.conexiones.length), initialLinks, "hover preview is not a persisted connection")
		await page.click(TEST_IDS.cancel)
		assert.equal((await previewCount(page, 0)).hidden, true, "Cancel removes the hover preview")

		// Draft review is visible and spells out the directed last-cell → first-cell
		// mapping for matching lanes; the extra source lane is visibly unmatched.
		await createDraft(page, streets.source, streets.destination)
		const firstPreview = await previewCount(page, 1)
		assert.equal(firstPreview.hidden, false, "selected streets show their directed draft arrow")
		assert.equal(await page.$eval('#linkDraftPreview path', path => path.getAttribute('stroke-dasharray')), '7 5', "preview arrow is visually distinct from saved links")
		await page.evaluate(pixi => {
			if (pixi) window.pixiApp.cameraController.pan(20, 0)
			else window.offsetX += 20
		}, usePixi)
		await page.waitForFunction(previous => document.querySelector('#linkDraftPreview path')?.getAttribute('d') !== previous, {}, firstPreview.paths[0])
		await page.evaluate(pixi => {
			if (pixi) window.pixiApp.cameraController.pan(-20, 0)
			else window.offsetX -= 20
		}, usePixi)
		assert.equal(await page.evaluate(() => window.conexiones.length), initialLinks, "map picks do not connect streets before Save")
		assert.equal((await rows(page)).length, 1, "Lineal starts with matching lane pairs")
		assert.match(await page.$eval('[data-testid="link-lineal-summary"]', el => el.textContent), /última celda.*15.*primera celda.*0/i, "Lineal visibly reviews canonical last-to-first cell mapping")
		const linealControls = await page.$$eval(`${TEST_IDS.rows} [data-testid="link-mapping-row"]`, elements => elements.map(row => ({
			pickers: row.querySelectorAll('[data-testid="link-pick-source"], [data-testid="link-pick-destination"], [data-testid="link-pick-map"]').length,
			editable: [...row.querySelectorAll('input, select, textarea')].filter(el => !el.disabled && !el.readOnly).length,
		})))
		assert.deepEqual(linealControls, [{ pickers: 0, editable: 2 }], "Lineal exposes both lanes without editable endpoint cells")
		assert.ok(await page.$(`${TEST_IDS.rows} [data-testid="link-unmatched-lane"]`), "the unmatched source lane is visible")
		const visibleReview = await page.$eval('[data-testid="link-lineal-summary"]', (el) => getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0)
		assert.ok(visibleReview, "mapping rows are visibly reviewable")
		await page.click("#linkAddExit")
		assert.equal((await rows(page)).length, 2, "extra source lanes can be connected explicitly")
		assert.equal((await rows(page))[1]["source-lane"], "1")
		await page.click(`${TEST_IDS.rows} [data-testid="link-mapping-row"]:nth-child(1) button`)
		assert.equal((await rows(page))[0]["source-lane"], "1", "removing a pair preserves the other lane choice")
		await page.$eval(`${TEST_IDS.rows} [data-testid="source-lane"]`, el => {
			el.value = "0"
			el.dispatchEvent(new Event("input", { bubbles: true }))
		})
		const panelBounds = await page.$eval(TEST_IDS.panel, (el) => ({
			top: el.getBoundingClientRect().top,
			bottom: el.getBoundingClientRect().bottom,
			viewportHeight: window.innerHeight,
		}))
		assert.ok(panelBounds.top >= 0 && panelBounds.bottom <= panelBounds.viewportHeight,
			`link instructions and Save/Cancel must fit in the viewport: ${JSON.stringify(panelBounds)}`)

		// Correct both street choices, then reverse direction. Escape discards only
		// this draft; it must not mutate existing links.
		await page.waitForSelector("#linkSourceStreet")
		await page.select("#linkSourceStreet", alternative.id)
		await page.select("#linkDestinationStreet", streets.source.id)
		await page.click(TEST_IDS.reverse)
		assert.equal(await page.$eval("#linkSourceStreet", (el) => el.value), streets.source.id)
		assert.equal(await page.$eval("#linkDestinationStreet", (el) => el.value), alternative.id)
		await page.waitForFunction(previous => document.querySelector('#linkDraftPreview path')?.getAttribute('d') !== previous, {}, firstPreview.paths[0])
		await page.keyboard.press("Escape")
		await page.waitForFunction(() => document.querySelector("#linkDraftPanel")?.hidden)
		assert.equal(await page.evaluate(() => window.conexiones.length), initialLinks, "Escape removes no persisted or existing link")
		assert.equal((await previewCount(page, 0)).hidden, true, "Escape removes the shadow arrow")

		// A valid draft commits a directed, last-cell-to-first-cell transfer, and a
		// vehicle placed at that endpoint moves across it on an explicit step.
		await createDraft(page, streets.source, streets.destination)
		await page.click(TEST_IDS.save)
		await page.waitForFunction((count) => window.conexiones.length === count + 1, {}, initialLinks)
		assert.equal((await previewCount(page, 0)).hidden, true, "Save removes the draft preview")
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

		// Exact directed duplicates are blocked even when the visible Lineal
		// mapping is immutable. Probabilistic validation/correction is covered
		// in connection-types.mjs.
		await createDraft(page, streets.source, streets.destination)
		await page.click(TEST_IDS.save)
		assert.equal(await page.evaluate(() => window.conexiones.length), beforeCancel, "an exact directed duplicate is rejected")
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
		await page.click(TEST_IDS.cancel)

		// A long review at a shorter viewport must remain readable and scroll to
		// Save/Cancel rather than extend below the application window.
		const longReview = await page.evaluate(() => ["Long link source", "Long link destination"].map((name, index) => {
			const street = window.crearCalle(name, 16, window.TIPOS.CONEXION, 300 + index * 100, 300, 0, 0, 10, 0)
			return street.id
		}))
		await page.click(TEST_IDS.start)
		await page.select("#linkSourceStreet", longReview[0])
		await page.select("#linkDestinationStreet", longReview[1])
		await page.select("#linkTypeSelect", "LINEAL")
		await page.setViewport({ width: 900, height: 600 })
		const compactLayout = await page.$eval(TEST_IDS.panel, (el) => {
			const rect = el.getBoundingClientRect()
			return { top: rect.top, bottom: rect.bottom, height: window.innerHeight, scrollable: el.scrollHeight > el.clientHeight }
		})
		assert.ok(compactLayout.top >= 0 && compactLayout.bottom <= compactLayout.height && compactLayout.scrollable,
			`long review remains within viewport and scrollable: ${JSON.stringify(compactLayout)}`)
		await page.click(TEST_IDS.cancel)

		console.log(`✅ directed Lineal fixed review, save, cancellation and duplicate validation (${usePixi ? "Pixi" : "Canvas"})`)
	} finally {
		await sim.close()
	}
}
