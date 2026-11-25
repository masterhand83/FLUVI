// Capture the built-in map through v1's public save path, not its construction code.
import { writeFile } from "node:fs/promises"
import { openSimulator } from "../apps/v1/tests/helpers/simulator.mjs"

const sim = await openSimulator({ usePixi: false, freezeFrames: true })
try {
	const capture = await sim.page.evaluate(async () => {
		window.prompt = () => "IPN / Zacatenco"
		let blob
		URL.createObjectURL = value => { blob = value; return "blob:campus" }
		HTMLAnchorElement.prototype.click = () => {}
		window.guardarSimulacion()
		return {
			map: await blob.text(),
			baseline: {
				streets: window.calles.map(c => ({ name: c.nombre, lanes: c.carriles, length: c.tamano })),
				connections: window.conexiones.length,
				samples: window.calles.flatMap((c, street) => !c.esCurva ? [] :
					[0, Math.floor(c.tamano / 2), c.tamano - 1].map(index => ({
						street, lane: c.carriles - 1, index,
						...window.obtenerCoordenadasGlobalesCeldaConCurva(c, c.carriles - 1, index),
					}))),
			},
		}
	})
	await writeFile(new URL("../crates/ca-core/src/campus.json", import.meta.url), capture.map + "\n")
	await writeFile(new URL("../crates/ca-core/tests/fixtures/campus-baseline.json", import.meta.url), JSON.stringify(capture.baseline, null, 2) + "\n")
	console.log(`Saved campus: ${capture.baseline.streets.length} streets, ${capture.baseline.connections} connections`)
} finally {
	await sim.close()
}
