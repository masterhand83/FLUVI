import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"
import { readFileSync } from "node:fs"

const originalDrawing = readFileSync(new URL("./fixtures/road-surface-before.js.txt", import.meta.url), "utf8")

describe("Canvas road surfaces", () => {
	let sim
	beforeAll(async () => {
		sim = await openSimulator({ seed: 97 })
		await sim.page.waitForFunction(() => carreteraImg.complete && carreteraImg.naturalWidth > 0)
	}, 180000)
	afterAll(async () => sim?.close())
	it("preserves the pre-refactor visible street rendering", async () => {
		const result = await sim.page.evaluate((original) => {
			const visible = document.getElementById("simuladorCanvas")
			const detached = document.createElement("canvas")
			detached.width = visible.width; detached.height = visible.height
			const contexts = [visible.getContext("2d"), detached.getContext("2d")]
			for (const context of contexts) {
				context.setTransform(1, 0, 0, 1, 0, 0)
				context.clearRect(0, 0, visible.width, visible.height)
				context.setTransform(window.escala, 0, 0, window.escala, window.offsetX, window.offsetY)
			}
			// Keep the exact pre-refactor oracle on the shared direct rasterizer.
			// Cached resampling is compared separately in road-surface-cache-browser.
			const draw = window.canvasRoadSurface.cache.draw
			try {
				window.canvasRoadSurface.cache.draw = window.canvasRoadSurface.drawSurface
				dibujarCalles()
			} finally { window.canvasRoadSurface.cache.draw = draw }
			new Function("ctx", "calles", `${original}\nreturn dibujarCalles;`)(contexts[1], window.calles)()
			const a = contexts[0].getImageData(0, 0, visible.width, visible.height).data
			const b = contexts[1].getImageData(0, 0, visible.width, visible.height).data
			let differences = 0
			for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differences++
			return differences
		}, originalDrawing)
		expect(result).toBe(0)
	}, 30000)
	it("draws the same roads on visible and detached canvases without consuming randomness", async () => {
		const result = await sim.page.evaluate(() => {
			const visible = document.getElementById("simuladorCanvas")
			const detached = document.createElement("canvas")
			detached.width = visible.width
			detached.height = visible.height
			const contexts = [visible.getContext("2d"), detached.getContext("2d")]
			const before = JSON.stringify(window.calles.map(c => c.arreglo))
			let randomCalls = 0
			const random = Math.random
			Math.random = () => { randomCalls++; return random() }
			try {
				for (const context of contexts) {
					context.setTransform(1, 0, 0, 1, 0, 0)
					context.clearRect(0, 0, visible.width, visible.height)
					context.setTransform(window.escala, 0, 0, window.escala, window.offsetX, window.offsetY)
					window.canvasRoadSurface.drawStreets(context, window.calles)
				}
			} finally { Math.random = random }
			const a = contexts[0].getImageData(0, 0, visible.width, visible.height).data
			const b = contexts[1].getImageData(0, 0, visible.width, visible.height).data
			let differences = 0, painted = 0
			for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) differences++; if (i % 4 === 3 && a[i]) painted++ }
			return { differences, painted, randomCalls, unchanged: before === JSON.stringify(window.calles.map(c => c.arreglo)) }
		})
		expect(result.painted).toBeGreaterThan(0)
		expect(result.differences).toBe(0)
		expect(result.randomCalls).toBe(0)
		expect(result.unchanged).toBe(true)
	}, 30000)
	it("leaves seeded traffic and virtual time unchanged by extra surface draws", async () => {
		const run = async (page, draw) => page.evaluate((drawSurfaces) => {
			document.getElementById("btnPauseResume").click()
			document.getElementById("btnBorrar").click()
			window.__fluviBaseline.reseed(1234)
			const canvas = document.createElement("canvas")
			canvas.width = 800; canvas.height = 600
			const context = canvas.getContext("2d")
			for (let i = 0; i < 12; i++) {
				if (drawSurfaces) window.canvasRoadSurface.drawStreets(context, window.calles)
				document.getElementById("btnPaso").click()
			}
			const t = window.configuracionTiempo
			return { cells: window.calles.map(c => c.arreglo), clock: [t.diaActual, t.horaActual, t.minutoActual, t.segundoActual] }
		}, draw)
		const other = await openSimulator({ seed: 97 })
		try { expect(await run(sim.page, true)).toEqual(await run(other.page, false)) }
		finally { await other.close() }
	}, 60000)
})
