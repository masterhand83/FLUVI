import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

const catalogs = {
	es: JSON.parse(
		readFileSync(
			new URL("../src/locales/es/translation.json", import.meta.url),
			"utf8",
		),
	),
	en: JSON.parse(
		readFileSync(
			new URL("../src/locales/en/translation.json", import.meta.url),
			"utf8",
		),
	),
}

function catalogValue(language, key) {
	return key
		.split(".")
		.reduce(
			(value, part) => (value == null ? undefined : value[part]),
			catalogs[language],
		)
}

const hideLoadingScreen = (page) =>
	page.evaluate(() => {
		window.hideLoadingScreen?.()
		document.getElementById("loadingScreen").style.display = "none"
	})

const openMetrics = async (page) => {
	const expanded = await page.$eval(
		'[data-bs-target="#collapseMetrics"]',
		(button) => button.getAttribute("aria-expanded") === "true",
	)
	if (!expanded) {
		await page.$eval('[data-bs-target="#collapseMetrics"]', (button) =>
			button.click(),
		)
		await page.waitForSelector("#collapseMetrics.show", { visible: true })
	}
}

const openAnalyzer = async (page) => {
	await openMetrics(page)
	await page.evaluate(() =>
		document.getElementById("btnAnalizarMetricas").click(),
	)
	await page.waitForSelector("#modalAnalizadorMetricas.show", {
		visible: true,
	})
	await page.waitForFunction(
		() =>
			!document
				.querySelector("#modalAnalizadorMetricas .modal-dialog")
				?.getAnimations().length,
		{ polling: 100 },
	)
}

const closeAnalyzer = async (page) => {
	await page.$eval(
		'#modalAnalizadorMetricas .modal-footer [data-bs-dismiss="modal"]',
		(button) => button.click(),
	)
	await page.waitForSelector("#modalAnalizadorMetricas", { hidden: true })
	await page.waitForFunction(() => !document.querySelector(".modal-backdrop"), {
		polling: 100,
	})
}

const installControlledAnalyzer = (page) =>
	page.evaluate(() => {
		window.testJobs = []
		window.destroyedJobs = []
		window.injectedAnalyzerMessages = null
		window.downloads = []
		window.zipFiles = []
		window.loadPyodide = async () => ({
			loadPackage: async () => {},
			globals: {
				set: (name, value) => {
					if (name === "FLUVI_ANALYZER_MESSAGES_JSON") {
						window.injectedAnalyzerMessages = JSON.parse(value)
					}
				},
			},
			runPythonAsync: async (code) => {
				if (!code.includes("resultados['imagenes']")) return
				return new Promise((resolve, reject) =>
					window.testJobs.push({ code, resolve, reject }),
				)
			},
		})
		window.fetch = async (url) => {
			if (String(url).startsWith("data:")) {
				return {
					blob: async () =>
						new Blob([atob(String(url).split(",")[1])]),
				}
			}
			return { ok: true, text: async () => "# analyzer" }
		}
		window.finishJob = (index, label) => {
			window.testJobs[index].resolve({
				toJs: () =>
					new Map(
						["temporal", "fundamentales", "distribuciones"].map(
							(key) => [
								key,
								`data:image/png;base64,${btoa(`${label}:${key}`)}`,
							],
						),
					),
				destroy: () => window.destroyedJobs.push(index),
			})
		}
		HTMLAnchorElement.prototype.click = function () {
			window.downloads.push({ href: this.href, name: this.download })
		}
		window.JSZip = class {
			folder() {
				return this
			}
			file(name, blob) {
				window.zipFiles.push({ name, blob })
			}
			async generateAsync() {
				return new Blob(["zip"])
			}
		}
	})

const upload = (page, name, content) =>
	page.evaluate(
		([name, content]) => {
			const input = document.getElementById("inputCSVAnalizador")
			const files = new DataTransfer()
			files.items.add(new File([content], name))
			input.files = files.files
			input.dispatchEvent(new Event("change", { bubbles: true }))
		},
		[name, content],
	)

