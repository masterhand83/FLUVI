import { describe, expect, it } from "vitest"
import {
	openSimulator,
	reloadSimulator,
} from "./helpers/simulator.mjs"

const hideLoadingScreen = (page) =>
	page.evaluate(() => {
		document.getElementById("loadingScreen").style.display = "none"
	})

const selectStreet = async (page) => {
	await page.evaluate(() => {
		window.calleSeleccionada = window.calles[0]
		const selector = document.getElementById("selectCalle")
		selector.value = "0"
		selector.dispatchEvent(new Event("change", { bubbles: true }))
	})
	await page.waitForSelector("#streetInspector", { visible: true })
}

const pausedState = (page) =>
	page.evaluate(() => {
		const ocupacion = window.calles
			.map(
				(calle) =>
					`${calle.id}:${calle.arreglo.map((lane) => lane.join("")).join(",")}`,
			)
			.join(";")
		return {
			isPaused: window.isPaused,
			calles: window.calles.map((calle) => calle.id),
			ocupacion,
			reloj: {
				diaActual: window.configuracionTiempo.diaActual,
				horaActual: window.configuracionTiempo.horaActual,
				minutoActual: window.configuracionTiempo.minutoActual,
				segundoActual: window.configuracionTiempo.segundoActual,
			},
			marker: window.__localizationMarker,
		}
	})

