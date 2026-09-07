import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { openSimulator } from "../helpers/simulator.mjs"

const EVIDENCE_DIR = new URL("./evidence", import.meta.url).pathname
const results = []

function record(item, ok, note) {
	results.push({ item, ok, note })
	console.log(`${ok ? "✅" : "❌"} ${item}${note ? ` — ${note}` : ""}`)
}

const totalCars = (page) =>
	page.evaluate(
		() =>
			window.calles.reduce(
				(sum, calle) =>
					sum + calle.arreglo.reduce((s, lane) => s + lane.filter((v) => v > 0).length, 0),
				0,
			),
	)

const canvasHash = (page) =>
	page
		.evaluate(() => document.getElementById("simuladorCanvas").toDataURL("image/png"))
		.then((url) => createHash("sha256").update(url).digest("hex"))

const stateHash = (page) =>
	page
		.evaluate(() => window.calles.map((c) => c.arreglo.flat().join("")).join("|"))
		.then((s) => createHash("sha256").update(s).digest("hex"))

async function screenshot(page, name) {
	await page.screenshot({ path: join(EVIDENCE_DIR, `${name}.png`) })
}

async function dismissLoading(page) {
	await page.evaluate(() => window.hideLoadingScreen?.())
	await page.waitForFunction(
		() => {
			const el = document.getElementById("loadingScreen")
			return !el || getComputedStyle(el).display === "none"
		},
		{ polling: 200, timeout: 20000 },
	)
}

// Bug preexistente documentado por esta línea base: los handlers canvas
// mouseup/mouseleave de trafico.js asignan sobre `controlandoVertice` /
// `verticeSeleccionado`, declarados const en curvas.js → TypeError en cada
// mouseup sobre el canvas. No se corrige aquí para conservar el comportamiento.
const KNOWN_ISSUE = "Assignment to constant variable"
const unexpectedErrors = (sim) => sim.pageErrors.filter((message) => !message.includes(KNOWN_ISSUE))

function assertNoUnexpectedErrors(sim) {
	const unexpected = unexpectedErrors(sim)
	if (unexpected.length) throw new Error(`pageerrors: ${unexpected.slice(0, 3).join(" | ")}`)
	const known = sim.pageErrors.filter((m) => m.includes(KNOWN_ISSUE)).length
	if (known > 0) console.log(`ℹ️  Bug preexistente observado ${known}x: mouseup sobre canvas lanza TypeError por reasignar const (trafico.js:4752/4767)`)
}

async function dragMinimap(page) {
	const probe = await page.evaluate(() => {
		const mini = document.getElementById("minimapa")
		const rect = mini.getBoundingClientRect()
		const params = window.calcularParametrosMinimapa()
		const viewport = window.calcularViewportVisible()
		return {
			cx: rect.left + params.minimapaOffsetX + (viewport.x + viewport.ancho / 2) * params.minimapaEscala,
			cy: rect.top + params.minimapaOffsetY + (viewport.y + viewport.alto / 2) * params.minimapaEscala,
			offsetBefore: [window.offsetX, window.offsetY],
		}
	})
	await page.mouse.move(probe.cx, probe.cy)
	await page.mouse.down()
	const grabbing = await page.evaluate(() => document.getElementById("minimapa").style.cursor === "grabbing")
	await page.mouse.move(probe.cx + 30, probe.cy + 15, { steps: 4 })
	await page.mouse.up()
	const offsetAfter = await page.evaluate(() => [window.offsetX, window.offsetY])
	const panned = Math.abs(offsetAfter[0] - probe.offsetBefore[0]) > 5 || Math.abs(offsetAfter[1] - probe.offsetBefore[1]) > 5
	return { grabbing, panned }
}

async function checkCanvas2D() {
	const sim = await openSimulator({ seed: 3, usePixi: false, freezeFrames: false })
	try {
		await dismissLoading(sim.page)
		await sim.page.evaluate(() => {
			window.__clears = 0
			const proto = CanvasRenderingContext2D.prototype
			const original = proto.clearRect
			proto.clearRect = function (...args) {
				window.__clears++
				return original.apply(this, args)
			}
		})
		const flags = await sim.page.evaluate(() => ({
			usesPixi: window.USE_PIXI,
			hasCanvas: !!document.getElementById("simuladorCanvas").getContext("2d"),
		}))
		const carsAt = () => totalCars(sim.page)
		const clearsAt = () => sim.page.evaluate(() => window.__clears)
		await sim.page.waitForFunction(() => window.calles.some((c) => c.arreglo.flat().some((v) => v > 0)), { polling: 100, timeout: 20000 })
		const cars1 = await carsAt()
		const clears1 = await clearsAt()
		const h1 = await canvasHash(sim.page)
		await new Promise((r) => setTimeout(r, 700))
		const cars2 = await carsAt()
		const clears2 = await clearsAt()
		// 🎲 llena los carriles visibles: prueba píxel a píxel de que el canvas se repinta
		await sim.page.click("#btnRandom")
		const h2 = await canvasHash(sim.page)
		record(
			"Canvas 2D carga y anima",
			!flags.usesPixi && flags.hasCanvas && cars2 > cars1 && clears2 > clears1 && h1 !== h2,
			`vehículos ${cars1}→${cars2}, repintados ${clears2 - clears1}, píxeles reactivos=${h1 !== h2}`,
		)
		await screenshot(sim.page, "01-canvas2d")
		assertNoUnexpectedErrors(sim)
	} finally {
		await sim.close()
	}
}

