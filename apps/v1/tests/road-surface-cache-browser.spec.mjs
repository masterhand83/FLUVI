import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

describe("cached Canvas straight streets in the simulator", () => {
	let sim
	beforeAll(async () => {
		sim = await openSimulator({ seed: 97 })
		await sim.page.waitForFunction(() => carreteraImg.complete && carreteraImg.naturalWidth > 0 && inundacionImg.complete && inundacionImg.naturalWidth > 0)
		await sim.page.evaluate(() => {
			window.hideLoadingScreen?.()
			limpiarSimulacionActual()
			escala = 1; offsetX = 0; offsetY = 0; publicarVistaCanvas()
			window.crearCalle("A", 30, window.TIPOS.CONEXION, 60, 100, 0, 0, 2, 0)
			window.crearCalle("B", 24, window.TIPOS.CONEXION, 100, 120, 20, 0, 3, 0)
		})
	}, 180000)
	afterAll(async () => sim?.close())
	it("matches direct footprints, overlap order and live overlays after paused mutations", async () => {
		const results = await sim.page.evaluate(() => {
			const cache = window.canvasRoadSurface.cache
			const canvas = document.getElementById("simuladorCanvas"), ctx = canvas.getContext("2d")
			const results = []
			let previous
			const snapshot = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data
			function compare(cached, direct, previous) {
				let error = 0, changed = 0
				for (let i = 0; i < direct.length; i += 4) {
					const delta = Math.abs(cached[i] - direct[i]) + Math.abs(cached[i+1] - direct[i+1]) + Math.abs(cached[i+2] - direct[i+2])
					if (delta) { error += delta; changed++ }
				}
				const stateChanges = previous ? Number(cached.some((value, i) => value !== previous[i])) : 0
				return { error, changed, stateChanges }
			}
			const a = window.calles[0], b = window.calles[1]
			const mutations = [
				() => {},
				() => { a.arreglo[0][3] = 1; a.arreglo[1][5] = 7 },
				() => { a.laneDirections = [-1, 1]; window.calleSeleccionada = a },
				() => { window.calleSeleccionada = b; window.labelVisibility = "streets" },
				() => { a.x += 20; a.y += 10; a.angulo = -15 },
				() => { a.tamano = 20; a.carriles = 1 },
				() => { b.angulo = 0; a.angulo = 0 },
				() => {
					a.arreglo[0][5] = 7
					window.estadoEscenarios.celdasBloqueadas.set(`${a.id || a.nombre}:0:5`, { tipo: "inundacion" })
				},
			]
			for (const mutate of mutations) {
				mutate()
				renderizarCanvas(); const cached = snapshot()
				const draw = cache.draw
				try { cache.draw = window.canvasRoadSurface.drawSurface; renderizarCanvas() }
				finally { cache.draw = draw }
				const direct = snapshot()
				results.push(compare(cached, direct, previous))
				previous = cached
			}
			return results
		})
		for (const result of results) {
			// Rotated artwork is sampled twice: allow <10 RGB levels/channel
			// on average over at most 3,500 pixels, not a whole-frame percentage.
			expect(result.changed, JSON.stringify(results)).toBeLessThan(3500)
			expect(result.error).toBeLessThan(100000)
		}
		// Integer-positioned, unrotated streets remain byte-exact, with overlays.
		expect(results[6].error).toBe(0)
		expect(results[7].error).toBe(0)
		for (const result of results.slice(1)) expect(result.stateChanges).toBeGreaterThan(0)
	})
	it("covers every road-cell center without clipping rotated footprints", async () => {
		const missing = await sim.page.evaluate(() => {
			const surface = document.createElement("canvas")
			surface.width = 400; surface.height = 400
			const ctx = surface.getContext("2d"), cache = window.canvasRoadSurface.cache
			let missing = 0
			function missingCenters(pixels, angle) {
				let missing = 0
				for (let lane = 0; lane < 2; lane++) for (let i = 0; i < 30; i++) {
					const rad = -angle * Math.PI / 180, x = (i + .5) * 5, y = (lane + .5) * 5
					const px = Math.floor(150 + x * Math.cos(rad) - y * Math.sin(rad))
					const py = Math.floor(180 + x * Math.sin(rad) + y * Math.cos(rad))
					if (pixels[(py * 400 + px) * 4 + 3] < 250) missing++
				}
				return missing
			}
			for (const angle of [0, 20, -15, 89]) {
				const street = { x: 150, y: 180, angulo: angle, tamano: 30, carriles: 2 }
				ctx.clearRect(0, 0, 400, 400); cache.draw(ctx, street)
				const pixels = ctx.getImageData(0, 0, 400, 400).data
				missing += missingCenters(pixels, angle)
				cache.invalidate(street)
			}
			return missing
		})
		expect(missing).toBe(0)
	})
	it("rasterizes no resident road cells on ticks or scenario changes and spares unrelated streets on edits", async () => {
		const result = await sim.page.evaluate(() => {
			const cache = window.canvasRoadSurface.cache
			cache.clear(); renderizarCanvas()
			const original = CanvasRenderingContext2D.prototype.drawImage
			let tiles = 0
			CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
				if (image === carreteraImg) tiles++
				return original.call(this, image, ...args)
			}
			try {
				for (let i = 0; i < 3; i++) document.getElementById("btnPaso").click()
				window.calles[0].arreglo[0][1] = 7; renderizarCanvas()
				const warm = tiles
				window.calles[0].x++; renderizarCanvas()
				return { warm, edited: tiles, expected: window.calles[0].tamano * window.calles[0].carriles }
			} finally { CanvasRenderingContext2D.prototype.drawImage = original }
		})
		expect(result.warm).toBe(0)
		expect(result.edited).toBe(result.expected)
	})
	it("keeps fallback pixels identical and recovers after allocation failure", async () => {
		const result = await sim.page.evaluate(() => {
			const before = JSON.stringify(window.calles.map(c => c.arreglo))
			const street = { x: 20, y: 70, angulo: 15, tamano: 10, carriles: 2 }
			let fail = true
			const allocation = window.createCanvasRoadSurfaceCache({
				drawSurface: window.canvasRoadSurface.drawSurface, cellSize: () => 5, artworkReady: () => true,
				createCanvas: () => { if (fail) throw Error("allocation"); return document.createElement("canvas") },
			})
			const unavailable = window.createCanvasRoadSurfaceCache({
				drawSurface: window.canvasRoadSurface.drawSurface, cellSize: () => 5, artworkReady: () => false,
			})
			const insufficient = window.createCanvasRoadSurfaceCache({
				drawSurface: window.canvasRoadSurface.drawSurface, cellSize: () => 5, artworkReady: () => true, budget: 1,
			})
			const cases = [
				[window.canvasRoadSurface.cache, { ...street, tamano: 2000 }],
				[allocation, street], [unavailable, street], [insufficient, street],
			]
			const comparisons = cases.map(([cache, street]) => {
				const canvases = [document.createElement("canvas"), document.createElement("canvas")]
				const contexts = canvases.map(canvas => { canvas.width = 300; canvas.height = 150; return canvas.getContext("2d") })
				for (const ctx of contexts) ctx.setTransform(1.5, 0, 0, 1.5, 7, 11)
				cache.draw(contexts[0], street)
				window.canvasRoadSurface.drawSurface(contexts[1], street)
				const a = contexts[0].getImageData(0, 0, 300, 150).data
				const b = contexts[1].getImageData(0, 0, 300, 150).data
				return { equal: a.every((value, i) => value === b[i]), painted: a.some(value => value > 0) }
			})
			fail = false
			allocation.draw(document.createElement("canvas").getContext("2d"), street)
			const recovered = allocation.bytes > 0
			allocation.clear(); unavailable.clear(); insufficient.clear()
			return { comparisons, recovered, unchanged: before === JSON.stringify(window.calles.map(c => c.arreglo)) }
		})
		expect(result.comparisons).toEqual(Array(4).fill({ equal: true, painted: true }))
		expect(result.recovered).toBe(true)
		expect(result.unchanged).toBe(true)
	})
	it("releases deleted roads and all rasters on repeated map replacement", async () => {
		const result = await sim.page.evaluate(() => {
			const cache = window.canvasRoadSurface.cache
			const a = window.calles[0]
			const before = cache.bytes
			window.calleSeleccionada = a
			window.eliminarObjetoSeleccionado({ confirmar: false })
			const after = cache.bytes
			const cleared = []
			for (let i = 0; i < 3; i++) {
				limpiarSimulacionActual(); cleared.push(cache.bytes)
				window.crearCalle(`New ${i}`, 20, window.TIPOS.CONEXION, 60, 100, 0, 0, 2, 0)
				renderizarCanvas()
			}
			return { before, after, cleared }
		})
		expect(result.before).toBeGreaterThan(result.after)
		expect(result.cleared).toEqual([0, 0, 0])
	})
	it("New and repeated Load release previously composited backing stores", async () => {
		await sim.page.evaluate(() => {
			window.__roadRasters = new Set()
			window.__captureRoadRasters = () => {
				const original = CanvasRenderingContext2D.prototype.drawImage
				CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
					if (image instanceof HTMLCanvasElement) window.__roadRasters.add(image)
					return original.call(this, image, ...args)
				}
				try { renderizarCanvas() } finally { CanvasRenderingContext2D.prototype.drawImage = original }
			}
			window.__captureRoadRasters()
			window.confirm = () => true
			window.nuevaSimulacion()
		})
		expect(await sim.page.evaluate(() => [...window.__roadRasters].every(c => c.width === 0 && c.height === 0))).toBe(true)
		for (let cycle = 0; cycle < 3; cycle++) {
			await sim.page.evaluate((cycle) => {
				const data = { nombre: `Cache load ${cycle}`, calles: [{ nombre: `Loaded ${cycle}`, tamano: 20, tipo: "conexion", x: 20, y: 40, angulo: 0, carriles: 2 }] }
				window.cargarSimulacion({ target: { files: [new File([JSON.stringify(data)], "cache.json")], value: "" } })
			}, cycle)
			await sim.page.waitForFunction(cycle => window.calles[0]?.nombre === `Loaded ${cycle}`, {}, cycle)
			expect(await sim.page.evaluate(() => [...window.__roadRasters].every(c => c.width === 0 && c.height === 0))).toBe(true)
			expect(await sim.page.evaluate(() => { renderizarCanvas(); return window.canvasRoadSurface.cache.bytes })).toBeGreaterThan(0)
			await sim.page.evaluate(() => window.__captureRoadRasters())
		}
		expect(await sim.page.evaluate(() => { window.nuevaSimulacion(); return window.canvasRoadSurface.cache.bytes })).toBe(0)
		expect(await sim.page.evaluate(() => [...window.__roadRasters].every(c => c.width === 0 && c.height === 0))).toBe(true)
	})
})
