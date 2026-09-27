import { afterAll, beforeAll, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

let sim

beforeAll(async () => {
	sim = await openSimulator({ usePixi: false })
}, 180000)

afterAll(async () => {
	await sim?.close()
})

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
		}
	})
	expect(result.sourceUnchanged).toBe(true)
	expect(result.main).toEqual(result.expected)
	expect(result.editor).toEqual(result.expected)
}, 180000)

it("filters a street dropdown without changing its selected street", async () => {
	const result = await sim.page.evaluate(() => {
		const select = document.getElementById("selectCalle")
		const input = select.nextElementSibling
		const original = [...select.options].filter((option) => option.value !== "")
		const target = original.find((option) => option.textContent.trim().length > 3)
		select.value = target.value
		select.dispatchEvent(new Event("change", { bubbles: true }))
		input.value = "__missing_street__"
		input.dispatchEvent(new Event("input", { bubbles: true }))
		const filtered = [...select.options].filter((option) => option.value !== "" && !option.hidden).map((option) => option.value)
		const preserved = select.value
		input.value = ""
		input.dispatchEvent(new Event("input", { bubbles: true }))
		return { hasInput: input?.type === "search", filtered, preserved, restored: [...select.options].filter((option) => option.value !== "" && !option.hidden).length === original.length }
	})
	expect(result.hasInput).toBe(true)
	expect(result.filtered).toEqual([result.preserved])
	expect(result.restored).toBe(true)
}, 180000)

it("sorts map-first connection and parking street choices with searchable inputs", async () => {
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
		expect(select.searched).toBe(true)
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
		expect(select.searched).toBe(true)
	}
}, 180000)

it("filters the sorted metrics checklist without losing checkbox identity or state", async () => {
	const result = await sim.page.evaluate(() => {
		document.getElementById("btnConfigCallesMetricas").click()
		const list = document.getElementById("listaCallesMetricas")
		const search = document.getElementById("buscarCallesMetricas")
		const rows = [...list.querySelectorAll(".form-check")]
		const first = rows[0].querySelector("input[type=checkbox]")
		const original = first.checked
		first.click()
		search.value = "__missing_street__"
		search.dispatchEvent(new Event("input", { bubbles: true }))
		const allHidden = rows.every((row) => row.hidden)
		search.value = ""
		search.dispatchEvent(new Event("input", { bubbles: true }))
		const expected = window.streetListUI.sortedEntries(window.calles).map(({ index }) => String(index))
		const actual = rows.map((row) => row.querySelector("input").dataset.calleIdx)
		return { allHidden, expected, actual, toggled: first.checked !== original, visible: rows.every((row) => !row.hidden) }
	})
	expect(result.actual).toEqual(result.expected)
	expect(result.allHidden).toBe(true)
	expect(result.visible).toBe(true)
	expect(result.toggled).toBe(true)
}, 180000)