describe("startup language and simulator controls", () => {
	it("starts in Spanish for an absent preference even when the browser is English", async () => {
		const simulator = await openSimulator({ navigatorLanguage: "en-US" })
		try {
			const { page } = simulator
			const state = await page.evaluate(() => ({
				lang: document.documentElement.lang,
				loadingTitle: document.querySelector("#loadingScreen p").textContent.trim(),
				heading: document
					.querySelector("#headingAbout .accordion-button")
					.textContent.trim(),
				pause: document
					.getElementById("btnPauseResume")
					.getAttribute("aria-label"),
				speed: document
					.querySelector('label[for="velocidadSlider"]')
					.textContent.trim(),
				population: document
					.querySelector('.info-label[data-i18n="simulation.info.population"]')
					.textContent.trim(),
				selector: document.getElementById("languagePreference").value,
			}))
			expect(state).toEqual({
				lang: "es",
				loadingTitle: "Cargando simulación...",
				heading: "ℹ️ Sobre FLUVI",
				pause: "Pausar simulación",
				speed: "Velocidad:",
				population: "Vehículos:",
				selector: "es",
			})
		} finally {
			await simulator.close()
		}
	})

	it("shows translated Spanish notification severities and confirmation defaults", async () => {
		const simulator = await openSimulator()
		try {
			const { page } = simulator
			await hideLoadingScreen(page)
			await page.evaluate(() => {
				window.fluviNotify.warning(
					"notifications.simulation.generationRange",
					undefined,
					60000,
				)
			})
			await page.waitForSelector(".toast", { visible: true })
			const toast = await page.$eval(".toast", (element) => ({
				header: element.querySelector(".toast-header").className,
				title: element.querySelector(".toast-header strong").textContent,
				body: element.querySelector(".toast-body").textContent,
			}))
			expect(toast).toEqual({
				header: "toast-header bg-warning text-dark",
				title: "⚠️Advertencia",
				body: "La probabilidad de generación debe estar entre 0 y 100.",
			})

			await page.evaluate(() => {
				window.mostrarConfirmacion("Confirmar prueba", "Cuerpo")
			})
			await page.waitForSelector(".modal.show", { visible: true })
			await new Promise((resolve) => setTimeout(resolve, 500))
			expect(
				await page.$$eval(".modal.show .modal-footer .btn", (elements) =>
					elements.map((element) => element.textContent.trim()),
				),
			).toEqual(["Cancelar", "Confirmar"])
			await page.click(".modal.show .modal-footer .btn-secondary")
			await page.waitForSelector(".modal.show", { hidden: true })
		} finally {
			await simulator.close()
		}
	})

	it("falls back to Spanish for an invalid saved preference", async () => {
		const simulator = await openSimulator({
			languagePreference: "fr",
			navigatorLanguage: "en-US",
		})
		try {
			const { page } = simulator
			expect(await page.evaluate(() => document.documentElement.lang)).toBe("es")
			expect(
				await page.$eval(
					"#headingAbout .accordion-button",
					(element) => element.textContent.trim(),
				),
			).toBe("ℹ️ Sobre FLUVI")
			expect(
				await page.$eval("#languagePreference", (element) => element.value),
			).toBe("es")
		} finally {
			await simulator.close()
		}
	})

	it("starts in English with translated loading, sidebar, simulation controls, and street inspector", async () => {
		const simulator = await openSimulator({ languagePreference: "en" })
		try {
			const { page } = simulator
			const startup = await page.evaluate(() => ({
				lang: document.documentElement.lang,
				loadingTitle: document.querySelector("#loadingScreen p").textContent.trim(),
				loadingInstruction: document.querySelector(
					'[data-i18n="loading.instructions.navigate.title"]',
				).textContent.trim(),
				headings: [...document.querySelectorAll(
					"#controlPanelAccordion > .accordion-item > .accordion-header .accordion-button",
				)].map((element) => element.textContent.trim()),
				pause: document
					.getElementById("btnPauseResume")
					.getAttribute("aria-label"),
				pauseTooltip: document
					.getElementById("btnPauseResume")
					.getAttribute("data-bs-title"),
				step: document.getElementById("btnPaso").getAttribute("aria-label"),
				speed: document
					.querySelector('label[for="velocidadSlider"]')
					.textContent.trim(),
				generation: document
					.querySelector('label[for="probabilidadSlider"]')
					.textContent.trim(),
				population: document
					.querySelector('.info-label[data-i18n="simulation.info.population"]')
					.textContent.trim(),
				selector: document.getElementById("languagePreference").value,
			}))
			expect(startup.lang).toBe("en")
			expect(startup.loadingTitle).toBe("Loading simulation...")
			expect(startup.loadingInstruction).toBe("🖱️ Navigate")
			expect(startup.headings.slice(0, 6)).toEqual([
				"ℹ️ About FLUVI",
				"✏️ Tools",
				"🏗️ Map Constructor",
				"⚙️ Street Settings",
				"🎬 Scenario Settings",
				"📈 Simulation Metrics",
			])
			expect(startup.pause).toBe("Pause simulation")
			expect(startup.pauseTooltip).toBe("Pause or resume the traffic simulation")
			expect(startup.step).toBe("Advance one step")
			expect(startup.speed).toBe("Speed:")
			expect(startup.generation).toBe("Generation:")
			expect(startup.population).toBe("Vehicles:")
			expect(startup.selector).toBe("en")

			await hideLoadingScreen(page)
			await selectStreet(page)
			const inspector = await page.evaluate(() => ({
				label: document.getElementById("streetInspector").getAttribute("aria-label"),
				name: document
					.querySelector("#streetInspector .street-inspector-field span")
					.textContent.trim(),
				close: document
					.getElementById("streetInspectorClose")
					.getAttribute("aria-label"),
				labels: [...document.querySelectorAll("#streetInspector dt")].map(
					(element) => element.textContent.trim(),
				),
				types: [...document.querySelectorAll("#streetInspectorType option")].map(
					(element) => element.textContent.trim(),
				),
				directions: document
					.getElementById("streetInspectorLaneDirections")
					.getAttribute("aria-label"),
				firstLane: document
					.querySelector("#streetInspectorLaneDirections button")
					.getAttribute("aria-label"),
				deleteStreet: document
					.getElementById("streetInspectorDeleteStreet")
					.textContent.trim(),
			}))
			expect(inspector.label).toBe("Street inspector")
			expect(inspector.name).toBe("Name")
			expect(inspector.close).toBe("Close street inspector")
			expect(inspector.labels).toContain("Lanes")
			expect(inspector.labels).toContain("Direction per lane")
			expect(inspector.labels).toContain("Type")
			expect(inspector.labels).toContain("Generation (%)")
			expect(inspector.types).toEqual([
				"Generator",
				"CONEXION (street type)",
				"Sink",
			])
			expect(inspector.directions).toMatch(/\d+ lanes?/)
			expect(inspector.firstLane).toContain("forward")
			expect(inspector.deleteStreet).toBe("Delete street")

			await page.click("#btnPauseResume")
			expect(
				await page.$eval("#btnPauseResume", (element) =>
					element.getAttribute("aria-label"),
				),
			).toBe("Resume simulation")
		} finally {
			await simulator.close()
		}
	})

	it("persists the next-startup preference without changing the active language", async () => {
		const simulator = await openSimulator()
		try {
			const { page } = simulator
			await hideLoadingScreen(page)
			await page.evaluate(() => {
				window.__localizationMarker = "still-here"
			})
			await page.select("#languagePreference", "en")
			const afterSelection = await page.evaluate(() => ({
				lang: document.documentElement.lang,
				heading: document
					.querySelector("#headingAbout .accordion-button")
					.textContent.trim(),
				notice: document.getElementById("languagePreferenceNotice").textContent,
				noticeState: document.getElementById("languagePreferenceNotice").dataset.state,
				saved: localStorage.getItem("fluvi.interfaceLanguage"),
				marker: window.__localizationMarker,
			}))
			expect(afterSelection.lang).toBe("es")
			expect(afterSelection.heading).toBe("ℹ️ Sobre FLUVI")
			expect(afterSelection.notice).toBe(
				"El idioma seleccionado se aplicará la próxima vez que inicies FLUVI.",
			)
			expect(afterSelection.noticeState).toBe("saved")
			expect(afterSelection.saved).toBe("en")
			expect(afterSelection.marker).toBe("still-here")

			await reloadSimulator(page)
			const afterReload = await page.evaluate(() => ({
				lang: document.documentElement.lang,
				heading: document
					.querySelector("#headingAbout .accordion-button")
					.textContent.trim(),
				selector: document.getElementById("languagePreference").value,
				notice: document.getElementById("languagePreferenceNotice").textContent,
			}))
			expect(afterReload).toEqual({
				lang: "en",
				heading: "ℹ️ About FLUVI",
				selector: "en",
				notice: "",
			})
		} finally {
			await simulator.close()
		}
	})

	it("keeps working and reports a storage failure without changing the session", async () => {
		const simulator = await openSimulator({
			storageFailureKey: "fluvi.interfaceLanguage",
			navigatorLanguage: "en-US",
		})
		try {
			const { page } = simulator
			await hideLoadingScreen(page)
			await page.select("#languagePreference", "en")
			const state = await page.evaluate(() => ({
				lang: document.documentElement.lang,
				heading: document
					.querySelector("#headingAbout .accordion-button")
					.textContent.trim(),
				notice: document.getElementById("languagePreferenceNotice").textContent,
				noticeState: document.getElementById("languagePreferenceNotice").dataset.state,
				noticeClasses: document.getElementById("languagePreferenceNotice").className,
				saved: (() => {
					try {
						return localStorage.getItem("fluvi.interfaceLanguage")
					} catch {
						return null
					}
				})(),
			}))
			expect(state.lang).toBe("es")
			expect(state.heading).toBe("ℹ️ Sobre FLUVI")
			expect(state.notice).toBe(
				"No se pudo guardar la preferencia de idioma. La sesión actual sigue funcionando y el idioma no cambia.",
			)
			expect(state.noticeState).toBe("storage-error")
			expect(state.noticeClasses).toContain("text-warning")
			expect(state.saved).toBeNull()

			await reloadSimulator(page)
			expect(await page.evaluate(() => document.documentElement.lang)).toBe("es")
		} finally {
			await simulator.close()
		}
	})

	it("preserves paused simulation state and edits when the preference changes", async () => {
		const simulator = await openSimulator()
		try {
			const { page } = simulator
			await hideLoadingScreen(page)
			await page.evaluate(() => {
				window.__localizationMarker = "paused-session"
				document.getElementById("btnPauseResume").click()
				document.getElementById("btnBorrar").click()
				for (let index = 0; index < 3; index++) {
					document.getElementById("btnPaso").click()
				}
			})
			const before = await pausedState(page)
			expect(before.isPaused).toBe(true)

			await page.select("#languagePreference", "en")
			const after = await pausedState(page)
			expect(after).toEqual(before)
			expect(
				await page.evaluate(() => document.documentElement.lang),
			).toBe("es")
			expect(
				await page.$eval("#languagePreference", (element) => element.value),
			).toBe("en")
			expect(
				await page.$eval(
					"#languagePreferenceNotice",
					(element) => element.textContent,
				),
			).toBe("El idioma seleccionado se aplicará la próxima vez que inicies FLUVI.")
		} finally {
			await simulator.close()
		}
	})

	it("does not pause or reset a running simulation when the preference changes", async () => {
		const simulator = await openSimulator({ freezeFrames: false })
		try {
			const { page } = simulator
			await hideLoadingScreen(page)
			await page.evaluate(() => {
				const slider = document.getElementById("velocidadSlider")
				slider.value = "100"
				slider.dispatchEvent(new Event("input", { bubbles: true }))
			})
			await page.waitForFunction(
				() => Number(document.getElementById("infoGeneration").textContent) > 1,
				{ timeout: 15000 },
			)
			const before = await page.evaluate(() => ({
				isPaused: window.isPaused,
				calles: window.calles.map((calle) => calle.id),
				generation: Number(document.getElementById("infoGeneration").textContent),
			}))
			expect(before.isPaused).toBe(false)

			await page.select("#languagePreference", "en")
			const afterSelection = await page.evaluate(() => ({
				isPaused: window.isPaused,
				calles: window.calles.map((calle) => calle.id),
				lang: document.documentElement.lang,
			}))
			expect(afterSelection).toEqual({
				isPaused: false,
				calles: before.calles,
				lang: "es",
			})
			await page.waitForFunction(
				(generation) =>
					Number(document.getElementById("infoGeneration").textContent) >
					generation,
				{ timeout: 15000 },
				before.generation,
			)
		} finally {
			await simulator.close()
		}
	})

	it("keeps explicit notification severities, translated defaults, legacy alerts, and safe interpolation", async () => {
		const simulator = await openSimulator({ languagePreference: "en" })
		try {
			const { page } = simulator
			await hideLoadingScreen(page)
			await page.evaluate(() => {
				window.fluviNotify.success(
					"notifications.simulation.changesAppliedLaneChange",
					{ name: "Main street", laneChange: 12 },
					60000,
				)
				window.fluviNotify.error(
					"notifications.streetSelection.required",
					undefined,
					60000,
				)
				window.fluviNotify.warning(
					"notifications.simulation.generationRange",
					undefined,
					60000,
				)
				window.fluviNotify.info("loading.status.ready", undefined, 60000)
			})
			await page.waitForFunction(
				() => document.querySelectorAll(".toast").length >= 4,
				{ timeout: 5000 },
			)
			const toasts = await page.$$eval(".toast", (elements) =>
				elements.map((element) => ({
					header: element.querySelector(".toast-header").className,
					title: element.querySelector(".toast-header strong").textContent,
					body: element.querySelector(".toast-body").textContent,
					close: element
						.querySelector('[data-bs-dismiss="toast"]')
						.getAttribute("aria-label"),
				})),
			)
			expect(toasts).toHaveLength(4)
			expect(toasts.map((toast) => toast.header)).toEqual([
				"toast-header bg-success text-white",
				"toast-header bg-danger text-white",
				"toast-header bg-warning text-dark",
				"toast-header bg-info text-white",
			])
			expect(toasts.map((toast) => toast.title)).toEqual([
				"✅Success",
				"❌Error",
				"⚠️Warning",
				"ℹ️Information",
			])
			expect(toasts[0].body).toBe(
				"Probabilities for «Main street» were updated:\n• Lane change: 12%",
			)
			expect(toasts[1].body).toBe("Please select a street first.")
			expect(toasts[2].body).toBe(
				"The generation probability must be between 0 and 100.",
			)
			expect(toasts[3].body).toBe("Ready!")
			expect(toasts.every((toast) => toast.close === "Close")).toBe(true)

			await page.evaluate(() => {
				window.mostrarConfirmacion("Confirm test", "Body")
			})
			await page.waitForSelector(".modal.show", { visible: true })
			await new Promise((resolve) => setTimeout(resolve, 500))
			const confirmation = await page.$$eval(
				".modal.show .modal-footer .btn",
				(elements) => elements.map((element) => element.textContent.trim()),
			)
			expect(confirmation).toEqual(["Cancel", "Confirm"])
			await page.click(".modal.show .modal-footer .btn-secondary")
			await page.waitForSelector(".modal.show", { hidden: true })

			await page.evaluate(() => {
				window.alert("Error de prueba")
			})
			await page.waitForFunction(
				() => document.querySelectorAll(".toast").length >= 5,
				{ timeout: 5000 },
			)
			const legacy = await page.$$eval(".toast", (elements) => {
				const element = elements.at(-1)
				return {
					header: element.querySelector(".toast-header").className,
					title: element.querySelector(".toast-header strong").textContent,
					body: element.querySelector(".toast-body").textContent,
				}
			})
			expect(legacy.header).toContain("bg-danger")
			expect(legacy.title).toContain("Error")
			expect(legacy.body).toBe("Error de prueba")

			await page.evaluate(() => {
				window.fluviNotify.success(
					"notifications.simulation.changesAppliedLaneChange",
					{ name: '<img src=x onerror="window.__injected=1">', laneChange: 5 },
					60000,
				)
			})
			await page.waitForFunction(
				() => document.querySelectorAll(".toast").length >= 6,
				{ timeout: 5000 },
			)
			const safe = await page.$$eval(".toast", (elements) => {
				const element = elements.at(-1)
				return {
					body: element.querySelector(".toast-body").textContent,
					injectedMarkup: element.querySelectorAll(".toast-body img").length,
					injectedGlobal: window.__injected ?? null,
				}
			})
			expect(safe.body).toContain(
				'Probabilities for «<img src=x onerror="window.__injected=1">»',
			)
			expect(safe.injectedMarkup).toBe(0)
			expect(safe.injectedGlobal).toBeNull()
		} finally {
			await simulator.close()
		}
	})
})

