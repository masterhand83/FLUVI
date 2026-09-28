import assert from "node:assert/strict"
import { openSimulator } from "../helpers/simulator.mjs"

const sim = await openSimulator({ seed: 91, usePixi: true, freezeFrames: false })
try {
	const { page } = sim
	await page.waitForFunction(() => !!window.pixiApp?.sceneManager, { timeout: 30000 })
	await page.evaluate(() => {
		window.hideLoadingScreen?.()
		window.streetEditPause?.()
		const source = window.crearCalle("Live link source", 14, window.TIPOS.CONEXION, 200, 180, 0, 0, 1, 0)
		const target = window.crearCalle("Live link target", 14, window.TIPOS.CONEXION, 400, 260, 0, 0, 1, 0)
		const links = window.crearConexionLineal(source, target, 1)
		window.registrarConexiones(links)
		window.conexiones.push(...links)
		const otherSource = window.crearCalle("Unchanged link source", 14, window.TIPOS.CONEXION, 550, 180, 0, 0, 1, 0)
		const otherTarget = window.crearCalle("Unchanged link target", 14, window.TIPOS.CONEXION, 650, 260, 0, 0, 1, 0)
		const otherLinks = window.crearConexionLineal(otherSource, otherTarget, 1)
		window.registrarConexiones(otherLinks)
		window.conexiones.push(...otherLinks)
		const index = window.calles.indexOf(source)
		for (const id of ["selectCalle", "selectCalleEditor"]) document.getElementById(id).add(new Option(source.nombre, index))
		const select = document.getElementById("selectCalle")
		select.value = String(index)
		select.dispatchEvent(new Event("change", { bubbles: true }))
		window.calleSeleccionada = source
		window.pixiApp.sceneManager.renderAll()
		document.getElementById("btnConexiones").click()
		window.__liveLink = links[0]
		window.__unchangedLink = otherLinks[0]
		window.__unchangedGraphic = window.pixiApp.sceneManager.conexionGraphics.get(otherLinks[0])
	})
	const before = await page.evaluate(() => {
		const graphics = window.pixiApp.sceneManager.conexionGraphics.get(window.__liveLink)
		return graphics.geometry.graphicsData[0].shape.points.slice(0, 2)
	})
	await page.$eval("#streetInspectorX", input => {
		input.focus()
		input.value = String(Number(input.value) + 40)
		input.blur()
	})
	await page.waitForFunction(() => {
		const link = window.__liveLink
		return link.origen.x === 240 && !!window.pixiApp.sceneManager.conexionGraphics.get(link)
	})
	const result = await page.evaluate(() => {
		const link = window.__liveLink
		const graphics = window.pixiApp.sceneManager.conexionGraphics.get(link)
		const expected = window.obtenerCoordenadasGlobalesCelda(link.origen, link.carrilOrigen, link.origen.tamano - 1)
		return { actual: graphics.geometry.graphicsData[0].shape.points.slice(0, 2), expected, streetX: link.origen.x }
	})
	assert.notDeepEqual(result.actual, before, "visible connection moves when its Calle moves")
	assert.ok(Math.abs(result.actual[0] - result.expected.x) < 0.01 && Math.abs(result.actual[1] - result.expected.y) < 0.01,
		`connection follows source cell without hiding/showing links: ${JSON.stringify(result)}`)
	assert.equal(await page.evaluate(() => window.pixiApp.sceneManager.conexionGraphics.get(window.__unchangedLink) === window.__unchangedGraphic), true,
		"unaffected links keep their graphics")

	// Updates that mutate geometry without calling renderAll (e.g. a live drag)
	// are picked up by the Pixi ticker while the link viewer stays open.
	const previousDestinationY = await page.evaluate(() => {
		const link = window.__liveLink
		const points = window.pixiApp.sceneManager.conexionGraphics.get(link).geometry.graphicsData[0].shape.points
		link.destino.y += 25
		return points[3]
	})
	await page.waitForFunction(previous => {
		const link = window.__liveLink
		const graphics = window.pixiApp.sceneManager.conexionGraphics.get(link)
		const expected = window.obtenerCoordenadasGlobalesCelda(link.destino, link.carrilDestino, link.posDestino)
		const [x, y] = graphics.geometry.graphicsData[0].shape.points.slice(2, 4)
		return Math.abs(y - previous) > 1 && Math.abs(x - expected.x) < 0.01 && Math.abs(y - expected.y) < 0.01
	}, {}, previousDestinationY)
	await page.evaluate(() => {
		window.conexiones.splice(window.conexiones.indexOf(window.__liveLink), 1)
	})
	await page.waitForFunction(() => !window.pixiApp.sceneManager.conexionGraphics.has(window.__liveLink))
	assert.equal(await page.evaluate(() => window.pixiApp.sceneManager.conexionGraphics.get(window.__unchangedLink) === window.__unchangedGraphic), true,
		"removing a link keeps other visible links intact")
	console.log("✅ visible Pixi link follows inspector street geometry")
} finally {
	await sim.close()
}
