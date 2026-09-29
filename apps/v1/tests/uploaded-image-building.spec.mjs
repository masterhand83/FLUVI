import { afterAll, beforeAll, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

let sim

beforeAll(async () => {
	sim = await openSimulator({ usePixi: false, freezeFrames: false })
	await sim.page.evaluate(() => {
		window.hideLoadingScreen?.()
		window.confirm = () => true
		window.alert = () => {}
		document.getElementById("btnNuevaSimulacion").click()
	})
	await sim.page.waitForFunction(() => window.edificios.length === 0 && getComputedStyle(document.getElementById("loadingScreen")).display === "none")
}, 180000)

afterAll(async () => {
	await sim?.close()
})

async function chooseFile(name, type, bytes) {
	await sim.page.$eval("#uploadImageBuildingFile", async (input, file) => {
		const transfer = new DataTransfer()
		const content = typeof file.bytes === "string"
			? Uint8Array.from(atob(file.bytes.split(",")[1]), char => char.charCodeAt(0))
			: new Uint8Array(file.bytes)
		transfer.items.add(new File([content], file.name, { type: file.type }))
		input.files = transfer.files
		input.dispatchEvent(new Event("change", { bubbles: true }))
	}, { name, type, bytes })
}

async function pngBytes() {
	return sim.page.evaluate(async () => {
		const canvas = document.createElement("canvas")
		canvas.width = 80
		canvas.height = 40
		canvas.getContext("2d").fillRect(0, 0, 80, 40)
		return canvas.toDataURL("image/png")
	})
}

it("rejects unsupported, oversized, and undecodable files before creating buildings", async () => {
	await chooseFile("art.svg", "image/svg+xml", [60, 62, 62, 62])
	expect(await sim.page.$eval("#uploadImageBuildingError", el => el.textContent)).toContain("Formato no compatible")
	await chooseFile("large.png", "image/png", Array(5 * 1024 * 1024 + 1).fill(0))
	expect(await sim.page.$eval("#uploadImageBuildingError", el => el.textContent)).toContain("5 MB")
	await chooseFile("broken.webp", "image/webp", [1, 2, 3, 4])
	await sim.page.waitForFunction(() => document.getElementById("uploadImageBuildingError").textContent.includes("dañado"))
	expect(await sim.page.evaluate(() => window.edificios.length)).toBe(0)
}, 180000)

it("places one proportionally sized image building and edits it without a mode switch", async () => {
	const dataUrl = await pngBytes()
	expect(await sim.page.evaluate(async source => {
		const image = new Image()
		image.src = source
		await image.decode()
		return [image.naturalWidth, image.naturalHeight]
	}, dataUrl)).toEqual([80, 40])
	await chooseFile("art.png", "image/png", dataUrl)
	await sim.page.waitForFunction(() => window.uploadImageBuildingTool.isActive() || document.getElementById("uploadImageBuildingError").textContent)
	expect(await sim.page.evaluate(() => document.getElementById("uploadImageBuildingError").textContent)).toBe("")
	const box = await (await sim.page.$("#simuladorCanvas")).boundingBox()
	await sim.page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45)
	await sim.page.waitForFunction(() => window.edificios.length === 1)
	const initial = await sim.page.evaluate(() => ({
		building: window.edificios[0],
		inspectorVisible: !document.getElementById("buildingInspector").hidden,
		active: window.uploadImageBuildingTool.isActive(),
	}))
	expect(initial.building.appearanceMode).toBe("image")
	expect(initial.building.imageDataUrl).toMatch(/^data:image\/png;base64,/)
	expect(initial.building.width / initial.building.height).toBeCloseTo(2)
	expect(initial.building.width).toBe(160)
	expect(initial.inspectorVisible).toBe(true)
	expect(initial.active).toBe(false)

	await sim.page.$eval("#buildingInspectorWidth", input => {
		input.value = "200"
		input.dispatchEvent(new Event("input", { bubbles: true }))
	})
	expect(await sim.page.evaluate(() => [window.edificios[0].width, window.edificios[0].height])).toEqual([200, 100])
	const resizeHandle = await sim.page.$(".building-resize-handle")
	const handleBox = await resizeHandle.boundingBox()
	await sim.page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
	await sim.page.mouse.down()
	await sim.page.mouse.move(handleBox.x + handleBox.width / 2 + 24, handleBox.y + handleBox.height / 2 + 16, { steps: 3 })
	await sim.page.mouse.up()
	expect(await sim.page.evaluate(() => window.edificios[0].width / window.edificios[0].height)).toBeCloseTo(2)
	await sim.page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.45)
	expect(await sim.page.evaluate(() => window.edificios.length)).toBe(1)
}, 180000)
