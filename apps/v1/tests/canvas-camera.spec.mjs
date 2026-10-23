import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

// Regresión del bloqueo de arrastre en Canvas 2D: los gestos actualizaban la
// cámara local y `aplicarLimitesOffset` la sobrescribía con copias viejas de
// window.*, así que el mapa no se movía aunque el zoom sí cambiara.

async function dismissLoading(page) {
	await page.evaluate(() => window.hideLoadingScreen?.())
	await page.waitForFunction(
		() => {
			const element = document.getElementById("loadingScreen")
			return !element || getComputedStyle(element).display === "none"
		},
		{ polling: 200, timeout: 20000 },
	)
}

function readCamera(page) {
	return page.evaluate(() => ({
		escala: window.escala,
		offsetX: window.offsetX,
		offsetY: window.offsetY,
	}))
}

// Punto de pantalla sobre mapa vacío: evita calles, edificios y overlays que
// pudieran seleccionar o arrastrar otra cosa durante la prueba.
async function findEmptyPoint(page, marginRight = 40, marginLeft = 40) {
	const point = await page.evaluate(([rightMargin, leftMargin]) => {
		const canvas = document.getElementById("simuladorCanvas")
		const rect = canvas.getBoundingClientRect()
		const isEmptyAt = (x, y) => {
			if (document.elementFromPoint(rect.left + x, rect.top + y) !== canvas) return false
			const worldX = (x - window.offsetX) / window.escala
			const worldY = (y - window.offsetY) / window.escala
			if (window.cellGeometryIndex?.findNearest(worldX, worldY, window.calles)) return false
			return !window.encontrarEdificioEnPunto?.(worldX, worldY)
		}
		for (let y = 40; y < rect.height - 40; y += 24) {
			for (let x = leftMargin; x < rect.width - rightMargin; x += 24) {
				if (isEmptyAt(x, y)) return { x: rect.left + x, y: rect.top + y }
			}
		}
		return null
	}, [marginRight, marginLeft])
	if (!point) throw new Error("No se encontró un punto vacío para arrastrar el mapa")
	return point
}

async function dragMap(page, point, dx, dy) {
	await page.mouse.move(point.x, point.y)
	await page.mouse.down()
	await page.mouse.move(point.x + dx, point.y + dy, { steps: 4 })
	await page.mouse.up()
}

function expectMovedBy(before, after, dx, dy) {
	expect(after.offsetX - before.offsetX).toBeCloseTo(dx, 0)
	expect(after.offsetY - before.offsetY).toBeCloseTo(dy, 0)
}

