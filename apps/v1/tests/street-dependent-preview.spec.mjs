import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("../src/js/ui/streetDependentPreview.js", import.meta.url), "utf8")

describe("streetDependentPreview", () => {
	function setup() {
		const street = { id: "s", nombre: "S", tamano: 8, carriles: 2, arreglo: Array.from({ length: 2 }, () => Array(8).fill(0)), celulasEsperando: Array.from({ length: 2 }, () => Array(8).fill(false)), conexionesSalida: [[], []] }
		const other = { id: "o", tamano: 8, carriles: 1, arreglo: [Array(8).fill(0)], conexionesSalida: [[]] }
		const dynamic = { origen: street, destino: other, carrilOrigen: 0, posOrigen: -1, carrilDestino: 0, posDestino: 0, tipo: "probabilistica", probabilidad: 0.4 }
		const numbered = { origen: street, destino: other, carrilOrigen: 1, posOrigen: 7, carrilDestino: 0, posDestino: 1, tipo: "lineal" }
		street.conexionesSalida = [[dynamic], [numbered]]
		const pair = [{ tipo: "entrada", calleId: "s", carril: 0, indice: 1 }, { tipo: "salida", calleId: "o", carril: 0, indice: 2 }]
		const building = { id: "b", conexiones: pair.flat(), vehiculosActuales: 4, probabilidadesEntrada: [0.2] }
		const marks = new Map([["s:0:1", {}], ["s:1:7", {}]])
		const context = { conexiones: [dynamic, numbered], calles: [street, other], edificios: [building], estadoEscenarios: { celdasBloqueadas: marks } }
		new Function("window", source)(context)
		return { ...context, street, other, dynamic, numbered, building, pair, marks }
	}

	it("inspects without mutation and keeps a dynamic last-cell mapping when its new effective index is valid", () => {
		const state = setup()
		const preview = state.streetDependentPreview.inspect(state.street, { tamano: 6, carriles: 1 })
		expect(preview.survivingConnections).toEqual([state.dynamic])
		expect(preview.lostConnections).toEqual([state.numbered])
		expect(preview.lostScenarioMarkKeys).toEqual(["s:1:7"])
		expect(state.street.tamano).toBe(8)
		expect(state.building.conexiones).toHaveLength(2)
		expect(state.marks.size).toBe(2)
	})

	it("commits pruning while preserving state, pairs and connection object identity", () => {
		const state = setup()
		state.streetDependentPreview.commit(state.street, { tamano: 6, carriles: 1 })
		expect(state.conexiones).toEqual([state.dynamic])
		expect(state.street.conexionesSalida[0]).toEqual([state.dynamic])
		expect(state.street.arreglo[0]).toHaveLength(6)
		expect(state.building.conexiones).toEqual(state.pair)
		expect(state.building.vehiculosActuales).toBe(4)
		expect(state.building.probabilidadesEntrada).toEqual([0.2])
		expect(state.marks.has("s:0:1")).toBe(true)
		expect(state.marks.has("s:1:7")).toBe(false)
	})

	it("makes a building with no surviving pairs parking-inactive without losing its occupancy", () => {
		const state = setup()
		state.building.esEstacionamiento = true
		state.building.conexiones = [
			{ tipo: "entrada", calleId: "s", carril: 1, indice: 7 },
			{ tipo: "salida", calleId: "o", carril: 0, indice: 2 },
		]
		const preview = state.streetDependentPreview.inspect(state.street, { tamano: 6, carriles: 1 })
		expect(preview.counts.lostParkingPairs).toBe(1)
		expect(state.building.esEstacionamiento).toBe(true)
		state.streetDependentPreview.commit(state.street, { tamano: 6, carriles: 1 })
		expect(state.building.conexiones).toEqual([])
		expect(state.building.esEstacionamiento).toBe(false)
		expect(state.building.vehiculosActuales).toBe(4)
	})

	it("clears a moved dynamic-last waiting flag when expanding", () => {
		const state = setup()
		state.street.celulasEsperando[0][7] = true
		state.streetDependentPreview.commit(state.street, { tamano: 10, carriles: 2 })
		expect(state.street.celulasEsperando[0][7]).toBe(false)
		expect(state.street.conexionesSalida[0]).toContain(state.dynamic)
		expect(state.dynamic.posOrigen).toBe(-1)
	})

	it("preserves indexed attachments on translation and reshape without changing their identity", () => {
		const state = setup()
		const first = { ...state.numbered, carrilOrigen: 0, posOrigen: 0 }
		state.conexiones.push(first)
		const before = state.streetDependentPreview.inspect(state.street, {
			...state.street, x: 15, y: 25, angulo: 90,
		})
		expect(before.lostConnections).toEqual([])
		expect(before.lostParkingPairs).toEqual([])
		expect(before.lostScenarioMarkKeys).toEqual([])
		state.streetDependentPreview.commit(state.street, { tamano: 8, carriles: 2 })
		expect(state.conexiones).toEqual([state.dynamic, state.numbered, first])
		expect(state.building.conexiones).toEqual(state.pair)
		expect(state.marks.size).toBe(2)
	})
})
