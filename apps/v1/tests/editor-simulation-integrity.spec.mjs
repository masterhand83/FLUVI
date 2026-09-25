import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

describe.each([
	["Canvas", false],
	["Pixi", true],
])("Calle mutations in %s", (_mode, usePixi) => {
	let sim

	beforeAll(async () => {
		sim = await openSimulator({ seed: 41, usePixi, freezeFrames: true })
		if (usePixi) await sim.page.waitForFunction(() => !!window.pixiApp?.sceneManager, { polling: 100, timeout: 30000 })
	}, 180000)
	afterAll(async () => sim?.close())

	it("retains in-bounds state on UI resize and clears incident references on UI delete", async () => {
		const result = await sim.page.evaluate(() => {
			const street = window.calles.find(c => c.tipo === "conexion" && !c.esCurva && c.tamano >= 20 && c.carriles >= 2)
			const other = window.calles.find(c => c !== street && c.tamano >= 20)
			const existingOther = other.arreglo[0][0]
			const valid = { origen: street, destino: other, carrilOrigen: 0, posOrigen: -1, carrilDestino: 0, posDestino: 0, tipo: "lineal" }
			const invalid = { ...valid, carrilOrigen: 1, posOrigen: 19 }
			const incoming = { origen: other, destino: street, carrilOrigen: 0, posOrigen: 6, carrilDestino: 0, posDestino: 2, tipo: "lineal" }
			window.conexiones.push(valid, invalid, incoming)
			street.conexionesSalida[0].push(valid)
			street.conexionesSalida[1].push(invalid)
			other.conexionesSalida[0].push(incoming)
			other.celulasEsperando[0][6] = true
			street.arreglo[0][1] = 2
			street.arreglo[1][1] = 3
			street.arreglo[0][19] = 4
			const building = { id: "integrity-building", esEstacionamiento: true, vehiculosActuales: 7, capacidadMaxima: 20, probabilidadesEntrada: Array(24).fill(0), probabilidadesSalida: Array(24).fill(0), conexiones: [
				{ tipo: "entrada", calleId: street.id, carril: 0, indice: 2 },
				{ tipo: "entrada", calleId: street.id, carril: 1, indice: 19 },
				{ tipo: "entrada", calleId: other.id, carril: 0, indice: 4 },
				{ tipo: "salida", calleId: other.id, carril: 0, indice: 2 },
				{ tipo: "salida", calleId: other.id, carril: 0, indice: 3 },
				{ tipo: "salida", calleId: other.id, carril: 0, indice: 5 },
			] }
			window.edificios.push(building)
			const mark = `${street.id}:0:2`
			const lostMark = `${street.id}:1:19`
			const otherMark = `${other.id}:0:2`
			for (const key of [mark, lostMark, otherMark]) window.estadoEscenarios.celdasBloqueadas.set(key, { tipo: "bloqueo" })
			window.calleSeleccionada = street
			window.edificioSeleccionado = null
			window.confirm = () => true
			document.getElementById("inputTamanoEditar").value = "10"
			document.getElementById("inputCarrilesEditar").value = "1"
			document.getElementById("btnAplicarDimensiones").click()
			const resized = {
				occupancy: street.arreglo.length === 1 && street.arreglo[0].length === 10 && street.arreglo[0][1] === 2,
				transfer: window.conexiones.includes(valid) && window.conexiones.includes(incoming) && !window.conexiones.includes(invalid) && street.conexionesSalida.length === 1 && street.conexionesSalida[0].includes(valid),
				parking: building.conexiones.length === 4 && building.vehiculosActuales === 7 && street.conexionesEstacionamiento.has("0-2") && other.conexionesEstacionamiento.has("0-4") && other.conexionesEstacionamiento.has("0-5") && !other.conexionesEstacionamiento.has("0-3"),
				marks: window.estadoEscenarios.celdasBloqueadas.has(mark) && !window.estadoEscenarios.celdasBloqueadas.has(lostMark) && window.estadoEscenarios.celdasBloqueadas.has(otherMark),
				other: other.arreglo[0][0] === existingOther,
			}
			// Exercise the button wired to the existing deletion action.
			document.getElementById("btnEliminarObjeto").click()
			const deleted = !window.calles.includes(street) && !window.conexiones.includes(valid) &&
				!window.conexiones.some(c => c.origen === street || c.destino === street) && !other.celulasEsperando[0][6] &&
				!window.calles.some(c => c.conexionesSalida?.some(lane => lane.some(link => link.origen === street || link.destino === street))) &&
				building.conexiones.length === 2 && building.vehiculosActuales === 7 && other.conexionesEstacionamiento.has("0-4") && !other.conexionesEstacionamiento.has("0-2") &&
				!window.estadoEscenarios.celdasBloqueadas.has(mark) && window.estadoEscenarios.celdasBloqueadas.has(otherMark)
			const beforeStep = JSON.stringify(window.configuracionTiempo)
			document.getElementById("btnPauseResume").click()
			document.getElementById("btnPaso").click()
			return { resized, deleted, stepped: JSON.stringify(window.configuracionTiempo) !== beforeStep, renderer: window.USE_PIXI && window.pixiApp?.sceneManager ? "Pixi" : "Canvas", validState: window.calles.every(c => c.arreglo.length === c.carriles && c.arreglo.every(lane => lane.length === c.tamano)) && window.conexiones.every(c => window.calles.includes(c.origen) && window.calles.includes(c.destino) && c.origen.arreglo[c.carrilOrigen]?.[c.posOrigen === -1 ? c.origen.tamano - 1 : c.posOrigen] !== undefined && c.destino.arreglo[c.carrilDestino]?.[c.posDestino] !== undefined) }
		})
		expect(result).toEqual({ resized: { occupancy: true, transfer: true, parking: true, marks: true, other: true }, deleted: true, stepped: true, renderer: _mode, validState: true })
		expect(sim.pageErrors).toEqual([])
	}, 180000)
})
