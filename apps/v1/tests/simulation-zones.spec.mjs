import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

describe.each([
	["Canvas", false],
	["Pixi", true],
])("zone cleanup in %s", (_, usePixi) => {
	let sim

	beforeEach(async () => {
		sim = await openSimulator({ usePixi, freezeFrames: true })
		if (usePixi) await sim.page.waitForFunction(() => !!window.pixiApp?.sceneManager, { polling: 100, timeout: 30000 })
	}, 180000)
	afterEach(async () => sim?.close())

	it("removes the current map's zones when starting a new simulation", async () => {
		const result = await sim.page.evaluate(() => {
			const before = window.backgroundAreas.length
			window.confirm = () => true
			window.alert = () => {}
			document.getElementById("btnNuevaSimulacion").click()
			return {
				before,
				after: window.backgroundAreas.length,
				streets: window.calles.length,
				pixiZones: window.USE_PIXI ? window.pixiApp.sceneManager.backgroundAreaRenderer.backgroundAreas.size : null,
			}
		})
		expect(result.before).toBeGreaterThan(0)
		expect(result.after).toBe(0)
		expect(result.streets).toBe(0)
		if (usePixi) expect(result.pixiZones).toBe(0)
	}, 180000)

	it("removes the old map's zones when loading a simulation", async () => {
		const initialZones = await sim.page.evaluate(() => window.backgroundAreas.length)
		expect(initialZones).toBeGreaterThan(0)
		await sim.page.evaluate(() => {
			window.confirm = () => true
			window.alert = () => {}
			const saved = { nombre: "Empty replacement", calles: [], conexiones: [], edificios: [] }
			window.cargarSimulacion({ target: { files: [new File([JSON.stringify(saved)], "empty.json")], value: "" } })
		})
		await sim.page.waitForFunction(() => window.simulacionActual?.nombre === "Empty replacement", { polling: 100, timeout: 5000 })
		await sim.page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)))
		const result = await sim.page.evaluate(() => ({
			zones: window.backgroundAreas.length,
			streets: window.calles.length,
			pixiZones: window.USE_PIXI ? window.pixiApp.sceneManager.backgroundAreaRenderer.backgroundAreas.size : null,
		}))
		expect(result.zones).toBe(0)
		expect(result.streets).toBe(0)
		if (usePixi) expect(result.pixiZones).toBe(0)
	}, 180000)

	it("keeps zones when New or Load is cancelled", async () => {
		const before = await sim.page.evaluate(() => ({ zones: window.backgroundAreas.length,
			pixiZones: window.USE_PIXI ? window.pixiApp.sceneManager.backgroundAreaRenderer.backgroundAreas.size : null }))
		await sim.page.evaluate(() => {
			window.__zoneCancelCount = 0
			window.confirm = () => { window.__zoneCancelCount++; return false }
			window.nuevaSimulacion()
			window.cargarSimulacion({ target: { files: [new File(['{"calles":[]}'], "empty.json")], value: "" } })
		})
		await sim.page.waitForFunction(() => window.__zoneCancelCount === 2, { polling: 100, timeout: 5000 })
		const after = await sim.page.evaluate(() => ({ zones: window.backgroundAreas.length,
			pixiZones: window.USE_PIXI ? window.pixiApp.sceneManager.backgroundAreaRenderer.backgroundAreas.size : null }))
		expect(before.zones).toBeGreaterThan(0)
		expect(after).toEqual(before)
	}, 180000)
})
