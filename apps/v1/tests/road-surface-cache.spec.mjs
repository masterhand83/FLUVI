import { readFileSync } from "node:fs"
import vm from "node:vm"
import { describe, expect, it } from "vitest"

function setup(options = {}) {
	const window = {}
	vm.runInNewContext(readFileSync(new URL("../src/js/renderer/CanvasRoadSurfaceCache.js", import.meta.url), "utf8"), { window })
	const allocated = [], rasterized = [], direct = []
	const context = { save() {}, restore() {}, translate() {}, rotate() {}, drawImage() {} }
	const cache = window.createCanvasRoadSurfaceCache({
		cellSize: () => 5, artworkReady: () => true,
		drawSurface: (ctx, street) => (ctx === context ? direct : rasterized).push(street.nombre),
		createCanvas: () => {
			const canvas = { width: 0, height: 0, getContext: () => ({ translate() {} }) }
			allocated.push(canvas)
			return canvas
		}, ...options,
	})
	const street = (nombre = "A") => ({ nombre, x: 0, y: 0, angulo: 0, tamano: 10, carriles: 2 })
	return { cache, context, allocated, rasterized, direct, street }
}

describe("Canvas road surface cache interface", () => {
	it("reuses unchanged surfaces and releases backing stores on invalidate and clear", () => {
		const s = setup(), a = s.street(), b = s.street("B")
		s.cache.draw(s.context, a); s.cache.draw(s.context, a); s.cache.draw(s.context, b)
		expect(s.rasterized).toEqual(["A", "B"])
		expect(s.cache.bytes).toBe(6048) // two (50 + 4) × (10 + 4) RGBA rasters
		s.cache.invalidate(a)
		expect(s.cache.bytes).toBe(3024)
		expect(s.allocated[0].width).toBe(0)
		s.cache.clear()
		expect(s.cache.bytes).toBe(0)
		expect(s.allocated.every(c => c.width === 0 && c.height === 0)).toBe(true)
	})
	it("evicts the least recently used street before allocation and bounds replacement pressure", () => {
		const s = setup({ budget: 6048 }), a = s.street(), b = s.street("B"), c = s.street("C")
		s.cache.draw(s.context, a); s.cache.draw(s.context, b); s.cache.draw(s.context, a)
		s.cache.draw(s.context, c)
		expect(s.allocated[1].width).toBe(0)
		expect(s.cache.bytes).toBe(6048)
		a.tamano = 20
		s.cache.draw(s.context, a)
		expect(s.allocated.slice(0, 3).every(c => c.width === 0)).toBe(true)
		expect(s.cache.bytes).toBe(5824)
		expect(s.rasterized).toEqual(["A", "B", "C", "A"])
	})
	it("draws directly without allocation for oversized, unsafe, unavailable and over-budget surfaces", () => {
		const s = setup({ budget: 3000 }), a = s.street()
		s.cache.draw(s.context, a)
		expect(s.direct).toEqual(["A"])
		expect(s.allocated).toHaveLength(0)
		for (const fields of [{ tamano: 2000 }, { carriles: 2000 }, { tamano: 1000, carriles: 1000 }, { tamano: 1.5 }, { carriles: 1.5 }, { x: NaN }, { esCurva: true }, { geometryType: "roundabout" }]) {
			const t = setup(); t.cache.draw(t.context, { ...t.street(), ...fields })
			expect(t.direct).toEqual(["A"]); expect(t.allocated).toHaveLength(0)
		}
		const t = setup({ artworkReady: () => false }); t.cache.draw(t.context, t.street())
		expect(t.direct).toEqual(["A"]); expect(t.allocated).toHaveLength(0)
	})
	it("releases failed allocations and falls back without retaining a surface", () => {
		const failed = { width: 0, height: 0, getContext: () => null }
		for (const createCanvas of [() => { throw Error("allocation") }, () => failed]) {
			const s = setup({ createCanvas }); s.cache.draw(s.context, s.street())
			expect(s.direct).toEqual(["A"]); expect(s.cache.bytes).toBe(0)
		}
		expect([failed.width, failed.height]).toEqual([0, 0])
	})
	it("never exceeds the backing-store budget while allocating replacements", () => {
		let live = 0, peak = 0
		const s = setup({ budget: 6048, createCanvas: () => {
			let w = 0, h = 0
			const resize = (width, height) => { live += (width * height - w * h) * 4; w = width; h = height; peak = Math.max(peak, live) }
			return {
				get width() { return w }, set width(v) { resize(v, h) },
				get height() { return h }, set height(v) { resize(w, v) },
				getContext: () => ({ translate() {} }),
			}
		} })
		const a = s.street(), b = s.street("B")
		s.cache.draw(s.context, a); s.cache.draw(s.context, b)
		a.tamano = 20; s.cache.draw(s.context, a)
		expect(peak).toBe(6048)
		expect(live).toBe(s.cache.bytes)
		s.cache.clear(); expect(live).toBe(0)
	})
	it("refreshes geometry but ignores traffic, scenarios, direction and selection fields", () => {
		const s = setup(), a = s.street(), b = s.street("B")
		s.cache.draw(s.context, a); s.cache.draw(s.context, b)
		a.arreglo = [[7, 1]]; a.laneDirections = [-1, 1]; a.nombre = "Renamed"
		s.cache.draw(s.context, a)
		expect(s.rasterized).toHaveLength(2)
		for (const field of ["x", "y", "angulo", "tamano", "carriles"]) {
			a[field]++; s.cache.draw(s.context, a); s.cache.draw(s.context, b)
		}
		expect(s.rasterized.filter(n => n === "B")).toHaveLength(1)
		expect(s.rasterized).toHaveLength(7)
	})
})
