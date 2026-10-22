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

function message(language, key, params = {}) {
	let value = catalogValue(language, key)
	if (value === undefined && "count" in params) {
		value = catalogValue(
			language,
			`${key}_${params.count === 1 ? "one" : "other"}`,
		)
	}
	if (value === undefined) throw new Error(`Missing ${language} key: ${key}`)
	return String(value).replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (match, name) =>
		name in params ? String(params[name]) : match,
	)
}

const languageDigests = {}

function imageExportTexts(language, archive) {
	const timeAxis = catalogValue(language, "metrics.imageExport.timeAxis")
	return {
		timeAxis,
		exact: [
			timeAxis,
			...["density", "throughput", "speed", "netGeneration", "entropy"].map(
				(key) => catalogValue(language, `metrics.imageExport.axis.${key}`),
			),
			...["indicator", "value", "interpretation"].map((key) =>
				catalogValue(language, `metrics.imageExport.summary.table.${key}`),
			),
			catalogValue(
				language,
				"metrics.imageExport.summary.observationsTitle",
			),
			catalogValue(language, "metrics.imageExport.summary.entropyLabel"),
			catalogValue(
				language,
				"metrics.imageExport.summary.entropyDescription",
			),
			message(language, "metrics.imageExport.summary.entropyValue", {
				value: archive.entropyValue,
			}),
			catalogValue(language, "metrics.imageExport.notes.title"),
			...["low", "high"].map((key) =>
				catalogValue(language, `metrics.imageExport.heatmapLegend.${key}`),
			),
		],
		notes: [
			message(language, "metrics.imageExport.notes.charts", {
				count: archive.measurementCount,
			}),
			catalogValue(language, "metrics.imageExport.notes.summary"),
			message(language, "metrics.imageExport.notes.streets", {
				included: archive.includedStreets,
				total: archive.totalStreets,
			}),
			catalogValue(language, "metrics.imageExport.notes.heatmap"),
		],
	}
}

function assertImageExport(archive, language) {
	expect(archive.images.map((image) => image.name).sort()).toEqual([
		"densidad.png",
		"entropia.png",
		"flujo_vehicular.png",
		"mapa_de_calor.png",
		"resumen.png",
		"tasa_de_cambio.png",
		"velocidad.png",
	])
	for (const image of archive.images) {
		expect(image.width, image.name).toBe(1600)
		expect(image.height, image.name).toBeGreaterThan(200)
		expect(image.pixel, image.name).toEqual([255, 255, 255, 255])
		expect(image.coloredPixels, image.name).toBeGreaterThan(1000)
	}
	expect(archive.unchanged).toBe(true)
	expect(archive.modalOpen).toBe(false)
	expect(archive.buttonLabel).toBe(
		catalogValue(language, "metrics.export.imagesButton"),
	)
	expect(archive.buttonMarkupPreserved).toBe(true)

	const expectedImageText = imageExportTexts(language, archive)
	for (const text of expectedImageText.exact) {
		expect(archive.drawnText, `${language}: ${text}`).toContain(text)
	}
	expect(
		archive.drawnText.filter((text) => text === expectedImageText.timeAxis)
			.length,
	).toBeGreaterThanOrEqual(5)
	const joinedText = archive.drawnText.join(" ")
	for (const note of expectedImageText.notes) {
		expect(joinedText, `${language}: ${note}`).toContain(note)
	}

	const otherLanguage = language === "es" ? "en" : "es"
	const otherTexts = imageExportTexts(otherLanguage, archive)
	for (const text of otherTexts.exact) {
		// Language-independent values (such as "0 bits") legitimately match.
		if (expectedImageText.exact.includes(text)) continue
		expect(archive.drawnText, `${language}: leaked ${text}`).not.toContain(text)
	}
	for (const note of otherTexts.notes) {
		expect(joinedText, `${language}: leaked ${note}`).not.toContain(note)
	}
	return Object.fromEntries(
		archive.images.map((image) => [image.name, image.digest]),
	)
}

const hideLoadingScreen = (page) =>
	page.evaluate(() => {
		window.hideLoadingScreen?.()
		document.getElementById("loadingScreen").style.display = "none"
	})

const ready = async (page) => {
	await hideLoadingScreen(page)
	await page.waitForFunction(
		() =>
			typeof Chart !== "undefined" &&
			densityChartInstance !== null &&
			typeof JSZip !== "undefined",
		{ polling: 100, timeout: 30000 },
	)
	await page.evaluate(() => {
		window.fluviI18n.translateDocument()
		if (!window.isPaused) document.getElementById("btnPauseResume").click()
	})
}

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

