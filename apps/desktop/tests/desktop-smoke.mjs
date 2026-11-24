// Explicit integration check: requires a graphical session and network access.
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { _electron as electron } from "playwright-core"
import electronPath from "electron"
import { DESKTOP_PORT } from "../server.mjs"

if (process.platform !== "linux") {
	throw new Error("This isolated development smoke uses XDG_CONFIG_HOME on Linux; use Windows acceptance for the portable artifact.")
}
const home = await mkdtemp(join(tmpdir(), "fluvi-desktop-smoke-"))
const origin = `http://127.0.0.1:${DESKTOP_PORT}`
let desktop
async function launch() {
	return electron.launch({
		executablePath: process.argv[2] ?? electronPath,
		args: process.argv[2] ? [] : [fileURLToPath(new URL("../", import.meta.url))],
		env: { ...process.env, XDG_CONFIG_HOME: home },
	})
}

try {
	desktop = await launch()
	let page = await desktop.firstWindow()
	await page.waitForURL(`${origin}/`)
	assert.equal(await page.evaluate(() => typeof require), "undefined")
	assert.equal(await page.evaluate(() => window.open("https://example.com/") === null), true)
	await page.locator("#loadingScreen").waitFor({ state: "hidden", timeout: 60000 })
	await page.locator("#btnPauseResume").click()
	assert.equal(await page.locator("#btnPaso").isEnabled(), true)
	await page.locator("#btnPaso").click()
	await page.locator("#languagePreference").selectOption("en")
	await page.reload()
	await page.locator("#languagePreference").waitFor()
	assert.equal(await page.locator("#languagePreference").inputValue(), "en")
	// The page may fetch CDN scripts but cannot navigate to remote content.
	await page.evaluate(() => {
		const link = document.createElement("a")
		link.href = "https://example.com/"
		link.click()
	})
	assert.equal(page.url(), `${origin}/`)
	await Promise.all([desktop.waitForEvent("close"), page.close()])
	desktop = undefined
	await assert.rejects(fetch(origin))
	desktop = await launch()
	page = await desktop.firstWindow()
	await page.locator("#loadingScreen").waitFor({ state: "hidden", timeout: 60000 })
	assert.equal(await page.locator("#languagePreference").inputValue(), "en")
	await Promise.all([desktop.waitForEvent("close"), page.close()])
	desktop = undefined
	await assert.rejects(fetch(origin))
	console.log("PASS: desktop launch, pause/step controls, renderer isolation, popup/navigation guards, language restart persistence and server shutdown")
} finally {
	await desktop?.close()
	await rm(home, { recursive: true, force: true })
}
