import { writeFile } from "node:fs/promises"
import {
	driveDeterministicTraffic,
	hashOcupacion,
	openSimulator,
	readScenarioInvariants,
} from "../helpers/simulator.mjs"
import { BASELINE_FILE_URL, LOAD_SEED, TRAFFIC_SEED, TRAFFIC_STEPS } from "./config.mjs"

const sim = await openSimulator({ seed: LOAD_SEED, usePixi: false, freezeFrames: true })
try {
	const scenario = await readScenarioInvariants(sim.page)
	const traffic = await driveDeterministicTraffic(sim.page, {
		seed: TRAFFIC_SEED,
		steps: TRAFFIC_STEPS,
	})
	const baseline = {
		generatedAt: new Date().toISOString(),
		engine: { loadSeed: LOAD_SEED, trafficSeed: TRAFFIC_SEED, steps: TRAFFIC_STEPS },
		scenario,
		traffic: {
			...traffic,
			ocupacion: undefined,
			hashOcupacion: hashOcupacion(traffic.ocupacion),
		},
		errors: { pageErrors: sim.pageErrors, consoleErrors: sim.consoleErrors },
	}
	await writeFile(new URL(BASELINE_FILE_URL), `${JSON.stringify(baseline, null, 2)}\n`)
	console.log("✅ Baseline grabado en tests/baseline/baseline.json")
	console.log(
		`   calles=${scenario.callesTotales} conexiones=${scenario.conexionesTotales} curvas=${scenario.callesCurvas.length} vehiculos=${traffic.vehiculosTotales}`,
	)
} finally {
	await sim.close()
}