const openHeatmap = async (page) => {
	await page.evaluate(() => document.getElementById("btnMapaCalor").click())
	await page.waitForSelector("#modalMapaCalor.show", { visible: true })
	await page.waitForFunction(
		() =>
			document.getElementById("heatmapCanvasContainer").style.display ===
				"block" &&
			!document
				.querySelector("#modalMapaCalor .modal-dialog")
				?.getAnimations().length,
		{ polling: 100 },
	)
}

const closeHeatmap = async (page) => {
	await page.$eval('#modalMapaCalor [data-bs-dismiss="modal"]', (button) =>
		button.click(),
	)
	await page.waitForSelector("#modalMapaCalor", { hidden: true })
	await page.waitForFunction(() => !document.querySelector(".modal-backdrop"), {
		polling: 100,
	})
}

const exportArchive = (page) =>
	page.evaluate(async () => {
		for (let index = 0; index < 30; index++) {
			document.getElementById("btnPaso").click()
		}
		updateMetricsHistory(calculateMetrics())
		updateCharts()

		const drawnText = []
		const originalFillText = CanvasRenderingContext2D.prototype.fillText
		const originalCreate = URL.createObjectURL
		let exported
		CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
			drawnText.push(String(text))
			return originalFillText.call(this, text, ...args)
		}
		URL.createObjectURL = (blob) => {
			exported = blob
			return originalCreate(blob)
		}
		const source = JSON.stringify(densityChartInstance.data)
		try {
			document.getElementById("btnExportarImagenes").click()
			while (document.getElementById("btnExportarImagenes").disabled) {
				await new Promise((resolve) => setTimeout(resolve, 20))
			}
		} finally {
			CanvasRenderingContext2D.prototype.fillText = originalFillText
			URL.createObjectURL = originalCreate
		}
		if (!exported) return { error: "No ZIP produced" }

		const zip = await JSZip.loadAsync(exported)
		const images = await Promise.all(
			Object.values(zip.files).map(async (file) => {
				const bytes = await file.async("uint8array")
				const digest = [
					...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
				]
					.map((byte) => byte.toString(16).padStart(2, "0"))
					.join("")
				const blob = new Blob([bytes], { type: "image/png" })
				const bitmap = await createImageBitmap(blob)
				const canvas = document.createElement("canvas")
				canvas.width = bitmap.width
				canvas.height = bitmap.height
				const ctx = canvas.getContext("2d")
				ctx.drawImage(bitmap, 0, 0)
				const pixel = [...ctx.getImageData(0, 0, 1, 1).data]
				const pixels = ctx.getImageData(
					48,
					48,
					canvas.width - 96,
					canvas.height - 96,
				).data
				let coloredPixels = 0
				for (let index = 0; index < pixels.length; index += 4) {
					if (
						pixels[index] < 240 ||
						pixels[index + 1] < 240 ||
						pixels[index + 2] < 240
					)
						coloredPixels++
				}
				bitmap.close()
				return {
					name: file.name,
					digest,
					width: canvas.width,
					height: canvas.height,
					pixel,
					coloredPixels,
				}
			}),
		)
		return {
			images,
			drawnText,
			measurementCount: completeMetricsHistory.timestamps.length,
			entropyValue: metricsHistory.entropy.at(-1),
			includedStreets: window.calles.filter(
				(_, index) =>
					callesIncluidasEnMetricas === null ||
					callesIncluidasEnMetricas.has(index),
			).length,
			totalStreets: window.calles.length,
			unchanged: source === JSON.stringify(densityChartInstance.data),
			modalOpen: document
				.getElementById("modalMapaCalor")
				.classList.contains("show"),
			buttonLabel: document
				.getElementById("btnExportarImagenes")
				.textContent.trim(),
			buttonMarkupPreserved: Boolean(
				document.querySelector(
					'#btnExportarImagenes [data-i18n="metrics.export.imagesButton"]',
				),
			),
		}
	})

