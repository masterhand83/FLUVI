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

const virtualTimeCopy = {
	en: {
		sidebarTitle: "📅 Simulation Date and Time",
		description:
			"Set the simulation's starting weekday and time to test different traffic profiles.",
		current: "Simulation time:",
		changeButton: "⏰ Change Date and Time",
		changeTooltip: "Set the simulation's starting weekday and time",
		profilesButton: "📊 Configure Gen. Multiplier",
		profilesTooltip:
			"Configure vehicle generation multipliers for each hour of the day and day of the week",
		timeTitle: "📅 Set Date and Time",
		weekdayLabel: "📆 Weekday",
		weekdayOptions: [
			"🔵 Sunday",
			"🔴 Monday",
			"🟠 Tuesday",
			"🟡 Wednesday",
			"🟢 Thursday",
			"🟣 Friday",
			"🟤 Saturday",
		],
		hourLabel: "🕐 Hour",
		hourRange: "0-23 hours",
		minutesLabel: "⏱️ Minutes",
		minutesRange: "0-59 minutes",
		previewLabel: "🔍 Preview:",
		preview: "Friday 00:00",
		noteLabel: "💡 Note:",
		noteBody:
			"Different days and hours have different traffic multipliers. For example, peak hours (7-9 AM, 6-8 PM) on weekdays have more traffic.",
		confirm: "✅ Confirm and Apply",
		cancel: "Cancel",
		profilesTitle: "📊 Configure Hourly Generation Multipliers",
		profilesWeekdayLabel: "📅 Weekday:",
		profilesWeekdayHelp: "Changes apply only to the selected day",
		rangeTitle: "💡 Value range:",
		rangeItems: [
			"Very low traffic (early morning)",
			"Low to normal traffic",
			"Normal to high traffic",
			"Peak hour (morning/afternoon)",
			"Very heavy traffic",
		],
		morningTitle: "🌙 Early Morning and Morning (00:00 - 11:00)",
		afternoonTitle: "☀️ Afternoon and Night (12:00 - 23:00)",
		presetsTitle: "⚡ Quick Presets:",
		presets: [
			"🏢 Workday",
			"🎉 Weekend",
			"📊 Constant (1.0)",
			"🌙 Night",
		],
		copyAll: "📋 Copy to All Days",
		restoreDefaults: "🔄 Restore Defaults",
		update: "✅ Update Multipliers",
		sliderTitle: "Controls the 00:00-00:59 range",
		close: "Close",
		copyTitle: "Copy multipliers",
		copyConfirm: "Copy the values from Sunday to ALL days of the week?",
		copySuccess: "Values copied to all days of the week successfully.",
		restoreTitle: "Restore multipliers",
		restoreQuestion: "What do you want to restore to default values?",
		restoreOnlyDay: "Only this day (Sunday)",
		restoreOnlyDayDefault: "Only this day (Monday)",
		restoreAllOption: "All days of the week",
		restoreConfirm: "Restore",
		restoreDaySuccess: "Multipliers for Sunday restored.",
		updateSuccess:
			"Multipliers for Sunday updated successfully.\n\nThe new values will apply on the next simulation step.",
		displayDay: "Sunday",
		peakDescription: "Peak hour",
	},
	es: {
		sidebarTitle: "📅 Fecha y Hora del Simulador",
		description:
			"Configura el día y hora inicial de la simulación para probar diferentes perfiles de tráfico.",
		current: "Tiempo de la simulación:",
		changeButton: "⏰ Cambiar Fecha y Hora",
		changeTooltip:
			"Establece el día de la semana y hora inicial de la simulación",
		profilesButton: "📊 Configurar Multiplicador de Gen.",
		profilesTooltip:
			"Configura los multiplicadores de generación de vehículos para cada hora del día y día de la semana",
		timeTitle: "📅 Configurar Fecha y Hora",
		weekdayLabel: "📆 Día de la Semana",
		weekdayOptions: [
			"🔵 Domingo",
			"🔴 Lunes",
			"🟠 Martes",
			"🟡 Miércoles",
			"🟢 Jueves",
			"🟣 Viernes",
			"🟤 Sábado",
		],
		hourLabel: "🕐 Hora",
		hourRange: "0-23 horas",
		minutesLabel: "⏱️ Minutos",
		minutesRange: "0-59 minutos",
		previewLabel: "🔍 Vista previa:",
		preview: "Viernes 00:00",
		noteLabel: "💡 Nota:",
		noteBody:
			"Diferentes días y horas tienen distintos multiplicadores de tráfico. Por ejemplo, las horas pico (7-9 AM, 6-8 PM) en días laborales tienen más tráfico.",
		confirm: "✅ Confirmar y Aplicar",
		cancel: "Cancelar",
		profilesTitle: "📊 Configurar Multiplicadores de Generación por Hora",
		profilesWeekdayLabel: "📅 Día de la Semana:",
		profilesWeekdayHelp: "Los cambios se aplicarán solo al día seleccionado",
		rangeTitle: "💡 Rango de valores:",
		rangeItems: [
			"Tráfico muy bajo (madrugada)",
			"Tráfico bajo a normal",
			"Tráfico normal a alto",
			"Hora pico (mañana/tarde)",
			"Tráfico muy intenso",
		],
		morningTitle: "🌙 Madrugada y Mañana (00:00 - 11:00)",
		afternoonTitle: "☀️ Tarde y Noche (12:00 - 23:00)",
		presetsTitle: "⚡ Presets Rápidos:",
		presets: [
			"🏢 Día Laboral",
			"🎉 Fin de Semana",
			"📊 Constante (1.0)",
			"🌙 Nocturno",
		],
		copyAll: "📋 Copiar a Todos los Días",
		restoreDefaults: "🔄 Restaurar Default",
		update: "✅ Actualizar Multiplicadores",
		sliderTitle: "Controla el rango 00:00-00:59",
		close: "Cerrar",
		copyTitle: "Copiar multiplicadores",
		copyConfirm:
			"¿Deseas copiar los valores de Domingo a TODOS los días de la semana?",
		copySuccess: "Valores copiados a todos los días de la semana exitosamente.",
		restoreTitle: "Restaurar multiplicadores",
		restoreQuestion: "¿Qué deseas restaurar a valores por defecto?",
		restoreOnlyDay: "Solo este día (Domingo)",
		restoreOnlyDayDefault: "Solo este día (Lunes)",
		restoreAllOption: "Todos los días de la semana",
		restoreConfirm: "Restaurar",
		restoreDaySuccess: "Multiplicadores de Domingo restaurados.",
		updateSuccess:
			"Multiplicadores de Domingo actualizados exitosamente.\n\nLos nuevos valores se aplicarán en el siguiente paso de simulación.",
		displayDay: "Domingo",
		peakDescription: "Hora pico",
	},
}

