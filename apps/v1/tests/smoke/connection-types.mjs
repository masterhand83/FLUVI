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
	await page.waitForSelector(type === "LINEAL" ? '[data-testid="link-lineal-summary"]' : rowsSelector)
}

async function readRows(page) {
	return page.$$eval(rowsSelector, elements => elements.map(row => Object.fromEntries(
		["source-lane", "source-cell", "destination-lane", "destination-cell", "chance"].map(key => {
			const el = row.querySelector(`[data-testid="${key}"]`)
			if (!el && key === "source-cell" && document.querySelector("#linkTypeSelect")?.value === "INCORPORACION") {
				const street = window.calles.find(item => item.id === document.querySelector("#linkSourceStreet")?.value)
				return [key, String(street?.tamano - 1)]
			}
			return [key, el ? ("value" in el ? el.value : el.textContent.trim()) : null]
		}),
	)))
}

async function setRow(page, index, key, value) {
	await page.$eval(`${rowsSelector}:nth-child(${index + 1}) [data-testid="${key}"]`, (input, next) => {
		input.value = String(next)
		input.dispatchEvent(new Event("input", { bubbles: true }))
		input.dispatchEvent(new Event("change", { bubbles: true }))
	}, value)
}

async function clickCell(page, streetId, lane, cell) {
	const point = await page.evaluate(({ streetId, lane, cell }) => {
		const street = window.calles.find(item => item.id === streetId)
		if (!street) throw new Error(`street ${streetId} disappeared`)
		const canvas = document.getElementById("simuladorCanvas")
		const rect = canvas.getBoundingClientRect()
		const world = window.obtenerCoordenadasGlobalesCelda(street, lane, cell)
		const camera = window.pixiApp?.cameraController
		const screen = camera ? camera.worldToScreen(world.x, world.y) : { x: world.x * window.escala + window.offsetX, y: world.y * window.escala + window.offsetY }
		return {
			x: rect.left + screen.x * rect.width / (camera ? window.pixiApp.app.screen.width : canvas.width),
			y: rect.top + screen.y * rect.height / (camera ? window.pixiApp.app.screen.height : canvas.height),
		}
	}, { streetId, lane, cell })
	await page.mouse.click(point.x, point.y)
}

