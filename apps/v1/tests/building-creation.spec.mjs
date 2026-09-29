import { afterAll, beforeAll, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

let sim

beforeAll(async () => {
	sim = await openSimulator({ usePixi: false, freezeFrames: false })
	await sim.page.evaluate(() => {
		window.hideLoadingScreen?.()
		window.confirm = () => true
		window.alert = () => {}
		document.getElementById("btnNuevaSimulacion").click()
	})
	await sim.page.waitForFunction(() => window.edificios.length === 0 && getComputedStyle(document.getElementById("loadingScreen")).display === "none")
}, 180000)

afterAll(async () => {
	await sim?.close()
})

async function draw(from, to) {
	await sim.page.$eval("#btnAgregarEdificio", button => button.click())
	await sim.page.mouse.move(from.x, from.y)
	await sim.page.mouse.down()
	await sim.page.mouse.move(to.x, to.y, { steps: 4 })
	await sim.page.mouse.up()
}

it("creates exactly one building per completed map gesture", async () => {
	const box = await (await sim.page.$("#simuladorCanvas")).boundingBox()
	const start = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.35 }

	await sim.page.$eval("#btnAgregarEdificio", button => button.click())
	await sim.page.keyboard.press("Escape")
	expect(await sim.page.evaluate(() => window.edificios.length)).toBe(0)

	await draw(start, { x: start.x + 80, y: start.y + 45 })
	expect(await sim.page.evaluate(() => window.edificios.length)).toBe(1)
	await sim.page.$eval("#buildingInspectorName", input => {
		input.value = "Regression first"
		input.dispatchEvent(new Event("input", { bubbles: true }))
	})

	await draw({ x: start.x + 140, y: start.y + 100 }, { x: start.x + 235, y: start.y + 160 })
	await sim.page.$eval("#buildingInspectorName", input => {
		input.value = "Regression second"
		input.dispatchEvent(new Event("input", { bubbles: true }))
	})

	const result = await sim.page.evaluate(() => ({
		count: window.edificios.length,
		labels: window.edificios.map(building => building.label),
		selectorLabels: [...document.getElementById("selectEdificio").options].slice(1).map(option => option.textContent).sort(),
	}))
	expect(result).toEqual({
		count: 2,
		labels: ["Regression first", "Regression second"],
		selectorLabels: ["Regression first", "Regression second"],
	})
}, 180000)