describe("Canvas 2D map camera", () => {
	let sim

	beforeAll(async () => {
		sim = await openSimulator({ seed: 7, usePixi: false, freezeFrames: false })
		await dismissLoading(sim.page)
	}, 180000)

	afterAll(async () => sim?.close())

	it("moves the map when dragging empty space", async () => {
		const page = sim.page
		const point = await findEmptyPoint(page)
		const before = await readCamera(page)

		await dragMap(page, point, 60, 40)

		const after = await readCamera(page)
		expectMovedBy(before, after, 60, 40)
		expectFiniteCamera(after)
	})

	it("accumulates movement across consecutive drags", async () => {
		const page = sim.page
		const point = await findEmptyPoint(page)
		const before = await readCamera(page)

		await dragMap(page, point, 40, 25)
		await dragMap(page, point, 40, 25)
		await dragMap(page, point, 40, 25)

		const after = await readCamera(page)
		expectMovedBy(before, after, 120, 75)
	})

	it("keeps the world point under the cursor when zooming with the wheel", async () => {
		const page = sim.page
		const point = await findEmptyPoint(page)
		const box = await page.evaluate(() => {
			const rect = document.getElementById("simuladorCanvas").getBoundingClientRect()
			return { left: rect.left, top: rect.top }
		})
		const before = await readCamera(page)
		const screenX = point.x - box.left
		const screenY = point.y - box.top
		const worldBefore = {
			x: (screenX - before.offsetX) / before.escala,
			y: (screenY - before.offsetY) / before.escala,
		}

		await page.mouse.move(point.x, point.y)
		await page.mouse.wheel({ deltaY: -110 })

		const after = await readCamera(page)
		expect(after.escala).toBeGreaterThan(before.escala)
		expect((screenX - after.offsetX) / after.escala).toBeCloseTo(worldBefore.x, 0)
		expect((screenY - after.offsetY) / after.escala).toBeCloseTo(worldBefore.y, 0)
	})

	it("still drags after zooming", async () => {
		const page = sim.page
		const point = await findEmptyPoint(page)
		await page.mouse.move(point.x, point.y)
		await page.mouse.wheel({ deltaY: -220 })

		const before = await readCamera(page)
		await dragMap(page, point, 50, 30)
		const after = await readCamera(page)
		expectMovedBy(before, after, 50, 30)
	})

	it("clamps at the map edge and moves again in the opposite direction", async () => {
		const page = sim.page
		const point = await findEmptyPoint(page, 300, 200)

		// Empujar repetidamente hacia el borde derecho hasta fijarlo.
		for (let i = 0; i < 12; i++) await dragMap(page, point, 250, 0)
		const atEdge = await readCamera(page)

		await dragMap(page, point, 250, 0)
		const stillAtEdge = await readCamera(page)
		expect(stillAtEdge.offsetX).toBeCloseTo(atEdge.offsetX, 1)

		await dragMap(page, point, -120, 0)
		const recovered = await readCamera(page)
		expect(recovered.offsetX).toBeLessThan(atEdge.offsetX - 100)
	})

	it("keeps a finite published camera state after navigation", async () => {
		const page = sim.page
		const point = await findEmptyPoint(page)
		await page.mouse.move(point.x, point.y)
		await page.mouse.wheel({ deltaY: 660 })

		const camera = await readCamera(page)
		expectFiniteCamera(camera)
		expect(camera.escala).toBeGreaterThanOrEqual(0.5)
		expect(camera.escala).toBeLessThanOrEqual(20)
	})
})

function expectFiniteCamera(camera) {
	expect(Number.isFinite(camera.escala)).toBe(true)
	expect(Number.isFinite(camera.offsetX)).toBe(true)
	expect(Number.isFinite(camera.offsetY)).toBe(true)
	expect(camera.escala).toBeGreaterThan(0)
}

