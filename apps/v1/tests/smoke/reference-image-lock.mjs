import assert from "node:assert/strict"
import { openSimulator } from "../helpers/simulator.mjs"

const imageData = "data:image/svg+xml," + encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#ff00ff"/></svg>',
)

async function setupImage(page) {
	await page.evaluate(async (dataUrl) => {
		await window.setReferenceImage({ dataUrl })
		const canvas = document.getElementById("simuladorCanvas")
		if (window.USE_PIXI) {
			const calle = window.calles.find((item) => !item.esCurva && item.tamano >= 10)
			const cell = obtenerCoordenadasGlobalesCelda(calle, 0, Math.floor(calle.tamano / 2))
			window.pixiApp.cameraController.setPosition(canvas.clientWidth / 2 - cell.x, canvas.clientHeight / 2 - cell.y)
		}
		Object.assign(window.referenceImage, {
			x: -window.offsetX / window.escala,
			y: -window.offsetY / window.escala,
			width: canvas.width / window.escala,
			height: canvas.height / window.escala,
		})
		if (window.USE_PIXI) window.pixiApp.sceneManager.renderAll()
		else window.renderizarCanvas()
	}, imageData)
	await page.waitForFunction(() => window.USE_PIXI
		? !!window.pixiApp?.sceneManager?.referenceImageRenderer?.sprite
		: !!window.referenceImage?.image?.complete)
	const initial = await page.evaluate(() => window.referenceImage.opacity)
	assert.equal(initial, 0.7, "new references start slightly transparent")
	const pixels = () => page.evaluate(() => {
		window.renderizarCanvas()
		return Array.from(document.getElementById("simuladorCanvas").getContext("2d").getImageData(30, 30, 1, 1).data)
	})
	const initialPixel = await page.evaluate(() => window.USE_PIXI) ? null : await pixels()
	await page.$eval("#opacidadImagenReferencia", (input) => {
		input.value = "45"
		input.dispatchEvent(new Event("input", { bubbles: true }))
	})
	if (initialPixel) assert.notDeepEqual(await pixels(), initialPixel, "opacity changes Canvas image pixels")
	else assert.equal(await page.evaluate(() => window.pixiApp.sceneManager.referenceImageRenderer.sprite.alpha), 0.45)
	await page.$eval("#btnBloquearImagenReferencia", (button) => button.click())
	const shownPixel = await page.evaluate(() => window.USE_PIXI) ? null : await pixels()
	const beforeHide = await page.evaluate(() => {
		const { x, y, width, height, rotation, opacity, locked } = window.referenceImage
		return { x, y, width, height, rotation, opacity, locked }
	})
	await page.$eval("#mostrarImagenReferencia", (input) => input.click())
	assert.equal(await page.evaluate(() => window.referenceImage.visible), false)
	assert.equal(await page.$eval(".reference-image-frame", (frame) => getComputedStyle(frame).display), "none")
	if (shownPixel) assert.notDeepEqual(await pixels(), shownPixel, "hiding removes image pixels from Canvas")
	else assert.equal(await page.evaluate(() => window.pixiApp.sceneManager.referenceImageRenderer.sprite.visible), false)
	await page.$eval("#mostrarImagenReferencia", (input) => input.click())
	assert.equal(await page.evaluate(() => window.referenceImage.visible), true)
	if (shownPixel) assert.deepEqual(await pixels(), shownPixel, "showing restores image pixels in Canvas")
	else assert.equal(await page.evaluate(() => window.pixiApp.sceneManager.referenceImageRenderer.sprite.visible), true)
	assert.deepEqual(await page.evaluate(() => {
		const { x, y, width, height, rotation, opacity, locked } = window.referenceImage
		return { x, y, width, height, rotation, opacity, locked }
	}), beforeHide, "hide/show preserves placement, opacity and lock")
	const state = await page.evaluate(() => ({
		frameHidden: getComputedStyle(document.querySelector(".reference-image-frame")).display === "none",
		visible: window.referenceImage.visible,
		opacity: window.referenceImage.opacity,
		pixiAlpha: window.USE_PIXI ? window.pixiApp.sceneManager.referenceImageRenderer.sprite.alpha : null,
		pixiVisible: window.USE_PIXI ? window.pixiApp.sceneManager.referenceImageRenderer.sprite.visible : null,
	}))
	assert.equal(state.frameHidden, true, "locking hides image editing handles")
	assert.equal(state.visible, true, "locked reference remains visible")
	assert.equal(state.opacity, 0.45)
	if (state.pixiAlpha !== null) {
		assert.equal(state.pixiAlpha, 0.45)
		assert.equal(state.pixiVisible, true)
	}
	const json = await page.evaluate(async () => {
		window.prompt = () => "Reference lock smoke"
		const original = URL.createObjectURL
		URL.createObjectURL = (blob) => {
			window.__referenceJSON = blob.text()
			return "blob:reference-lock-smoke"
		}
		try {
			window.guardarSimulacion()
			return await window.__referenceJSON
		} finally {
			URL.createObjectURL = original
		}
	})
	const saved = JSON.parse(json).imagenReferencia
	assert.equal(saved.opacity, 0.45)
	assert.equal(saved.visible, true)
	assert.equal(saved.locked, true)
	await page.evaluate((savedJson) => {
		window.confirm = () => true
		window.alert = () => {}
		window.referenceImage = null
		const file = new File([savedJson], "locked-reference.json", { type: "application/json" })
		window.cargarSimulacion({ target: { files: [file] } })
	}, json)
	await page.waitForFunction(() => window.referenceImage?.image?.complete && window.calles?.length > 0 && window.referenceImage.locked, { timeout: 20000 })
	assert.equal(await page.evaluate(() => window.referenceImage.opacity), 0.45)
	assert.equal(await page.evaluate(() => window.referenceImage.visible), true)
	assert.equal(await page.$eval("#btnBloquearImagenReferencia", (button) => button.getAttribute("aria-pressed")), "true")
}

