import { afterAll, beforeAll, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

let sim

beforeAll(async () => {
	sim = await openSimulator({ usePixi: false })
}, 180000)

afterAll(async () => {
	await sim?.close()
})

it("sorts names alphabetically without mutating the source or losing duplicate indexes", async () => {
	const result = await sim.page.evaluate(() => {
		const streets = [{ nombre: "Zeta" }, { nombre: "Álamo" }, { nombre: "Alamo" }, { nombre: "Beta" }]
		const entries = window.streetListUI.sortedEntries(streets)
		return { indexes: entries.map(({ index }) => index), source: streets.map(({ nombre }) => nombre) }
	})
	expect(result.indexes).toEqual([1, 2, 3, 0])
	expect(result.source).toEqual(["Zeta", "Álamo", "Alamo", "Beta"])
}, 180000)

it("sorts street choices without changing street indexes or the simulation order", async () => {
	const result = await sim.page.evaluate(() => {
		const original = window.calles.slice()
		const sorted = window.streetListUI.sortedEntries(window.calles)
		const selected = document.getElementById("selectCalle")
		const editor = document.getElementById("selectCalleEditor")
		const values = (select) => [...select.options].filter((option) => option.value !== "").map((option) => option.value)
		return {
			sourceUnchanged: original.every((street, index) => window.calles[index] === street),
			expected: sorted.map(({ index }) => String(index)),
			main: values(selected),
			editor: values(editor),
			searchInputs: document.querySelectorAll('input[type="search"]').length,
		}
	})
	expect(result.sourceUnchanged).toBe(true)
	expect(result.main).toEqual(result.expected)
	expect(result.editor).toEqual(result.expected)
	expect(result.searchInputs).toBe(0)
}, 180000)

it("sorts map-first connection and parking street choices", async () => {
	const result = await sim.page.evaluate(() => {
		document.getElementById("createLinkButton").click()
		window.agregarParConexion()
		const parking = document.querySelector(".par-conexion:last-child")
		const selects = [
			document.getElementById("linkSourceStreet"),
			document.getElementById("linkDestinationStreet"),
			parking.querySelector('[id$="_entrada_calle"]'),
			parking.querySelector('[id$="_salida_calle"]'),
		]
		const names = window.streetListUI.sortedEntries(window.calles).map(({ street }) => street.nombre)
		return selects.map((select) => ({
			searched: select.nextElementSibling?.type === "search",
			values: [...select.options].filter((option) => option.value !== "").map((option) => option.value),
			expected: window.streetListUI.sortedEntries(window.calles).map(({ street }) => String(select.id.startsWith("link") ? street.id : street.id || street.nombre)),
			count: names.length,
		}))
	})
	for (const select of result) {
		expect(select.searched).toBe(false)
		expect(select.values).toEqual(select.expected)
		expect(select.values.length).toBe(select.count)
	}
}, 180000)

it("sorts legacy connection street choices while keeping original index values", async () => {
	const result = await sim.page.evaluate(() => {
		document.getElementById("btnAgregarConexion").click()
		const selects = ["selectCalleOrigen", "selectCalleDestino"].map((id) => document.getElementById(id))
		return selects.map((select) => ({
			values: [...select.options].filter((option) => option.value !== "").map((option) => option.value),
			expected: window.streetListUI.sortedEntries(window.calles).map(({ index }) => String(index)),
			searched: select.nextElementSibling?.type === "search",
		}))
	})
	for (const select of result) {
		expect(select.values).toEqual(select.expected)
		expect(select.searched).toBe(false)
	}
}, 180000)

it("sorts the metrics checklist without losing checkbox identity or state", async () => {
	const result = await sim.page.evaluate(() => {
		document.getElementById("btnConfigCallesMetricas").click()
		const list = document.getElementById("listaCallesMetricas")
		const rows = [...list.querySelectorAll(".form-check")]
		const first = rows[0].querySelector("input[type=checkbox]")
		const original = first.checked
		first.click()
		const expected = window.streetListUI.sortedEntries(window.calles).map(({ index }) => String(index))
		const actual = rows.map((row) => row.querySelector("input").dataset.calleIdx)
		return { hasSearch: Boolean(document.getElementById("buscarCallesMetricas")), expected, actual, toggled: first.checked !== original }
	})
	expect(result.actual).toEqual(result.expected)
	expect(result.hasSearch).toBe(false)
	expect(result.toggled).toBe(true)
	expect(sim.pageErrors.filter((error) => error.includes("search is not defined"))).toEqual([])
}, 180000)