const openLocalizedModal = async (page, modalId) => {
	await page.$eval(
		`#collapseAbout [data-bs-target="#${modalId}"]`,
		(button) => button.click(),
	)
	await page.waitForSelector(`#${modalId}.show`, { visible: true })
	await page.waitForFunction(
		(id) => document.getElementById(id).getAttribute("aria-modal") === "true",
		{ polling: 100 },
		modalId,
	)
	await page.waitForFunction(
		(id) => !document.querySelector(`#${id} .modal-dialog`)?.getAnimations().length,
		{ polling: 100 },
		modalId,
	)
}

const closeLocalizedModal = async (page, modalId) => {
	await page.$eval(`#${modalId} [data-bs-dismiss="modal"]`, (button) =>
		button.click(),
	)
	await page.waitForSelector(`#${modalId}`, { hidden: true })
	await page.waitForFunction(
		() => !document.querySelector(".modal-backdrop"),
		{ polling: 100 },
	)
}

const readModalLayout = (page, modalId) =>
	page.evaluate((id) => {
		const modal = document.getElementById(id)
		const dialog = modal.querySelector(".modal-dialog").getBoundingClientRect()
		const body = modal.querySelector(".modal-body")
		const title = modal.querySelector(".modal-title")
		const styles = getComputedStyle(body)
		return {
			fits:
				dialog.left >= -1 &&
				dialog.top >= -1 &&
				dialog.right <= window.innerWidth + 1 &&
				dialog.bottom <= window.innerHeight + 1,
			overflowX: body.scrollWidth - body.clientWidth,
			titleSize: Number.parseFloat(getComputedStyle(title).fontSize),
			readable:
				styles.color !== "rgba(0, 0, 0, 0)" &&
				styles.color !== styles.backgroundColor,
			text: body.innerText,
			title: title.textContent.trim(),
			close: modal
				.querySelector(".modal-header [data-bs-dismiss='modal']")
				.getAttribute("aria-label"),
		}
	}, modalId)

