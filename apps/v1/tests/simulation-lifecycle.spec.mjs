import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

describe.each([
	["Canvas", false],
	["Pixi", true],
])("simulation lifecycle in %s", (renderer, usePixi) => {
	let sim

	beforeAll(async () => {
		sim = await openSimulator({ seed: 73, usePixi, freezeFrames: true })
		if (usePixi) await sim.page.waitForFunction(() => !!window.pixiApp?.sceneManager, { polling: 100, timeout: 30000 })
	}, 180000)
	afterAll(async () => sim?.close())

	it("keeps the active simulation intact when starting a new one is cancelled", async () => {
		const result = await sim.page.evaluate(() => {
			const street = window.calles.find((item) => item.tipo === "conexion" && item.arreglo[0]?.length > 2)
			street.arreglo[0][1] = 2
			const scenarioKey = `${street.id}:0:2`
			window.estadoEscenarios.celdasBloqueadas.set(scenarioKey, { tipo: "bloqueo" })
			const before = {
				streets: window.calles.length,
				vehicles: street.arreglo[0][1],
				scenario: window.estadoEscenarios.celdasBloqueadas.has(scenarioKey),
				clock: { ...window.configuracionTiempo },
				metrics: JSON.stringify(window.datosMetricas ?? window.metricas ?? null),
			}
			window.confirm = () => false
			document.getElementById("btnNuevaSimulacion").click()
			return {
				before,
				after: {
					streets: window.calles.length,
					vehicles: street.arreglo[0][1],
					scenario: window.estadoEscenarios.celdasBloqueadas.has(scenarioKey),
					clock: { ...window.configuracionTiempo },
					metrics: JSON.stringify(window.datosMetricas ?? window.metricas ?? null),
				},
			}
		})
		expect(result.after).toEqual(result.before)
		expect(sim.pageErrors).toEqual([])
	}, 180000)

	it("resets displayed and exported simulation state when a new simulation is accepted", async () => {
		const result = await sim.page.evaluate(async () => {
			const click = (id) => document.getElementById(id).click()
			click("btnPauseResume")
			for (let i = 0; i < 12; i++) click("btnPaso")
			const generationBefore = Number(document.getElementById("infoGeneration").textContent)
			const populationBefore = Number(document.getElementById("infoPopulation").textContent)
			if (generationBefore === 0) throw new Error("setup failed: deterministic steps did not advance generation")
			const street = window.calles.find((item) => item.tipo === "conexion" && item.arreglo[0]?.length > 2)
			const scenarioKey = `${street.id}:0:2`
			window.estadoEscenarios.celdasBloqueadas.set(scenarioKey, { tipo: "bloqueo" })
			const originalClick = HTMLAnchorElement.prototype.click
			const originalCreateObjectURL = URL.createObjectURL
			let exportedBlob = null
			HTMLAnchorElement.prototype.click = () => {}
			URL.createObjectURL = (blob) => { exportedBlob = blob; return originalCreateObjectURL(blob) }
			window.descargarMetricasJSON()
			const exportedBefore = exportedBlob ? JSON.parse(await exportedBlob.text()).metrics.timestamps.length : 0
			window.confirm = () => true
			window.nuevaSimulacion()
			exportedBlob = null
			window.descargarMetricasJSON()
			const exportedAfter = exportedBlob
			HTMLAnchorElement.prototype.click = originalClick
			URL.createObjectURL = originalCreateObjectURL
			return {
				generationBefore,
				populationBefore,
				generationAfter: Number(document.getElementById("infoGeneration").textContent),
				populationAfter: Number(document.getElementById("infoPopulation").textContent),
				fpsAfter: Number(document.getElementById("infoFPS").textContent),
				scenarioCleared: !window.estadoEscenarios.celdasBloqueadas.has(scenarioKey),
				exportedBefore,
				exportedAfter,
			}
		})
		expect(result.generationBefore).toBeGreaterThan(0)
		expect(result.populationBefore).toBeGreaterThanOrEqual(0)
		expect(result.generationAfter).toBe(0)
		expect(result.populationAfter).toBe(0)
		expect(result.fpsAfter).toBe(0)
		expect(result.scenarioCleared).toBe(true)
		expect(result.exportedBefore).toBeGreaterThan(0)
		expect(result.exportedAfter).toBeNull()
	}, 180000)

	it("loads only the saved map and clock, with fresh generation and connections", async () => {
		await sim.page.evaluate(() => {
			for (let i = 0; i < 12; i++) document.getElementById("btnPaso").click()
			window.estadoEscenarios.celdasBloqueadas.set("old-road:0:0", { tipo: "bloqueo" })
			window.confirm = () => true
			window.alert = () => {}
			const roads = ["Source", "Destination"].map((nombre, index) => ({
				nombre, tamano: 6, tipo: "CONEXION", x: 40 + index * 100, y: 40,
				angulo: 0, probabilidadGeneracion: 0, carriles: 1, probabilidadSaltoDeCarril: 0.05,
			}))
			const saved = {
				nombre: "Saved map", calles: roads,
				conexiones: [{ origenIdx: 0, destinoIdx: 1, tipo: "LINEAL", detalles: [
					{ carrilOrigen: 0, carrilDestino: 0, posOrigen: 5, posDestino: 0, probabilidad: 1 },
				] }],
				edificios: [], configuracionTiempo: {
					activo: true, diaActual: 2, horaActual: 13, minutoActual: 27, segundoActual: 0, usarPerfiles: true,
				},
			}
			window.cargarSimulacion({ target: { files: [new File([JSON.stringify(saved)], "saved.json")], value: "" } })
		})
		try {
			await sim.page.waitForFunction(() => window.calles.length === 2 && window.conexiones.length === 1, { polling: 100, timeout: 5000 })
		} catch (error) {
			const state = await sim.page.evaluate(() => ({ calles: window.calles.length, conexiones: window.conexiones.length, generation: document.getElementById('infoGeneration').textContent }))
			throw new Error(`Load did not complete: ${JSON.stringify({ state, pageErrors: sim.pageErrors, consoleErrors: sim.consoleErrors })}`, { cause: error })
		}
		const result = await sim.page.evaluate(() => ({
			generation: document.getElementById("infoGeneration").textContent,
			population: document.getElementById("infoPopulation").textContent,
			scenarioCount: window.estadoEscenarios.celdasBloqueadas.size,
			streets: window.calles.map((calle) => calle.nombre),
			connectionMatches: window.conexiones[0].origen === window.calles[0] && window.conexiones[0].destino === window.calles[1],
			clock: { day: window.configuracionTiempo.diaActual, hour: window.configuracionTiempo.horaActual, minute: window.configuracionTiempo.minutoActual },
			clockLabel: document.getElementById("infoSimulatedDateTime").textContent,
			pixiStreets: window.USE_PIXI ? window.pixiApp.sceneManager.calleSprites.size : null,
		}))
		expect(result.generation).toBe("0")
		expect(result.population).toBe("0")
		expect(result.scenarioCount).toBe(0)
		expect(result.streets).toEqual(["Source", "Destination"])
		expect(result.connectionMatches).toBe(true)
		expect(result.clock).toEqual({ day: 2, hour: 13, minute: 27 })
		expect(result.clockLabel).toBe(await sim.page.evaluate(() => window.obtenerTimestampVirtual()))
		if (usePixi) expect(result.pixiStreets).toBe(2)
		await sim.page.evaluate(() => document.getElementById("btnPaso").click())
		expect(await sim.page.$eval("#infoGeneration", (element) => element.textContent)).toBe("1")
		expect(sim.pageErrors).toEqual([])
	}, 180000)

	it("does not replace the loaded map when loading is cancelled", async () => {
		const before = await sim.page.evaluate(() => ({
			streets: window.calles.map((calle) => calle.nombre),
			generation: document.getElementById("infoGeneration").textContent,
			clock: window.obtenerTimestampVirtual(),
		}))
		await sim.page.evaluate(() => {
			window.__loadConfirmationSeen = false
			window.confirm = () => { window.__loadConfirmationSeen = true; return false }
			window.cargarSimulacion({ target: { files: [new File(['{"nombre":"Other","calles":[]}'], "other.json")], value: "" } })
		})
		await sim.page.waitForFunction(() => window.__loadConfirmationSeen, { polling: 100, timeout: 5000 })
		const after = await sim.page.evaluate(() => ({
			streets: window.calles.map((calle) => calle.nombre),
			generation: document.getElementById("infoGeneration").textContent,
			clock: window.obtenerTimestampVirtual(),
		}))
		expect(after).toEqual(before)
	}, 180000)

	it("does not resurrect connections from a load replaced before its deferred work completes", async () => {
		await sim.page.evaluate(() => {
			window.confirm = () => true
			window.alert = () => {}
			const road = (nombre, x) => ({ nombre, tamano: 6, tipo: "CONEXION", x, y: 0, angulo: 0,
				probabilidadGeneracion: 0, carriles: 1, probabilidadSaltoDeCarril: 0.05 })
			const saved = { nombre: "Soon replaced", calles: [road("A", 0), road("B", 100)], conexiones: [
				{ origenIdx: 0, destinoIdx: 1, tipo: "LINEAL", detalles: [
					{ carrilOrigen: 0, carrilDestino: 0, posOrigen: 5, posDestino: 0, probabilidad: 1 },
				] },
			] }
			window.cargarSimulacion({ target: { files: [new File([JSON.stringify(saved)], "stale.json")], value: "" } })
		})
		await sim.page.waitForFunction(() => window.calles.some((calle) => calle.nombre === "A"), { polling: 10, timeout: 5000 })
		const result = await sim.page.evaluate(async () => {
			window.nuevaSimulacion()
			await new Promise((resolve) => setTimeout(resolve, 200))
			return { streets: window.calles.length, connections: window.conexiones.length,
				generation: document.getElementById("infoGeneration").textContent }
		})
		expect(result).toEqual({ streets: 0, connections: 0, generation: "0" })
	}, 180000)

	it("renders a loaded map that has no connections", async () => {
		await sim.page.evaluate(() => {
			window.confirm = () => true
			window.alert = () => {}
			const saved = { nombre: "One road", calles: [{ nombre: "Solo", tamano: 5, tipo: "CONEXION", x: 0, y: 0,
				angulo: 0, probabilidadGeneracion: 0, carriles: 1, probabilidadSaltoDeCarril: 0.05 }], conexiones: [] }
			window.cargarSimulacion({ target: { files: [new File([JSON.stringify(saved)], "solo.json")], value: "" } })
		})
		await sim.page.waitForFunction(() => window.calles.length === 1, { polling: 100, timeout: 5000 })
		await sim.page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)))
		const result = await sim.page.evaluate(() => ({
			street: window.calles[0].nombre, connections: window.conexiones.length,
			generation: document.getElementById("infoGeneration").textContent,
			pixiStreets: window.USE_PIXI ? window.pixiApp.sceneManager.calleSprites.size : null,
		}))
		expect(result.street).toBe("Solo")
		expect(result.connections).toBe(0)
		expect(result.generation).toBe("0")
		if (usePixi) expect(result.pixiStreets).toBe(1)
	}, 180000)
})
