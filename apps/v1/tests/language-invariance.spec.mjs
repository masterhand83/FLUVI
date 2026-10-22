import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import {
	driveDeterministicTraffic,
	hashOcupacion,
	openSimulator,
	readScenarioInvariants,
} from "./helpers/simulator.mjs"
import {
	BASELINE_FILE_URL,
	LOAD_SEED,
	TRAFFIC_SEED,
	TRAFFIC_STEPS,
} from "./baseline/config.mjs"

const baseline = JSON.parse(await readFile(new URL(BASELINE_FILE_URL), "utf8"))

async function runSeededWorkflow(language) {
	const simulator = await openSimulator({
		seed: LOAD_SEED,
		usePixi: false,
		freezeFrames: true,
		languagePreference: language,
	})
	try {
		const scenario = await readScenarioInvariants(simulator.page)
		const traffic = await driveDeterministicTraffic(simulator.page, {
			seed: TRAFFIC_SEED,
			steps: TRAFFIC_STEPS,
		})
		return {
			language: await simulator.page.evaluate(
				() => document.documentElement.lang,
			),
			scenario,
			traffic: {
				...traffic,
				ocupacion: undefined,
				hashOcupacion: hashOcupacion(traffic.ocupacion),
			},
			pageErrors: simulator.pageErrors,
			consoleErrors: simulator.consoleErrors,
		}
	} finally {
		await simulator.close()
	}
}

describe("interface language independence", () => {
	it("produces identical seeded simulation results in Spanish and English", async () => {
		const spanish = await runSeededWorkflow("es")
		const english = await runSeededWorkflow("en")

		expect(spanish.language).toBe("es")
		expect(english.language).toBe("en")
		expect(spanish.scenario).toEqual(baseline.scenario)
		expect(english.scenario).toEqual(baseline.scenario)
		expect(spanish.traffic).toEqual(baseline.traffic)
		expect(english.traffic).toEqual(baseline.traffic)
		expect(spanish.traffic).toEqual(english.traffic)
		expect(spanish.pageErrors).toEqual([])
		expect(spanish.consoleErrors).toEqual([])
		expect(english.pageErrors).toEqual([])
		expect(english.consoleErrors).toEqual([])
	}, 180000)
})
