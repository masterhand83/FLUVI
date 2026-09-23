import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

const MODES = [
	["Canvas", false],
	["Pixi", true],
]

describe.each(MODES)("reference image alignment in %s mode", (_mode, usePixi) => {
	let sim
	let reopened

	beforeAll(async () => {
		sim = await openSimulator({ usePixi })
		if (usePixi) await sim.page.waitForFunction(() => window.pixiApp?.sceneManager, { polling: 100, timeout: 30000 })
		await dismissLoading(sim.page)
	}, 180000)

	afterAll(async () => {
		await reopened?.close()
		await sim?.close()
	})

	it("drags, proportionally resizes, rotates, and restores the edited placement via simulation JSON", async () => {
		const dataUrl = await sim.page.evaluate(() => {
			const canvas = document.createElement("canvas")
			canvas.width = 240
			canvas.height = 120
			const context = canvas.getContext("2d")
			context.fillStyle = "#ff00ff"
			context.fillRect(0, 0, canvas.width, canvas.height)
			return canvas.toDataURL("image/png")
		})
		await sim.page.evaluate((data) => window.setReferenceImage(data), dataUrl)

		// The selection overlay is part of the user-facing interaction contract:
		// move the image by dragging its visible body, then use visible corner and rotation handles.
		const imageCenter = await sim.page.evaluate(() => {
			const image = window.referenceImage
			const view = window.USE_PIXI ? window.pixiApp.app.view : document.getElementById("simuladorCanvas")
			const rect = view.getBoundingClientRect()
			const factorX = rect.width / view.width
			const factorY = rect.height / view.height
			return {
				x: rect.left + (image.x + image.width / 2) * window.escala * factorX + window.offsetX * factorX,
				y: rect.top + (image.y + image.height / 2) * window.escala * factorY + window.offsetY * factorY,
			}
		})
		const beforeDrag = await readPlacement(sim.page)
		await sim.page.mouse.move(imageCenter.x, imageCenter.y)
		await sim.page.mouse.down()
		await sim.page.mouse.move(imageCenter.x + 64, imageCenter.y + 36, { steps: 8 })
		await sim.page.mouse.up()
		const afterDrag = await readPlacement(sim.page)
		expect(afterDrag.x).not.toBeCloseTo(beforeDrag.x, 1)
		expect(afterDrag.y).not.toBeCloseTo(beforeDrag.y, 1)

		const resize = await sim.page.$('[data-reference-image-handle="resize"]')
		expect(resize, "visible resize-corner handle").not.toBeNull()
		const resizeBox = await resize.boundingBox()
		expect(resizeBox).not.toBeNull()
		const ratioBefore = afterDrag.width / afterDrag.height
		await sim.page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2)
		await sim.page.mouse.down()
		await sim.page.mouse.move(resizeBox.x + resizeBox.width / 2 + 48, resizeBox.y + resizeBox.height / 2 + 24, { steps: 8 })
		await sim.page.mouse.up()
		const afterResize = await readPlacement(sim.page)
		expect(afterResize.width).toBeGreaterThan(afterDrag.width)
		expect(afterResize.height).toBeGreaterThan(afterDrag.height)
		expect(afterResize.width / afterResize.height).toBeCloseTo(ratioBefore, 2)

		const rotate = await sim.page.$('[data-reference-image-handle="rotate"]')
		expect(rotate, "visible rotation handle").not.toBeNull()
		const rotateBox = await rotate.boundingBox()
		expect(rotateBox).not.toBeNull()
		const angleBefore = afterResize.rotation ?? afterResize.angle ?? 0
		await sim.page.mouse.move(rotateBox.x + rotateBox.width / 2, rotateBox.y + rotateBox.height / 2)
		await sim.page.mouse.down()
		await sim.page.mouse.move(rotateBox.x + rotateBox.width / 2 + 42, rotateBox.y + rotateBox.height / 2 + 32, { steps: 8 })
		await sim.page.mouse.up()
		const edited = await readPlacement(sim.page)
		const angleAfter = edited.rotation ?? edited.angle ?? 0
		expect(angleAfter).not.toBeCloseTo(angleBefore, 1)
		// Camera movement changes only the screen projection, never the world placement.
		await sim.page.mouse.move(imageCenter.x, imageCenter.y)
		await sim.page.mouse.wheel({ deltaY: -180 })
		expect(await readPlacement(sim.page)).toEqual(edited)
		await sim.page.evaluate(() => document.getElementById("btnBloquearImagenReferencia").click())
		expect(await sim.page.$eval(".reference-image-frame", (frame) => getComputedStyle(frame).display)).toBe("none")
		await sim.page.evaluate(() => document.getElementById("btnBloquearImagenReferencia").click())
		expect(await sim.page.$eval(".reference-image-frame", (frame) => getComputedStyle(frame).display)).toBe("block")

		const json = await sim.page.evaluate(async () => {
			window.prompt = () => "Aligned reference image"
			const createObjectURL = URL.createObjectURL
			URL.createObjectURL = (blob) => {
				window.__alignmentJSON = blob.text()
				return "blob:reference-image-alignment-test"
			}
			window.guardarSimulacion()
			URL.createObjectURL = createObjectURL
			return await window.__alignmentJSON
		})
		const savedImage = JSON.parse(json).imagenReferencia
		expect(savedImage).toMatchObject({ dataUrl, x: edited.x, y: edited.y, width: edited.width, height: edited.height })
		expect(savedImage.rotation ?? savedImage.angle).toBeCloseTo(angleAfter, 5)

		reopened = await openSimulator({ usePixi })
		if (usePixi) await reopened.page.waitForFunction(() => window.pixiApp?.sceneManager, { polling: 100, timeout: 30000 })
		await dismissLoading(reopened.page)
		await reopened.page.evaluate(async (savedJson) => {
			window.confirm = () => true
			window.alert = () => {}
			const file = new File([savedJson], "aligned-reference.json", { type: "application/json" })
			await window.cargarSimulacion({ target: { files: [file] } })
		}, json)
		await reopened.page.waitForFunction(() => window.referenceImage?.image?.complete, { polling: 100, timeout: 10000 })
		const restored = await readPlacement(reopened.page)
		expect(restored).toMatchObject({ ...edited, dataUrl })
		expect(restored.rotation ?? restored.angle).toBeCloseTo(angleAfter, 5)
	}, 180000)
})

function readPlacement(page) {
	return page.evaluate(() => {
		const { dataUrl, x, y, width, height, rotation, angle } = window.referenceImage
		return { dataUrl, x, y, width, height, rotation, angle }
	})
}

async function dismissLoading(page) {
	await page.evaluate(() => window.hideLoadingScreen?.())
	await page.waitForFunction(() => getComputedStyle(document.getElementById("loadingScreen")).display === "none", { polling: 100 })
}
