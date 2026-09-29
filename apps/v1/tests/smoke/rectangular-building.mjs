import assert from "node:assert/strict"
import { openSimulator } from "../helpers/simulator.mjs"

async function drag(page, from, to) {
	await page.mouse.move(from.x, from.y)
	await page.mouse.down()
	await page.mouse.move(to.x, to.y, { steps: 5 })
	await page.mouse.up()
}

async function edit(page, selector, value) {
	await page.$eval(selector, (input, next) => {
		input.value = next
		input.dispatchEvent(new Event("input", { bubbles: true }))
	}, String(value))
}

async function captureJson(page) {
	return page.evaluate(async () => {
		window.prompt = () => "Rectangle round trip"
		window.alert = () => {}
		const original = URL.createObjectURL
		URL.createObjectURL = (blob) => {
			window.__buildingJSON = blob.text()
			return "blob:building-smoke"
		}
		try {
			window.guardarSimulacion()
			return await window.__buildingJSON
		} finally {
			URL.createObjectURL = original
		}
	})
}

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 91, usePixi, freezeFrames: false })
	let savedJson
	try {
		const { page } = sim
		if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.sceneManager, { timeout: 30000 })
		await page.evaluate(() => {
			window.hideLoadingScreen?.()
			window.confirm = () => true
			window.alert = () => {}
			document.getElementById("btnNuevaSimulacion").click()
		})
		await page.waitForFunction(() => getComputedStyle(document.getElementById("loadingScreen")).display === "none")
		await page.waitForFunction(() => window.edificios.length === 0 && !!window.drawBuildingTool)

		const canvas = await page.$("#simuladorCanvas")
		const box = await canvas.boundingBox()
		const first = { x: box.x + box.width * 0.48, y: box.y + box.height * 0.36 }
		const second = { x: first.x + 124, y: first.y + 72 }
		await page.$eval("#drawBuildingButton", button => button.click())
		await drag(page, first, second)
		assert.equal(await page.evaluate(() => window.edificios.length), 1, "one drag creates exactly one building")
		assert.deepEqual(await page.evaluate(() => {
			const b = window.edificios[0]
			return { mode: b.appearanceMode, independent: Math.abs(b.width - b.height) > 20, selected: window.edificioSeleccionado === b }
		}), { mode: "rectangular", independent: true, selected: true })
		assert.equal(await page.$eval("#buildingInspector", el => el.hidden), false, "creation opens unified inspector")

		await page.$eval("#buildingProportionLock", input => input.click())
		await page.$eval("#drawBuildingButton", button => button.click())
		await drag(page, { x: first.x + 180, y: first.y + 120 }, { x: first.x + 270, y: first.y + 175 })
		assert.equal(await page.evaluate(() => window.edificios.length), 2, "a second gesture creates only one more building")
		assert.ok(await page.evaluate(() => Math.abs(window.edificios[1].width - window.edificios[1].height) < 0.001), "proportion lock creates a square")
		await page.$eval("#buildingProportionLock", input => input.click())

		await edit(page, "#buildingInspectorName", "Rectángulo editable")
		await edit(page, "#buildingInspectorX", 321.25)
		await edit(page, "#buildingInspectorY", 222.5)
		await edit(page, "#buildingInspectorWidth", 135)
		await edit(page, "#buildingInspectorHeight", 75)
		await edit(page, "#buildingInspectorAngle", 28)
		assert.deepEqual(await page.evaluate(() => {
			const b = window.edificioSeleccionado
			return { label: b.label, x: b.x, y: b.y, width: b.width, height: b.height, angle: b.angle }
		}), { label: "Rectángulo editable", x: 321.25, y: 222.5, width: 135, height: 75, angle: 28 }, "valid inspector edits apply immediately")

		const beforeInvalid = await page.evaluate(() => ({ ...window.edificioSeleccionado }))
		await edit(page, "#buildingInspectorWidth", "")
		await edit(page, "#buildingInspectorHeight", -2)
		await edit(page, "#buildingInspectorX", "not-a-number")
		assert.deepEqual(await page.evaluate(() => {
			const b = window.edificioSeleccionado
			return { x: b.x, width: b.width, height: b.height }
		}), { x: beforeInvalid.x, width: beforeInvalid.width, height: beforeInvalid.height }, "invalid intermediate values preserve valid geometry")
		assert.ok(await page.$eval("#buildingInspectorError", el => el.textContent.length > 0), "invalid input has visible feedback")

		await page.evaluate(() => { window.edificios[0].color = "#123456" })
		await page.$eval("#selectEdificio", select => { select.value = "0"; select.dispatchEvent(new Event("change", { bubbles: true })) })
		assert.equal(await page.$$eval('[name="buildingColor"][aria-pressed="true"]', buttons => buttons.length), 0, "an arbitrary legacy color is not misidentified")
		assert.equal(await page.evaluate(() => window.edificioSeleccionado.color), "#123456", "selecting an old building preserves its color")
		await page.$eval('[name="buildingColor"][value="#8B4513"]', button => button.click())
		assert.equal(await page.evaluate(() => window.edificioSeleccionado.color), "#8B4513", "legacy brown is an explicit palette choice")
		assert.equal(await page.$$eval('[name="buildingColor"]', buttons => buttons.length), 6, "shape palette contains six fixed choices")
		await page.evaluate(() => { window.edificioSeleccionado.color = "#A0522D80"; window.buildingInspector.refresh() })
		assert.equal(await page.$$eval('[name="buildingColor"][aria-pressed="true"]', buttons => buttons.length), 0, "an alpha color is not misidentified as its six-digit palette prefix")

		await page.$eval("#selectEdificio", select => { select.value = "1"; select.dispatchEvent(new Event("change", { bubbles: true })) })
		assert.equal(await page.$eval("#buildingInspectorWidth", input => Number(input.value)), 135, "changing selection refreshes inspector values")
		const visibleCenter = await page.evaluate(() => {
			const canvas = document.getElementById("simuladorCanvas")
			const rect = canvas.getBoundingClientRect()
			return window.USE_PIXI ? window.pixiApp.cameraController.screenToWorld(rect.width * 0.55, rect.height * 0.55) : {
				x: (canvas.width * 0.55 - window.offsetX) / window.escala,
				y: (canvas.height * 0.55 - window.offsetY) / window.escala,
			}
		})
		await edit(page, "#buildingInspectorX", visibleCenter.x)
		await edit(page, "#buildingInspectorY", visibleCenter.y)
		const move = await page.$(".building-move-handle:not([hidden])")
		const moveBox = await move.boundingBox()
		const beforeMove = await page.evaluate(() => window.edificioSeleccionado.x)
		await drag(page, { x: moveBox.x + moveBox.width / 2, y: moveBox.y + moveBox.height / 2 }, { x: moveBox.x + moveBox.width / 2 + 30, y: moveBox.y + moveBox.height / 2 + 14 })
		assert.notEqual(await page.evaluate(() => window.edificioSeleccionado.x), beforeMove, "map move handle applies immediately")
		const resize = await page.$(".building-resize-handle:not([hidden])")
		const resizeBox = await resize.boundingBox()
		const beforeSize = await page.evaluate(() => window.edificioSeleccionado.width)
		await drag(page, { x: resizeBox.x + resizeBox.width / 2, y: resizeBox.y + resizeBox.height / 2 }, { x: resizeBox.x + resizeBox.width / 2 + 35, y: resizeBox.y + resizeBox.height / 2 + 20 })
		assert.notEqual(await page.evaluate(() => window.edificioSeleccionado.width), beforeSize, "map resize handle applies immediately")
		const rotate = await page.$(".building-rotate-handle:not([hidden])")
		const rotateBox = await rotate.boundingBox()
		const beforeRotation = await page.evaluate(() => window.edificioSeleccionado.angle)
		await drag(page, { x: rotateBox.x + rotateBox.width / 2, y: rotateBox.y + rotateBox.height / 2 }, { x: rotateBox.x + rotateBox.width / 2 + 45, y: rotateBox.y + rotateBox.height / 2 + 30 })
		assert.notEqual(await page.evaluate(() => window.edificioSeleccionado.angle), beforeRotation, "map rotation handle applies immediately")
		const rotatedResize = await page.$(".building-resize-handle:not([hidden])")
		const rotatedResizeBox = await rotatedResize.boundingBox()
		const beforeRotatedResize = await page.evaluate(() => ({ width: window.edificioSeleccionado.width, height: window.edificioSeleccionado.height }))
		await drag(page, { x: rotatedResizeBox.x + rotatedResizeBox.width / 2, y: rotatedResizeBox.y + rotatedResizeBox.height / 2 }, { x: rotatedResizeBox.x + rotatedResizeBox.width / 2 + 20, y: rotatedResizeBox.y + rotatedResizeBox.height / 2 + 12 })
		assert.ok(await page.evaluate(({ width, height }) => {
			const building = window.edificioSeleccionado
			return Number.isFinite(building.width) && Number.isFinite(building.height) && building.width > 0 && building.height > 0 && (building.width !== width || building.height !== height)
		}, beforeRotatedResize), "a rotated resize remains valid and changes size")

		await page.evaluate(({ x, y }) => {
			const legacy = window.agregarEdificio("Legacy rectangle", x + 220, y - 110, 84, 46, 13)
			legacy.color = "#C0FFEE"
			delete legacy.appearanceMode
			window.actualizarSelectorEdificios()
		}, visibleCenter)
		await page.$eval("#selectEdificio", select => { select.value = "2"; select.dispatchEvent(new Event("change", { bubbles: true })) })
		assert.equal(await page.evaluate(() => window.edificioSeleccionado.color), "#C0FFEE", "pre-feature rectangle keeps an arbitrary saved color")
		assert.equal(await page.$$eval('[name="buildingColor"][aria-pressed="true"]', buttons => buttons.length), 0, "pre-feature arbitrary color has no false active swatch")

		savedJson = await captureJson(page)
		const saved = JSON.parse(savedJson).edificios
		assert.deepEqual(saved.map(({ x, y, width, height, angle, color, appearanceMode }) => ({ x, y, width, height, angle, color, appearanceMode: appearanceMode ?? null })),
			await page.evaluate(() => window.edificios.map(({ x, y, width, height, angle, color, appearanceMode }) => ({ x, y, width, height, angle, color, appearanceMode: appearanceMode ?? null }))), "JSON captures exact rectangle appearance and placement")
	} finally {
		await sim.close()
	}

	const fresh = await openSimulator({ seed: 92, usePixi, freezeFrames: false })
	try {
		if (usePixi) await fresh.page.waitForFunction(() => !!window.pixiApp?.sceneManager, { timeout: 30000 })
		await fresh.page.evaluate((json) => {
			window.hideLoadingScreen?.()
			window.confirm = () => true
			window.alert = () => {}
			const file = new File([json], "rectangles.json", { type: "application/json" })
			window.cargarSimulacion({ target: { files: [file] } })
		}, savedJson)
		await fresh.page.waitForFunction(() => getComputedStyle(document.getElementById("loadingScreen")).display === "none")
		await fresh.page.waitForFunction(() => window.edificios?.length === 3, { timeout: 20000 })
		assert.deepEqual(await fresh.page.evaluate(() => window.edificios.map(({ x, y, width, height, angle, color, appearanceMode }) => ({ x, y, width, height, angle, color, appearanceMode: appearanceMode ?? null }))),
			JSON.parse(savedJson).edificios.map(({ x, y, width, height, angle, color, appearanceMode }) => ({ x, y, width, height, angle, color, appearanceMode: appearanceMode ?? null })), "fresh app restores exact rectangles")
		const legacyPoint = await fresh.page.evaluate(() => {
			const building = window.edificios.find(item => item.label === "Legacy rectangle")
			const canvas = document.getElementById("simuladorCanvas")
			const rect = canvas.getBoundingClientRect()
			window.renderizarCanvas?.()
			const camera = window.USE_PIXI && window.pixiApp?.cameraController
			const raw = camera ? camera.worldToScreen(building.x, building.y) : { x: building.x * window.escala + window.offsetX, y: building.y * window.escala + window.offsetY }
			const screen = camera ? window.pixiApp.app.screen : { width: canvas.width, height: canvas.height }
			return {
				x: rect.left + raw.x * rect.width / screen.width,
				y: rect.top + raw.y * rect.height / screen.height,
				rendered: camera ? window.pixiApp.sceneManager.edificioSprites.has(building) : (() => {
					const angle = building.angle * Math.PI / 180
					const worldX = building.x + 20 * Math.cos(angle)
					const worldY = building.y + 20 * Math.sin(angle)
					const pixel = canvas.getContext("2d").getImageData(Math.round(worldX * window.escala + window.offsetX), Math.round(worldY * window.escala + window.offsetY), 1, 1).data
					return pixel[0] === 192 && pixel[1] === 255 && pixel[2] === 238
				})(),
			}
		})
		assert.equal(legacyPoint.rendered, true, "legacy rectangle renders with its original color")
		await fresh.page.keyboard.down("Control")
		await fresh.page.mouse.click(legacyPoint.x, legacyPoint.y)
		await fresh.page.keyboard.up("Control")
		assert.equal(await fresh.page.evaluate(() => window.edificioSeleccionado?.label), "Legacy rectangle", "legacy rectangle remains map-selectable")
		await fresh.page.waitForFunction(() => document.getElementById("buildingInspectorName")?.value === "Legacy rectangle")
		const freshCenter = await fresh.page.evaluate(() => {
			const canvas = document.getElementById("simuladorCanvas")
			const rect = canvas.getBoundingClientRect()
			return window.USE_PIXI ? window.pixiApp.cameraController.screenToWorld(window.pixiApp.app.screen.width * 0.65, window.pixiApp.app.screen.height * 0.55) : {
				x: (canvas.width * 0.65 - window.offsetX) / window.escala,
				y: (canvas.height * 0.55 - window.offsetY) / window.escala,
			}
		})
		await edit(fresh.page, "#buildingInspectorX", freshCenter.x)
		await edit(fresh.page, "#buildingInspectorY", freshCenter.y)
		const legacyMove = await fresh.page.$(".building-move-handle:not([hidden])")
		const legacyMoveBox = await legacyMove.boundingBox()
		const legacyX = await fresh.page.evaluate(() => window.edificioSeleccionado.x)
		await drag(fresh.page, { x: legacyMoveBox.x + legacyMoveBox.width / 2, y: legacyMoveBox.y + legacyMoveBox.height / 2 }, { x: legacyMoveBox.x + legacyMoveBox.width / 2 + 18, y: legacyMoveBox.y + legacyMoveBox.height / 2 + 10 })
		assert.notEqual(await fresh.page.evaluate(() => window.edificioSeleccionado.x), legacyX, "legacy rectangle remains movable")
		const canvas = await fresh.page.$("#simuladorCanvas")
		const box = await canvas.boundingBox()
		await fresh.page.$eval("#drawBuildingButton", button => button.click())
		await drag(fresh.page, { x: box.x + box.width * 0.76, y: box.y + box.height * 0.24 }, { x: box.x + box.width * 0.86, y: box.y + box.height * 0.31 })
		assert.equal(await fresh.page.evaluate(() => window.edificios.length), 4, "one post-load gesture still appends exactly one building")
		console.log(`✅ rectangular building inspector (${usePixi ? "Pixi" : "Canvas"})`)
	} finally {
		await fresh.close()
	}
}
