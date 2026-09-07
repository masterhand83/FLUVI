import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import puppeteer from "puppeteer-core"
import { startStaticServer } from "./static-server.mjs"

const V1_ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")

const CHROME_CANDIDATES = [
	process.env.CHROME_PATH,
	"/usr/bin/google-chrome",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
].filter(Boolean)

export function findChrome() {
	return CHROME_CANDIDATES.find((path) => existsSync(path))
}

// Se ejecuta antes que cualquier script de la página: siembra el Math.random
// compartido, fija el motor gráfico y (opcional) congela el bucle de animación
// para que los pasos ocurran solo cuando el arnés pulsa ⏭. La semilla de carga
// y la de pasos van por streams separados (__fluviBaseline.reseed) para que los
// timers de la página no puedan desincronizar la secuencia de pasos.
function baselineInitScript({ seed, usePixi, freezeFrames }) {
	localStorage.setItem("usePixi", usePixi ? "true" : "false")
	const mulberry32 = (a) => () => {
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
	const loadRng = mulberry32(seed >>> 0)
	let stepRng = null
	Math.random = () => (stepRng === null ? loadRng() : stepRng())
	window.__fluviBaseline = {
		reseed(value) {
			stepRng = mulberry32(value >>> 0)
		},
	}
	if (freezeFrames) {
		window.requestAnimationFrame = () => 0
	}
}

async function launchBrowser() {
	const executablePath = findChrome()
	if (!executablePath) {
		throw new Error("No Chrome/Chromium found. Set CHROME_PATH to the browser binary.")
	}
	const userDataDir = await mkdtemp(join(tmpdir(), "fluvi-baseline-"))
	const browser = await puppeteer.launch({
		executablePath,
		userDataDir,
		headless: "new",
		args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1440,900"],
	})
	return {
		browser,
		close: async () => {
			await browser.close()
			await rm(userDataDir, { recursive: true, force: true })
		},
	}
}

export async function openSimulator({ seed = 1, usePixi = false, freezeFrames = true, hasTouch = false } = {}) {
	const server = await startStaticServer(V1_ROOT)
	const { browser, close: closeBrowser } = await launchBrowser()
	const page = await browser.newPage()
	// La emulación táctil debe activarse antes de navegar: cambiarla después
	// hace que Chrome reinicie el renderer y recargue la página.
	await page.setViewport({ width: 1440, height: 900, hasTouch })
	const consoleErrors = []
	const pageErrors = []
	page.on("pageerror", (error) => pageErrors.push(error.message))
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text())
	})
	await page.evaluateOnNewDocument(baselineInitScript, { seed, usePixi, freezeFrames })
	await page.goto(server.url, { waitUntil: "domcontentloaded" })
	await page.waitForFunction(
		() =>
			Array.isArray(window.calles) &&
			window.calles.length > 0 &&
			Array.isArray(window.conexiones) &&
			typeof window.calcularLimitesMapa === "function",
		{ polling: 100, timeout: 30000 },
	)
	return {
		page,
		browser,
		consoleErrors,
		pageErrors,
		close: async () => {
			await closeBrowser()
			await server.close()
		},
	}
}

export function hashOcupacion(ocupacion) {
	return createHash("sha256").update(ocupacion).digest("hex")
}

export function readScenarioInvariants(page) {
	return page.evaluate(() => {
		const countBy = (items, key) => {
			const out = {}
			for (const item of items) out[item[key]] = (out[item[key]] ?? 0) + 1
			return out
		}
		return {
			callesTotales: window.calles.length,
			callesPorTipo: countBy(window.calles, "tipo"),
			callesCurvas: window.calles
				.filter((c) => c.esCurva)
				.map((c) => c.nombre)
				.sort(),
			conexionesTotales: window.conexiones.length,
			conexionesPorTipo: countBy(window.conexiones, "tipo"),
			limitesMapa: window.calcularLimitesMapa(),
			totalCeldas: window.calles.reduce((sum, c) => sum + c.carriles * c.tamano, 0),
		}
	})
}

export function driveDeterministicTraffic(page, { seed, steps }) {
	return page.evaluate(
		([reseed, totalSteps]) => {
			const click = (id) => document.getElementById(id).click()
			click("btnPauseResume")
			click("btnBorrar")
			window.__fluviBaseline.reseed(reseed)
			for (let i = 0; i < totalSteps; i++) click("btnPaso")

			const porTipo = {}
			const conteoPorCalle = {}
			const partes = []
			let vehiculosTotales = 0
			const contarCalle = (calle) => {
				let count = 0
				for (const carril of calle.arreglo) {
					for (const valor of carril) {
						if (valor > 0) {
							count++
							porTipo[valor] = (porTipo[valor] ?? 0) + 1
						}
					}
				}
				return count
			}
			for (const calle of window.calles) {
				const count = contarCalle(calle)
				conteoPorCalle[calle.id] = count
				partes.push(`${calle.id}:${calle.arreglo.map((r) => r.join("")).join(",")}`)
				vehiculosTotales += count
			}
			const tiempo = window.configuracionTiempo
			return {
				steps: totalSteps,
				seed: reseed,
				vehiculosTotales,
				callesConVehiculos: Object.values(conteoPorCalle).filter((n) => n > 0).length,
				vehiculosPorTipo: Object.fromEntries(Object.entries(porTipo).sort()),
				conteoPorCalle,
				relojVirtual: {
					diaActual: tiempo.diaActual,
					horaActual: tiempo.horaActual,
					minutoActual: tiempo.minutoActual,
					segundoActual: tiempo.segundoActual,
				},
				ocupacion: partes.join(";"),
			}
		},
		[seed, steps],
	)
}