const readHeatmap = (page) =>
	page.evaluate(() => {
		const directText = (element) =>
			[...element.childNodes]
				.filter((node) => node.nodeType === Node.TEXT_NODE)
				.map((node) => node.nodeValue)
				.join("")
				.trim()
		const vehicleCount = window.calles.reduce(
			(total, street) =>
				total +
				(street.arreglo ?? []).reduce(
					(sum, lane) =>
						sum +
						[...lane].filter((value) => value >= 1 && value <= 6).length,
					0,
				),
			0,
		)
		return {
			language: document.documentElement.lang,
			texts: [
				...document.querySelectorAll('[data-i18n^="metrics.heatmap."]'),
			].map((element) => ({
				key: element.getAttribute("data-i18n"),
				text: directText(element),
			})),
			title: document.getElementById("modalMapaCalorLabel").textContent,
			subtitle: document.getElementById("heatmapSubtitle").textContent,
			close: document
				.querySelector(
					'#modalMapaCalor .heatmap-footer [data-bs-dismiss="modal"]',
				)
				.textContent.trim(),
			closeLabel: document
				.querySelector(
					'#modalMapaCalor .modal-header [data-bs-dismiss="modal"]',
				)
				.getAttribute("aria-label"),
			loadingHidden:
				getComputedStyle(document.getElementById("heatmapLoading"))
					.display === "none",
			canvasVisible:
				getComputedStyle(
					document.getElementById("heatmapCanvasContainer"),
				).display === "block",
			stats: {
				vehicles: document.getElementById("heatmapVehicles").textContent,
				streets: document.getElementById("heatmapStreets").textContent,
				renderTime: document.getElementById("heatmapTime").textContent,
				simTime: document.getElementById("heatmapSimTime").textContent,
			},
			expectedVehicleCount: vehicleCount.toLocaleString(),
			totalStreets: window.calles.length,
		}
	})

