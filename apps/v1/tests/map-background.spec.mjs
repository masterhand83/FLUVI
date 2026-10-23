import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

function loadDayNightCycle() {
	const source = readFileSync(
		new URL("../src/js/renderer/DayNightCycle.js", import.meta.url),
		"utf8",
	)
	const window = {}
	runInNewContext(source, {
		window,
		console: { log() {}, warn() {}, error() {} },
	})
	return window
}

const dateAt = (hour, minute = 0) => {
	const date = new Date()
	date.setHours(hour, minute, 0, 0)
	return date
}

describe("map background color model", () => {
	it("keeps the animated sky palette as the default", () => {
		const { mapBackgroundCycle: cycle } = loadDayNightCycle()
		expect(cycle.getPreference()).toEqual({ preset: "sky", color: "#6aa0f0" })
		expect(cycle.getBackgroundColor(dateAt(12))).toBe(0x6aa0f0)
		expect(cycle.getBackgroundColor(dateAt(0))).toBe(0x12163a)
	})

	it("uses each preset base color at noon and shades it at night", () => {
		const { mapBackgroundCycle: cycle } = loadDayNightCycle()

		cycle.setBackgroundPreset("guinda")
		expect(cycle.getBackgroundColor(dateAt(12))).toBe(0x7a1f3d)
		const guindaNight = cycle.getBackgroundColor(dateAt(0))
		expect(guindaNight).not.toBe(0x7a1f3d)
		expect((guindaNight >> 16) & 0xff).toBeLessThan(0x7a)

		cycle.setBackgroundPreset("white")
		expect(cycle.getBackgroundColor(dateAt(12))).toBe(0xffffff)
		const whiteNight = cycle.getBackgroundColor(dateAt(0))
		expect(whiteNight).not.toBe(0xffffff)
		expect(whiteNight).toBeGreaterThan(0x404040)
		expect(whiteNight).toBeLessThan(0xc0c0c0)
	})

	it("accepts custom colors and round-trips the preference", () => {
		const { mapBackgroundCycle: cycle } = loadDayNightCycle()
		const state = cycle.setBackgroundPreset("custom", "#336699")
		expect(state).toEqual({ preset: "custom", color: "#336699" })
		expect(cycle.getBackgroundColor(dateAt(12))).toBe(0x336699)
		expect(cycle.toJSON()).toEqual({ preset: "custom", color: "#336699" })

		cycle.fromJSON({ preset: "grey", color: "#C6CBCD" })
		expect(cycle.getPreference()).toEqual({ preset: "grey", color: "#c6cbcd" })
	})

	it("falls back to the sky palette for unknown presets or invalid colors", () => {
		const { mapBackgroundCycle: cycle } = loadDayNightCycle()
		expect(cycle.fromJSON({ preset: "no-existe", color: "not-a-color" })).toEqual({
			preset: "sky",
			color: "#6aa0f0",
		})
		expect(cycle.fromJSON({ preset: "custom", color: "#12345" })).toEqual({
			preset: "sky",
			color: "#6aa0f0",
		})
		expect(cycle.fromJSON(null)).toEqual({ preset: "sky", color: "#6aa0f0" })
	})
})