async function checkPixi() {
	const sim = await openSimulator({ seed: 4, usePixi: true, freezeFrames: false })
	try {
		await sim.page.waitForFunction(() => !!window.pixiApp?.sceneManager, { polling: 100, timeout: 30000 })
		const state = await sim.page.evaluate(() => ({
			usePixi: window.USE_PIXI,
			children: window.pixiApp.app?.stage?.children.length ?? 0,
			minimap: !!window.pixiApp.minimapRenderer,
		}))
		const cars = await totalCars(sim.page)
		record(
			"PixiJS inicializa tras el escenario",
			state.usePixi && state.children > 0 && cars > 0,
			`stage children=${state.children}, minimap=${state.minimap}, vehiculos=${cars}`,
		)
		await dismissLoading(sim.page)
		await sim.page.click("#btnPauseResume")
		const pasoEnabled = await sim.page.evaluate(() => !document.getElementById("btnPaso").disabled)
		await sim.page.click("#btnPaso")
		const escalaBefore = await sim.page.evaluate(() => window.escala)
		await sim.page.mouse.move(700, 450)
		await sim.page.mouse.wheel({ deltaY: -240 })
		const escalaAfter = await sim.page.evaluate(() => window.escala)
		record(
			"Controles y zoom con PixiJS activo",
			pasoEnabled && escalaAfter > escalaBefore,
			`paso=${pasoEnabled}, escala ${escalaBefore.toFixed(2)}→${escalaAfter.toFixed(2)}`,
		)
		const miniPixi = await dragMinimap(sim.page)
		record("Minimapa: arrastre del viewport (PixiJS)", miniPixi.grabbing && miniPixi.panned, `grab=${miniPixi.grabbing}, pan=${miniPixi.panned}`)
		await screenshot(sim.page, "02-pixi")
		assertNoUnexpectedErrors(sim)
	} finally {
		await sim.close()
	}
}

async function clickStreetCenter(page) {
	const candidates = await page.evaluate(() => {
		const canvas = document.getElementById("simuladorCanvas")
		const rect = canvas.getBoundingClientRect()
		const scaleX = rect.width / canvas.width
		const scaleY = rect.height / canvas.height
		const out = []
		for (const target of window.calles) {
			if (target.esCurva || target.tamano < 10) continue
			const cell = obtenerCoordenadasGlobalesCelda(target, 0, Math.floor(target.tamano / 2))
			const x = rect.left + (cell.x * window.escala + window.offsetX) * scaleX
			const y = rect.top + (cell.y * window.escala + window.offsetY) * scaleY
			if (x > 520 && y > 60 && x < innerWidth - 20 && y < innerHeight - 20) {
				out.push({ x, y, id: target.id })
			}
		}
		return out
	})
	if (!candidates.length) throw new Error("no hay calles rectas visibles")
	for (const point of candidates) {
		await page.keyboard.down("Control")
		await page.mouse.click(point.x, point.y)
		await page.keyboard.up("Control")
		const selected = await page.evaluate(() => window.calleSeleccionada?.id ?? null)
		if (selected === point.id) return point
	}
	throw new Error("ninguna calle respondió a ctrl+clic")
}

