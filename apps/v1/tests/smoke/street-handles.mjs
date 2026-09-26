import assert from "node:assert/strict"
import { openSimulator } from "../helpers/simulator.mjs"

const selector = ".street-endpoint-handle"

async function selectStraightCalle(page) {
	await page.evaluate(() => {
		const canvas = document.getElementById("simuladorCanvas")
		const rect = canvas.getBoundingClientRect()
		const camera = window.USE_PIXI ? window.pixiApp.cameraController : null
		const sx = rect.width * 0.55
		const sy = rect.height * 0.42
		const world = camera ? camera.screenToWorld(sx, sy)
			: { x: (sx * canvas.width / rect.width - window.offsetX) / window.escala,
				y: (sy * canvas.height / rect.height - window.offsetY) / window.escala }
		const street = window.crearCalle("Handle smoke Calle", 14, window.TIPOS.CONEXION, world.x, world.y, 0, 0, 1, 0.02)
		const index = window.calles.indexOf(street)
		for (const id of ["selectCalle", "selectCalleEditor"]) document.getElementById(id).add(new Option(street.nombre, index))
		const select = document.getElementById("selectCalle")
		select.value = String(index)
		select.dispatchEvent(new Event("change", { bubbles: true }))
		window.calleSeleccionada = street
		window.pixiApp?.sceneManager?.renderAll()
		window.renderizarCanvas?.()
	})
	await page.waitForFunction(() => window.calleSeleccionada === window.calles.at(-1) && !document.getElementById("streetInspector").hidden)
	assert.equal(await page.evaluate(() => window.calleSeleccionada.esCurva), false)
}

async function snapshot(page) {
	return page.evaluate(() => {
		const street = window.calleSeleccionada
		const canvas = document.getElementById("simuladorCanvas")
		const rect = canvas.getBoundingClientRect()
		const camera = window.USE_PIXI ? window.pixiApp.cameraController : null
		const project = ({ x, y }) => {
			const local = camera ? camera.worldToScreen(x, y)
				: { x: (x * window.escala + window.offsetX) * rect.width / canvas.width,
					y: (y * window.escala + window.offsetY) * rect.height / canvas.height }
			return { x: rect.left + local.x, y: rect.top + local.y }
		}
		const length = street.tamano * window.celda_tamano
		const angle = street.angulo * Math.PI / 180
		const geometry = { x: street.x, y: street.y, angulo: street.angulo, tamano: street.tamano }
		const endpoints = {
			start: project({ x: street.x, y: street.y }),
			end: project({ x: street.x + length * Math.cos(angle), y: street.y - length * Math.sin(angle) }),
		}
		const handles = Array.from(document.querySelectorAll(".street-endpoint-handle"), element => {
			const box = element.getBoundingClientRect()
			return { end: element.dataset.end, x: box.left + box.width / 2, y: box.top + box.height / 2,
				visible: box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden" }
		})
		return { geometry, endpoints, handles, scale: window.escala,
			orangePreview: Array.from(document.querySelectorAll("svg.street-draw-preview:not([hidden]) line"))
				.some(line => line.getAttribute("stroke") === "#e87516") }
	})
}

function near(actual, expected, label, tolerance = 3) {
	assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} should be within ${tolerance}px of ${expected}`)
}

function attached(state, label) {
	assert.deepEqual(state.handles.map(handle => handle.end).sort(), ["end", "start"], `${label}: exactly two endpoint handles`)
	for (const handle of state.handles) {
		assert.ok(handle.visible, `${label}: ${handle.end} is visible`)
		near(handle.x, state.endpoints[handle.end].x, `${label}: ${handle.end} x`)
		near(handle.y, state.endpoints[handle.end].y, `${label}: ${handle.end} y`)
	}
	assert.equal(state.orangePreview, false, `${label}: no orange SVG edit preview`)
}

async function dragHandle(page, end, dx, dy, finish = "release") {
	const state = await snapshot(page)
	const handle = state.handles.find(item => item.end === end)
	assert.ok(handle, `${end} handle exists`)
	await page.mouse.move(handle.x, handle.y)
	await page.mouse.down()
	await page.mouse.move(handle.x + dx, handle.y + dy, { steps: 6 })
	assert.equal((await snapshot(page)).orangePreview, false, `${end} drag has no orange SVG preview`)
	if (finish === "escape") {
		await page.keyboard.press("Escape")
		await page.mouse.up()
	} else if (finish === "outside") {
		await page.mouse.move(20, 20, { steps: 6 })
		await page.mouse.up()
	} else await page.mouse.up()
	return snapshot(page)
}

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 73, usePixi, freezeFrames: false })
	const { page } = sim
	try {
		if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.cameraController, { timeout: 30000 })
		await page.evaluate(() => window.hideLoadingScreen?.())
		await selectStraightCalle(page)
		let before = await snapshot(page)
		attached(before, "selected straight Calle")
		await page.mouse.move((before.handles[0].x + before.handles[1].x) / 2, before.handles[0].y - 30)
		await page.mouse.wheel({ deltaY: -220 })
		await page.waitForFunction(previous => window.escala > previous, {}, before.scale)
		let after = await snapshot(page)
		attached(after, "wheel zoom")
		assert.deepEqual(after.geometry, before.geometry, "zoom does not edit Calle")

		before = after
		after = await dragHandle(page, "start", -35, -12)
		attached(after, "start drag")
		assert.notDeepEqual(after.geometry, before.geometry, `start drag edits Calle geometry (${JSON.stringify({ before, after })})`)
		near(after.endpoints.end.x, before.endpoints.end.x, "start drag anchors end x", 4)
		near(after.endpoints.end.y, before.endpoints.end.y, "start drag anchors end y", 4)

		before = after
		after = await dragHandle(page, "end", 35, 12)
		attached(after, "end drag")
		assert.notDeepEqual(after.geometry, before.geometry, "end drag edits Calle geometry")
		near(after.endpoints.start.x, before.endpoints.start.x, "end drag anchors start x", 4)
		near(after.endpoints.start.y, before.endpoints.start.y, "end drag anchors start y", 4)

		before = after
		after = await dragHandle(page, "start", -30, 15, "escape")
		assert.deepEqual(after.geometry, before.geometry, "Escape restores Calle geometry")
		attached(after, "Escape")
		after = await dragHandle(page, "end", 20, 0, "outside")
		assert.deepEqual(after.geometry, before.geometry, "release outside restores Calle geometry")
		attached(after, "outside release")

		await page.click("#streetInspectorClose")
		await page.waitForFunction(() => !window.calleSeleccionada)
		assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll(".street-endpoint-handle"))
			.filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden" }).length), 0, "closing selection hides both handles")
		console.log(`✅ straight Calle endpoint handles, zoom, drag, cancel and close (${usePixi ? "Pixi" : "Canvas"})`)
	} finally {
		await sim.close()
	}
}
