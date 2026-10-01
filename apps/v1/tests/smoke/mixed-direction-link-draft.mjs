import assert from "node:assert/strict"
import { openSimulator } from "../helpers/simulator.mjs"

const rowSelector = "#linkMappingRows [data-testid='link-mapping-row']"

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 268, usePixi, freezeFrames: false })
	const { page } = sim
	try {
		if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.sceneManager)
		await page.evaluate(() => {
			document.getElementById("loadingScreen").style.display = "none"
			window.streetEditPause?.()
			const source = window.crearCalle("Draft mixed source", 6, window.TIPOS.CONEXION, -500, -500, 0, 0, 3, 0)
			const destination = window.crearCalle("Draft mixed destination", 6, window.TIPOS.CONEXION, -500, -200, 0, 0, 3, 0)
			source.laneDirections = [1, -1, 1]
			destination.laneDirections = [-1, 1, -1]
		})
		async function open(type) {
			if (!await page.$eval('#collapseMapDrawingTools', el => el.classList.contains('show'))) {
				await page.click('[data-bs-target="#collapseMapDrawingTools"]')
				await page.waitForSelector('#collapseMapDrawingTools.show', { visible: true })
			}
			await page.click("#createLinkButton")
			await page.select("#linkSourceStreet", "Draft mixed source")
			await page.select("#linkDestinationStreet", "Draft mixed destination")
			await page.select("#linkTypeSelect", type)
		}
		async function rows() {
			return page.$$eval(rowSelector, elements => elements.map(row => Object.fromEntries(
				["source-lane", "source-cell", "destination-lane", "destination-cell"].map(key => {
					const el = row.querySelector(`[data-testid='${key}']`) ?? (key === "source-cell" ? row.querySelector("[data-testid='link-fixed-source-cell']") : null)
					return [key, el?.value ?? el?.textContent ?? null]
				}),
			)))
		}
		async function set(key, value, index = 0) {
			await page.$eval(`${rowSelector}:nth-child(${index + 1}) [data-testid='${key}']`, (el, val) => {
				el.value = val
				el.dispatchEvent(new Event("input", { bubbles: true }))
			}, String(value))
		}
		const count = await page.evaluate(() => window.conexiones.length)
		await open("LINEAL")
		assert.match(await page.$eval("[data-testid='link-lineal-summary']", el => el.textContent), /carril 2: primera celda de origen \(0\).*primera celda de destino \(0\)/)
		assert.match(await page.$eval("[data-testid='link-lineal-summary']", el => el.textContent), /carril 1: última celda de origen \(5\).*última celda de destino \(5\)/)
		await page.click("#linkSaveButton")
		assert.deepEqual(await page.evaluate(() => window.conexiones.slice(-3).map(l => [l.carrilOrigen, l.posOrigen, l.carrilDestino, l.posDestino])), [[0, 5, 0, 5], [1, 0, 1, 0], [2, 5, 2, 5]])
		assert.equal(await page.evaluate(() => window.conexiones.length), count + 3)
		await page.evaluate(() => window.createLinkTool.edit(window.conexiones.at(-2)))
		assert.match(await page.$eval("[data-testid='link-lineal-summary']", el => el.textContent), /carril 2: primera celda de origen \(0\).*primera celda de destino \(0\)/)
		await page.click("#linkSaveButton")
		assert.equal(await page.evaluate(() => window.conexiones.length), count + 3)
		await page.evaluate(() => {
			const source = window.calles.find(s => s.id === "Draft mixed source")
			const destination = window.calles.find(s => s.id === "Draft mixed destination")
			const explicit = new window.ConexionCA(source, destination, 1, 1, 2, 2, 1, window.TIPOS_CONEXION.LINEAL)
			window.conexiones.push(explicit)
			window.registrarConexiones([explicit])
			window.createLinkTool.edit(explicit)
		})
		assert.match(await page.$eval("[data-testid='link-lineal-summary']", el => el.textContent), /carril 2: celda de origen \(2\).*celda de destino \(2\)/)
		await page.click("#linkSaveButton")
		assert.deepEqual(await page.evaluate(() => { const l = window.conexiones.at(-1); return [l.posOrigen, l.posDestino] }), [2, 2], "editing a saved explicit Lineal mapping does not replace it with defaults")

		await open("INCORPORACION")
		assert.deepEqual((await rows()).map(row => [Number(row["source-cell"].match(/\((\d+)\)/)?.[1]), Number(row["destination-cell"])]), [[5, 5], [0, 4], [5, 3]])
		await set("source-lane", 1)
		assert.match((await rows())[0]["source-cell"], /\(0\)/, "fixed origin follows edited physical lane")
		await page.click("#linkCancelButton")
		await page.evaluate(() => {
			const source = window.calles.find(s => s.id === "Draft mixed source")
			const destination = window.calles.find(s => s.id === "Draft mixed destination")
			const legacy = new window.ConexionCA(source, destination, 0, 1, -1, 0, 1, window.TIPOS_CONEXION.INCORPORACION)
			window.conexiones.push(legacy)
			window.registrarConexiones([legacy])
			window.createLinkTool.edit(legacy)
		})
		assert.match((await rows())[0]["source-cell"], /\(5\)/, "-1 displays as physical last")
		await page.click("#linkSaveButton")
		assert.equal(await page.evaluate(() => window.conexiones.at(-1).posOrigen), -1, "unchanged incorporation edit preserves explicit -1")

		await open("PROBABILISTICA")
		assert.deepEqual((await rows()).map(row => [Number(row["source-cell"]), Number(row["destination-cell"])]), [[5, 5]])
		await set("source-lane", 1)
		await set("source-cell", -1)
		await page.click("#linkSaveButton")
		assert.match(await page.$eval("#linkDraftMessage", el => el.textContent), /dirección incompatible/)
		assert.equal(await page.evaluate(() => window.conexiones.length), count + 5, "-1 remains physical last, not reverse exit")
		await set("source-cell", 0)
		await set("destination-cell", 0)
		await page.click("#linkSaveButton")
		assert.equal(await page.evaluate(() => window.conexiones.length), count + 5, "exact duplicate across link types remains rejected")
		await set("destination-lane", 0)
		await set("destination-cell", 0)
		await page.click("#linkSaveButton")
		assert.match(await page.$eval("#linkDraftMessage", el => el.textContent), /dirección incompatible/, "entry into a lane at its exit is rejected")
		await set("destination-lane", 0)
		await set("source-cell", 2)
		await set("destination-cell", 2)
		await page.click("#linkSaveButton")
		assert.equal(await page.evaluate(() => window.conexiones.length), count + 6, "interior taps remain allowed")
		assert.deepEqual(await page.evaluate(() => { const l = window.conexiones.at(-1); return [l.posOrigen, l.posDestino, window.isConnectionDirectionCompatible(l)] }), [2, 2, true])
		await page.evaluate(() => window.createLinkTool.edit(window.conexiones.at(-1)))
		assert.deepEqual((await rows()).map(row => [Number(row["source-cell"]), Number(row["destination-cell"])]), [[2, 2]])
		await page.click("#linkSaveButton")
		assert.deepEqual(await page.evaluate(() => { const l = window.conexiones.at(-1); return [l.posOrigen, l.posDestino] }), [2, 2])
		console.log(`mixed-direction link draft (${usePixi ? "Pixi" : "Canvas"}): passed`)
	} finally {
		await sim.close()
	}
}
