import { afterAll, beforeAll, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

let sim

beforeAll(async () => {
	sim = await openSimulator({ usePixi: false })
}, 180000)

afterAll(async () => {
	await sim?.close()
})

it("creates exactly one building per confirmation after reopening the creation dialog", async () => {
	const counts = await sim.page.evaluate(() => {
		const initial = window.edificios.length
		const open = () => document.getElementById("btnAgregarEdificio").click()
		const confirm = () => document.getElementById("btnConfirmarNuevoEdificio").click()
		const cancel = () => document.querySelector('#modalNuevoEdificio [data-bs-dismiss="modal"]').click()
		const fill = (name) => {
			for (const [id, value] of Object.entries({
				inputNombreEdificio: name,
				inputXEdificio: "3500",
				inputYEdificio: "3000",
				inputWidthEdificio: "60",
				inputHeightEdificio: "40",
				inputAnguloEdificio: "0",
			})) document.getElementById(id).value = value
		}
		open()
		cancel()
		open()
		cancel()
		open()
		fill("Regression first")
		confirm()
		const first = window.edificios.length - initial
		open()
		fill("Regression second")
		confirm()
		return {
			first,
			second: window.edificios.length - initial,
			labels: window.edificios.slice(initial).map((building) => building.label),
			selectorLabels: [...document.getElementById("selectEdificio").options]
				.filter((option) => Number(option.value) >= initial && option.value !== "")
				.map((option) => option.textContent),
		}
	})
	expect(counts).toEqual({
		first: 1,
		second: 2,
		labels: ["Regression first", "Regression second"],
		selectorLabels: ["Regression first", "Regression second"],
	})
}, 180000)