describe("live Canvas traffic while panning", () => {
	let sim

	beforeAll(async () => {
		sim = await openSimulator({ seed: 17, usePixi: false, freezeFrames: false })
		await dismissLoading(sim.page)
		await sim.page.evaluate(() => {
			if (!window.isPaused) document.getElementById("btnPauseResume").click()
			const street = window.crearCalle("Pan animation regression", 60, window.TIPOS.CONEXION,
				100, 100, 0, 0, 1, 0)
			street.arreglo[0][10] = 1
			window.calles.splice(0, window.calles.length, street)
			window.conexiones.length = 0
			// Reset the real Canvas camera, not a mocked render implementation.
			escala = 1
			offsetX = 0
			offsetY = 0
			window.aplicarLimitesOffset()
			window.renderizarCanvas()
		})
	}, 180000)

	afterAll(async () => sim?.close())

	it("keeps drawing moving vehicles before the mouse is released", async () => {
		const page = sim.page
		const point = await findEmptyPoint(page, 150, 150)
		await page.evaluate(() => document.getElementById("btnPauseResume").click())
		await page.mouse.move(point.x, point.y)
		await page.mouse.down()
		try {
			const before = await readCamera(page)
			await page.mouse.move(point.x + 20, point.y + 10, { steps: 3 })
			expectMovedBy(before, await readCamera(page), 20, 10)
			// Let the pan's first frame paint before comparing vehicle pixels.
			await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() =>
				requestAnimationFrame(resolve))))
			const sample = await page.evaluate(() => {
				const street = window.calles[0]
				const context = document.getElementById("simuladorCanvas").getContext("2d")
				return {
					cell: street.arreglo[0].findIndex((value) => value > 0),
					// Sample only the road/vehicle strip, not the changing sky.
					pixels: context.getImageData(street.x + window.offsetX,
						street.y + window.offsetY, 300, 5).data.join(","),
				}
			})
			await page.waitForFunction((cell) =>
				window.calles[0].arreglo[0].findIndex((value) => value > 0) !== cell,
			{}, sample.cell)
			await page.waitForFunction((pixels) => {
				const street = window.calles[0]
				const context = document.getElementById("simuladorCanvas").getContext("2d")
				return context.getImageData(street.x + window.offsetX,
					street.y + window.offsetY, 300, 5).data.join(",") !== pixels
			}, { timeout: 3000 }, sample.pixels)
			await page.mouse.move(point.x + 40, point.y + 20, { steps: 3 })
			expectMovedBy(before, await readCamera(page), 40, 20)
		} finally {
			await page.mouse.up()
		}
	})

	it("keeps the camera and vehicle pixels live through consecutive drag moves", async () => {
		const page = sim.page
		const point = await findEmptyPoint(page, 150, 150)
		const before = await readCamera(page)
		await page.mouse.move(point.x, point.y)
		await page.mouse.down()
		try {
			for (let i = 1; i <= 4; i++) {
				const previous = await page.evaluate(() => ({
					cell: window.calles[0].arreglo[0].findIndex((value) => value > 0),
					pixels: document.getElementById("simuladorCanvas").toDataURL(),
				}))
				await page.mouse.move(point.x + i * 10, point.y + i * 5, { steps: 3 })
				expectMovedBy(before, await readCamera(page), i * 10, i * 5)
				await page.waitForFunction(({ cell, pixels }) => {
					const moved = window.calles[0].arreglo[0].findIndex((value) => value > 0) !== cell
					return moved && document.getElementById("simuladorCanvas").toDataURL() !== pixels
				}, { timeout: 3000 }, previous)
			}
		} finally {
			await page.mouse.up()
		}
	})

	it("coalesces a burst of drag events into a live repaint while paused", async () => {
		const page = sim.page
		await page.evaluate(() => document.getElementById("btnPauseResume").click())
		const point = await findEmptyPoint(page, 150, 150)
		await page.mouse.move(point.x, point.y)
		await page.mouse.down()
		try {
			const result = await page.evaluate(async ({ x, y }) => {
				const canvas = document.getElementById("simuladorCanvas")
				const context = canvas.getContext("2d")
				const clear = context.clearRect
				const before = canvas.toDataURL()
				const cells = window.calles[0].arreglo[0].join(",")
				let paints = 0
				context.clearRect = function (...args) {
					paints++
					return clear.apply(this, args)
				}
				try {
					for (let i = 1; i <= 100; i++) {
						canvas.dispatchEvent(new MouseEvent("mousemove", {
							bubbles: true, buttons: 1, clientX: x + i / 5, clientY: y + i / 10,
						}))
					}
					const synchronousPaints = paints
					for (let i = 0; i < 6; i++) {
						await new Promise((resolve) => requestAnimationFrame(resolve))
					}
					return {
						synchronousPaints,
						paints,
						imageChanged: canvas.toDataURL() !== before,
						cellsUnchanged: window.calles[0].arreglo[0].join(",") === cells,
						paused: window.isPaused,
					}
				} finally {
					context.clearRect = clear
				}
			}, point)
			expect(result).toEqual({
				synchronousPaints: 0, paints: 1, imageChanged: true, cellsUnchanged: true, paused: true,
			})
		} finally {
			await page.mouse.up()
		}
	})
})
