// Matched direct/cached batches; no machine-dependent CI thresholds.
import { openSimulator } from "../helpers/simulator.mjs"

const seed = 97
const percentile = (samples, p) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1]
const sim = await openSimulator({ seed, usePixi: false, freezeFrames: true })
try {
	const { page, browser } = sim
	await page.evaluate(() => window.hideLoadingScreen?.())
	await page.waitForFunction(() => carreteraImg.complete && carreteraImg.naturalWidth > 0)
	await page.evaluate(() => document.getElementById("btnPauseResume").click())
	const initialTime = await page.evaluate(() => window.tiempoToJSON())
	const metadata = await page.evaluate(() => ({
		viewport: { width: innerWidth, height: innerHeight },
		pixelDensity: devicePixelRatio,
		zoom: window.escala,
		canvas: { width: simuladorCanvas.width, height: simuladorCanvas.height },
	}))
	const cases = []
	for (const name of ["built-in", "synthetic"]) {
		if (name === "synthetic")
			await page.evaluate(() => {
				for (let i = 0; i < 200; i++) {
					window.crearCalle(
						`Benchmark ${i}`,
						80,
						window.TIPOS.CONEXION,
						(i % 20) * 35,
						Math.floor(i / 20) * 35,
						(i % 4) * 15,
						0,
						2,
						0,
					)
				}
			})
		const batches = []
		for (let batch = 0; batch < 3; batch++)
			for (const mode of batch % 2 ? ["cached", "direct"] : ["direct", "cached"]) {
				const result = await page.evaluate(
					({ mode, initialTime }) => {
						window.__fluviBaseline.reseed(97)
						window.tiempoFromJSON(initialTime)
						window.resetScenarioTraffic()
						const button = document.getElementById("btnPaso")
						const canvas = document.createElement("canvas")
						canvas.width = simuladorCanvas.width
						canvas.height = simuladorCanvas.height
						const context = canvas.getContext("2d")
						context.setTransform(window.escala, 0, 0, window.escala, window.offsetX, window.offsetY)
						const cache = window.canvasRoadSurface.cache,
							cachedDraw = cache.draw
						const draw = mode === "cached" ? cachedDraw : window.canvasRoadSurface.drawSurface
						cache.clear()
						cache.draw = draw
						const original = CanvasRenderingContext2D.prototype.drawImage
						let tiles = 0
						CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
							if (image === carreteraImg) tiles++
							return original.call(this, image, ...args)
						}
						const road = [],
							step = [],
							rasterizations = []
						try {
							let start = performance.now()
							for (const street of window.calles) draw(context, street)
							const coldMs = performance.now() - start,
								coldTiles = tiles
							for (let i = 0; i < 35; i++) {
								tiles = 0
								start = performance.now()
								for (const street of window.calles) draw(context, street)
								const roadTime = performance.now() - start
								start = performance.now()
								button.click()
								const stepTime = performance.now() - start
								if (i >= 5) {
									road.push(roadTime)
									step.push(stepTime)
									rasterizations.push(tiles)
								}
							}
							return {
								road,
								step,
								coldMs,
								coldTiles,
								rasterizations,
								bytes: cache.bytes,
								streets: window.calles.length,
								cells: window.calles.reduce((sum, c) => sum + c.tamano * c.carriles, 0),
								roundabouts: window.calles.filter((c) => c.geometryType === "roundabout").length,
							}
						} finally {
							cache.draw = cachedDraw
							CanvasRenderingContext2D.prototype.drawImage = original
						}
					},
					{ mode, initialTime },
				)
				batches.push({
					batch,
					mode,
					streets: result.streets,
					cells: result.cells,
					roundabouts: result.roundabouts,
					coldMs: result.coldMs,
					coldTiles: result.coldTiles,
					bytes: result.bytes,
					warmTilesPerRoadAndStep: [...new Set(result.rasterizations)],
					roadMs: { median: percentile(result.road, 0.5), p95: percentile(result.road, 0.95) },
					manualStepMs: { median: percentile(result.step, 0.5), p95: percentile(result.step, 0.95) },
				})
			}
		cases.push({ name, batches })
	}
	console.log(
		JSON.stringify(
			{
				mode: "matched-direct-cached",
				seed,
				browser: await browser.version(),
				gpu: "--disable-gpu",
				...metadata,
				warmup: 5,
				samples: 30,
				note: "Road timings are separate surface-only draws; manual step timings are not user-visible FPS. Cells count road tiles; roundabouts are paths, not tiles.",
				cases,
			},
			null,
			2,
		),
	)
} finally {
	await sim.close()
}
