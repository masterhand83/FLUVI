import { expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

it("saves and restores background zones and clears them on New", async () => {
	const sim = await openSimulator()
	try {
		const saved = await sim.page.evaluate(async () => {
			window.prompt = () => "Zones"
			let blob
			URL.createObjectURL = value => { blob = value; return "blob:zones" }
			HTMLAnchorElement.prototype.click = () => {}
			window.guardarSimulacion()
			return JSON.parse(await blob.text())
		})
		expect(saved.backgroundAreas).toHaveLength(1)
		expect(saved.backgroundAreas[0].label).toBe("Área IPN/Politécnico")
		await sim.page.evaluate(data => {
			window.confirm = () => true
			window.nuevaSimulacion()
			window.cargarSimulacion({ target: { files: [new File([JSON.stringify(data)], "zones.json")], value: "" } })
		}, { ...saved, edificios: [] })
		await sim.page.waitForFunction(() => window.backgroundAreas.length === 1)
		expect(await sim.page.evaluate(() => window.backgroundAreas[0].vertices[0])).toEqual({ x: 848, y: 1089 })
		await sim.page.evaluate(() => window.nuevaSimulacion())
		expect(await sim.page.evaluate(() => window.backgroundAreas.length)).toBe(0)
	} finally {
		await sim.close()
	}
})
