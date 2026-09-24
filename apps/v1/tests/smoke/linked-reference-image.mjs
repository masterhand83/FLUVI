import assert from "node:assert/strict"
import { openSimulator } from "../helpers/simulator.mjs"

async function addUrl(page, url) {
	await page.$eval("#inputUrlImagenReferencia", (input, value) => {
		input.value = value
		input.dispatchEvent(new Event("input", { bubbles: true }))
	}, url)
	await page.$eval("#btnAgregarUrlImagenReferencia", (button) => button.click())
}

async function saveMap(page) {
	return page.evaluate(async () => {
		window.prompt = () => "Linked reference smoke"
		const original = URL.createObjectURL
		URL.createObjectURL = (blob) => {
			window.__linkedReferenceJSON = blob.text()
			return "blob:linked-reference-smoke"
		}
		try {
			window.guardarSimulacion()
			return await window.__linkedReferenceJSON
		} finally {
			URL.createObjectURL = original
		}
	})
}

async function loadMap(page, json) {
	await page.evaluate((saved) => {
		window.confirm = () => true
		window.alert = () => {}
		const file = new File([saved], "linked-reference.json", { type: "application/json" })
		window.cargarSimulacion({ target: { files: [file] } })
	}, json)
}

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 41, usePixi, freezeFrames: false })
	try {
		if (usePixi) await sim.page.waitForFunction(() => !!window.pixiApp?.sceneManager, { timeout: 30000 })
		await sim.page.evaluate(() => window.hideLoadingScreen?.())
		const workingUrl = new URL("tests/smoke/fixtures/reference-image.svg", sim.page.url()).href
		const brokenUrl = new URL("tests/smoke/fixtures/missing-reference-image.svg", sim.page.url()).href

		await addUrl(sim.page, workingUrl)
		await sim.page.waitForFunction(() => window.referenceImage?.url && !window.referenceImage.unavailable)
		const original = await sim.page.evaluate(() => {
			const image = window.referenceImage
			return { url: image.url, x: image.x, y: image.y, width: image.width, height: image.height, rotation: image.rotation, opacity: image.opacity }
		})
		assert.equal(original.url, workingUrl)

		const workingJSON = await saveMap(sim.page)
		const savedWorking = JSON.parse(workingJSON).imagenReferencia
		assert.equal(savedWorking.url, workingUrl, "linked image is saved as a URL")
		assert.equal("dataUrl" in savedWorking, false, "linked image bytes are not embedded")
		await loadMap(sim.page, workingJSON)
		await sim.page.waitForFunction(() => window.referenceImage?.url && !window.referenceImage.unavailable && window.calles?.length > 0, { timeout: 20000 })
		assert.deepEqual(await sim.page.evaluate(() => {
			const { x, y, width, height, rotation, opacity } = window.referenceImage
			return { x, y, width, height, rotation, opacity }
		}), { x: original.x, y: original.y, width: original.width, height: original.height, rotation: original.rotation, opacity: original.opacity }, "saved working link restores its position")

		await addUrl(sim.page, brokenUrl)
		await sim.page.waitForFunction(() => window.referenceImage?.url === new URL("tests/smoke/fixtures/missing-reference-image.svg", location.href).href && window.referenceImage.unavailable)
		assert.deepEqual(await sim.page.evaluate(() => {
			const { x, y, width, height, rotation, opacity } = window.referenceImage
			return { x, y, width, height, rotation, opacity }
		}), { x: original.x, y: original.y, width: original.width, height: original.height, rotation: original.rotation, opacity: original.opacity }, "failed replacement retains alignment and settings")
		await sim.page.waitForFunction(() => getComputedStyle(document.querySelector(".reference-image-unavailable")).display !== "none")
		const marker = await sim.page.evaluate(() => {
			const element = document.querySelector(".reference-image-unavailable")
			const rect = element.getBoundingClientRect()
			const image = window.referenceImage
			const canvas = document.getElementById("simuladorCanvas")
			const view = canvas.getBoundingClientRect()
			const width = window.USE_PIXI ? window.pixiApp.app.renderer.screen.width : canvas.width
			const height = window.USE_PIXI ? window.pixiApp.app.renderer.screen.height : canvas.height
			return {
				text: element.textContent, pointerEvents: getComputedStyle(element).pointerEvents,
				width: rect.width, height: rect.height,
				dx: rect.left + rect.width / 2 - (view.left + ((image.x + image.width / 2) * window.escala + window.offsetX) * view.width / width),
				dy: rect.top + rect.height / 2 - (view.top + ((image.y + image.height / 2) * window.escala + window.offsetY) * view.height / height),
			}
		})
		assert.equal(marker.text, "Image unavailable")
		assert.equal(marker.pointerEvents, "none", "marker does not intercept map editing")
		assert.ok(marker.width < 180 && marker.height < 45, "marker stays small")
		assert.ok(Math.abs(marker.dx) < 3 && Math.abs(marker.dy) < 3, "marker follows saved map coordinates")

		const savedBroken = await saveMap(sim.page)
		await loadMap(sim.page, savedBroken)
		await sim.page.waitForFunction(() => window.referenceImage?.url && window.referenceImage.unavailable && window.calles?.length > 0, { timeout: 20000 })
		assert.equal(await sim.page.evaluate(() => window.referenceImage.url), brokenUrl)
		assert.deepEqual(await sim.page.evaluate(() => {
			const { x, y, width, height, rotation, opacity } = window.referenceImage
			return { x, y, width, height, rotation, opacity }
		}), { x: original.x, y: original.y, width: original.width, height: original.height, rotation: original.rotation, opacity: original.opacity }, "load preserves broken-link alignment")

		await addUrl(sim.page, workingUrl)
		await sim.page.waitForFunction(() => window.referenceImage?.url && !window.referenceImage.unavailable)
		assert.equal(await sim.page.evaluate(() => window.referenceImage.url), workingUrl, "broken link can be replaced")
		console.log(`✅ linked reference URL, broken link, replacement and JSON round trip (${usePixi ? "Pixi" : "Canvas"})`)
	} finally {
		await sim.close()
	}
}