async function pickRow(page, index, endpoint) {
	const buttons = await page.$$(`${rowsSelector} [data-testid="link-pick-${endpoint}"]`)
	assert.ok(buttons[index], `mapping row ${index} has a ${endpoint} map picker`)
	await buttons[index].click()
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
		const target = await makeStreet(page, `Issue 06 target ${usePixi}`, .70, .10, 3, 16)
		const initial = await connectionCount(page)

		// Incorporation creates an exit for every source lane. Out-of-range rows stay
		// in the draft, and Save is atomic: repair succeeds without partial links.
		await openDraft(page, source, short, "INCORPORACION")
		let rows = await readRows(page)
		assert.equal(rows.length, 3, "incorporation includes every source lane")
		assert.deepEqual(rows.map(row => Number(row["source-lane"])), [0, 1, 2])
		assert.deepEqual(rows.map(row => Number(row["destination-lane"])), [0, 0, 0])
		assert.deepEqual(rows.map(row => Number(row["destination-cell"])), [0, 1, 2], "all lanes expand to destination cells; the final cell is out of range")
		assert.equal(await page.$$eval(rowsSelector, elements => elements.filter(row => /celda origen.*última.*15/i.test(row.textContent)).length), 3, "every incorporation row visibly fixes origin at its last cell")
		assert.equal(await page.$$eval(rowsSelector, elements => elements.filter(row => row.querySelector('[data-testid="link-pick-source"], [data-phase="source"]') || [...row.querySelectorAll('[data-testid="source-cell"]')].some(el => !el.disabled && !el.readOnly && el.matches('input, select, textarea'))).length), 0, "incorporation has no origin picker or editable origin cell")
		assert.equal(await page.$eval(`${rowsSelector} [data-testid="link-pick-destination"]`, button => button.title.includes("destino") && button.getAttribute("aria-label")?.includes("destino") && button.parentElement.querySelector('[data-testid="destination-lane"]') && button.parentElement.querySelector('[data-testid="destination-cell"]') && !button.textContent.includes("Elegir")), true, "destination icon has a tooltip and sits above its destination fields")
		await pickRow(page, 1, "destination")
		await clickCell(page, source.id, 1, 5)
		assert.deepEqual((await readRows(page)).map(row => Number(row["source-cell"])), [15, 15, 15], "wrong-street pick cannot change the fixed incorporation origin")
		assert.match(await page.$eval("#linkMapPickStatus", el => el.textContent), /incorrecta|fuera|destino/i, "invalid destination pick has visible feedback")
		await clickCell(page, short.id, 1, 1)
		rows = await readRows(page)
		assert.deepEqual(rows.map(row => [Number(row["source-lane"]), Number(row["source-cell"]), Number(row["destination-lane"]), Number(row["destination-cell"])]), [[0, 15, 0, 0], [1, 15, 1, 1], [2, 15, 0, 2]], "the destination pick leaves other rows and their validation state intact")
		await page.click(ui.save)
		assert.equal(await connectionCount(page), initial, "invalid incorporation does not partially commit")
		assert.ok(await page.$(`${rowsSelector}.is-invalid`), "invalid lane is highlighted")
		await setRow(page, 2, "destination-cell", 1)
		await page.click(ui.save)
		await waitForCount(page, initial + 3)
		const incorporated = await page.evaluate(() => window.conexiones.slice(-3).map(link => ({ type: link.tipo, sourceLane: link.carrilOrigen, sourceCell: link.posOrigen, destLane: link.carrilDestino, destCell: link.posDestino })))
		assert.deepEqual(incorporated.map(link => link.type), Array(3).fill(canonicalType.INCORPORACION))
		assert.deepEqual(incorporated.map(link => [link.sourceLane, link.sourceCell, link.destLane, link.destCell]), [[0, 15, 0, 0], [1, 15, 1, 1], [2, 15, 0, 1]], "incorporation keeps fixed origins and persists the chosen destination")
		let incorporationCount = await connectionCount(page)
		await openDraft(page, source, target, "INCORPORACION")
		await pickRow(page, 0, "destination")
		await clickCell(page, target.id, 1, 5)
		await closeDraft(page)
		assert.equal(await connectionCount(page), incorporationCount, "Cancel discards picked incorporation destination")
		await openDraft(page, source, target, "INCORPORACION")
		await pickRow(page, 0, "destination")
		await page.keyboard.press("Escape")
		await page.waitForFunction(() => document.querySelector("#linkDraftPanel")?.hidden)
		assert.equal(await connectionCount(page), incorporationCount, "Escape discards armed incorporation pick")

		// A probabilistic draft starts with one 100% exit. Additional exits are
		// explicitly added and retain independent, non-normalized percentages.
		await openDraft(page, source, target, "PROBABILISTICA")
		rows = await readRows(page)
		assert.equal(rows.length, 1, "probabilistic type defaults to one exit")
		assert.equal(Number(rows[0].chance), 100)
		assert.equal(await page.$eval(rowsSelector, row => ["source", "destination"].every(phase => { const button = row.querySelector(`[data-testid="link-pick-${phase}"]`); return button?.title && button.getAttribute("aria-label") && button.parentElement.querySelector(`[data-testid="${phase}-lane"]`) && button.parentElement.querySelector(`[data-testid="${phase}-cell"]`) && !button.textContent.includes("Elegir") })), true, "both probabilistic icon pickers have tooltips and sit above their field pairs")
		await setRow(page, 0, "chance", 35)
		await page.click(ui.add)
		await page.waitForFunction(() => document.querySelectorAll('#linkMappingRows [data-testid="link-mapping-row"]').length === 2)
		assert.equal(Number((await readRows(page))[0].chance), 35, "adding an exit retains the edited first exit")
		const firstExit = (await readRows(page))[0]
		await pickRow(page, 1, "destination")
		await clickCell(page, source.id, 1, 6)
		assert.deepEqual((await readRows(page))[0], firstExit, "invalid destination pick does not touch another exit")
		assert.match(await page.$eval("#linkMapPickStatus", el => el.textContent), /incorrecta|fuera|destino/i, "wrong-street probabilistic pick has visible feedback")
		await clickCell(page, target.id, 2, 5)
		rows = await readRows(page)
		assert.deepEqual([Number(rows[1]["destination-lane"]), Number(rows[1]["destination-cell"])], [2, 5], `destination can be picked without first picking origin: ${await page.$eval("#linkMapPickStatus", el => el.textContent)}`)
		assert.deepEqual(rows[0], firstExit, "destination pick is isolated to its row")
		await pickRow(page, 1, "source")
		await clickCell(page, target.id, 2, 5)
		assert.deepEqual((await readRows(page))[1], rows[1], "wrong-street origin pick is ignored")
		await clickCell(page, source.id, 1, 6)
		rows = await readRows(page)
		assert.deepEqual([Number(rows[1]["source-lane"]), Number(rows[1]["source-cell"])], [1, 6], "source pick changes only origin of its row")
		assert.deepEqual(rows[0], firstExit, "origin pick leaves other rows untouched")
		await setRow(page, 1, "destination-cell", 3)
		assert.equal(Number((await readRows(page))[1]["destination-cell"]), 3, "manual correction remains possible after map picking")
		await setRow(page, 1, "chance", 80)
		const beforeProbSave = await connectionCount(page)
		await page.click(ui.save)
		await waitForCount(page, beforeProbSave + 2)
		const probabilistic = await page.evaluate(() => window.conexiones.slice(-2).map(link => ({ type: link.tipo, sourceLane: link.carrilOrigen, sourceCell: link.posOrigen, destLane: link.carrilDestino, destCell: link.posDestino, chance: link.probabilidadTransferencia })))
		assert.deepEqual(probabilistic.map(link => link.type), Array(2).fill(canonicalType.PROBABILISTICA))
		assert.deepEqual(probabilistic.map(link => [link.sourceLane, link.destLane, link.destCell]), [[0, 0, 0], [1, 2, 3]])
		assert.deepEqual(probabilistic.map(link => link.sourceCell), [15, 6], "picked probabilistic origin persists independently")
		assert.deepEqual(probabilistic.map(link => Math.round(link.chance * 100)), [35, 80], "chance is persisted per exit, without normalization")

		// Both dismissal paths discard an armed per-endpoint pick and all draft edits.
		let count = await connectionCount(page)
		await openDraft(page, source, target, "PROBABILISTICA")
		await pickRow(page, 0, "source")
		await clickCell(page, source.id, 2, 4)
		await pickRow(page, 0, "destination")
		await page.keyboard.press("Escape")
		await page.waitForFunction(() => document.querySelector("#linkDraftPanel")?.hidden)
		assert.equal(await connectionCount(page), count, "Escape discards probabilistic draft with a pending pick")
		await openDraft(page, source, target, "PROBABILISTICA")
		await pickRow(page, 0, "destination")
		await clickCell(page, target.id, 1, 4)
		await closeDraft(page)
		assert.equal(await connectionCount(page), count, "Cancel discards probabilistic picked destination")

		// Identical exits inside a draft and against a committed mapping are rejected;
		// non-identical shared-endpoint overlap and reverse direction remain legal.
		await openDraft(page, source, target, "PROBABILISTICA")
		await page.click(ui.add)
		await setRow(page, 1, "source-lane", 0)
		await setRow(page, 1, "destination-lane", 0)
		await setRow(page, 1, "destination-cell", 0)
		await page.click(ui.save)
		assert.equal(await connectionCount(page), count, "duplicate exits in the expanded draft are rejected atomically")
		await closeDraft(page)
		await openDraft(page, source, target, "PROBABILISTICA")
		await setRow(page, 0, "destination-cell", 999)
		await page.click(ui.save)
		assert.equal(await connectionCount(page), count, "out-of-range probabilistic mapping is rejected")
		assert.ok(await page.$(`${rowsSelector}.is-invalid`), "invalid probabilistic row stays highlighted")
		await setRow(page, 0, "destination-cell", 1)
		assert.match(await page.$eval("#linkDraftNotice", el => el.textContent), /solapamiento/i, "nonidentical shared endpoint remains informational")
		await page.click(ui.save)
		await waitForCount(page, count + 1)
		count++

		const linealSource = await makeStreet(page, `Issue 06 lineal source ${usePixi}`, .45, .20, 3, 16)
		await openDraft(page, linealSource, target, "LINEAL")
		assert.equal(await page.$$eval(rowsSelector, elements => elements.filter(row => [...row.querySelectorAll('input, select, textarea')].some(el => !el.disabled && !el.readOnly) || row.querySelector('[data-testid="link-pick-source"], [data-testid="link-pick-destination"], [data-testid="link-pick-map"]')).length), 0, "Lineal mapping cannot be edited or picked")
		await page.click(ui.save)
		await waitForCount(page, count + 3)
		count += 3
		const linealEdit = await page.evaluate(({ sourceId, targetId }) => {
			const links = window.conexiones.filter(link => link.origen.id === sourceId && link.destino.id === targetId && link.tipo === window.TIPOS_CONEXION.LINEAL)
			window.__linealSiblings = [links[0], links[2]]
			window.createLinkTool.edit(links[1])
			return links[1].carrilOrigen
		}, { sourceId: linealSource.id, targetId: target.id })
		assert.match(await page.$eval('[data-testid="link-lineal-summary"]', el => el.textContent), new RegExp(`carril ${linealEdit + 1}`))
		await page.click(ui.save)
		assert.equal(await connectionCount(page), count, "editing one fixed Lineal lane does not add its siblings again")
		assert.equal(await page.evaluate(() => window.__linealSiblings.every(link => window.conexiones.includes(link))), true, "other saved Lineal lanes remain untouched")
		await openDraft(page, target, linealSource, "LINEAL")
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
		}, { sourceId: linealSource.id, destinationId: target.id })
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
		const stepSource = await makeStreet(page, `Issue 06 step source ${usePixi}`, .75, .20, 1, 16)
		await openDraft(page, stepSource, target, "PROBABILISTICA")
		await page.click(ui.save)
		await waitForCount(page, count + 1)
		// Exercise real transfers in an explicit step. These different source
		// streets move independently; shared-source links still compete in order.
		const step = await page.evaluate(({ sourceId, shortId, targetId, stepSourceId }) => {
			const streets = [sourceId, shortId, targetId, stepSourceId].map(id => window.calles.find(street => street.id === id))
			for (const street of streets) {
				for (const lane of street.arreglo) lane.fill(0)
				for (const lane of street.celulasEsperando) lane.fill(false)
			}
			const [from, short, target, probSource] = streets
			const incorporation = window.conexiones.find(link => link.origen === from && link.destino === short && link.tipo === window.TIPOS_CONEXION.INCORPORACION && link.carrilOrigen === 2)
			const probabilistic = window.conexiones.find(link => link.origen === probSource && link.destino === target && link.tipo === window.TIPOS_CONEXION.PROBABILISTICA)
			from.arreglo[incorporation.carrilOrigen][incorporation.posOrigen] = 1
			probSource.arreglo[probabilistic.carrilOrigen][probabilistic.posOrigen] = 1
			const links = [...window.conexiones]
			const calls = [], transfers = []
			const originalTransfer = window.ConexionCA.prototype.transferir
			const originalRandom = Math.random
			window.ConexionCA.prototype.transferir = function () {
				calls.push(window.conexiones.indexOf(this))
				const moved = originalTransfer.call(this)
				if (this === incorporation || this === probabilistic) transfers.push({
					type: this.tipo, moved,
					source: this.origen.arreglo[this.carrilOrigen][this.posOrigen],
					destination: this.destino.arreglo[this.carrilDestino][this.posDestino],
				})
				return moved
			}
			try {
				Math.random = () => 0
				document.getElementById("btnPaso").click()
			} finally {
				Math.random = originalRandom
				window.ConexionCA.prototype.transferir = originalTransfer
			}
			return { expected: links.map((_, index) => index), calls, transfers }
		}, { sourceId: source.id, shortId: short.id, targetId: target.id, stepSourceId: stepSource.id })
		assert.deepEqual(step.calls, step.expected, "explicit simulation step visits saved connections in order")
		assert.deepEqual(step.transfers, [
			{ type: canonicalType.INCORPORACION, moved: true, source: 0, destination: 1 },
			{ type: canonicalType.PROBABILISTICA, moved: true, source: 0, destination: 1 },
		], "both saved link types transfer independently during a real step")
		console.log(`✅ connection types, editing, validation and transfer (${usePixi ? "Pixi" : "Canvas"})`)
	} finally {
		await sim.close()
	}
}
