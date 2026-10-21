import { describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

const hideLoadingScreen = (page) =>
	page.evaluate(() => {
		document.getElementById("loadingScreen").style.display = "none"
	})

const openAccordion = async (page, target) => {
	await page.$eval(`[data-bs-target="${target}"]`, (button) => button.click())
	await page.waitForSelector(`${target}.show`, { visible: true })
}

const clearToasts = (page) =>
	page.evaluate(() => {
		for (const toast of document.querySelectorAll(".toast")) toast.remove()
	})

const waitForToast = async (page) => {
	await page.waitForFunction(
		() => document.querySelectorAll(".toast").length > 0,
		{ timeout: 5000, polling: 100 },
	)
	await new Promise((resolve) => setTimeout(resolve, 250))
	return page.$$eval(".toast", (elements) => {
		const toast = elements.at(-1)
		return {
			header: toast.querySelector(".toast-header").className,
			title: toast.querySelector(".toast-header strong").textContent,
			body: toast.querySelector(".toast-body").textContent,
			markup: toast.querySelectorAll(".toast-body *").length,
		}
	})
}

const fill = (page, selector, value) =>
	page.$eval(
		selector,
		(element, next) => {
			element.value = next
			element.dispatchEvent(new Event("input", { bubbles: true }))
			element.dispatchEvent(new Event("change", { bubbles: true }))
			element.dispatchEvent(new Event("blur"))
		},
		value,
	)

const streetSnapshot = (page) =>
	page.evaluate(() => {
		const street = window.calles.at(-1)
		return {
			nombre: street.nombre,
			tipo: street.tipo,
			tamano: street.tamano,
			carriles: street.carriles,
			x: street.x,
			y: street.y,
			angulo: street.angulo,
			probabilidadGeneracion: street.probabilidadGeneracion,
			probabilidadSaltoDeCarril: street.probabilidadSaltoDeCarril,
			laneDirections: [...street.laneDirections],
			laneGenerationEnabled: [...street.laneGenerationEnabled],
			arreglo: street.arreglo.map((lane) => lane.join("")),
		}
	})

const copy = {
	en: {
		deleteConfirm: 'Delete the street "<b>Main</b> & "A""?',
		deleteLabel: "Delete street",
		drawStreet: "✏️ Street",
		drawStreetTooltip: "Draw a street",
		globalGeneration: "Global generation (%)",
		generatorTypeWord: "GENERATOR",
		handleLabels: ["Move street start", "Move street end"],
		globalToggle: "Use global generation",
		invalidCells: "Enter a whole number between 1 and 2500.",
		laneDirection: "Lane 1:",
		laneGeneration: "Generate vehicles in lane 1",
		modalTitle: "➕ Add New Street",
		nameInvalid:
			"The name must contain only valid characters (letters, numbers, spaces, hyphens, and periods).",
		nameLabel: "Name:",
		nameRequired: "The street name is required.",
		selectObjectFirst: "Select a street or building first",
		roundabout: "↻ Roundabout",
		roundaboutTooltip: "Drag from the center to the inner radius",
		create: "✓ Create Street",
		cancel: "❌ Cancel",
		typeLabels: ["Generator", "CONEXION (street type)", "Sink"],
		typeValues: ["generador", "conexion", "devorador"],
		modalTypes: [
			"🚗 Generator",
			"🛣️ CONEXION (street type)",
			"🏁 Sink",
		],
		modalTypeValues: ["GENERADOR", "CONEXION", "DEVORADOR"],
	},
	es: {
		deleteConfirm: '¿Eliminar la calle "<b>Main</b> & "A""?',
		deleteLabel: "Eliminar calle",
		drawStreet: "✏️ Calle",
		drawStreetTooltip: "Dibujar una calle",
		globalGeneration: "Generación global (%)",
		generatorTypeWord: "GENERADOR",
		handleLabels: ["Mover inicio de calle", "Mover fin de calle"],
		globalToggle: "Usar generación global",
		invalidCells: "Introduce un número entero entre 1 y 2500.",
		laneDirection: "Carril 1:",
		laneGeneration: "Generar vehículos en carril 1",
		modalTitle: "➕ Agregar Nueva Calle",
		nameInvalid:
			"El nombre debe contener solo caracteres válidos (letras, números, espacios, guiones y puntos).",
		nameLabel: "Nombre:",
		nameRequired: "El nombre de la calle es obligatorio.",
		selectObjectFirst: "Selecciona una calle o edificio primero",
		roundabout: "↻ Glorieta",
		roundaboutTooltip: "Arrastra del centro al radio interior",
		create: "✓ Crear Calle",
		cancel: "❌ Cancelar",
		typeLabels: ["Generador", "Conexión (tipo de calle)", "Devorador"],
		typeValues: ["generador", "conexion", "devorador"],
		modalTypes: [
			"🚗 Generador",
			"🛣️ Conexión (tipo de calle)",
			"🏁 Devorador",
		],
		modalTypeValues: ["GENERADOR", "CONEXION", "DEVORADOR"],
	},
}

const htmlStreetName = '<b>Main</b> & "A"'

const runStreetWorkflow = async ({ page, language }) => {
	const labels = copy[language]
	await hideLoadingScreen(page)
	await clearToasts(page)

	await openAccordion(page, "#collapseMapDrawingTools")
	const tools = await page.evaluate(() => ({
		street: document.getElementById("drawStreetButton").textContent.trim(),
		streetTooltip: document
			.getElementById("drawStreetButton")
			.getAttribute("data-bs-title"),
		roundabout: document
			.getElementById("drawRoundaboutButton")
			.textContent.trim(),
		roundaboutTooltip: document
			.getElementById("drawRoundaboutButton")
			.getAttribute("data-bs-title"),
	}))
	expect(tools).toEqual({
		street: labels.drawStreet,
		streetTooltip: labels.drawStreetTooltip,
		roundabout: labels.roundabout,
		roundaboutTooltip: labels.roundaboutTooltip,
	})

	await page.click("#drawStreetButton")
	expect(await page.evaluate(() => window.drawStreetTool.isActive())).toBe(true)
	await page.keyboard.press("Escape")
	expect(await page.evaluate(() => window.drawStreetTool.isActive())).toBe(false)
	await page.click("#drawRoundaboutButton")
	expect(
		await page.evaluate(() => window.drawRoundaboutTool.isActive()),
	).toBe(true)
	await page.keyboard.press("Escape")
	expect(
		await page.evaluate(() => window.drawRoundaboutTool.isActive()),
	).toBe(false)

	await page.evaluate(() => window.mostrarDialogoNuevaCalle())
	await page.waitForSelector("#modalNuevaCalle.show", { visible: true })
	await new Promise((resolve) => setTimeout(resolve, 600))
	const modal = await page.evaluate(() => {
		const typeOptions = [
			...document.querySelectorAll("#selectTipoCalle option"),
		]
		const feedback = [
			...document.querySelectorAll("#modalNuevaCalle .invalid-feedback"),
		].map((element) => element.textContent.trim())
		return {
			title: document.getElementById("modalNuevaCalleLabel").textContent.trim(),
			name: document
				.querySelector('label[for="inputNombreCalle"]')
				.textContent.trim(),
			types: typeOptions.map((option) => option.textContent.trim()),
			values: typeOptions.map((option) => option.value),
			create: document
				.getElementById("btnConfirmarNuevaCalle")
				.textContent.trim(),
			cancel: document
				.querySelector("#modalNuevaCalle .modal-footer .btn-secondary")
				.textContent.trim(),
			feedback,
			generationTooltip: document
				.querySelector("#campoGeneracionModal .info-icon")
				.getAttribute("data-bs-title"),
		}
	})
	expect(modal.title).toBe(labels.modalTitle)
	expect(modal.name).toBe(labels.nameLabel)
	expect(modal.types).toEqual(labels.modalTypes)
	expect(modal.values).toEqual(labels.modalTypeValues)
	expect(modal.create).toBe(labels.create)
	expect(modal.cancel).toBe(labels.cancel)
	expect(modal.feedback).toContain(labels.nameInvalid)
	expect(modal.generationTooltip).toContain(labels.generatorTypeWord)

	await page.click("#btnConfirmarNuevaCalle")
	let toast = await waitForToast(page)
	expect(toast.header).toContain("bg-danger")
	expect(toast.title).toContain("Error")
	expect(toast.body).toBe(labels.nameRequired)

	await fill(page, "#inputNombreCalle", "Main Street")
	await page.select("#selectTipoCalle", "GENERADOR")
	await fill(page, "#inputTamanoCalle", "12")
	await fill(page, "#inputCarrilesCalle", "3")
	await fill(page, "#inputXCalle", "500")
	await fill(page, "#inputYCalle", "500")
	await fill(page, "#inputAnguloCalle", "0")
	await fill(page, "#inputProbGenCalle", "25")
	await fill(page, "#inputProbSaltoCalle", "5")
	await page.click("#btnConfirmarNuevaCalle")
	await page.waitForSelector("#modalNuevaCalle", { hidden: true })
	await page.waitForFunction(
		() => !document.querySelector(".modal-backdrop"),
		{ polling: 100 },
	)
	await page.waitForFunction(
		() => window.calles.at(-1)?.nombre === "Main Street",
		{ timeout: 5000, polling: 100 },
	)
	let created = await streetSnapshot(page)
	expect(created).toMatchObject({
		nombre: "Main Street",
		tipo: "generador",
		tamano: 12,
		carriles: 3,
		x: 500,
		y: 500,
		angulo: 0,
		probabilidadGeneracion: 0.25,
		probabilidadSaltoDeCarril: 0.05,
	})

	await page.evaluate(() => {
		const index = window.calles.length - 1
		window.calleSeleccionada = window.calles[index]
		const selector = document.getElementById("selectCalle")
		selector.value = String(index)
		selector.dispatchEvent(new Event("change", { bubbles: true }))
	})
	await page.waitForFunction(
		() => document.getElementById("streetInspector").hidden === false,
		{ polling: 100 },
	)
	const inspector = await page.evaluate(() => ({
		label: document
			.getElementById("streetInspector")
			.getAttribute("aria-label"),
		name: document
			.querySelector("#streetInspector .street-inspector-field span")
			.textContent.trim(),
		types: [...document.querySelectorAll("#streetInspectorType option")].map(
			(option) => ({
				value: option.value,
				label: option.textContent.trim(),
			}),
		),
		laneDirection: document
			.querySelector("#streetInspectorLaneDirections button")
			.getAttribute("aria-label"),
		laneGeneration: document
			.querySelector("#streetInspectorLaneDirections input")
			.getAttribute("aria-label"),
		deleteStreet: document
			.getElementById("streetInspectorDeleteStreet")
			.textContent.trim(),
		errorRole: document
			.getElementById("streetInspectorError")
			.getAttribute("role"),
	}))
	expect(inspector.label).toBe(
		language === "en" ? "Street inspector" : "Inspector de calle",
	)
	expect(inspector.name).toBe(language === "en" ? "Name" : "Nombre")
	expect(inspector.types.map((type) => type.label)).toEqual(labels.typeLabels)
	expect(inspector.types.map((type) => type.value)).toEqual(labels.typeValues)
	expect(inspector.laneDirection).toContain(labels.laneDirection)
	expect(inspector.laneGeneration).toBe(labels.laneGeneration)
	expect(inspector.deleteStreet).toBe(labels.deleteLabel)
	expect(inspector.errorRole).toBe("alert")

	const visibleCenter = await page.evaluate(() => {
		const canvas = document.getElementById("simuladorCanvas")
		const rect = canvas.getBoundingClientRect()
		const screen = { x: rect.width * 0.55, y: rect.height * 0.4 }
		return window.USE_PIXI
			? window.pixiApp.cameraController.screenToWorld(screen.x, screen.y)
			: {
					x:
						((screen.x * canvas.width) / rect.width - window.offsetX) /
						window.escala,
					y:
						((screen.y * canvas.height) / rect.height - window.offsetY) /
						window.escala,
				}
	})
	await fill(page, "#streetInspectorX", String(visibleCenter.x))
	await fill(page, "#streetInspectorY", String(visibleCenter.y))
	await page.evaluate(() => window.streetGeometryEditor.refresh())
	expect(
		await page.$$eval(".street-endpoint-handle", (handles) =>
			handles
				.filter((handle) => !handle.hidden)
				.map((handle) => handle.getAttribute("aria-label")),
		),
	).toEqual(labels.handleLabels)

	const beforeResize = await page.evaluate(
		() => window.calleSeleccionada.tamano,
	)
	const endHandle = await page.$('.street-endpoint-handle[data-kind="end"]')
	const handleBox = await endHandle.boundingBox()
	await page.mouse.move(
		handleBox.x + handleBox.width / 2,
		handleBox.y + handleBox.height / 2,
	)
	await page.mouse.down()
	await page.mouse.move(
		handleBox.x + handleBox.width / 2 + 24,
		handleBox.y + handleBox.height / 2,
		{ steps: 5 },
	)
	await page.mouse.up()
	expect(
		await page.evaluate(() => window.calleSeleccionada.tamano),
	).toBeGreaterThan(beforeResize)

	await page.click("#streetInspectorLaneDirections button")
	expect(
		await page.evaluate(() => window.calleSeleccionada.laneDirections[0]),
	).toBe(-1)
	await page.click("#streetInspectorLaneDirections input")
	expect(
		await page.evaluate(
			() => window.calleSeleccionada.laneGenerationEnabled[0],
		),
	).toBe(false)

	await fill(page, "#streetInspectorGeneration", "40")
	await fill(page, "#streetInspectorLaneChange", "7")
	expect(await streetSnapshot(page)).toMatchObject({
		probabilidadGeneracion: 0.4,
		probabilidadSaltoDeCarril: 0.07,
		laneDirections: [-1, 1, 1],
		laneGenerationEnabled: [false, true, true],
	})

	await page.select("#streetInspectorType", "conexion")
	expect(
		await page.evaluate(() => ({
			tipo: window.calleSeleccionada.tipo,
			generation: window.calleSeleccionada.probabilidadGeneracion,
			hidden: document.getElementById("streetInspectorGenerationRow").hidden,
		})),
	).toEqual({ tipo: "conexion", generation: 0, hidden: true })
	await page.select("#streetInspectorType", "generador")
	expect(
		await page.evaluate(() => ({
			tipo: window.calleSeleccionada.tipo,
			generation: window.calleSeleccionada.probabilidadGeneracion,
			hidden: document.getElementById("streetInspectorGenerationRow").hidden,
		})),
	).toEqual({ tipo: "generador", generation: 0.5, hidden: false })

	await fill(page, "#streetInspectorCells", "0")
	const cellsBefore = await page.evaluate(
		() => window.calleSeleccionada.tamano,
	)
	expect(
		await page.$eval(
			"#streetInspectorError",
			(element) => element.textContent.trim(),
		),
	).toBe(labels.invalidCells)
	expect(await page.evaluate(() => window.calleSeleccionada.tamano)).toBe(
		cellsBefore,
	)
	await fill(page, "#streetInspectorCells", "16")
	expect(await page.evaluate(() => window.calleSeleccionada.tamano)).toBe(16)
	// Resizing rebuilds the selector options; restore the explicit selection the
	// user would make before using the Street Settings controls.
	await page.evaluate(() => {
		const index = window.calles.length - 1
		const selector = document.getElementById("selectCalle")
		selector.value = String(index)
		selector.dispatchEvent(new Event("change", { bubbles: true }))
	})

	await fill(page, "#streetInspectorX", "123.5")
	expect(await page.evaluate(() => window.calleSeleccionada.x)).toBe(123.5)

	await fill(page, "#streetInspectorName", htmlStreetName)
	created = await streetSnapshot(page)
	expect(created.nombre).toBe(htmlStreetName)
	expect(
		await page.evaluate(() => {
			const selector = document.getElementById("selectCalle")
			const index = String(window.calles.length - 1)
			return selector.querySelector(`option[value="${index}"]`).textContent
		}),
	).toBe(htmlStreetName)

	await openAccordion(page, "#collapseConfig")
	const settings = await page.evaluate(() => ({
		toggle: document
			.querySelector('label[for="toggleGeneracionGlobal"]')
			.textContent.trim(),
		generation: document
			.querySelector('label[for="inputGeneracionGlobal"]')
			.textContent.trim(),
		help: document.getElementById("ayudaGeneracionGlobal").textContent.trim(),
	}))
	expect(settings.toggle).toBe(labels.globalToggle)
	expect(settings.generation).toBe(labels.globalGeneration)
	expect(settings.help.length).toBeGreaterThan(20)

	const globalGeneration = await page.evaluate(() => {
		const input = document.getElementById("inputGeneracionGlobal")
		const toggle = document.getElementById("toggleGeneracionGlobal")
		input.value = "0"
		input.dispatchEvent(new Event("input", { bubbles: true }))
		toggle.click()
		const zero = {
			active: generacionGlobal.activa,
			probability: generacionGlobal.probabilidad,
		}
		toggle.click()
		input.value = "101"
		input.dispatchEvent(new Event("input", { bubbles: true }))
		const invalid = {
			classed: input.classList.contains("is-invalid"),
			aria: input.getAttribute("aria-invalid"),
			feedback: input.nextElementSibling.textContent.trim(),
		}
		input.value = "50"
		input.dispatchEvent(new Event("input", { bubbles: true }))
		return {
			zero,
			invalid,
			disabled: generacionGlobal.activa,
			restored: generacionGlobal.probabilidad,
		}
	})
	expect(globalGeneration.zero).toEqual({ active: true, probability: 0 })
	expect(globalGeneration.invalid.classed).toBe(true)
	expect(globalGeneration.invalid.aria).toBe("true")
	expect(globalGeneration.invalid.feedback).toBe(
		language === "en"
			? "Please enter a value between 0 and 100."
			: "Por favor ingresa un valor entre 0 y 100.",
	)
	expect(globalGeneration.disabled).toBe(false)
	expect(globalGeneration.restored).toBe(0.5)

	await fill(page, "#inputProbabilidadGeneracion", "30")
	await fill(page, "#inputProbabilidadSalto", "9")
	await page.click("#btnActualizarCalle")
	toast = await waitForToast(page)
	expect(toast.header).toContain("bg-success")
	expect(toast.body).toContain(htmlStreetName)
	expect(toast.body).toContain("30%")
	expect(toast.body).toContain("9%")
	expect(toast.markup).toBe(0)
	expect(await streetSnapshot(page)).toMatchObject({
		probabilidadGeneracion: 0.3,
		probabilidadSaltoDeCarril: 0.09,
	})

	const snapshot = await streetSnapshot(page)

	await page.evaluate((name) => {
		window.__deleteConfirmation = null
		window.confirm = (message) => {
			window.__deleteConfirmation = message
			return false
		}
		window.__expectedStreetName = name
	}, htmlStreetName)
	await page.click("#streetInspectorDeleteStreet")
	const cancelled = await page.evaluate((name) => ({
		confirmation: window.__deleteConfirmation,
		exists: window.calles.some((street) => street.nombre === name),
	}), htmlStreetName)
	expect(cancelled.confirmation).toBe(labels.deleteConfirm)
	expect(cancelled.exists).toBe(true)

	await page.evaluate(() => {
		window.confirm = () => true
	})
	await page.click("#streetInspectorDeleteStreet")
	await page.waitForFunction(
		() =>
			!window.calles.some((street) => street.nombre === window.__expectedStreetName),
		{ polling: 100 },
	)
	expect(
		await page.evaluate(() => ({
			selected: window.calleSeleccionada,
			hidden: document.getElementById("streetInspector").hidden,
			options: [
				document.getElementById("selectCalle").value,
				document.getElementById("selectCalleEditor").value,
			],
		})),
	).toEqual({ selected: null, hidden: true, options: ["", ""] })

	await clearToasts(page)
	await page.evaluate(() => {
		window.calleSeleccionada = null
		window.edificioSeleccionado = null
		window.editorCalles.entrarModoEdicion()
	})
	toast = await waitForToast(page)
	expect(toast.header).toContain("bg-warning")
	expect(toast.body).toBe(labels.selectObjectFirst)

	return snapshot
}

describe("street drawing and inspection localization", () => {
	for (const usePixi of [false, true]) {
		it(`creates, edits, validates, and deletes streets identically in Spanish and English with ${usePixi ? "Pixi" : "Canvas"}`, async () => {
			const snapshots = []
			for (const language of ["es", "en"]) {
				const simulator = await openSimulator({
					usePixi,
					languagePreference: language,
					freezeFrames: true,
				})
				try {
					const { page } = simulator
					if (usePixi) {
						await page.waitForFunction(
							() => Boolean(window.pixiApp?.sceneManager),
							{ timeout: 60000, polling: 100 },
						)
					}
					snapshots.push(
						await runStreetWorkflow({ page, language }),
					)
					expect(simulator.pageErrors).toEqual([])
				} finally {
					await simulator.close()
				}
			}
			expect(snapshots[1]).toEqual(snapshots[0])
		}, 120000)
	}
})

describe("street controls at mobile sizes and in both themes", () => {
	it("keeps translated drawing, settings, inspector, and modal controls reachable", async () => {
		const simulator = await openSimulator({ languagePreference: "en" })
		try {
			const { page } = simulator
			await page.setViewport({ width: 390, height: 844 })
			await hideLoadingScreen(page)

			for (const theme of ["light", "dark"]) {
				if (theme === "dark") {
					await page.click("#switchModoOscuro")
					await page.waitForFunction(
						() => document.body.classList.contains("dark-mode"),
						{ polling: 100 },
					)
				}
				const fits = (ids) =>
					page.evaluate((selectors) => {
						const elements = selectors.map((id) =>
							document.getElementById(id),
						)
						return {
							fit: elements.every((element) => {
								const rect = element.getBoundingClientRect()
								const style = getComputedStyle(element)
								return (
									style.display !== "none" &&
									style.visibility !== "hidden" &&
									rect.width > 0 &&
									rect.height > 0 &&
									rect.left >= -1 &&
									rect.right <= window.innerWidth + 1
								)
							}),
							overflow:
								document.documentElement.scrollWidth - window.innerWidth,
						}
					}, ids)

				await openAccordion(page, "#collapseMapDrawingTools")
				let controls = await fits([
					"drawStreetButton",
					"drawRoundaboutButton",
				])
				expect(controls.fit).toBe(true)
				expect(controls.overflow).toBeLessThanOrEqual(1)
				expect(
					await page.evaluate(() => ({
						street: document
							.getElementById("drawStreetButton")
							.textContent.trim(),
						streetTooltip: document
							.getElementById("drawStreetButton")
							.getAttribute("data-bs-title"),
					})),
				).toEqual({
					street: "✏️ Street",
					streetTooltip: "Draw a street",
				})

				await openAccordion(page, "#collapseConfig")
				controls = await fits([
					"toggleGeneracionGlobal",
					"inputGeneracionGlobal",
					"selectCalle",
					"btnActualizarCalle",
				])
				expect(controls.fit).toBe(true)
				expect(controls.overflow).toBeLessThanOrEqual(1)
				expect(
					await page.evaluate(() => ({
						toggle: document
							.querySelector('label[for="toggleGeneracionGlobal"]')
							.textContent.trim(),
						global: document
							.querySelector('label[for="inputGeneracionGlobal"]')
							.textContent.trim(),
					})),
				).toEqual({
					toggle: "Use global generation",
					global: "Global generation (%)",
				})

				await openAccordion(page, "#collapseConstructor")
				controls = await fits(["btnAgregarCalle"])
				expect(controls.fit).toBe(true)
				expect(controls.overflow).toBeLessThanOrEqual(1)
				expect(
					await page.$eval("#btnAgregarCalle", (element) =>
						element.textContent.trim(),
					),
				).toBe("➕ Add Street")

				await page.evaluate(() => window.mostrarDialogoNuevaCalle())
				await page.waitForSelector("#modalNuevaCalle.show", { visible: true })
				await new Promise((resolve) => setTimeout(resolve, 600))
				const modal = await page.evaluate(() => {
					const dialog = document
						.querySelector("#modalNuevaCalle .modal-dialog")
						.getBoundingClientRect()
					const body = document.querySelector("#modalNuevaCalle .modal-body")
					const label = document
						.querySelector('label[for="inputNombreCalle"]')
						.getBoundingClientRect()
					const styles = getComputedStyle(
						document.querySelector('label[for="inputNombreCalle"]'),
					)
					return {
						fits:
							dialog.left >= -1 &&
							dialog.top >= -1 &&
							dialog.right <= window.innerWidth + 1 &&
							dialog.bottom <= window.innerHeight + 1,
						overflow: body.scrollWidth - body.clientWidth,
						labelVisible: label.width > 0 && label.height > 0,
						readable:
							styles.color !== "rgba(0, 0, 0, 0)" &&
							styles.color !== styles.backgroundColor,
						title: document
							.getElementById("modalNuevaCalleLabel")
							.textContent.trim(),
					}
				})
				expect(modal.fits).toBe(true)
				expect(modal.overflow).toBeLessThanOrEqual(1)
				expect(modal.labelVisible).toBe(true)
				expect(modal.readable).toBe(true)
				expect(modal.title).toBe("➕ Add New Street")
				await page.$eval(
					"#modalNuevaCalle [data-bs-dismiss='modal']",
					(button) => button.click(),
				)
				await page.waitForSelector("#modalNuevaCalle", { hidden: true })
				await page.waitForFunction(
					() => !document.querySelector(".modal-backdrop"),
					{ polling: 100 },
				)
			}
		} finally {
			await simulator.close()
		}
	}, 120000)
})