const expectUsableModal = (layout, title) => {
	expect(layout.title).toBe(title)
	expect(layout.fits).toBe(true)
	expect(layout.overflowX).toBeLessThanOrEqual(1)
	expect(layout.readable).toBe(true)
}

const settingsCopy = {
	en: {
		language: "Language",
		dark: "🌙 Dark mode",
		darkActive: "☀️ Light mode",
		consoleLogs: "🚫 Hide console logs",
		consoleActive: "📝 Show console logs",
		debug: "🐛 Visual debug",
		cell: "🔢 Cell detection (Off)",
		cellActive: "🔢 Cell detection (On)",
		cellTooltipStart: "Shows the cell number when hovering over streets.",
		projectTitle:
			"Vehicular Flow Management System Simulator for Roads Near Academic Areas of IPN - ESCOM",
		aboutButton: "📖 View Full Information",
		aboutTooltip: "View complete information about the FLUVI project",
		guideButton: "📚 View Full Guide",
		guideTooltip: "Open the complete simulator guide with detailed instructions",
		guideTitle: "📚 FLUVI Traffic Simulator Guide",
		guideCard: "🖱️ Basic Controls",
		guideItem: "Quick selection:",
		guideNumberedSection: "1 Temporal Analysis",
		aboutTitle: "ℹ️ About FLUVI",
		aboutNumberedSection: "1 Introduction",
		aboutProse: "cellular automata",
		developerRole: "Developer",
	},
	es: {
		language: "Idioma",
		dark: "🌙 Modo Oscuro",
		darkActive: "☀️ Modo Claro",
		consoleLogs: "🚫 Ocultar Logs en Consola",
		consoleActive: "📝 Mostrar Logs en Consola",
		debug: "🐛 Debug Visual",
		cell: "🔢 Activador de Celdas (Desactivado)",
		cellActive: "🔢 Activador de Celdas (Activo)",
		cellTooltipStart:
			"Muestra el número de celda en el hover sobre calles.",
		projectTitle:
			"Simulador de Sistema de Gestión del Flujo Vehicular en Vialidades Cercanas a Áreas Académicas de IPN - ESCOM",
		aboutButton: "📖 Ver Información Completa",
		aboutTooltip: "Ver información completa sobre el proyecto FLUVI",
		guideButton: "📚 Ver Guía Completa",
		guideTooltip:
			"Abrir la guía completa del simulador con instrucciones detalladas",
		guideTitle: "📚 Guía del Simulador de Tráfico FLUVI",
		guideCard: "🖱️ Controles Básicos",
		guideItem: "Selección rápida:",
		guideNumberedSection: "1 Análisis Temporal",
		aboutTitle: "ℹ️ Acerca de FLUVI",
		aboutNumberedSection: "1 Introducción",
		aboutProse: "autómatas celulares",
		developerRole: "Desarrollador",
	},
}

