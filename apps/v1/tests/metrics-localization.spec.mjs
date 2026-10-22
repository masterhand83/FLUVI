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

function interpolate(template, params = {}) {
	return String(template).replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (match, name) =>
		name in params ? String(params[name]) : match,
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
	return interpolate(value, params)
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
			typeof Chart !== "undefined" && densityChartInstance !== null,
		{ polling: 100, timeout: 30000 },
	)
	await page.evaluate(() => {
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

const openStreetModal = async (page) => {
	await page.evaluate(() =>
		document.getElementById("btnConfigCallesMetricas").click(),
	)
	await page.waitForSelector("#modalConfigCallesMetricas.show", {
		visible: true,
	})
	await page.waitForFunction(
		() =>
			!document
				.querySelector("#modalConfigCallesMetricas .modal-dialog")
				?.getAnimations().length,
		{ polling: 100 },
	)
}

const closeStreetModal = async (page) => {
	await page.$eval(
		'#modalConfigCallesMetricas [data-bs-dismiss="modal"]',
		(button) => button.click(),
	)
	await page.waitForSelector("#modalConfigCallesMetricas", { hidden: true })
	await page.waitForFunction(() => !document.querySelector(".modal-backdrop"), {
		polling: 100,
	})
}

const statusSamples = [
	{
		metrics: { density: 90, speed: 5, throughput: 0.2, netGeneration: -5 },
		key: "collapse",
		className: "status-critico",
	},
	{
		metrics: { density: 40, speed: 70, throughput: 3.5, netGeneration: 1 },
		key: "optimal",
		className: "status-optimo",
	},
	{
		metrics: { density: 70, speed: 20, throughput: 1.5, netGeneration: -1 },
		key: "congested",
		className: "status-alto",
	},
	{
		metrics: { density: 10, speed: 80, throughput: 0.5, netGeneration: 0 },
		key: "underused",
		className: "status-bajo",
	},
	{
		metrics: { density: 50, speed: 40, throughput: 2.5, netGeneration: 0.5 },
		key: "moderate",
		className: "status-moderado",
	},
]

const samplesByLanguage = {}

describe("traffic metrics localization", () => {
	it("translates classifications, chart labels, street selection, and export copy in both languages", async () => {
		for (const language of ["es", "en"]) {
			const simulator = await openSimulator({ languagePreference: language })
			try {
				const { page } = simulator
				await page.waitForFunction(
					(active) => document.documentElement.lang === active,
					{ polling: 100 },
					language,
				)
				await page.evaluate(() => window.fluviI18n.translateDocument())
				await ready(page)
				await openMetrics(page)

				const wiring = await page.evaluate(() => {
					const directText = (element) =>
						[...element.childNodes]
							.filter((node) => node.nodeType === Node.TEXT_NODE)
							.map((node) => node.nodeValue)
							.join("")
							.trim()
					return {
						language: document.documentElement.lang,
						texts: [
							...document.querySelectorAll('[data-i18n^="metrics."]'),
						].map((element) => ({
							key: element.getAttribute("data-i18n"),
							text: directText(element),
						})),
						attributes: [
							...document.querySelectorAll("[data-i18n-attr]"),
						].flatMap((element) =>
							element
								.getAttribute("data-i18n-attr")
								.split(";")
								.map((pair) => pair.trim())
								.filter(Boolean)
								.map((pair) => {
									const separator = pair.indexOf(":")
									const attribute = pair.slice(0, separator).trim()
									return {
										key: pair.slice(separator + 1).trim(),
										attribute,
										value: element.getAttribute(attribute),
									}
								})
								.filter((entry) => entry.key.startsWith("metrics.")),
						),
						chartLabels: [
							densityChartInstance,
							throughputChartInstance,
							speedChartInstance,
							netGenerationChartInstance,
							entropyChartInstance,
						].map((chart) => {
							const value = {
								densityChart: 40,
								throughputChart: 3.2,
								speedChart: 65,
								netGenerationChart: -1,
								entropyChart: 2.345,
							}[chart.canvas.id]
							return {
								id: chart.canvas.id,
								dataset: chart.data.datasets[0].label,
								title: chart.options.plugins.tooltip.callbacks.title([
									{ label: "08:00:00" },
								]),
								body: chart.options.plugins.tooltip.callbacks.label({
									parsed: { y: value },
								}),
							}
						}),
					}
				})

				expect(wiring.language).toBe(language)
				expect(wiring.texts.length).toBeGreaterThan(20)
				for (const entry of wiring.texts) {
					expect(entry.text, `${language}: ${entry.key}`).toBe(
						catalogValue(language, entry.key),
					)
				}
				expect(wiring.attributes.length).toBeGreaterThan(5)
				for (const entry of wiring.attributes) {
					expect(
						entry.value,
						`${language}: ${entry.key} (${entry.attribute})`,
					).toBe(catalogValue(language, entry.key))
				}

				expect(wiring.chartLabels).toEqual([
					{
						id: "densityChart",
						dataset: catalogValue(language, "metrics.charts.density.dataset"),
						title: [
							catalogValue(language, "metrics.charts.density.tooltipTitle"),
							"08:00:00",
						],
						body: [
							message(language, "metrics.charts.density.tooltipValue", {
								value: "40.0",
							}),
							catalogValue(language, "metrics.labels.density.moderate"),
						],
					},
					{
						id: "throughputChart",
						dataset: catalogValue(
							language,
							"metrics.charts.throughput.dataset",
						),
						title: [
							catalogValue(
								language,
								"metrics.charts.throughput.tooltipTitle",
							),
							"08:00:00",
						],
						body: [
							message(language, "metrics.charts.throughput.tooltipValue", {
								value: "3.2",
							}),
							catalogValue(language, "metrics.labels.throughput.good"),
						],
					},
					{
						id: "speedChart",
						dataset: catalogValue(language, "metrics.charts.speed.dataset"),
						title: [
							catalogValue(language, "metrics.charts.speed.tooltipTitle"),
							"08:00:00",
						],
						body: [
							message(language, "metrics.charts.speed.tooltipValue", {
								value: "65.0",
							}),
							catalogValue(language, "metrics.labels.speed.fluid"),
						],
					},
					{
						id: "netGenerationChart",
						dataset: catalogValue(
							language,
							"metrics.charts.netGeneration.dataset",
						),
						title: [
							catalogValue(
								language,
								"metrics.charts.netGeneration.tooltipTitle",
							),
							"08:00:00",
						],
						body: [
							message(
								language,
								"metrics.charts.netGeneration.tooltipValue",
								{ value: "-1.0" },
							),
							catalogValue(
								language,
								"metrics.labels.netGeneration.slowDecrease",
							),
						],
					},
					{
						id: "entropyChart",
						dataset: catalogValue(language, "metrics.charts.entropy.dataset"),
						title: [
							catalogValue(language, "metrics.charts.entropy.tooltipTitle"),
							"08:00:00",
						],
						body: [
							message(language, "metrics.charts.entropy.tooltipValue", {
								value: "2.345",
							}),
						],
					},
				])

				const statusSamplesRead = await page.evaluate((samples) => {
					const panel = document.getElementById("statusPanel")
					return samples.map(({ metrics }) => {
						const state = window.interpretarMetricas(metrics)
						window.actualizarPanelInterpretacion(state, metrics)
						return {
							level: state.level,
							emoji: state.emoji,
							className: panel.className,
							role: panel.getAttribute("role"),
							live: panel.getAttribute("aria-live"),
							title: panel.querySelector(".status-title").textContent,
							description: panel
								.querySelector(".status-description")
								.textContent.trim(),
							labels: [...panel.querySelectorAll(".metric-label")].map(
								(element) => element.textContent,
							),
							values: [...panel.querySelectorAll(".metric-value")].map(
								(element) => element.textContent,
							),
							descriptions: [...panel.querySelectorAll(".metric-desc")].map(
								(element) => element.textContent.replace(/^→\s*/, ""),
							),
							observationsTitle: panel.querySelector(
								".observations-title",
							).textContent,
							observations: [
								...panel.querySelectorAll(".observation-item"),
							].map((element) =>
								element.textContent.replace(/^•\s*/, ""),
							),
							observationDescriptors: state.observations,
						}
					})
				}, statusSamples)

				statusSamplesRead.forEach((sample, index) => {
					const expected = statusSamples[index]
					const levelKey = `metrics.status.levels.${expected.key}`
					expect(sample.level).toBe(expected.key)
					expect(sample.emoji).toHaveLength(2)
					expect(sample.className).toBe(
						`status-panel ${expected.className}`,
					)
					expect(sample.role).toBe("status")
					expect(sample.live).toBe("polite")
					expect(sample.title).toBe(catalogValue(language, `${levelKey}.title`))
					expect(sample.description).toBe(
						catalogValue(language, `${levelKey}.description`),
					)
					expect(sample.labels).toEqual([
						catalogValue(language, "metrics.status.labels.density"),
						catalogValue(language, "metrics.status.labels.throughput"),
						catalogValue(language, "metrics.status.labels.speed"),
						catalogValue(language, "metrics.status.labels.rate"),
					])
					const { density, speed, throughput, netGeneration } =
						expected.metrics
					expect(sample.values).toEqual([
						`${density.toFixed(1)}%`,
						`${throughput.toFixed(1)} veh/s`,
						`${speed.toFixed(1)}%`,
						`${netGeneration.toFixed(1)} veh/s`,
					])
					expect(sample.observationsTitle).toBe(
						`💡 ${catalogValue(language, "metrics.status.observationsTitle")}`,
					)
					expect(sample.observations).toEqual(
						sample.observationDescriptors.map((observation) =>
							message(language, observation.key, observation.params),
						),
					)
					expect(sample.observations.length).toBeGreaterThan(2)
				})
				samplesByLanguage[language] = statusSamplesRead.map(
					(sample) => sample.level,
				)

				await openStreetModal(page)
				const streetSelection = await page.evaluate(() => {
					const first = window.streetListUI.sortedEntries(window.calles)[0]
					const row = document.querySelector("#listaCallesMetricas .form-check")
					const label = row.querySelector("label")
					return {
						title: document.querySelector(
							"#modalConfigCallesMetricas .modal-title",
						).textContent,
						notice: document.querySelector(
							"#modalConfigCallesMetricas .modal-body > p",
						).textContent,
						counter: document.getElementById("contadorCallesIncluidas")
							.textContent,
						selectAll: document.getElementById("btnSeleccionarTodasCalles")
							.textContent,
						deselectAll: document.getElementById(
							"btnDeseleccionarTodasCalles",
						).textContent,
						first: {
							name: label.childNodes[0].nodeValue.trim(),
							detail: label.querySelector(".text-muted").textContent,
							aria: row.querySelector("input").getAttribute("aria-label"),
							index: first.index,
							lanes: first.street.carriles,
							cells: first.street.tamano,
							streetName: first.street.nombre,
						},
						total: window.calles.length,
						included: window.obtenerCantidadCallesIncluidas(),
					}
				})
				expect(streetSelection.title).toBe(
					catalogValue(language, "metrics.streetSelection.modalTitle"),
				)
				expect(streetSelection.notice).toBe(
					catalogValue(language, "metrics.streetSelection.intro"),
				)
				expect(streetSelection.counter).toBe(
					message(language, "metrics.streetSelection.includedCount", {
						included: streetSelection.included,
						total: streetSelection.total,
					}),
				)
				expect(streetSelection.selectAll).toBe(
					catalogValue(language, "metrics.streetSelection.selectAll"),
				)
				expect(streetSelection.deselectAll).toBe(
					catalogValue(language, "metrics.streetSelection.deselectAll"),
				)
				expect(streetSelection.first).toMatchObject({
					name: streetSelection.first.streetName,
					detail: `(${message(language, "metrics.streetSelection.lanes", {
						count: streetSelection.first.lanes,
					})}, ${message(language, "metrics.streetSelection.cells", {
						count: streetSelection.first.cells,
					})})`,
					aria: message(language, "metrics.streetSelection.includeStreet", {
						name: streetSelection.first.streetName,
					}),
				})
				await closeStreetModal(page)

				const exportCopy = await page.evaluate(() => ({
					csv: document.querySelector("#btnDescargarCSV span").textContent,
					json: document.querySelector("#btnDescargarJSON span").textContent,
					notice: document.querySelector(".metrics-export-notice").textContent,
					csvTooltip: document
						.getElementById("btnDescargarCSV")
						.getAttribute("data-bs-title"),
					jsonTooltip: document
						.getElementById("btnDescargarJSON")
						.getAttribute("data-bs-title"),
				}))
				expect(exportCopy).toEqual({
					csv: catalogValue(language, "metrics.export.csvButton"),
					json: catalogValue(language, "metrics.export.jsonButton"),
					notice: catalogValue(language, "metrics.export.legacyNotice"),
					csvTooltip: catalogValue(language, "metrics.export.csvTooltip"),
					jsonTooltip: catalogValue(language, "metrics.export.jsonTooltip"),
				})

				await page.evaluate(() => window.resetSimulationMetrics())
				await page.evaluate(() => {
					document.getElementById("btnDescargarCSV").click()
				})
				await page.waitForFunction(
					() => document.querySelectorAll(".toast").length > 0,
					{ polling: 100 },
				)
				const toast = await page.$$eval(".toast", (elements) => {
					const last = elements.at(-1)
					return {
						header: last.querySelector(".toast-header").className,
						title: last.querySelector(".toast-header strong").textContent,
						body: last.querySelector(".toast-body").textContent,
					}
				})
				expect(toast.header).toContain("bg-warning")
				expect(toast.title).toContain(
					catalogValue(language, "notifications.title.warning"),
				)
				expect(toast.body).toBe(
					catalogValue(language, "notifications.metrics.nothingToExport"),
				)
				expect(simulator.pageErrors).toEqual([])
				expect(simulator.consoleErrors).toEqual([])
			} finally {
				await simulator.close()
			}
		}

		expect(samplesByLanguage.en).toEqual(samplesByLanguage.es)
	}, 240000)

	it("keeps English chart tooltips contained through low, middle, high, and updated samples", async () => {
		const simulator = await openSimulator({
			languagePreference: "en",
			freezeFrames: false,
		})
		try {
			const { page } = simulator
			await ready(page)
			await page.waitForFunction(
				() =>
					getComputedStyle(document.getElementById("loadingScreen")).display ===
					"none",
			)
			await openMetrics(page)
			await page.evaluate(() => {
				for (const chart of [
					densityChartInstance,
					throughputChartInstance,
					speedChartInstance,
					netGenerationChartInstance,
					entropyChartInstance,
				]) {
					for (
						let parent = chart.canvas.parentElement;
						parent;
						parent = parent.parentElement
					) {
						if (parent.classList.contains("collapse")) parent.classList.add("show")
					}
					chart.resize()
				}
			})

			const expectedTitles = {
				densityChart: catalogValue("en", "metrics.charts.density.tooltipTitle"),
				throughputChart: catalogValue(
					"en",
					"metrics.charts.throughput.tooltipTitle",
				),
				speedChart: catalogValue("en", "metrics.charts.speed.tooltipTitle"),
				netGenerationChart: catalogValue(
					"en",
					"metrics.charts.netGeneration.tooltipTitle",
				),
				entropyChart: catalogValue("en", "metrics.charts.entropy.tooltipTitle"),
			}
			const expectedBodies = {
				densityChart: catalogValue("en", "metrics.labels.density.critical"),
				throughputChart: catalogValue(
					"en",
					"metrics.labels.throughput.excellent",
				),
				speedChart: catalogValue("en", "metrics.labels.speed.excellent"),
				netGenerationChart: catalogValue(
					"en",
					"metrics.labels.netGeneration.fastGrowth",
				),
				entropyChart: message("en", "metrics.charts.entropy.tooltipValue", {
					value: "3.000",
				}),
			}

			const placements = await page.evaluate(() => {
				const charts = [
					densityChartInstance,
					throughputChartInstance,
					speedChartInstance,
					netGenerationChartInstance,
					entropyChartInstance,
				]
				const placements = []
				for (const chart of charts) {
					const max =
						chart.options.scales.y.max ||
						chart.options.scales.y.suggestedMax
					chart.data.labels = ["08:00:00", "08:00:02", "08:00:04"]
					chart.data.datasets[0].data = [0, max / 2, max]
					chart.update("none")
					for (let index = 0; index < 3; index++) {
						const point = chart.getDatasetMeta(0).data[index]
						chart.tooltip.setActiveElements(
							[{ datasetIndex: 0, index }],
							{ x: point.x, y: point.y },
						)
						chart.draw()
						const tooltip = chart.tooltip
						placements.push({
							id: chart.canvas.id,
							index,
							x: tooltip.x,
							y: tooltip.y,
							width: tooltip.width,
							height: tooltip.height,
							canvasWidth: chart.width,
							canvasHeight: chart.height,
							caretX: tooltip.caretX,
							caretY: tooltip.caretY,
							pointX: point.x,
							pointY: point.y,
							title: tooltip.title,
							body: tooltip.body.map((entry) => entry.lines).flat(),
							timestamp: chart.data.labels[index],
						})
					}
				}
				return placements
			})
			for (const placement of placements) {
				const label = `${placement.id} sample ${placement.index}: ${JSON.stringify(placement)}`
				expect(placement.x, label).toBeGreaterThanOrEqual(0)
				expect(placement.y, label).toBeGreaterThanOrEqual(0)
				expect(placement.x + placement.width, label).toBeLessThanOrEqual(
					placement.canvasWidth,
				)
				expect(placement.y + placement.height, label).toBeLessThanOrEqual(
					placement.canvasHeight,
				)
				expect(placement.caretX, label).toBeCloseTo(placement.pointX)
				expect(placement.caretY, label).toBeCloseTo(placement.pointY)
				expect(placement.title, label).toEqual([
					expectedTitles[placement.id],
					placement.timestamp,
				])
				expect(placement.body.length, label).toBeLessThanOrEqual(2)
				expect(placement.body.join(" ").length, label).toBeLessThan(70)
				if (placement.index === 2) {
					expect(placement.body.at(-1), label).toBe(
						expectedBodies[placement.id],
					)
				}
			}

			for (const id of Object.keys(expectedTitles)) {
				const point = await page.evaluate((id) => {
					const canvas = document.getElementById(id)
					canvas.scrollIntoView({ block: "center", behavior: "instant" })
					const chart = Chart.getChart(canvas)
					const point = chart.getDatasetMeta(0).data[1]
					const bounds = canvas.getBoundingClientRect()
					return { x: bounds.left + point.x, y: bounds.top + point.y }
				}, id)
				await page.mouse.move(point.x, point.y)
				await page
					.waitForFunction(
						(id) => {
							const tooltip = Chart.getChart(id).tooltip
							return (
								tooltip.opacity === 1 &&
								tooltip.dataPoints[0]?.dataIndex === 1
							)
						},
						{ timeout: 5000 },
						id,
					)
					.catch((error) => {
						throw new Error(`${id}: ${error.message}`)
					})
				const result = await page.evaluate((id) => {
					const chart = Chart.getChart(id)
					chart.data.datasets[0].data[1] *= 0.5
					chart.update("none")
					const point = chart.getDatasetMeta(0).data[1]
					const tooltip = chart.tooltip
					return {
						index: tooltip.dataPoints[0].dataIndex,
						title: tooltip.title,
						body: tooltip.body.map((entry) => entry.lines).flat(),
						caretX: tooltip.caretX,
						caretY: tooltip.caretY,
						pointX: point.x,
						pointY: point.y,
						bottom: tooltip.y + tooltip.height,
						height: chart.height,
					}
				}, id)
				expect(result.index, id).toBe(1)
				expect(result.title, id).toEqual([
					expectedTitles[id],
					"08:00:02",
				])
				expect(result.body.length, id).toBeLessThanOrEqual(2)
				expect(result.caretX, id).toBeCloseTo(result.pointX)
				expect(result.caretY, id).toBeCloseTo(result.pointY)
				expect(result.bottom, id).toBeLessThanOrEqual(result.height)
				await page.mouse.move(1400, 20)
				await page.waitForFunction(
					(id) => Chart.getChart(id).tooltip.opacity === 0,
					{},
					id,
				)
			}
			expect(simulator.pageErrors).toEqual([])
		} finally {
			await simulator.close()
		}
	}, 180000)

	it("keeps metrics controls readable in both themes and mobile layouts", async () => {
		const simulator = await openSimulator({ languagePreference: "en" })
		try {
			const { page } = simulator
			await ready(page)
			await openMetrics(page)

			const readLayout = () =>
				page.evaluate(() => {
					const panel = document.getElementById("statusPanel")
					const notice = document.querySelector(".metrics-export-notice")
					const button = document.getElementById("btnDescargarCSV")
					const panelRect = panel.getBoundingClientRect()
					const noticeRect = notice.getBoundingClientRect()
					return {
						viewport: window.innerWidth,
						bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
						panelOverflow: panel.scrollWidth - panel.clientWidth,
						panelInside:
							panelRect.left >= -1 &&
							panelRect.right <= window.innerWidth + 1,
						noticeInside:
							noticeRect.left >= -1 &&
							noticeRect.right <= window.innerWidth + 1,
						buttonVisible:
							button.getBoundingClientRect().width > 0 &&
							getComputedStyle(button).visibility !== "hidden",
						buttonText: button.textContent.trim(),
						panelColor: getComputedStyle(panel.querySelector(".status-description"))
							.color,
						panelBackground: getComputedStyle(panel).backgroundImage,
					}
				})

			let layout = await readLayout()
			expect(layout.bodyOverflow).toBeLessThanOrEqual(1)
			expect(layout.panelOverflow).toBeLessThanOrEqual(1)
			expect(layout.panelInside).toBe(true)
			expect(layout.noticeInside).toBe(true)
			expect(layout.buttonVisible).toBe(true)
			expect(layout.buttonText).toBe(catalogValue("en", "metrics.export.csvButton"))

			await page.click("#switchModoOscuro")
			await page.waitForFunction(
				() => document.body.classList.contains("dark-mode"),
				{ polling: 100 },
			)
			const dark = await readLayout()
			expect(dark.panelColor).not.toBe(layout.panelColor)
			expect(dark.panelBackground).not.toBe(layout.panelBackground)

			await page.setViewport({ width: 390, height: 844 })
			await new Promise((resolve) => setTimeout(resolve, 400))
			layout = await readLayout()
			expect(layout.bodyOverflow).toBeLessThanOrEqual(1)
			expect(layout.panelOverflow).toBeLessThanOrEqual(1)
			expect(layout.panelInside).toBe(true)
			expect(layout.noticeInside).toBe(true)
			expect(layout.buttonVisible).toBe(true)

			await openStreetModal(page)
			const modal = await page.evaluate(() => {
				const dialog = document
					.querySelector("#modalConfigCallesMetricas .modal-dialog")
					.getBoundingClientRect()
				const body = document.querySelector(
					"#modalConfigCallesMetricas .modal-body",
				)
				return {
					fits:
						dialog.left >= -1 &&
						dialog.top >= -1 &&
						dialog.right <= window.innerWidth + 1 &&
						dialog.bottom <= window.innerHeight + 1,
					overflow: body.scrollWidth - body.clientWidth,
				}
			})
			expect(modal.fits).toBe(true)
			expect(modal.overflow).toBeLessThanOrEqual(1)
			await closeStreetModal(page)
			expect(simulator.pageErrors).toEqual([])
		} finally {
			await simulator.close()
		}
	}, 180000)
})