describe.each([
	["Canvas", false],
	["Pixi", true],
])("map background customization in %s", (renderer, usePixi) => {
	let sim
	let savedBackground = null

	beforeAll(async () => {
		sim = await openSimulator({ seed: 41, usePixi, freezeFrames: true })
		if (usePixi) {
			await sim.page.waitForFunction(() => !!window.pixiApp?.sceneManager, {
				polling: 100,
				timeout: 30000,
			})
		}
	}, 180000)

	afterAll(async () => sim?.close())

	it("exposes the five presets and starts on the animated sky", async () => {
		const result = await sim.page.evaluate(() => ({
			presets: [...document.querySelectorAll("[data-map-background-preset]")].map(
				(button) => button.dataset.mapBackgroundPreset,
			),
			state: window.mapBackgroundPreference.get(),
			pressed: [
				...document.querySelectorAll(
					'[data-map-background-preset][aria-pressed="true"]',
				),
			].map((button) => button.dataset.mapBackgroundPreset),
			hasPicker: !!document.getElementById("mapBackgroundCustomColor"),
		}))
		expect(result.presets).toEqual(["blue", "guinda", "grey", "white", "sky"])
		expect(result.state).toEqual({ preset: "sky", color: "#6aa0f0" })
		expect(result.pressed).toEqual(["sky"])
		expect(result.hasPicker).toBe(true)
		expect(sim.pageErrors).toEqual([])
	})

	it("applies a preset to the active renderer and saves it in the map JSON", async () => {
		const result = await sim.page.evaluate(async () => {
			window.document.getElementById("loadingScreen").style.display = "none"

			// Captura el relleno de fondo completo del Canvas 2D durante el redibujado.
			let canvasFill = null
			const originalFillRect = CanvasRenderingContext2D.prototype.fillRect
			CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
				if (
					this.canvas.id === "simuladorCanvas" &&
					x === 0 &&
					y === 0 &&
					width === this.canvas.width &&
					height === this.canvas.height
				) {
					canvasFill = this.fillStyle
				}
				return originalFillRect.apply(this, arguments)
			}
			document.querySelector('[data-map-background-preset="guinda"]').click()
			CanvasRenderingContext2D.prototype.fillRect = originalFillRect

			const expectedColor = window.mapBackgroundCycle.getBackgroundColor()
			const rendered = window.USE_PIXI && window.pixiApp?.app?.renderer
				? window.pixiApp.app.renderer.background.color
				: canvasFill

			const originalClick = HTMLAnchorElement.prototype.click
			const originalCreateObjectURL = URL.createObjectURL
			const originalPrompt = window.prompt
			let exportedBlob = null
			HTMLAnchorElement.prototype.click = () => {}
			URL.createObjectURL = (blob) => {
				exportedBlob = blob
				return originalCreateObjectURL(blob)
			}
			window.prompt = () => "Mapa personalizado"
			window.guardarSimulacion()
			HTMLAnchorElement.prototype.click = originalClick
			URL.createObjectURL = originalCreateObjectURL
			window.prompt = originalPrompt

			const saved = JSON.parse(await exportedBlob.text())
			return {
				state: window.mapBackgroundPreference.get(),
				expectedColor,
				rendered,
				savedBackground: saved.personalizacion?.fondoMapa,
				pressed: [
					...document.querySelectorAll(
						'[data-map-background-preset][aria-pressed="true"]',
					),
				].map((button) => button.dataset.mapBackgroundPreset),
			}
		})
		expect(result.state).toEqual({ preset: "guinda", color: "#7a1f3d" })
		expect(result.pressed).toEqual(["guinda"])
		expect(result.savedBackground).toEqual({ preset: "guinda", color: "#7a1f3d" })
		expect(result.rendered).toBe(
			usePixi
				? result.expectedColor
				: `#${result.expectedColor.toString(16).padStart(6, "0")}`,
		)

		savedBackground = result.savedBackground
	})

	it("restores the saved preference when loading a map file", async () => {
		const mapJson = JSON.stringify({
			version: "1.0",
			nombre: "Mapa con fondo guinda",
			calles: [],
			conexiones: [],
			edificios: [],
			personalizacion: { fondoMapa: savedBackground },
		})
		const loaded = await sim.page.evaluate(async (jsonText) => {
			window.confirm = () => true
			window.mapBackgroundPreference.reset()
			const file = new File([jsonText], "mapa.json", {
				type: "application/json",
			})
			window.cargarSimulacion({ target: { files: [file] } })
			const deadline = Date.now() + 5000
			while (
				Date.now() < deadline &&
				window.mapBackgroundPreference.get().preset !== "guinda"
			) {
				await new Promise((resolve) => setTimeout(resolve, 50))
			}
			return {
				state: window.mapBackgroundPreference.get(),
				pressed: [
					...document.querySelectorAll(
						'[data-map-background-preset][aria-pressed="true"]',
					),
				].map((button) => button.dataset.mapBackgroundPreset),
			}
		}, mapJson)
		expect(loaded.state).toEqual({ preset: "guinda", color: "#7a1f3d" })
		expect(loaded.pressed).toEqual(["guinda"])
		expect(sim.pageErrors).toEqual([])
	})

	it("applies a custom color from the picker", async () => {
		const result = await sim.page.evaluate(() => {
			const picker = document.getElementById("mapBackgroundCustomColor")
			picker.value = "#336699"
			picker.dispatchEvent(new Event("input", { bubbles: true }))
			return {
				state: window.mapBackgroundPreference.get(),
				preview: document.getElementById("mapBackgroundPreview").style
					.backgroundColor,
				pressed: [
					...document.querySelectorAll(
						'[data-map-background-preset][aria-pressed="true"]',
					),
				].length,
			}
		})
		expect(result.state).toEqual({ preset: "custom", color: "#336699" })
		expect(result.pressed).toBe(0)
		expect(result.preview).not.toBe("")
	})

	it("resets to the animated sky on a new simulation", async () => {
		const state = await sim.page.evaluate(() => {
			window.confirm = () => true
			window.nuevaSimulacion()
			return {
				state: window.mapBackgroundPreference.get(),
				pressed: [
					...document.querySelectorAll(
						'[data-map-background-preset][aria-pressed="true"]',
					),
				].map((button) => button.dataset.mapBackgroundPreset),
			}
		})
		expect(state.state).toEqual({ preset: "sky", color: "#6aa0f0" })
		expect(state.pressed).toEqual(["sky"])
	})
})
