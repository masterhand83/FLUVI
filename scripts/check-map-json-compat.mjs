// Run after: cargo run -p ca-core --example map_round_trip
// --record captures a small map with the real v1 save path.
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { openSimulator } from "../apps/v1/tests/helpers/simulator.mjs"

const fixtures = new URL("../crates/ca-core/tests/fixtures/", import.meta.url)
const sim = await openSimulator({ usePixi: false, freezeFrames: true })
try {
	if (process.argv.includes("--record")) {
		const saved = await sim.page.evaluate(async () => {
			window.confirm = () => true
			window.nuevaSimulacion()
			const a = window.crearCalle("Entrada", 6, window.TIPOS.GENERADOR, 10, 20, 0, 0.35, 2, 0.05)
			const b = window.crearCalle("Salida", 6, window.TIPOS.DEVORADOR, 50, 20, 0, 0, 2, 0.05)
			a.laneDirections = b.laneDirections = [1, -1]
			b.laneGenerationEnabled = [true, false]
			const links = [
				new window.ConexionCA(a, b, 0, 0, -1, 0, 1, window.TIPOS_CONEXION.LINEAL),
				new window.ConexionCA(b, a, 1, 1, 0, 5, 1, window.TIPOS_CONEXION.INCORPORACION),
				new window.ConexionCA(a, b, 0, 0, 2, 2, 0.5, window.TIPOS_CONEXION.PROBABILISTICA),
				new window.ConexionCA(a, b, 0, 0, 2, 3, 0.5, window.TIPOS_CONEXION.PROBABILISTICA),
			]
			window.registrarConexiones(links)
			window.conexiones.push(...links)
			window.prompt = () => "Compatibility"
			let blob
			URL.createObjectURL = (value) => { blob = value; return "blob:fixture" }
			HTMLAnchorElement.prototype.click = () => {}
			window.guardarSimulacion()
			return await blob.text()
		})
		await writeFile(new URL("map-v1.json", fixtures), saved + "\n")
		console.log("Recorded map-v1.json through v1 guardarSimulacion")
	} else {
		const saved = await readFile(new URL("map-v2.json", fixtures), "utf8")
		await sim.page.evaluate((saved) => {
			window.confirm = () => true
			window.cargarSimulacion({ target: { files: [new File([saved], "map-v2.json")], value: "" } })
		}, saved)
		try {
			await sim.page.waitForFunction(() => window.calles.length === 2 && window.conexiones.length === 4, { polling: 100, timeout: 5000 })
		} catch (error) {
			console.error(await sim.page.evaluate(() => ({
				streets: window.calles.length, links: window.conexiones.length,
				notices: document.querySelector("#toastContainer")?.textContent,
			})), sim.consoleErrors, sim.pageErrors)
			throw error
		}
		const loaded = await sim.page.evaluate(() => ({
			roads: window.calles.map(c => ({
				name: c.nombre, lanes: c.carriles, size: c.tamano, directions: c.laneDirections,
				generation: c.probabilidadGeneracion, laneGeneration: c.laneGenerationEnabled,
			})),
			links: window.conexiones.map(c => [c.carrilOrigen, c.carrilDestino, c.posOrigen, c.posDestino, c.probabilidadTransferencia]),
		}))
		assert.deepEqual(loaded.roads, [
			{ name: "Entrada", lanes: 2, size: 6, directions: [1, -1], generation: 0.35, laneGeneration: [true, true] },
			{ name: "Salida", lanes: 2, size: 6, directions: [1, -1], generation: 0, laneGeneration: [true, false] },
		])
		assert.deepEqual(loaded.links, [[0, 0, -1, 0, 1], [1, 1, 0, 5, 1], [0, 0, 2, 2, 0.5], [0, 0, 2, 3, 0.5]])
		const trials = await sim.page.evaluate(() => {
			const random = Math.random
			Math.random = () => 0.75
			try {
				window.calles[0].arreglo[0][2] = 1
				window.conexiones.forEach(c => c.transferir())
				return [window.calles[0].arreglo[0][2], ...window.calles[1].arreglo[0].slice(2, 4)]
			} finally {
				Math.random = random
			}
		})
		assert.deepEqual(trials, [1, 0, 0], "v1 can decline both independent 0.5 trials")
		assert.deepEqual(sim.pageErrors, [])
		console.log("PASS: map-v2.json loads in the real v1 app")
	}
} finally {
	await sim.close()
}