describe("settings, help, and project information", () => {
	for (const [language, copy] of Object.entries(settingsCopy)) {
		it(`keeps settings and help reachable and readable in ${language} across themes and viewports`, async () => {
			const simulator = await openSimulator({ languagePreference: language })
			try {
				const { page } = simulator
				await hideLoadingScreen(page)

				const settings = await page.evaluate(() => {
					const label = (id) =>
						document.getElementById(id)?.textContent.trim() ?? null
					const rectVisible = (id) => {
						const element = document.getElementById(id)
						if (!element) return false
						const rect = element.getBoundingClientRect()
						const styles = getComputedStyle(element)
						return (
							rect.width > 0 &&
							rect.height > 0 &&
							styles.display !== "none" &&
							styles.visibility !== "hidden"
						)
					}
					const cellTooltip = document
						.getElementById("switchCellDetection")
						.closest(".form-check")
						.querySelector('[data-bs-toggle="tooltip"]')
					return {
						language: document
							.querySelector('label[for="languagePreference"]')
							.textContent.trim(),
						languageOptions: [
							...document.getElementById("languagePreference").options,
						].map((option) => option.textContent.trim()),
						dark: label("labelModoOscuro"),
						consoleLogs: label("labelConsoleLogs"),
						debug: label("labelDebugMovil"),
						cell: label("labelCellDetection"),
						cellTooltip:
							cellTooltip.getAttribute("data-bs-original-title") ||
							cellTooltip.getAttribute("title"),
						cellTooltipTitle: cellTooltip.getAttribute("data-bs-title"),
						desktopControls: [
							"languagePreference",
							"switchModoOscuro",
							"switchConsoleLogs",
							"switchCellDetection",
						].every(rectVisible),
					}
				})
				expect(settings.language).toBe(copy.language)
				expect(settings.languageOptions).toEqual(["Español", "English"])
				expect(settings.dark).toBe(copy.dark)
				expect(settings.consoleLogs).toBe(copy.consoleLogs)
				expect(settings.debug).toBe(copy.debug)
				expect(settings.cell).toBe(copy.cell)
				expect(settings.cellTooltip).toContain(copy.cellTooltipStart)
				expect(settings.cellTooltipTitle).toContain(copy.cellTooltipStart)
				expect(settings.desktopControls).toBe(true)

				const aboutPanel = await page.evaluate(() => ({
					title: document.querySelector("#collapseAbout h6").textContent.trim(),
					aboutButton: document
						.querySelector('#collapseAbout [data-bs-target="#aboutModal"]')
						.textContent.trim(),
					aboutTooltip: document
						.querySelector('#collapseAbout [data-bs-target="#aboutModal"]')
						.getAttribute("data-bs-title"),
					guideButton: document
						.querySelector('#collapseAbout [data-bs-target="#instructionsModal"]')
						.textContent.trim(),
					guideTooltip: document
						.querySelector('#collapseAbout [data-bs-target="#instructionsModal"]')
						.getAttribute("data-bs-title"),
					version: document
						.querySelector('#collapseAbout strong[data-i18n="about.versionLabel"]')
						.textContent.trim(),
				}))
				expect(aboutPanel.title).toBe(copy.projectTitle)
				expect(aboutPanel.aboutButton).toBe(copy.aboutButton)
				expect(aboutPanel.aboutTooltip).toBe(copy.aboutTooltip)
				expect(aboutPanel.guideButton).toBe(copy.guideButton)
				expect(aboutPanel.guideTooltip).toBe(copy.guideTooltip)
				expect(aboutPanel.version).toBe(
					language === "en" ? "Version:" : "Versión:",
				)

				await page.click("#switchCellDetection")
				expect(
					await page.$eval(
						"#labelCellDetection",
						(element) => element.textContent.trim(),
					),
				).toBe(copy.cellActive)
				await page.click("#switchCellDetection")

				await page.click("#switchConsoleLogs")
				expect(
					await page.$eval(
						"#labelConsoleLogs",
						(element) => element.textContent.trim(),
					),
				).toBe(copy.consoleActive)
				await page.click("#switchConsoleLogs")

				await openLocalizedModal(page, "instructionsModal")
				let layout = await readModalLayout(page, "instructionsModal")
				expect(layout.close).toBe(language === "en" ? "Close" : "Cerrar")
				expect(layout.text).toContain(copy.guideCard)
				expect(layout.text).toContain(copy.guideItem)
				expect(layout.text).toContain("Z")
				expect(layout.text).toContain(copy.guideNumberedSection)
				expect(layout.text).not.toMatch(
					/\b(?:guide|aboutModal|about|settings)\.[a-zA-Z]/,
				)
				expect(layout.titleSize).toBeGreaterThan(12)
				expectUsableModal(layout, copy.guideTitle)
				await closeLocalizedModal(page, "instructionsModal")

				await openLocalizedModal(page, "aboutModal")
				layout = await readModalLayout(page, "aboutModal")
				expect(layout.text).toContain(copy.aboutNumberedSection)
				expect(layout.text).toContain(copy.aboutProse)
				expect(layout.text).toContain("Connor Urbano Mendoza")
				expect(layout.text).toContain("Luis Gael Molina Figueroa")
				expect(layout.text).toContain("Denisse Márquez Morales")
				expect(layout.text).toContain("Instituto Politécnico Nacional")
				expect(layout.text).toContain("ESCOM")
				expect(layout.text).toContain(copy.developerRole)
				expect(layout.text).not.toMatch(
					/\b(?:guide|aboutModal|about|settings)\.[a-zA-Z]/,
				)
				expectUsableModal(layout, copy.aboutTitle)
				await closeLocalizedModal(page, "aboutModal")

				await page.click("#switchModoOscuro")
				await page.waitForFunction(
					() => document.body.classList.contains("dark-mode"),
					{ polling: 100 },
				)
				expect(
					await page.$eval(
						"#labelModoOscuro",
						(element) => element.textContent.trim(),
					),
				).toBe(copy.darkActive)

				await openLocalizedModal(page, "instructionsModal")
				layout = await readModalLayout(page, "instructionsModal")
				expectUsableModal(layout, copy.guideTitle)
				await closeLocalizedModal(page, "instructionsModal")

				await page.setViewport({ width: 390, height: 844 })
				await new Promise((resolve) => setTimeout(resolve, 400))
				const mobileSettings = await page.evaluate(() => {
					const visible = (id) => {
						const element = document.getElementById(id)
						if (!element) return false
						const rect = element.getBoundingClientRect()
						const styles = getComputedStyle(element)
						return (
							rect.width > 0 &&
							rect.height > 0 &&
							styles.display !== "none" &&
							styles.visibility !== "hidden"
						)
					}
					return {
						language: visible("languagePreference"),
						dark: visible("switchModoOscuro"),
						debug: visible("switchDebugMovil"),
					}
				})
				expect(mobileSettings).toEqual({
					language: true,
					dark: true,
					debug: true,
				})

				await openLocalizedModal(page, "aboutModal")
				layout = await readModalLayout(page, "aboutModal")
				expectUsableModal(layout, copy.aboutTitle)
				await closeLocalizedModal(page, "aboutModal")

				await openLocalizedModal(page, "instructionsModal")
				layout = await readModalLayout(page, "instructionsModal")
				expect(layout.text).toContain(copy.guideCard)
				expectUsableModal(layout, copy.guideTitle)
				await closeLocalizedModal(page, "instructionsModal")

				await page.click("#switchModoOscuro")
				await page.waitForFunction(
					() => !document.body.classList.contains("dark-mode"),
					{ polling: 100 },
				)
				await openLocalizedModal(page, "instructionsModal")
				layout = await readModalLayout(page, "instructionsModal")
				expectUsableModal(layout, copy.guideTitle)
				await closeLocalizedModal(page, "instructionsModal")
			} finally {
				await simulator.close()
			}
		})
	}
})