const openSidebarModal = async (page, modalId) => {
	await page.$eval(`[data-bs-target="#${modalId}"]`, (button) =>
		button.click(),
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

const waitForToastBody = (page, body) =>
	page.waitForFunction(
		(expected) =>
			[...document.querySelectorAll(".toast-body")].some(
				(element) => element.textContent === expected,
			),
		{ polling: 100, timeout: 5000 },
		body,
	)

describe("virtual time and traffic profiles", () => {
	for (const [language, copy] of Object.entries(virtualTimeCopy)) {
		it(`translates the clock and hourly profile controls in ${language}`, async () => {
			const simulator = await openSimulator({ languagePreference: language })
			try {
				const { page } = simulator
				await hideLoadingScreen(page)

				const checkRestoreDialog = async () => {
					await page.evaluate(() => window.confirmarRestaurarDefault())
					await page.waitForSelector("#modalRestaurarMultiplicadores.show", {
						visible: true,
					})
					await page.waitForFunction(
						() =>
							document
								.getElementById("modalRestaurarMultiplicadores")
								.getAttribute("aria-modal") === "true",
						{ polling: 100 },
					)
					await page.waitForFunction(
						() =>
							!document
								.querySelector(
									"#modalRestaurarMultiplicadores .modal-dialog",
								)
								.getAnimations().length,
						{ polling: 100 },
					)
					const restoreLayout = await readModalLayout(
						page,
						"modalRestaurarMultiplicadores",
					)
					expectUsableModal(restoreLayout, copy.restoreTitle)
					expect(restoreLayout.text).toContain(copy.restoreQuestion)
					expect(restoreLayout.text).toContain(copy.restoreOnlyDayDefault)
					expect(restoreLayout.text).toContain(copy.restoreAllOption)
					await closeLocalizedModal(page, "modalRestaurarMultiplicadores")
				}

				const sidebar = await page.evaluate(() => {
					const section = document
						.getElementById("tiempoActualDisplay")
						.closest(".mt-3")
					const tooltip = (target) =>
						document
							.querySelector(`[data-bs-target="#${target}"]`)
							.closest("[data-bs-toggle='tooltip']")
							.getAttribute("data-bs-title")
					return {
						title: section.querySelector("h6").textContent.trim(),
						description: section.querySelector("p").textContent.trim(),
						current: section.querySelector("strong").textContent.trim(),
						clock: document.getElementById("tiempoActualDisplay").textContent.trim(),
						changeButton: document
							.querySelector('[data-bs-target="#modalTiempoSimulador"]')
							.textContent.trim(),
						changeTooltip: tooltip("modalTiempoSimulador"),
						profilesButton: document
							.querySelector('[data-bs-target="#modalMultiplicadores"]')
							.textContent.trim(),
						profilesTooltip: tooltip("modalMultiplicadores"),
					}
				})
				expect(sidebar).toEqual({
					title: copy.sidebarTitle,
					description: copy.description,
					current: copy.current,
					clock: `${language === "en" ? "Monday" : "Lunes"} 07:00:00`,
					changeButton: copy.changeButton,
					changeTooltip: copy.changeTooltip,
					profilesButton: copy.profilesButton,
					profilesTooltip: copy.profilesTooltip,
				})

				await openSidebarModal(page, "modalTiempoSimulador")
				const timeModal = await page.evaluate(() => ({
					title: document
						.getElementById("modalTiempoSimuladorLabel")
						.textContent.trim(),
					intro: document
						.querySelector("#modalTiempoSimulador .modal-body > p")
						.textContent.trim(),
					weekdayLabel: document
						.querySelector('label[for="selectDiaSemanaModal"]')
						.textContent.trim(),
					weekdays: [...document.getElementById("selectDiaSemanaModal").options].map(
						(option) => option.textContent.trim(),
					),
					hourLabel: document
						.querySelector('label[for="inputHoraModal"]')
						.textContent.trim(),
					hourRange: document
						.querySelector("#inputHoraModal + small")
						.textContent.trim(),
					minutesLabel: document
						.querySelector('label[for="inputMinutosModal"]')
						.textContent.trim(),
					minutesRange: document
						.querySelector("#inputMinutosModal + small")
						.textContent.trim(),
					previewLabel: document
						.querySelector("#previewTiempoSeleccionado")
						.closest(".alert").querySelector("strong").textContent.trim(),
					noteLabel: document
						.querySelector("#modalTiempoSimulador .alert-warning strong")
						.textContent.trim(),
					noteBody: document
						.querySelector("#modalTiempoSimulador .alert-warning span")
						.textContent.trim(),
					buttons: [
						...document.querySelectorAll(
							"#modalTiempoSimulador .modal-footer .btn",
						),
					].map((button) => button.textContent.trim()),
				}))
				expect(timeModal.title).toBe(copy.timeTitle)
				expect(timeModal.weekdayLabel).toBe(copy.weekdayLabel)
				expect(timeModal.weekdays).toEqual(copy.weekdayOptions)
				expect(timeModal.hourLabel).toBe(copy.hourLabel)
				expect(timeModal.hourRange).toBe(copy.hourRange)
				expect(timeModal.minutesLabel).toBe(copy.minutesLabel)
				expect(timeModal.minutesRange).toBe(copy.minutesRange)
				expect(timeModal.previewLabel).toBe(copy.previewLabel)
				expect(timeModal.noteLabel).toBe(copy.noteLabel)
				expect(timeModal.noteBody).toBe(copy.noteBody)
				expect(timeModal.buttons).toEqual([copy.cancel, copy.confirm])
				expect(timeModal.intro).not.toMatch(/\bvirtualTime\./)

				await page.select("#selectDiaSemanaModal", "5")
				await page.$eval("#inputHoraModal", (input) => {
					input.value = "0"
					input.dispatchEvent(new Event("input", { bubbles: true }))
				})
				expect(
					await page.$eval("#previewTiempoSeleccionado", (element) =>
						element.textContent.trim(),
					),
				).toBe(copy.preview)
				let layout = await readModalLayout(page, "modalTiempoSimulador")
				expect(layout.close).toBe(copy.close)
				expectUsableModal(layout, copy.timeTitle)
				await closeLocalizedModal(page, "modalTiempoSimulador")

				await openSidebarModal(page, "modalMultiplicadores")
				await page.waitForSelector("#slider-mult-23", { visible: true })
				const profileModal = await page.evaluate(() => ({
					title: document
						.getElementById("modalMultiplicadoresLabel")
						.textContent.trim(),
					weekdayLabel: document
						.querySelector('label[for="selectDiaSemanaMultiplicador"]')
						.textContent.trim(),
					weekdayHelp: document
						.querySelector("#selectDiaSemanaMultiplicador + small")
						.textContent.trim(),
					rangeTitle: document
						.querySelector("#contenedorSliders")
						.previousElementSibling.querySelector("strong")
						.textContent.trim(),
					rangeItems: [
						...document
							.querySelector("#contenedorSliders")
							.previousElementSibling.querySelectorAll("li span"),
					].map((element) => element.textContent.trim()),
					columnTitles: [
						...document.querySelectorAll("#contenedorSliders h6"),
					].map((element) => element.textContent.trim()),
					presetsTitle: document
						.querySelector('[onclick*="aplicarPresetMultiplicadores"]')
						.closest(".mt-4").querySelector("h6").textContent.trim(),
					presets: [
						...document.querySelectorAll(
							'[onclick*="aplicarPresetMultiplicadores"]',
						),
					].map((button) => button.textContent.trim()),
					copyAll: document
						.querySelector('[onclick="copiarATodosDias()"]')
						.textContent.trim(),
					restoreDefaults: document
						.querySelector('[onclick="confirmarRestaurarDefault()"]')
						.textContent.trim(),
					buttons: [
						...document.querySelectorAll(
							"#modalMultiplicadores .modal-footer .btn",
						),
					].map((button) => button.textContent.trim()),
					sliderCount: document.querySelectorAll(
						"#modalMultiplicadores input[type='range']",
					).length,
					sliderTitle: document
						.getElementById("slider-mult-0")
						.getAttribute("title"),
					sliderLabel: document
						.getElementById("slider-mult-0")
						.getAttribute("aria-label"),
				}))
				expect(profileModal.title).toBe(copy.profilesTitle)
				expect(profileModal.weekdayLabel).toBe(copy.profilesWeekdayLabel)
				expect(profileModal.weekdayHelp).toBe(copy.profilesWeekdayHelp)
				expect(profileModal.rangeTitle).toBe(copy.rangeTitle)
				expect(profileModal.rangeItems).toEqual(copy.rangeItems)
				expect(profileModal.columnTitles).toEqual([
					copy.morningTitle,
					copy.afternoonTitle,
				])
				expect(profileModal.presetsTitle).toBe(copy.presetsTitle)
				expect(profileModal.presets).toEqual(copy.presets)
				expect(profileModal.copyAll).toBe(copy.copyAll)
				expect(profileModal.restoreDefaults).toBe(copy.restoreDefaults)
				expect(profileModal.buttons).toEqual([copy.cancel, copy.update])
				expect(profileModal.sliderCount).toBe(24)
				expect(profileModal.sliderTitle).toBe(copy.sliderTitle)
				expect(profileModal.sliderLabel).toBe(copy.sliderTitle)

				layout = await readModalLayout(page, "modalMultiplicadores")
				expectUsableModal(layout, copy.profilesTitle)
				await closeLocalizedModal(page, "modalMultiplicadores")
				await checkRestoreDialog()

				await page.click("#switchModoOscuro")
				await page.waitForFunction(
					() => document.body.classList.contains("dark-mode"),
					{ polling: 100 },
				)
				await openSidebarModal(page, "modalTiempoSimulador")
				layout = await readModalLayout(page, "modalTiempoSimulador")
				expectUsableModal(layout, copy.timeTitle)
				await closeLocalizedModal(page, "modalTiempoSimulador")
				await openSidebarModal(page, "modalMultiplicadores")
				layout = await readModalLayout(page, "modalMultiplicadores")
				expectUsableModal(layout, copy.profilesTitle)
				await closeLocalizedModal(page, "modalMultiplicadores")
				await checkRestoreDialog()

				await page.setViewport({ width: 390, height: 844 })
				await new Promise((resolve) => setTimeout(resolve, 400))
				await openSidebarModal(page, "modalTiempoSimulador")
				layout = await readModalLayout(page, "modalTiempoSimulador")
				expectUsableModal(layout, copy.timeTitle)
				await closeLocalizedModal(page, "modalTiempoSimulador")
				await openSidebarModal(page, "modalMultiplicadores")
				layout = await readModalLayout(page, "modalMultiplicadores")
				expectUsableModal(layout, copy.profilesTitle)
				await closeLocalizedModal(page, "modalMultiplicadores")
				await checkRestoreDialog()

				await page.click("#switchModoOscuro")
				await page.waitForFunction(
					() => !document.body.classList.contains("dark-mode"),
					{ polling: 100 },
				)
			} finally {
				await simulator.close()
			}
		})
	}

	for (const [language, copy] of Object.entries(virtualTimeCopy)) {
		it(`keeps midnight, zero multipliers, and profile switching independent in ${language}`, async () => {
			const simulator = await openSimulator({ languagePreference: language })
			try {
				const { page } = simulator
				await hideLoadingScreen(page)
				await page.evaluate(() => {
					document.getElementById("btnPauseResume").click()
					document.getElementById("btnBorrar").click()
				})

				await openSidebarModal(page, "modalTiempoSimulador")
				await page.select("#selectDiaSemanaModal", "0")
				await page.$eval("#inputHoraModal", (input) => {
					input.value = "0"
					input.dispatchEvent(new Event("input", { bubbles: true }))
				})
				await page.$eval("#inputMinutosModal", (input) => {
					input.value = "0"
					input.dispatchEvent(new Event("input", { bubbles: true }))
				})
				await page.click("#btnConfirmarTiempo")
				await page.waitForFunction(
					() =>
						configuracionTiempo.diaActual === 0 &&
						configuracionTiempo.horaActual === 0 &&
						configuracionTiempo.minutoActual === 0 &&
						configuracionTiempo.segundoActual === 0,
					{ polling: 100 },
				)
				await page.waitForSelector("#modalTiempoSimulador", { hidden: true })
				expect(
					await page.$eval("#tiempoActualDisplay", (element) =>
						element.textContent.trim(),
					),
				).toBe(`${copy.displayDay} 00:00:00`)

				await openSidebarModal(page, "modalMultiplicadores")
				await page.waitForSelector("#slider-mult-23", { visible: true })
				await page.select("#selectDiaSemanaMultiplicador", "0")
				await page.$eval("#slider-mult-0", (slider) => {
					slider.value = "0"
					slider.dispatchEvent(new Event("input", { bubbles: true }))
				})
				await page.click("#btnActualizarMultiplicadores")
				await page.waitForSelector("#modalMultiplicadores", { hidden: true })
				await page.waitForFunction(
					() => window.obtenerPerfilDia(0)[0] === 0,
					{ polling: 100 },
				)

				const upcoming = await page.evaluate(() => {
					const saved = {
						day: window.configuracionTiempo.diaActual,
						hour: window.configuracionTiempo.horaActual,
						minute: window.configuracionTiempo.minutoActual,
					}
					Object.assign(window.configuracionTiempo, {
						diaActual: 5,
						horaActual: 5,
						minutoActual: 0,
					})
					const change = window.obtenerProximoCambio()
					Object.assign(window.configuracionTiempo, {
						diaActual: saved.day,
						horaActual: saved.hour,
						minutoActual: saved.minute,
					})
					return change
				})
				expect(upcoming.descripcion).toBe(copy.peakDescription)
				expect(upcoming.horaProxima).toBe(7)

				const result = await page.evaluate(() => {
					const street = window.calles.find(
						(road) => road.tipo === window.TIPOS.GENERADOR,
					)
					generacionGlobal.activa = true
					generacionGlobal.probabilidad = 1
					street.arreglo.forEach((lane) => {
						lane.fill(0)
					})
					const profilesOn = {
						enabled: window.configuracionTiempo.usarPerfiles,
						multiplier: window.obtenerMultiplicadorTrafico(),
					}
					document.getElementById("btnPaso").click()
					const displayWithProfiles = document.getElementById(
						"infoTrafficMultiplier",
					).textContent
					const noSpawnWithProfiles = !street.arreglo
						.flat()
						.some((value) => value >= 1 && value <= 6)

					street.arreglo.forEach((lane) => {
						lane.fill(0)
					})
					document.getElementById("togglePerfilesDinamicos").click()
					document.getElementById("btnPaso").click()
					const spawnedWithoutProfiles = street.arreglo
						.flat()
						.some((value) => value >= 1 && value <= 6)
					const profilesOff = {
						enabled: window.configuracionTiempo.usarPerfiles,
						multiplier: window.obtenerMultiplicadorTrafico(),
						display: document.getElementById("infoTrafficMultiplier").textContent,
					}

					const clock = {
						day: window.configuracionTiempo.diaActual,
						hour: window.configuracionTiempo.horaActual,
						minute: window.configuracionTiempo.minutoActual,
						second: window.configuracionTiempo.segundoActual,
					}
					const json = window.tiempoToJSON()
					return {
						profilesOn,
						displayWithProfiles,
						noSpawnWithProfiles,
						spawnedWithoutProfiles,
						profilesOff,
						clock,
						display: window.obtenerTimestampVirtual(),
						exportTimestamp: window.obtenerTimestampExportacion(),
						exportDay: window.obtenerDiaExportacion(),
						displayDay: window.obtenerDiaString(),
						profile: window.obtenerPerfilDia(0),
						jsonDay: json.diaActual,
						jsonHour: json.horaActual,
						jsonMultiplier: json.multiplicadoresPorDiaHora[0][0],
					}
				})

				expect(result.profilesOn).toEqual({ enabled: true, multiplier: 0 })
				expect(result.displayWithProfiles).toBe("0.0×")
				expect(result.noSpawnWithProfiles).toBe(true)
				expect(result.spawnedWithoutProfiles).toBe(true)
				expect(result.profilesOff).toEqual({
					enabled: false,
					multiplier: 1,
					display: "1.0×",
				})
				expect(result.clock).toEqual({
					day: 0,
					hour: 0,
					minute: 0,
					second: 4,
				})
				expect(result.display).toBe(`${copy.displayDay} 00:00:04`)
				expect(result.displayDay).toBe(copy.displayDay)
				expect(result.exportTimestamp).toBe("Domingo 00:00:04")
				expect(result.exportDay).toBe("Domingo")
				expect(result.profile[0]).toBe(0)
				expect(result.jsonDay).toBe(0)
				expect(result.jsonHour).toBe(0)
				expect(result.jsonMultiplier).toBe(0)
				expect(simulator.pageErrors).toEqual([])
			} finally {
				await simulator.close()
			}
		})

		it(`confirms copy, restore, and update actions in ${language}`, async () => {
			const simulator = await openSimulator({ languagePreference: language })
			try {
				const { page } = simulator
				await hideLoadingScreen(page)
				await openSidebarModal(page, "modalMultiplicadores")
				await page.waitForSelector("#slider-mult-23", { visible: true })
				await page.select("#selectDiaSemanaMultiplicador", "0")
				await page.$eval("#slider-mult-1", (slider) => {
					slider.value = "0.7"
					slider.dispatchEvent(new Event("input", { bubbles: true }))
				})

				await page.$eval('[onclick="copiarATodosDias()"]', (button) =>
					button.click(),
				)
				await page.waitForFunction(
					() => document.querySelectorAll(".modal.show").length === 2,
					{ polling: 100 },
				)
				const confirmation = await page.evaluate(() => {
					const modal = [...document.querySelectorAll(".modal.show")].at(-1)
					return {
						title: modal.querySelector(".modal-title").textContent.trim(),
						body: modal.querySelector(".modal-body").textContent.trim(),
					}
				})
				expect(confirmation).toEqual({
					title: copy.copyTitle,
					body: copy.copyConfirm,
				})
				await page.waitForFunction(
					() => {
						const modal = [...document.querySelectorAll(".modal.show")].at(-1)
						const instance = modal && bootstrap.Modal.getInstance(modal)
						return (
							instance?._isShown === true &&
							instance?._isTransitioning === false
						)
					},
					{ polling: 100 },
				)
				await page.evaluate(() => {
					[...document.querySelectorAll(".modal.show")]
						.at(-1)
						.querySelector('[id$="-confirm"]')
						.click()
				})
				await page.waitForFunction(
					() =>
						![...document.querySelectorAll(".modal")].some(
							(modal) =>
								modal.id.startsWith("modal-confirm-") &&
								modal.classList.contains("show"),
						),
					{ polling: 100 },
				)
				await waitForToastBody(page, copy.copySuccess)
				expect(
					await page.evaluate(() =>
						[0, 1, 2, 3, 4, 5, 6].map(
							(day) => window.obtenerPerfilDia(day)[1],
						),
					),
				).toEqual([0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7])

				await page.$eval('[onclick="confirmarRestaurarDefault()"]', (button) =>
					button.click(),
				)
				await page.waitForSelector("#modalRestaurarMultiplicadores.show", {
					visible: true,
				})
				await page.waitForFunction(
					() => {
						const modal = document.getElementById(
							"modalRestaurarMultiplicadores",
						)
						const instance = bootstrap.Modal.getInstance(modal)
						return (
							instance?._isShown === true &&
							instance?._isTransitioning === false
						)
					},
					{ polling: 100 },
				)
				const restoreDialog = await page.evaluate(() => {
					const modal = document.getElementById("modalRestaurarMultiplicadores")
					return {
						title: modal
							.querySelector(".modal-title")
							.textContent.trim(),
						question: modal.querySelector(".modal-body p").textContent.trim(),
						options: [
							...modal.querySelectorAll(".form-check-label"),
						].map((label) => label.textContent.trim()),
						buttons: [
							...modal.querySelectorAll(".modal-footer .btn"),
						].map((button) => button.textContent.trim()),
					}
				})
				expect(restoreDialog).toEqual({
					title: copy.restoreTitle,
					question: copy.restoreQuestion,
					options: [copy.restoreOnlyDay, copy.restoreAllOption],
					buttons: [copy.cancel, copy.restoreConfirm],
				})
				await page.click("#btnConfirmarRestaurarMultiplicadores")
				await page.waitForSelector("#modalRestaurarMultiplicadores", {
					hidden: true,
				})
				await waitForToastBody(page, copy.restoreDaySuccess)
				expect(
					await page.evaluate(() => ({
						sunday: window.obtenerPerfilDia(0)[1],
						monday: window.obtenerPerfilDia(1)[1],
					})),
				).toEqual({ sunday: 0, monday: 0.7 })

				await page.$eval("#slider-mult-2", (slider) => {
					slider.value = "1.2"
					slider.dispatchEvent(new Event("input", { bubbles: true }))
				})
				await page.click("#btnActualizarMultiplicadores")
				await page.waitForSelector("#modalMultiplicadores", { hidden: true })
				await waitForToastBody(page, copy.updateSuccess)
				expect(
					await page.evaluate(() => ({
						value: window.obtenerPerfilDia(0)[2],
						clockDay: window.configuracionTiempo.diaActual,
					})),
				).toEqual({ value: 1.2, clockDay: 1 })
				expect(simulator.pageErrors).toEqual([])
			} finally {
				await simulator.close()
			}
		})
	}

	it("computes identical deterministic simulation results in Spanish and English", async () => {
		const run = async (language) => {
			const simulator = await openSimulator({ languagePreference: language, seed: 17 })
			try {
				const { page } = simulator
				const result = await page.evaluate(() => {
					document.getElementById("btnPauseResume").click()
					document.getElementById("btnBorrar").click()
					Object.assign(window.configuracionTiempo, {
						diaActual: 1,
						horaActual: 8,
						minutoActual: 0,
						segundoActual: 0,
						usarPerfiles: true,
					})
					window.__fluviBaseline.reseed(23)
					for (let step = 0; step < 25; step++) {
						document.getElementById("btnPaso").click()
					}
					return {
						occupancy: window.calles
							.map(
								(road) =>
									`${road.id}:${road.arreglo.map((lane) => lane.join("")).join(",")}`,
							)
							.join(";"),
						clock: {
							day: window.configuracionTiempo.diaActual,
							hour: window.configuracionTiempo.horaActual,
							minute: window.configuracionTiempo.minutoActual,
							second: window.configuracionTiempo.segundoActual,
						},
						generation: document.getElementById("infoGeneration").textContent,
					}
				})
				expect(simulator.pageErrors).toEqual([])
				return result
			} finally {
				await simulator.close()
			}
		}

		const spanish = await run("es")
		const english = await run("en")
		expect(english).toEqual(spanish)
	})
})