async function clickStreetUnderImage(page) {
	const candidates = await page.evaluate(() => {
		const canvas = document.getElementById("simuladorCanvas")
		const rect = canvas.getBoundingClientRect()
		const width = window.USE_PIXI ? window.pixiApp.app.renderer.screen.width : canvas.width
		const height = window.USE_PIXI ? window.pixiApp.app.renderer.screen.height : canvas.height
		return window.calles.filter((calle) => !calle.esCurva && calle.tamano >= 10).map((calle) => {
			const cell = obtenerCoordenadasGlobalesCelda(calle, 0, Math.floor(calle.tamano / 2))
			return {
				id: calle.id,
				x: rect.left + (cell.x * window.escala + window.offsetX) * rect.width / width,
				y: rect.top + (cell.y * window.escala + window.offsetY) * rect.height / height,
			}
		}).filter((point) => point.x > 520 && point.y > 60 && point.x < innerWidth - 20 && point.y < innerHeight - 20)
	})
	for (const target of candidates) {
		await page.keyboard.down("Control")
		await page.mouse.click(target.x, target.y)
		await page.keyboard.up("Control")
		if (await page.evaluate(() => window.calleSeleccionada?.id) === target.id) return target
	}
	assert.fail(`click did not reach any street beneath locked image (${candidates.length} visible candidates)`)
}

async function editObject(page, type) {
	const before = await page.evaluate((kind) => {
		const object = kind === "calle" ? window.calleSeleccionada : window.edificios[0]
		if (!object) throw new Error(`No ${kind} available in the default map`)
		window.calleSeleccionada = kind === "calle" ? object : null
		window.edificioSeleccionado = kind === "edificio" ? object : null
		document.getElementById("btnModoEdicion").disabled = false
		return { id: object.id ?? object.label, x: object.x }
	}, type)
	await page.$eval("#btnModoEdicion", (button) => button.click())
	assert.equal(await page.evaluate(() => window.editorCalles.modoEdicion), true, `${type} enters edit mode under locked image`)
	if (type === "calle") {
		let point
		if (await page.evaluate(() => window.USE_PIXI)) {
			point = await page.evaluate(() => {
				const bounds = window.editorHandles.moveHandle.getBounds()
				const canvas = document.getElementById("simuladorCanvas")
				const rect = canvas.getBoundingClientRect()
				return { x: rect.left + bounds.x + bounds.width / 2, y: rect.top + bounds.y + bounds.height / 2 }
			})
		} else {
			const handle = await page.$("#moveHandle.active")
			assert.ok(handle, "street move handle appears while reference is locked")
			const box = await handle.boundingBox()
			point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
		}
		await page.mouse.move(point.x, point.y)
		await page.mouse.down()
		await page.mouse.move(point.x + 35, point.y + 20, { steps: 5 })
		await page.mouse.up()
		assert.notEqual(await page.evaluate(() => window.editorCalles.objetoEditando?.x), before.x, "drag reaches street editor beneath locked image")
	}
	await page.evaluate(() => {
		const input = document.getElementById("inputPosX")
		input.value = String(Number(input.value) + 17)
		input.dispatchEvent(new Event("input", { bubbles: true }))
		document.getElementById("btnAplicarPosicion").click()
	})
	const after = await page.evaluate((kind) => {
		const object = window.editorCalles.objetoEditando
		return object?.x ?? (kind === "calle"
			? window.calles.find((item) => !item.esCurva)?.x
			: window.edificios[0]?.x)
	}, type)
	assert.notEqual(after, before.x, `${type} position changes while reference is locked`)
}

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 31, usePixi, freezeFrames: false })
	try {
		if (usePixi) await sim.page.waitForFunction(() => !!window.pixiApp?.sceneManager, { timeout: 30000 })
		await sim.page.evaluate(() => window.hideLoadingScreen?.())
		await setupImage(sim.page)
		await clickStreetUnderImage(sim.page)
		for (const type of ["calle", "edificio"]) {
			await editObject(sim.page, type)
			await sim.page.$eval("#btnCancelarEdicion", (button) => button.click())
			await sim.page.evaluate(() => {
				window.calleSeleccionada = null
				window.edificioSeleccionado = null
			})
		}
		await sim.page.$eval("#btnBloquearImagenReferencia", (button) => button.click())
		assert.equal(await sim.page.$eval(".reference-image-frame", (frame) => getComputedStyle(frame).display), "block", "unlock restores image editing")
		console.log(`✅ reference image locked display and calle/edificio editing (${usePixi ? "Pixi" : "Canvas"})`)
	} finally {
		await sim.close()
	}
}
