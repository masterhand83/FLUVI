import assert from "node:assert/strict"
import { openSimulator } from "../helpers/simulator.mjs"

const ui = { start: "#createLinkButton", panel: "#linkDraftPanel", rows: "#linkMappingRows", type: "#linkTypeSelect", add: "#linkAddExit", save: "#linkSaveButton", cancel: "#linkCancelButton" }
const rowsSelector = `${ui.rows} [data-testid="link-mapping-row"]`
const canonicalType = { LINEAL: "lineal", INCORPORACION: "incorporacion", PROBABILISTICA: "probabilistica" }

async function setup(page) {
	await page.evaluate(() => { document.getElementById("loadingScreen").style.display = "none" })
	await page.waitForSelector(ui.start, { visible: true, timeout: 10000 })
}

async function makeStreet(page, name, x, y, lanes = 2, size = 16) {
	return page.evaluate(({ name, x, y, lanes, size }) => {
		const canvas = document.getElementById("simuladorCanvas")
		const camera = window.pixiApp?.cameraController
		const point = camera ? camera.screenToWorld(canvas.width * x, canvas.height * y) : { x: (canvas.width * x - window.offsetX) / window.escala, y: (canvas.height * y - window.offsetY) / window.escala }
		const street = window.crearCalle(name, size, window.TIPOS.CONEXION, point.x, point.y, 0, 0, lanes, 0)
		window.pixiApp?.sceneManager?.renderAll()
		window.renderizarCanvas?.()
		return { id: street.id, name: street.nombre }
	}, { name, x, y, lanes, size })
}

async function openDraft(page, source, destination, type) {
	await page.click(ui.start)
	await page.select("#linkSourceStreet", source.id)
	await page.select("#linkDestinationStreet", destination.id)
	await page.select(ui.type, type)
	await page.waitForFunction(() => document.querySelector("#linkDraftPanel")?.hidden === false)
	await page.waitForSelector(rowsSelector)
}

async function readRows(page) {
	return page.$$eval(rowsSelector, elements => elements.map(row => Object.fromEntries(
		["source-lane", "source-cell", "destination-lane", "destination-cell", "chance"].map(key => [key, row.querySelector(`[data-testid="${key}"]`)?.value ?? null]),
	)))
}

async function setRow(page, index, key, value) {
	await page.$eval(`${rowsSelector}:nth-child(${index + 1}) [data-testid="${key}"]`, (input, next) => {
		input.value = String(next)
		input.dispatchEvent(new Event("input", { bubbles: true }))
		input.dispatchEvent(new Event("change", { bubbles: true }))
	}, value)
}

