import { readFile } from "node:fs/promises"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	driveDeterministicTraffic,
	hashOcupacion,
	openSimulator,
	readScenarioInvariants,
} from "../helpers/simulator.mjs"
import { BASELINE_FILE_URL, LOAD_SEED, TRAFFIC_SEED, TRAFFIC_STEPS } from "./config.mjs"

const baseline = JSON.parse(await readFile(new URL(BASELINE_FILE_URL), "utf8"))

let sim
let invariants

beforeAll(async () => {
	sim = await openSimulator({ seed: LOAD_SEED, usePixi: false, freezeFrames: true })
	invariants = await readScenarioInvariants(sim.page)
}, 180000)

afterAll(async () => {
	await sim?.close()
})

describe("línea base de comportamiento del escenario", () => {
	it("conserva cantidades y tipos de calles y conexiones", () => {
		expect(invariants.callesTotales).toBe(baseline.scenario.callesTotales)
		expect(invariants.callesPorTipo).toEqual(baseline.scenario.callesPorTipo)
		expect(invariants.conexionesTotales).toBe(baseline.scenario.conexionesTotales)
		expect(invariants.conexionesPorTipo).toEqual(baseline.scenario.conexionesPorTipo)
		expect(invariants.totalCeldas).toBe(baseline.scenario.totalCeldas)
	})

	it("conserva las calles curvas esperadas", () => {
		expect(invariants.callesCurvas).toEqual(baseline.scenario.callesCurvas)
	})

	it("conserva los límites del mapa", () => {
		expect(invariants.limitesMapa).toEqual(baseline.scenario.limitesMapa)
	})
})

describe("línea base de comportamiento de tráfico", () => {
	it("produce la misma distribución de tráfico tras pasos deterministas", async () => {
		const traffic = await driveDeterministicTraffic(sim.page, {
			seed: TRAFFIC_SEED,
			steps: TRAFFIC_STEPS,
		})
		expect(traffic.vehiculosTotales).toBe(baseline.traffic.vehiculosTotales)
		expect(traffic.callesConVehiculos).toBe(baseline.traffic.callesConVehiculos)
		expect(traffic.vehiculosPorTipo).toEqual(baseline.traffic.vehiculosPorTipo)
		expect(traffic.conteoPorCalle).toEqual(baseline.traffic.conteoPorCalle)
		expect(traffic.relojVirtual).toEqual(baseline.traffic.relojVirtual)
		expect(hashOcupacion(traffic.ocupacion)).toBe(baseline.traffic.hashOcupacion)
	}, 180000)

	it("no reporta errores de página ni de consola", async () => {
		expect(sim.pageErrors).toEqual([])
		expect(sim.consoleErrors).toEqual([])
	})
})