describe("heatmap and metric-image localization", () => {
	it.each([
		{ language: "es", usePixi: false },
		{ language: "en", usePixi: false },
		{ language: "es", usePixi: true },
		{ language: "en", usePixi: true },
	])(
		"translates heatmap content and all seven downloaded images ($language, Pixi $usePixi)",
		async ({ language, usePixi }) => {
			const simulator = await openSimulator({
				languagePreference: language,
				usePixi,
			})
			try {
				const { page } = simulator
				await page.waitForFunction(
					(active) => document.documentElement.lang === active,
					{ polling: 100 },
					language,
				)
				await ready(page)
				await openMetrics(page)

				const archive = await exportArchive(page)
				expect(archive.error, simulator.consoleErrors.join("\n")).toBeUndefined()
				languageDigests[`${usePixi ? "pixi" : "canvas"}-${language}`] =
					assertImageExport(archive, language)

				await openHeatmap(page)
				const heatmap = await readHeatmap(page)
				expect(heatmap.language).toBe(language)
				expect(heatmap.texts.length).toBeGreaterThan(15)
				for (const entry of heatmap.texts) {
					expect(entry.text, `${language}: ${entry.key}`).toBe(
						catalogValue(language, entry.key),
					)
				}
				expect(heatmap.title).toBe(
					catalogValue(language, "metrics.heatmap.title"),
				)
				expect(heatmap.subtitle).toBe(
					catalogValue(language, "metrics.heatmap.subtitle"),
				)
				expect(heatmap.close).toBe(catalogValue(language, "common.close"))
				expect(heatmap.closeLabel).toBe(
					catalogValue(language, "common.close"),
				)
				expect(heatmap.loadingHidden).toBe(true)
				expect(heatmap.canvasVisible).toBe(true)
				expect(heatmap.stats.vehicles).toBe(heatmap.expectedVehicleCount)
				expect(heatmap.stats.streets).toBe(
					`${heatmap.totalStreets}/${heatmap.totalStreets}`,
				)
				expect(heatmap.stats.renderTime).toMatch(/^\d+(\.\d+)?ms$/)
				expect(heatmap.stats.simTime).toMatch(/^\d{2}:\d{2}:\d{2}$/)
				await closeHeatmap(page)
				expect(simulator.pageErrors).toEqual([])
				expect(simulator.consoleErrors).toEqual([])
			} finally {
				await simulator.close()
			}
		},
		240000,
	)

	it("downloads language-specific bytes in all seven images", () => {
		for (const renderer of ["canvas", "pixi"]) {
			const spanish = languageDigests[`${renderer}-es`]
			const english = languageDigests[`${renderer}-en`]
			expect(spanish, `${renderer} Spanish archive`).toBeDefined()
			expect(english, `${renderer} English archive`).toBeDefined()
			expect(Object.keys(english).sort()).toEqual(Object.keys(spanish).sort())
			for (const name of Object.keys(spanish)) {
				expect(english[name], `${renderer}: ${name}`).not.toBe(spanish[name])
			}
		}
	})

	it("keeps heatmap controls readable in both themes and mobile layouts", async () => {
		const simulator = await openSimulator({ languagePreference: "en" })
		try {
			const { page, consoleErrors, pageErrors } = simulator
			await ready(page)
			await openMetrics(page)

			const warning = await page.evaluate(async () => {
				const originalStreets = window.calles
				window.calles = []
				for (const toast of document.querySelectorAll(".toast")) toast.remove()
				document.getElementById("btnMapaCalor").click()
				await new Promise((resolve) => setTimeout(resolve, 250))
				const toast = document.querySelector(".toast")
				window.calles = originalStreets
				return {
					modalOpen: document
						.getElementById("modalMapaCalor")
						.classList.contains("show"),
					severity: toast?.querySelector(".toast-header")?.className,
					body: toast?.querySelector(".toast-body")?.textContent,
				}
			})
			expect(warning.modalOpen).toBe(false)
			expect(warning.severity).toContain("bg-warning")
			expect(warning.body).toBe(
				catalogValue("en", "notifications.metrics.heatmapNoStreets"),
			)

			await openHeatmap(page)

			const readLayout = () =>
				page.evaluate(() => {
					const dialog = document
						.querySelector("#modalMapaCalor .modal-dialog")
						.getBoundingClientRect()
					const body = document.querySelector("#modalMapaCalor .modal-body")
					const title = document.getElementById("modalMapaCalorLabel")
					const footer = document.querySelector("#modalMapaCalor .heatmap-footer")
					const footerNote = footer.querySelector("small")
					const footerNoteRect = footerNote.getBoundingClientRect()
					const close = footer.querySelector("button")
					const legend = document.querySelector("#modalMapaCalor .heatmap-legend")
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
						footerNoteColor: getComputedStyle(footerNote).color,
						footerNoteInside:
							footerNoteRect.left >= -1 &&
							footerNoteRect.right <= window.innerWidth + 1 &&
							footerNoteRect.top >= -1 &&
							footerNoteRect.bottom <= window.innerHeight + 1,
						legendVisible:
							legend.getBoundingClientRect().width > 0 &&
							getComputedStyle(legend).visibility !== "hidden",
						headerCloseLabel: document
							.querySelector(
								"#modalMapaCalor .modal-header [data-bs-dismiss=\"modal\"]",
							)
							.getAttribute("aria-label"),
						closeVisible:
							close.getBoundingClientRect().width > 0 &&
							getComputedStyle(close).visibility !== "hidden",
						closeText: close.textContent.trim(),
					}
				})

			let layout = await readLayout()
			expect(layout.bodyOverflow).toBeLessThanOrEqual(1)
			expect(layout.bodyOverflowX).toBeLessThanOrEqual(1)
			expect(layout.dialogFits).toBe(true)
			expect(layout.titleVisible).toBe(true)
			expect(layout.footerNoteInside).toBe(true)
			expect(layout.legendVisible).toBe(true)
			expect(layout.headerCloseLabel).toBe(catalogValue("en", "common.close"))
			expect(layout.closeVisible).toBe(true)
			expect(layout.closeText).toBe(catalogValue("en", "common.close"))
			const lightDesktopColor = layout.titleColor

			await page.evaluate(() => document.getElementById("switchModoOscuro").click())
			await page.waitForFunction(
				() => document.body.classList.contains("dark-mode"),
				{ polling: 100 },
			)
			const dark = await readLayout()
			expect(dark.titleColor).not.toBe(lightDesktopColor)
			expect(dark.footerNoteColor).not.toBe(layout.footerNoteColor)
			expect(dark.bodyOverflow).toBeLessThanOrEqual(1)
			expect(dark.dialogFits).toBe(true)
			expect(dark.legendVisible).toBe(true)
			expect(dark.headerCloseLabel).toBe(catalogValue("en", "common.close"))

			await page.setViewport({ width: 390, height: 844 })
			await new Promise((resolve) => setTimeout(resolve, 400))
			layout = await readLayout()
			expect(layout.bodyOverflow).toBeLessThanOrEqual(1)
			expect(layout.bodyOverflowX).toBeLessThanOrEqual(1)
			expect(layout.dialogFits).toBe(true)
			expect(layout.titleVisible).toBe(true)
			expect(layout.footerNoteInside).toBe(true)
			expect(layout.legendVisible).toBe(true)
			expect(layout.headerCloseLabel).toBe(catalogValue("en", "common.close"))
			expect(layout.closeVisible).toBe(true)

			await page.evaluate(() => document.getElementById("switchModoOscuro").click())
			await page.waitForFunction(
				() => !document.body.classList.contains("dark-mode"),
				{ polling: 100 },
			)
			const lightMobile = await readLayout()
			expect(lightMobile.titleColor).toBe(lightDesktopColor)
			expect(lightMobile.bodyOverflow).toBeLessThanOrEqual(1)
			expect(lightMobile.bodyOverflowX).toBeLessThanOrEqual(1)
			expect(lightMobile.dialogFits).toBe(true)
			expect(lightMobile.footerNoteInside).toBe(true)
			expect(lightMobile.legendVisible).toBe(true)
			expect(lightMobile.closeVisible).toBe(true)

			await closeHeatmap(page)
			expect(pageErrors).toEqual([])
			expect(consoleErrors).toEqual([])
		} finally {
			await simulator.close()
		}
	}, 180000)
})