const readyAnalysis = async (page, label) => {
	await page.waitForFunction(() => window.testJobs.length === 1, { polling: 100 })
	await page.evaluate((label) => window.finishJob(0, label), label)
	await page.waitForFunction(
		() =>
			document.getElementById("resultadosAnalisis").style.display ===
			"block",
		{ polling: 100 },
	)
}

async function readVisibleAnalyzerCopy(page) {
	return page.evaluate(() => {
			const text = (id) =>
				document.getElementById(id)?.textContent.trim() ?? null
			const directText = (selector) =>
				[...document.querySelector(selector).childNodes]
					.filter((node) => node.nodeType === Node.TEXT_NODE)
					.map((node) => node.nodeValue)
					.join("")
					.trim()
			return {
				language: document.documentElement.lang,
				title: text("modalAnalizadorMetricasLabel"),
				intro: text("analizadorMetricasDescripcion"),
				upload: document
					.querySelector(
						'#modalAnalizadorMetricas label[for="inputCSVAnalizador"]',
					)
					.textContent.trim(),
				inputDescription:
					document
						.getElementById("inputCSVAnalizador")
						.getAttribute("aria-describedby"),
				noFile: text("nombreArchivoCSV"),
				loading: directText(
					"#estadoCargaPython .visually-hidden",
				),
				initializing: text("mensajeEstadoPython"),
				resultsTitle: directText("#resultadosAnalisis > h6"),
				tabs: [...document.querySelectorAll("#tabsImagenes [role=tab]")].map(
					(tab) => tab.textContent.trim(),
				),
				alts: [...document.querySelectorAll("#tabsImagenesContent img")].map(
					(img) => img.getAttribute("alt"),
				),
				downloads: [
					text("btnDescargarImagenActual"),
					text("btnDescargarTodasImagenes"),
				],
				close: [
					...document.querySelectorAll(
						'#modalAnalizadorMetricas [data-bs-dismiss="modal"]',
					),
				].map((button) =>
					button.textContent.trim() ||
					button.getAttribute("aria-label"),
				),
				headerClose: document
					.querySelector(
						'#modalAnalizadorMetricas .modal-header [data-bs-dismiss="modal"]',
					)
					.getAttribute("aria-label"),
			}
		})
}