async function checkControlsEditorMinimapTouch() {
	const sim = await openSimulator({ seed: 5, usePixi: false, freezeFrames: true, hasTouch: true })
	const page = sim.page
	try {
		await dismissLoading(page)

		// — Controles de simulación —
		await page.click("#btnPauseResume")
		const pasoEnabled = await page.evaluate(() => !document.getElementById("btnPaso").disabled)
		await page.click("#btnRandom")
		const afterRandom = await totalCars(page)
		const stateBeforeStep = await stateHash(page)
		await page.click("#btnPaso")
		const stateAfterStep = await stateHash(page)
		await page.evaluate(() => {
			const slider = document.getElementById("velocidadSlider")
			slider.value = 80
			slider.dispatchEvent(new Event("input"))
		})
		const speed = await page.evaluate(() => ({
			intervalo: window.intervaloDeseado,
			label: document.getElementById("velocidadValor").textContent,
		}))
		await page.click("#btnBorrar")
		const afterClear = await totalCars(page)
		record(
			"Controles: pausa, paso, velocidad, aleatorio, borrar",
			pasoEnabled &&
				afterRandom > 0 &&
				stateAfterStep !== stateBeforeStep &&
				speed.intervalo !== 125 &&
				speed.label === "80" &&
				afterClear === 0,
			`random=${afterRandom}, intervalo=${speed.intervalo}, tras borrar=${afterClear}`,
		)

		// — Selección y editor —
		const clicked = await clickStreetCenter(page)
		const selected = await page.evaluate(() => window.calleSeleccionada?.id ?? null)
		await page.$eval("#btnModoEdicion", (el) => el.click())
		await page.waitForSelector("#moveHandle.active", { visible: true, timeout: 5000 })
		const handle = await page.$("#moveHandle")
		const box = await handle.boundingBox()
		const xBefore = await page.evaluate((id) => window.calles.find((c) => c.id === id).x, clicked.id)
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await page.mouse.down()
		await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 })
		await page.mouse.up()
		const xAfter = await page.evaluate((id) => window.calles.find((c) => c.id === id).x, clicked.id)
		record(
			"Editor: ctrl+clic, modo edición, arrastre de calle",
			selected === clicked.id && xBefore !== xAfter,
			`seleccion=${selected}, x ${Math.round(xBefore)}→${Math.round(xAfter)}`,
		)
		await screenshot(page, "03-editor")

		// — Minimapa (fallback Canvas 2D) — defecto preexistente documentado:
		// el arrastre inicia pero aplicarLimitesOffset() reconstruye el offset desde
		// window.offsetX (espejo obsoleto) y la vista no se mueve.
		const miniCanvas = await dragMinimap(page)
		record(
			"Minimapa (Canvas 2D): defecto conocido — arrastre no reposiciona",
			miniCanvas.grabbing && !miniCanvas.panned,
			`grab=${miniCanvas.grabbing}, pan=${miniCanvas.panned} (esperado: sin pan)`,
		)
		await screenshot(page, "04-minimapa")

		// — Constructor (sección del acordeón) —
		await page.$eval("#headingConstructor button", (el) => el.click())
		const constructorVisible = await page.waitForFunction(
			() => document.getElementById("collapseConstructor")?.classList.contains("show"),
			{ polling: 100, timeout: 5000 },
		).then(() => true).catch(() => false)
		const constructorControls = await page.evaluate(() => ({
			tipo: !!document.getElementById("selectTipoObjeto"),
			guardar: !!document.getElementById("btnGuardarEscenario"),
		}))
		record("Constructor: panel disponible", constructorVisible && constructorControls.tipo && constructorControls.guardar, `abierto=${constructorVisible}`)

		// — Zoom con rueda —
		const escalaBefore = await page.evaluate(() => window.escala)
		await page.mouse.move(700, 450)
		await page.mouse.wheel({ deltaY: -240 })
		const escalaAfter = await page.evaluate(() => window.escala)
		record("Zoom con rueda", escalaAfter > escalaBefore, `escala ${escalaBefore}→${escalaAfter}`)

		// — Navegación táctil — (emulación de touch ya activa desde la apertura)
		await page.evaluate(() => {
			const sw = document.getElementById("switchDebugMovil")
			sw.checked = true
			sw.dispatchEvent(new Event("change"))
		})
		const cdp = await page.createCDPSession()
		const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points })
		const offsetBefore = await page.evaluate(() => [window.offsetX, window.offsetY])
		await touch("touchStart", [{ x: 700, y: 450, id: 1 }])
		await touch("touchMove", [{ x: 620, y: 400, id: 1 }])
		const panDebug = await page.evaluate(() => document.getElementById("debugMovil")?.innerText ?? "")
		await touch("touchEnd", [])
		const offsetAfterPan = await page.evaluate(() => [window.offsetX, window.offsetY])
		const panOk = Math.abs(offsetAfterPan[0] - offsetBefore[0]) > 10 && /TOUCHMOVE OK/.test(panDebug)
		const escalaTouchBefore = await page.evaluate(() => window.escala)
		await touch("touchStart", [
			{ x: 650, y: 450, id: 1 },
			{ x: 750, y: 450, id: 2 },
		])
		await touch("touchMove", [
			{ x: 580, y: 450, id: 1 },
			{ x: 820, y: 450, id: 2 },
		])
		await touch("touchMove", [
			{ x: 520, y: 450, id: 1 },
			{ x: 880, y: 450, id: 2 },
		])
		const pinchDebug = await page.evaluate(() => document.getElementById("debugMovil")?.innerText ?? "")
		await touch("touchEnd", [])
		const escalaTouchAfter = await page.evaluate(() => window.escala)
		await screenshot(page, "05-touch")
		record(
			"Navegación táctil: arrastre y pinch",
			panOk && escalaTouchAfter > escalaTouchBefore * 1.05 && /PINCH/.test(pinchDebug),
			`pan=${panOk}, escala ${escalaTouchBefore.toFixed(2)}→${escalaTouchAfter.toFixed(2)}`,
		)

		assertNoUnexpectedErrors(sim)
	} finally {
		await sim.close()
	}
}

await mkdir(EVIDENCE_DIR, { recursive: true })
try {
	await checkCanvas2D()
	await checkPixi()
	await checkControlsEditorMinimapTouch()
} catch (error) {
	record("smoke completado sin fallos técnicas", false, error.message)
}

const failed = results.filter((r) => !r.ok)
console.log(`\nResultado: ${results.length - failed.length}/${results.length} items OK`)
process.exitCode = failed.length ? 1 : 0