async function connectionCount(page) { return page.evaluate(() => window.conexiones.length) }
async function waitForCount(page, expected) { await page.waitForFunction(count => window.conexiones.length === count, {}, expected) }
async function closeDraft(page, button = ui.cancel) {
	await page.click(button)
	await page.waitForFunction(() => document.querySelector("#linkDraftPanel")?.hidden)
}

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 206, usePixi, freezeFrames: false })
	const { page } = sim
	try {
		if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.sceneManager, { timeout: 30000 })
		await setup(page)
		await page.evaluate(() => window.streetEditPause?.())
		const source = await makeStreet(page, `Issue 06 source ${usePixi}`, .20, .20, 3, 16)
		const short = await makeStreet(page, `Issue 06 short ${usePixi}`, .20, .70, 2, 2)
		const target = await makeStreet(page, `Issue 06 target ${usePixi}`, .70, .70, 3, 16)
		const initial = await connectionCount(page)

		// Incorporation creates an exit for every source lane. Out-of-range rows stay
		// in the draft, and Save is atomic: repair succeeds without partial links.
		await openDraft(page, source, short, "INCORPORACION")
		let rows = await readRows(page)
		assert.equal(rows.length, 3, "incorporation includes every source lane")
		assert.deepEqual(rows.map(row => Number(row["source-lane"])), [0, 1, 2])
		assert.deepEqual(rows.map(row => Number(row["destination-lane"])), [0, 0, 0])
		assert.deepEqual(rows.map(row => Number(row["destination-cell"])), [0, 1, 2], "all lanes expand to destination cells; the final cell is out of range")
		await page.click(ui.save)
		assert.equal(await connectionCount(page), initial, "invalid incorporation does not partially commit")
		assert.ok(await page.$(`${rowsSelector}.is-invalid`), "invalid lane is highlighted")
		await setRow(page, 2, "destination-cell", 1)
		await page.click(ui.save)
		await waitForCount(page, initial + 3)
		const incorporated = await page.evaluate(() => window.conexiones.slice(-3).map(link => ({ type: link.tipo, sourceLane: link.carrilOrigen, destLane: link.carrilDestino, destCell: link.posDestino })))
		assert.deepEqual(incorporated.map(link => link.type), Array(3).fill(canonicalType.INCORPORACION))
		assert.deepEqual(incorporated.map(link => [link.sourceLane, link.destLane, link.destCell]), [[0, 0, 0], [1, 0, 1], [2, 0, 1]])

		// A probabilistic draft starts with one 100% exit. Additional exits are
		// explicitly added and retain independent, non-normalized percentages.
		await openDraft(page, source, target, "PROBABILISTICA")
		rows = await readRows(page)
		assert.equal(rows.length, 1, "probabilistic type defaults to one exit")
		assert.equal(Number(rows[0].chance), 100)
		await setRow(page, 0, "chance", 35)
		await page.click(ui.add)
		await page.waitForFunction(() => document.querySelectorAll('#linkMappingRows [data-testid="link-mapping-row"]').length === 2)
		assert.equal(Number((await readRows(page))[0].chance), 35, "adding an exit retains the edited first exit")
		await setRow(page, 1, "source-lane", 1)
		await setRow(page, 1, "destination-lane", 2)
		await setRow(page, 1, "destination-cell", 3)
		await setRow(page, 1, "chance", 80)
		const beforeProbSave = await connectionCount(page)
		await page.click(ui.save)
		await waitForCount(page, beforeProbSave + 2)
		const probabilistic = await page.evaluate(() => window.conexiones.slice(-2).map(link => ({ type: link.tipo, sourceLane: link.carrilOrigen, destLane: link.carrilDestino, destCell: link.posDestino, chance: link.probabilidadTransferencia })))
		assert.deepEqual(probabilistic.map(link => link.type), Array(2).fill(canonicalType.PROBABILISTICA))
		assert.deepEqual(probabilistic.map(link => [link.sourceLane, link.destLane, link.destCell]), [[0, 0, 0], [1, 2, 3]])
		assert.deepEqual(probabilistic.map(link => Math.round(link.chance * 100)), [35, 80], "chance is persisted per exit, without normalization")

		// Identical exits inside a draft and against a committed mapping are rejected;
		// non-identical shared-endpoint overlap and reverse direction remain legal.
		let count = await connectionCount(page)
		await openDraft(page, source, target, "PROBABILISTICA")
		await page.click(ui.add)
		await setRow(page, 1, "source-lane", 0)
		await setRow(page, 1, "destination-lane", 0)
		await setRow(page, 1, "destination-cell", 0)
		await page.click(ui.save)
		assert.equal(await connectionCount(page), count, "duplicate exits in the expanded draft are rejected atomically")
		await closeDraft(page)

		await openDraft(page, source, target, "LINEAL")
		await setRow(page, 0, "destination-cell", 1)
		await page.click(ui.save)
		await waitForCount(page, count + 3)
		count += 3
		await openDraft(page, target, source, "LINEAL")
		await page.click(ui.save)
		await waitForCount(page, count + 3)
		count += 3
		await openDraft(page, source, target, "LINEAL")
		await page.click(ui.save)
		assert.equal(await connectionCount(page), count, "exact duplicate against another type is rejected")
		await closeDraft(page)

		// Reveal and search the sidebar, then click the exact 35% probabilistic
		// row's edit control (not merely the first matching street connection).
		const editIndex = await page.evaluate(({ sourceId, targetId }) => window.conexiones.findIndex(link => link.origen.id === sourceId && link.destino.id === targetId && link.tipo === window.TIPOS_CONEXION.PROBABILISTICA && Math.round(link.probabilidadTransferencia * 100) === 35), { sourceId: source.id, targetId: target.id })
		assert.ok(editIndex >= 0, "saved 35% probabilistic exit exists")
		const editInfo = await page.evaluate(index => {
			const link = window.conexiones[index]
			return { source: link.origen.id, destination: link.destino.id, type: link.tipo, lane: link.carrilOrigen, cell: link.posOrigen, destinationLane: link.carrilDestino, destinationCell: link.posDestino, chance: link.probabilidadTransferencia }
		}, editIndex)
		await page.$eval("#btnMostrarListaConexiones", button => button.click())
		await page.waitForFunction(() => getComputedStyle(document.querySelector("#listaConexionesContainer")).display !== "none")
		await page.$eval("#linkSearchInput", input => { input.value = "issue-06-no-such-street"; input.dispatchEvent(new Event("input", { bubbles: true })) })
		const noMatches = await page.$$eval("#listaConexiones .list-group-item-action", items => items.filter(item => !item.hidden).length)
		assert.equal(noMatches, 0, "search query with no matching street hides every connection")
		await page.$eval("#linkSearchInput", (input, query) => { input.value = query; input.dispatchEvent(new Event("input", { bubbles: true })) }, source.name)
		const listEvidence = await page.evaluate(() => ({ visible: [...document.querySelectorAll("#listaConexiones .list-group-item-action")].filter(item => !item.hidden).length, hidden: [...document.querySelectorAll("#listaConexiones .list-group-item-action")].filter(item => item.hidden).length }))
		assert.ok(listEvidence.visible > 0, `search for source shows matching connection: ${JSON.stringify(listEvidence)}`)
		const clickedEdit = await page.evaluate(index => {
			const button = [...document.querySelectorAll("#listaConexiones button[onclick^='editarConexion']")].find(el => el.getAttribute("onclick").includes(`(${index})`))
			const item = button?.closest(".list-group-item-action")
			if (!button || !item || item.hidden) return { found: false, index, buttons: [...document.querySelectorAll("#listaConexiones button[onclick^='editarConexion']")].map(el => el.getAttribute("onclick")), text: item?.textContent ?? "" }
			button.click()
			return { found: true }
		}, editIndex)
		assert.ok(clickedEdit.found, `search result edit button opens editor: ${JSON.stringify(clickedEdit)}`)
		await page.waitForFunction(() => !document.querySelector("#linkDraftPanel")?.hidden)
		assert.equal(await page.$eval("#linkSourceStreet", el => el.value), editInfo.source)
		assert.equal(await page.$eval("#linkDestinationStreet", el => el.value), editInfo.destination)
		assert.ok(await page.evaluate(() => typeof window.createLinkTool?.edit === "function"))
		rows = await readRows(page)
		assert.equal(rows.length, 1, "editing a saved exit presents that mapping")
		assert.equal(Number(rows[0].chance), 35)
		// Saving unchanged proves validation excludes the connection being edited.
		const beforeUnchangedSave = await page.evaluate(index => {
			const link = window.conexiones[index]
			return { type: link.tipo, sourceLane: link.carrilOrigen, sourceCell: link.posOrigen, destLane: link.carrilDestino, destCell: link.posDestino, probability: link.probabilidadTransferencia }
		}, editIndex)
		await page.click(ui.save)
		await page.waitForFunction(() => document.querySelector("#linkDraftPanel")?.hidden)
		assert.equal(await connectionCount(page), count, "editing self is not rejected as a duplicate")
		const editedRef = await page.evaluate(index => {
			const link = window.conexiones[index]
			return { type: link.tipo, sourceLane: link.carrilOrigen, sourceCell: link.posOrigen, destLane: link.carrilDestino, destCell: link.posDestino, probability: link.probabilidadTransferencia }
		}, editIndex)
		assert.deepEqual(editedRef, beforeUnchangedSave)
		await page.evaluate(index => window.createLinkTool.edit(window.conexiones[index]), editIndex)
		await setRow(page, 0, "destination-cell", Number(rows[0]["destination-cell"]) + 2)
		await page.evaluate(({ sourceId, targetId }) => { window.__connectionOrderBefore = [...window.conexiones]; window.__issue06SourceId = sourceId; window.__issue06TargetId = targetId }, { sourceId: source.id, targetId: target.id })
		await page.click(ui.save)
		await page.waitForFunction(() => document.querySelector("#linkDraftPanel")?.hidden)
		const editOrder = await page.evaluate(() => {
			const before = window.__connectionOrderBefore
			const index = before.findIndex(link => link.origen.id === window.__issue06SourceId && link.destino.id === window.__issue06TargetId && link.tipo === window.TIPOS_CONEXION.PROBABILISTICA && Math.round(link.probabilidadTransferencia * 100) === 35)
			return { length: window.conexiones.length, index, unaffectedRemainInOrder: before.filter((_, i) => i !== index).every((link, i) => window.conexiones.filter((_, j) => j !== index)[i] === link) }
		})
		assert.equal(editOrder.length, count, "editing replaces one mapping without changing connection count")
		assert.ok(editOrder.index >= 0)
		assert.ok(editOrder.unaffectedRemainInOrder, "edit preserves registration/list order of other links")

		// Invalid edit and explicit cancel do not mutate the committed mapping.
		const stable = await page.evaluate(index => {
			const link = window.conexiones[index]
			return { type: link.tipo, sourceLane: link.carrilOrigen, sourceCell: link.posOrigen, destLane: link.carrilDestino, destCell: link.posDestino, probability: link.probabilidadTransferencia }
		}, editIndex)
		await page.evaluate(index => window.createLinkTool.edit(window.conexiones[index]), editIndex)
		await setRow(page, 0, "destination-cell", 999)
		await page.click(ui.save)
		assert.deepEqual(await page.evaluate(index => { const l = window.conexiones[index]; return { type: l.tipo, sourceLane: l.carrilOrigen, sourceCell: l.posOrigen, destLane: l.carrilDestino, destCell: l.posDestino, probability: l.probabilidadTransferencia } }, editIndex), stable)
		await closeDraft(page)
		await page.evaluate(index => window.createLinkTool.edit(window.conexiones[index]), editIndex)
		await setRow(page, 0, "destination-cell", Number(stable.destCell) + 1)
		await closeDraft(page)
		assert.deepEqual(await page.evaluate(index => { const l = window.conexiones[index]; return { type: l.tipo, destCell: l.posDestino } }, editIndex), { type: stable.type, destCell: stable.destCell }, "cancel leaves saved link unchanged")

		// Deterministic transfer consumes exactly the matching source endpoint and
		// delivers to the mapped destination. The links remain in registration order.
		const transferResult = await page.evaluate(({ sourceId, destinationId }) => {
			const source = window.calles.find(street => street.id === sourceId)
			const destination = window.calles.find(street => street.id === destinationId)
			const link = window.conexiones.find(item => item.origen === source && item.destino === destination && item.tipo === window.TIPOS_CONEXION.LINEAL && item.carrilOrigen === 0)
			if (!link) throw new Error("expected saved lineal link missing")
			source.arreglo[link.carrilOrigen][link.posOrigen] = 1
			destination.arreglo[link.carrilDestino][link.posDestino] = 0
			const transferred = link.transferir()
			return { transferred, source: source.arreglo[link.carrilOrigen][link.posOrigen], destination: destination.arreglo[link.carrilDestino][link.posDestino] }
		}, { sourceId: source.id, destinationId: target.id })
		assert.equal(transferResult.transferred, true)
		assert.equal(transferResult.source, 0)
		assert.equal(transferResult.destination, 1)
		const probabilityTransfer = await page.evaluate(({ sourceId, destinationId }) => {
			const link = window.conexiones.find(item => item.origen.id === sourceId && item.destino.id === destinationId && item.tipo === window.TIPOS_CONEXION.PROBABILISTICA && item.probabilidadTransferencia === 0.8)
			const source = link.origen.arreglo[link.carrilOrigen]
			const destination = link.destino.arreglo[link.carrilDestino]
			source[link.posOrigen] = 1
			destination[link.posDestino] = 0
			const random = Math.random
			try {
				Math.random = () => 0.9
				const skipped = link.transferir()
				Math.random = () => 0.1
				const moved = link.transferir()
				return { skipped, moved, source: source[link.posOrigen], destination: destination[link.posDestino] }
			} finally { Math.random = random }
		}, { sourceId: source.id, destinationId: target.id })
		assert.deepEqual(probabilityTransfer, { skipped: false, moved: true, source: 0, destination: 1 }, "each probabilistic exit uses its own chance")
		// The application step visits registered connections in array order. Wrap
		// transferir to record the order and return false, avoiding random traffic effects.
		const stepOrder = await page.evaluate(() => {
			const links = [...window.conexiones]
			const calls = []
			const original = window.ConexionCA.prototype.transferir
			window.ConexionCA.prototype.transferir = function () { calls.push(window.conexiones.indexOf(this)); return false }
			try { document.getElementById("btnPaso").click() } finally { window.ConexionCA.prototype.transferir = original }
			return { expected: links.map((_, index) => index), calls }
		})
		assert.deepEqual(stepOrder.calls, stepOrder.expected, "explicit simulation step transfers connections in saved order")
		console.log(`✅ connection types, editing, validation and transfer (${usePixi ? "Pixi" : "Canvas"})`)
	} finally {
		await sim.close()
	}
}