describe("metrics analyzer localization", () => {
	it("translates analyzer states and passes the active session language to Python", async () => {
		for (const language of ["es", "en"]) {
			const simulator = await openSimulator({
				languagePreference: language,
			})
			try {
				const { page, pageErrors } = simulator
				await page.waitForFunction(
					(active) => document.documentElement.lang === active,
					{ polling: 100 },
					language,
				)
				await page.evaluate(() => window.fluviI18n.translateDocument())
				await hideLoadingScreen(page)
				await installControlledAnalyzer(page)
				await openAnalyzer(page)

				const copy = await readVisibleAnalyzerCopy(page)
				expect(copy.language).toBe(language)
				expect(copy.title).toBe(
					catalogValue(language, "analyzer.modal.title"),
				)
				expect(copy.intro).toBe(
					catalogValue(language, "analyzer.modal.intro"),
				)
				expect(copy.upload).toBe(
					catalogValue(language, "analyzer.modal.upload"),
				)
				expect(copy.inputDescription).toBe("nombreArchivoCSV")
				expect(copy.noFile).toBe(
					catalogValue(language, "analyzer.modal.noFile"),
				)
				expect(copy.loading).toBe(
					catalogValue(language, "analyzer.modal.loading"),
				)
				expect(copy.initializing).toBe(
					catalogValue(language, "analyzer.modal.initializing"),
				)
				expect(copy.resultsTitle).toBe(
					catalogValue(language, "analyzer.modal.resultsTitle"),
				)
				expect(copy.tabs).toEqual([
					catalogValue(language, "analyzer.modal.tabs.temporal"),
					catalogValue(language, "analyzer.modal.tabs.fundamental"),
					catalogValue(language, "analyzer.modal.tabs.distributions"),
				])
				expect(copy.alts).toEqual([
					catalogValue(language, "analyzer.modal.images.temporal"),
					catalogValue(language, "analyzer.modal.images.fundamental"),
					catalogValue(language, "analyzer.modal.images.distributions"),
				])
				expect(copy.downloads).toEqual([
					catalogValue(language, "analyzer.modal.downloadCurrent"),
					catalogValue(language, "analyzer.modal.downloadAll"),
				])
				expect(copy.headerClose).toBe(
					catalogValue(language, "common.close"),
				)
				expect(copy.close.at(-1)).toBe(
					catalogValue(language, "common.close"),
				)

				// Saving a different next-startup preference must not change the
				// language used by the active session or this analysis.
				await page.evaluate(
					(next) =>
						localStorage.setItem("fluvi.interfaceLanguage", next),
					language === "es" ? "en" : "es",
				)
				await upload(page, "metrics.csv", "sample")
				await page.waitForFunction(() => window.testJobs.length === 1, {
					polling: 100,
				})
				expect(
					await page.$eval("#mensajeEstadoPython", (element) =>
						element.textContent.trim(),
					),
				).toBe(catalogValue(language, "analyzer.modal.status.generating"))
				const boundary = await page.evaluate(() => ({
					code: window.testJobs[0].code,
					messages: window.injectedAnalyzerMessages,
				}))
				expect(boundary.code).toContain(`idioma="${language}"`)
				expect(
					boundary.messages[language][
						"analyzer.python.plots.temporal.suptitle"
					],
				).toBe(
					catalogValue(
						language,
						"analyzer.python.plots.temporal.suptitle",
					),
				)

				await readyAnalysis(page, language.toUpperCase())
				expect(
					await page.$eval("#mensajeEstadoPython", (element) =>
						element.textContent.trim(),
					),
				).toBe(catalogValue(language, "analyzer.modal.status.completed"))
				expect(
					await page.$eval("#progressBarPython", (element) =>
						element.style.width,
					),
				).toBe("100%")
				expect(
					await page.$eval(
						"#imgAnalisisTemporal",
						(element) => element.getAttribute("src"),
					),
				).toBe(
					`data:image/png;base64,${Buffer.from(
						`${language.toUpperCase()}:temporal`,
					).toString("base64")}`,
				)

				await page.evaluate(() =>
					document.getElementById("tab-fundamental").click(),
				)
				await page.waitForFunction(
					() =>
						document
							.getElementById("img-fundamental")
							.classList.contains("active") &&
						document
							.getElementById("img-fundamental")
							.classList.contains("show"),
					{ polling: 100 },
				)
				await page.evaluate(() => {
					window.downloads.length = 0
					document.getElementById("btnDescargarImagenActual").click()
				})
				expect(await page.evaluate(() => window.downloads)).toEqual([
					{
						href: `data:image/png;base64,${Buffer.from(
							`${language.toUpperCase()}:fundamentales`,
						).toString("base64")}`,
						name: "diagrama_fundamental.png",
					},
				])

				await page.evaluate(() => {
					window.zipFiles.length = 0
					document.getElementById("btnDescargarTodasImagenes").click()
				})
				await page.waitForFunction(() => window.zipFiles.length === 3, { polling: 100 })
				const zip = await page.evaluate(async () =>
					Promise.all(
						window.zipFiles.map(async ({ name, blob }) => ({
							name,
							text: await blob.text(),
						})),
					),
				)
				expect(zip).toEqual([
					{
						name: "analisis_temporal.png",
						text: `${language.toUpperCase()}:temporal`,
					},
					{
						name: "diagrama_fundamental.png",
						text: `${language.toUpperCase()}:fundamentales`,
					},
					{
						name: "distribuciones_correlaciones.png",
						text: `${language.toUpperCase()}:distribuciones`,
					},
				])

				await page.evaluate(() => {
					for (const toast of document.querySelectorAll(".toast")) {
						toast.remove()
					}
				})
				await upload(page, "metrics.txt", "sample")
				await page.waitForFunction(
					() => document.querySelector(".toast .toast-body") !== null,
					{ polling: 100 },
				)
				const notification = await page.evaluate(() => ({
					severity:
						document.querySelector(".toast .toast-header").className,
					body: document.querySelector(".toast .toast-body").textContent,
				}))
				expect(notification.severity).toContain("bg-danger")
				expect(notification.body).toBe(
					catalogValue(language, "analyzer.modal.errors.unsupportedFormat"),
				)

				await closeAnalyzer(page)
				expect(pageErrors).toEqual([])
			} finally {
				await simulator.close()
			}
		}
	}, 180000)

	it("keeps analyzer controls and dialogs reachable in both themes and on mobile", async () => {
		const simulator = await openSimulator({ languagePreference: "en" })
		try {
			const { page, pageErrors } = simulator
			await page.waitForFunction(
				() => document.documentElement.lang === "en",
				{ polling: 100 },
			)
			await page.evaluate(() => window.fluviI18n.translateDocument())
			await hideLoadingScreen(page)
			await installControlledAnalyzer(page)
			await openAnalyzer(page)

			const readLayout = () =>
				page.evaluate(() => {
					const modal = document.getElementById(
						"modalAnalizadorMetricas",
					)
					const dialog = modal
						.querySelector(".modal-dialog")
						.getBoundingClientRect()
					const body = modal.querySelector(".modal-body")
					const title = document.getElementById(
						"modalAnalizadorMetricasLabel",
					)
					const uploadButton = modal.querySelector(
						'label[for="inputCSVAnalizador"]',
					)
					return {
						viewport: window.innerWidth,
						bodyOverflow:
							document.body.scrollWidth - document.body.clientWidth,
						bodyOverflowX: body.scrollWidth - body.clientWidth,
						dialogFits:
							dialog.left >= -1 &&
							dialog.top >= -1 &&
							dialog.right <= window.innerWidth + 1 &&
							dialog.bottom <= window.innerHeight + 1,
						titleVisible:
							title.getBoundingClientRect().width > 0 &&
							getComputedStyle(title).visibility !== "hidden",
						titleColor: getComputedStyle(title).color,
						uploadVisible:
							uploadButton.getBoundingClientRect().width > 0 &&
							getComputedStyle(uploadButton).visibility !== "hidden",
						uploadText: uploadButton.textContent.trim(),
					}
				})

			let layout = await readLayout()
			expect(layout.bodyOverflow).toBeLessThanOrEqual(1)
			expect(layout.bodyOverflowX).toBeLessThanOrEqual(1)
			expect(layout.dialogFits).toBe(true)
			expect(layout.titleVisible).toBe(true)
			expect(layout.uploadVisible).toBe(true)
			expect(layout.uploadText).toBe(
				catalogValue("en", "analyzer.modal.upload"),
			)
			const lightDesktopColor = layout.titleColor

			await page.evaluate(() =>
				document.getElementById("switchModoOscuro").click(),
			)
			await page.waitForFunction(
				() => document.body.classList.contains("dark-mode"),
				{ polling: 100 },
			)
			const dark = await readLayout()
			expect(dark.titleColor).not.toBe(lightDesktopColor)
			expect(dark.bodyOverflow).toBeLessThanOrEqual(1)
			expect(dark.dialogFits).toBe(true)
			expect(dark.uploadVisible).toBe(true)

			await page.setViewport({ width: 390, height: 844 })
			await new Promise((resolve) => setTimeout(resolve, 400))
			layout = await readLayout()
			expect(layout.bodyOverflow).toBeLessThanOrEqual(1)
			expect(layout.bodyOverflowX).toBeLessThanOrEqual(1)
			expect(layout.dialogFits).toBe(true)
			expect(layout.titleVisible).toBe(true)
			expect(layout.uploadVisible).toBe(true)

			await page.evaluate(() =>
				document.getElementById("switchModoOscuro").click(),
			)
			await page.waitForFunction(
				() => !document.body.classList.contains("dark-mode"),
				{ polling: 100 },
			)
			const lightMobile = await readLayout()
			expect(lightMobile.titleColor).toBe(lightDesktopColor)
			expect(lightMobile.bodyOverflow).toBeLessThanOrEqual(1)
			expect(lightMobile.bodyOverflowX).toBeLessThanOrEqual(1)
			expect(lightMobile.dialogFits).toBe(true)
			expect(lightMobile.uploadVisible).toBe(true)

			await closeAnalyzer(page)
			expect(pageErrors).toEqual([])
		} finally {
			await simulator.close()
		}
	}, 180000)
})
