import { describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

const hideLoadingScreen = (page) =>
	page.evaluate(() => {
		window.hideLoadingScreen?.()
		document.getElementById("loadingScreen").style.display = "none"
	})

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

const openAccordion = async (page, target) => {
	const expanded = await page.$eval(
		`[data-bs-target="${target}"]`,
		(button) => button.getAttribute("aria-expanded") === "true",
	)
	if (!expanded) {
		await page.$eval(`[data-bs-target="${target}"]`, (button) => button.click())
		await page.waitForSelector(`${target}.show`, { visible: true })
	}
}

const edit = (page, selector, value) =>
	page.$eval(
		selector,
		(element, next) => {
			element.value = String(next)
			element.dispatchEvent(
				new Event(element.tagName === "SELECT" ? "change" : "input", {
					bubbles: true,
				}),
			)
		},
		value,
	)

const copy = {
	en: {
		constructor: {
			title: "🗺️ Simulation Management",
			newSimulation: "➕ New Simulation",
			newTooltip:
				"Create a new simulation from scratch, deleting all current content",
			saveSimulation: "💾 Save Simulation",
			saveTooltip: "Save the current simulation as a JSON file",
			loadSimulation: "📂 Load Simulation",
			loadTooltip:
				"Load a simulation from a previously saved JSON file",
			savePromptTitle: "Simulation name:",
			defaultSimulationName: "New Simulation",
			newConfirm:
				"Create a new simulation?\nThis will delete the current simulation.",
			loadConfirm: (name) =>
				`Load simulation "${name}"?\nThis will delete the current simulation.`,
			saved: (name) =>
				`Simulation "${name}" saved successfully as JSON.`,
			created: "New simulation created.",
			loaded: (name, streets, buildings, connections) =>
				`Simulation "${name}" loaded successfully.\n\n📊 Summary:\n  • Streets: ${streets}\n  • Buildings: ${buildings}\n  • Street connections: ${connections}`,
			loadFailed: (reason) =>
				`The simulation could not be loaded: ${reason}`,
			invalidFormat: "Invalid file format.",
		},
		labels: {
			title: "Map labels",
			options: ["No labels", "Streets", "Buildings", "Both"],
			fontSize: "Label size (px)",
			fontSizeError: "Enter a whole number of at least 1 pixel.",
		},
		reference: {
			title: "🖼️ Reference image",
			intro:
				"Add a local image or link a URL as a map guide. It initially fits the view and stays aligned as you move or zoom the map.",
			upload: "📷 Upload or replace image",
			urlLabel: "Image URL",
			urlPlaceholder: "https://example.org/map.png",
			link: "🔗 Link or replace image",
			remove: "🗑️ Remove image",
			lock: "🔓 Lock image to edit the map",
			unlock: "🔒 Unlock image to align it",
			show: "Show reference image",
			opacity: "Opacity:",
			help: "Drag the image to move it, drag its corner to resize it, and drag the circle to rotate it. Lock it to select objects underneath. Local images are embedded in the JSON; linked images save only the URL and their settings and depend on the source staying available. If the link fails, an «Image unavailable» marker appears at its position and you can replace it.",
			selected: "Selected reference image; drag to move",
			rotate: "Rotate image",
			resize: "Resize proportionally",
			unavailable: "Image unavailable",
			linkFailed: (reason) =>
				`The image could not be linked: ${reason}.`,
			uploadFailed: (reason) =>
				`The image could not be loaded: ${reason}.`,
			invalidUrl: "enter an HTTP or HTTPS image URL",
			loadFailed: "the file is not a readable image",
		},
	},
	es: {
		constructor: {
			title: "🗺️ Gestión de Simulación",
			newSimulation: "➕ Nueva Simulación",
			newTooltip:
				"Crear una nueva simulación desde cero, borrando todo el contenido actual",
			saveSimulation: "💾 Guardar Simulación",
			saveTooltip: "Guardar la simulación actual como archivo JSON",
			loadSimulation: "📂 Cargar Simulación",
			loadTooltip:
				"Cargar una simulación desde un archivo JSON guardado previamente",
			savePromptTitle: "Nombre de la simulación:",
			defaultSimulationName: "Nueva Simulación",
			newConfirm:
				"¿Crear una nueva simulación?\nEsto eliminará la simulación actual.",
			loadConfirm: (name) =>
				`¿Cargar simulación «${name}»?\nEsto eliminará la simulación actual.`,
			saved: (name) =>
				`Simulación «${name}» guardada correctamente como JSON.`,
			created: "Nueva simulación creada.",
			loaded: (name, streets, buildings, connections) =>
				`Simulación «${name}» cargada correctamente.\n\n📊 Resumen:\n  • Calles: ${streets}\n  • Edificios: ${buildings}\n  • Conexiones entre calles: ${connections}`,
			loadFailed: (reason) =>
				`No se pudo cargar la simulación: ${reason}`,
			invalidFormat: "Formato de archivo inválido.",
		},
		labels: {
			title: "Etiquetas del mapa",
			options: ["Sin etiquetas", "Calles", "Edificios", "Ambos"],
			fontSize: "Tamaño de etiqueta (px)",
			fontSizeError: "Ingresa un número entero de al menos 1 píxel.",
		},
		reference: {
			title: "🖼️ Imagen de referencia",
			intro:
				"Añade una imagen local o enlaza una URL como guía del mapa. Se ajusta inicialmente a la vista y queda alineada al mover o ampliar el mapa.",
			upload: "📷 Cargar o reemplazar imagen",
			urlLabel: "URL de la imagen",
			urlPlaceholder: "https://ejemplo.org/mapa.png",
			link: "🔗 Enlazar o reemplazar imagen",
			remove: "🗑️ Quitar imagen",
			lock: "🔓 Bloquear imagen para editar el mapa",
			unlock: "🔒 Desbloquear imagen para alinearla",
			show: "Mostrar imagen de referencia",
			opacity: "Opacidad:",
			help: "Arrastra la imagen para moverla, la esquina para cambiar su tamaño y el círculo para girarla. Bloquéala para seleccionar objetos bajo ella. Las imágenes locales se incluyen en el JSON; las enlazadas guardan solo la URL y sus ajustes y dependen de que la fuente siga disponible. Si falla el enlace, aparece una marca «Imagen no disponible» en su posición y puedes reemplazarlo.",
			selected: "Imagen de referencia seleccionada; arrastra para mover",
			rotate: "Girar imagen",
			resize: "Cambiar tamaño proporcionalmente",
			unavailable: "Imagen no disponible",
			linkFailed: (reason) =>
				`No se pudo enlazar la imagen: ${reason}.`,
			uploadFailed: (reason) =>
				`No se pudo cargar la imagen: ${reason}.`,
			invalidUrl: "introduce una URL HTTP o HTTPS de imagen",
			loadFailed: "el archivo no es una imagen legible",
		},
	},
}

async function referenceDataUrl(page) {
	return page.evaluate(() => {
		const canvas = document.createElement("canvas")
		canvas.width = 240
		canvas.height = 120
		const context = canvas.getContext("2d")
		context.fillStyle = "#ff00ff"
		context.fillRect(0, 0, canvas.width, canvas.height)
		return canvas.toDataURL("image/png")
	})
}

async function importJson(page, json, confirmResult) {
	await page.evaluate(
		async ({ json, confirmResult }) => {
			window.__mapConfirm = null
			window.confirm = (message) => {
				window.__mapConfirm = message
				return confirmResult
			}
			const input = document.getElementById("inputCargarSimulacion")
			const transfer = new DataTransfer()
			transfer.items.add(
				new File([json], "map-round-trip.json", {
					type: "application/json",
				}),
			)
			input.files = transfer.files
			input.dispatchEvent(new Event("change", { bubbles: true }))
		},
		{ json, confirmResult },
	)
}

async function saveJson(page, name) {
	return page.evaluate(async (name) => {
		window.__mapPrompt = null
		window.prompt = (title, defaultValue) => {
			window.__mapPrompt = { title, defaultValue }
			return name
		}
		const originalCreateObjectURL = URL.createObjectURL
		URL.createObjectURL = (blob) => {
			window.__mapSavedJSON = blob.text()
			return "blob:map-constructor-localization"
		}
		try {
			document.getElementById("btnGuardarSimulacion").click()
			return await window.__mapSavedJSON
		} finally {
			URL.createObjectURL = originalCreateObjectURL
		}
	}, name)
}

function snapshotScript() {
	return () => {
		const streets = window.calles.map((street) => ({
			name: street.nombre,
			size: street.tamano,
			type: typeof street.tipo === "object" ? street.tipo.nombre : street.tipo,
			x: street.x,
			y: street.y,
			angle: street.angulo,
			lanes: street.carriles,
			laneDirections: street.laneDirections,
			laneGenerationEnabled: street.laneGenerationEnabled,
			generation: street.probabilidadGeneracion,
			laneChange: street.probabilidadSaltoDeCarril,
			vertices: street.vertices,
			curved: street.esCurva,
			geometryType: street.geometryType,
			innerRadius: street.innerRadius,
			startAngle: street.startAngle,
			bezierGeometry: street.bezierGeometry,
			endX: street.endX,
			endY: street.endY,
		}))
		const connections = window.conexiones.map((connection) => ({
			origin: connection.origen.nombre,
			destination: connection.destino.nombre,
			type: connection.tipo,
			originLane: connection.carrilOrigen,
			destinationLane: connection.carrilDestino,
			originPosition: connection.posOrigen,
			destinationPosition: connection.posDestino,
			probability: connection.probabilidadTransferencia,
		}))
		const buildings = window.edificios.map((building) => ({
			label: building.label,
			x: building.x,
			y: building.y,
			width: building.width,
			height: building.height,
			angle: building.angle,
			color: building.color,
			geometryType: building.geometryType,
			appearanceMode: building.appearanceMode,
			vertices: building.vertices?.map((vertex) => ({
				x: vertex.x,
				y: vertex.y,
			})),
			imagen: building.imagen,
			canvasImageKey: building.canvasImageKey,
			imageRotationConvention: building.imageRotationConvention,
			imageData: building.imageData,
			parking: building.esEstacionamiento,
			capacity: building.capacidadMaxima,
			occupancy: building.vehiculosActuales,
			parkingConnections: (building.conexiones || []).map((connection) => ({
				type: connection.tipo,
				street: connection.calleId,
				lane: connection.carril,
				cell: connection.indice,
			})),
			entryProbabilities: building.probabilidadesEntrada,
			exitProbabilities: building.probabilidadesSalida,
		}))
		const image = window.referenceImage
		return {
			language: document.documentElement.lang,
			streets,
			connections,
			buildings,
			reference: image
				? {
						url: image.url,
						dataUrl: image.dataUrl,
						x: image.x,
						y: image.y,
						width: image.width,
						height: image.height,
						rotation: image.rotation,
						visible: image.visible,
						opacity: image.opacity,
						locked: image.locked,
					}
				: null,
			labels: {
				visibility: window.labelVisibility,
				fontSize: window.labelFontSize,
			},
		}
	}
}

async function buildExchangeMap(page) {
	const reference = await referenceDataUrl(page)
	await page.evaluate(async (referenceDataUrl) => {
		window.streetEditPause?.()
		const roadA = window.crearCalle(
			'Ruta <b> & "A"',
			12,
			window.TIPOS.CONEXION,
			-120,
			120,
			30,
			42,
			2,
			0.07,
		)
		const roadB = window.crearCalle(
			'Ruta <b> & "B"',
			40,
			window.TIPOS.CONEXION,
			240,
			120,
			0,
			18,
			2,
			0.03,
		)
		roadA.laneDirections = [-1, 1]
		roadA.laneGenerationEnabled = [true, false]
		roadB.laneDirections = [1, -1]
		roadB.laneGenerationEnabled = [false, true]
		const roundabout = window.roundaboutStreet.createStreet({
			nombre: 'Glorieta <b> & "R"',
			x: 420,
			y: 260,
			innerRadius: 40,
			carriles: 2,
			startAngle: 45,
		})
		roundabout.laneDirections = [1, -1]
		window.calles.push(roundabout)

		const links = window.crearConexionLineal(roadA, roadB)
		window.registrarConexiones(links)
		window.conexiones.push(...links)

		const parking = window.agregarEdificio(
			'Estacionamiento <b> & "P"',
			150,
			260,
			100,
			60,
			15,
		)
		window.configurarEstacionamiento(
			parking,
			[
				{
					tipo: "entrada",
					calleId: roadA.id,
					carril: 0,
					indice: 1,
				},
				{
					tipo: "salida",
					calleId: roadA.id,
					carril: 0,
					indice: 3,
				},
			],
			12,
		)
		parking.vehiculosActuales = 4

		const artwork = document.createElement("canvas")
		artwork.width = 40
		artwork.height = 20
		artwork.getContext("2d").fillStyle = "#176ba0"
		artwork.getContext("2d").fillRect(0, 0, 40, 20)
		const imageData = artwork.toDataURL()
		const imageElement = new Image()
		imageElement.src = imageData
		await imageElement.decode()
		const uploaded = window.agregarEdificio(
			'Imagen <b> & "U"',
			150,
			380,
			80,
			40,
			0,
		)
		Object.assign(uploaded, {
			appearanceMode: "uploaded-image",
			imageData,
			imageElement,
			imageNaturalWidth: 40,
			imageNaturalHeight: 20,
		})

		const bundled = window.agregarEdificio("ESCOM", 330, 360, 50, 50, 0)
		Object.assign(bundled, { imagen: "escom", canvasImageKey: "ESCOM" })

		await window.setReferenceImage(referenceDataUrl)
		Object.assign(window.referenceImage, {
			x: 40,
			y: 40,
			width: 60,
			height: 30,
			rotation: 12,
			opacity: 0.55,
			visible: true,
			locked: true,
		})
		window.actualizarSelectores?.()
		window.cellGeometryIndex?.invalidate?.()
		window.pixiApp?.sceneManager?.renderAll?.()
		window.renderizarCanvas?.()
	}, reference)
	return reference
}

async function waitForExchangeMap(page) {
	await page.waitForFunction(
		() =>
			window.calles?.length === 3 &&
			window.conexiones?.length === 2 &&
			window.edificios?.length === 3 &&
			window.referenceImage?.dataUrl &&
			window.referenceImage.locked === true,
		{ timeout: 20000, polling: 100 },
	)
}

async function readSnapshot(page) {
	return page.evaluate(snapshotScript())
}

describe.each([
	["Canvas", false],
	["Pixi", true],
])("map constructor localization in %s mode", (_mode, usePixi) => {
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one focused workflow covers both languages.
	it("translates reference images, map labels, and map lifecycle controls in Spanish and English", async () => {
		for (const language of ["es", "en"]) {
			const labels = copy[language]
			const simulator = await openSimulator({
				usePixi,
				languagePreference: language,
				freezeFrames: false,
			})
			try {
				const { page } = simulator
				if (usePixi) {
					await page.waitForFunction(
						() => Boolean(window.pixiApp?.sceneManager),
						{ timeout: 60000, polling: 100 },
					)
				}
				await hideLoadingScreen(page)
				await page.evaluate(() => {
					window.confirm = () => true
					document.getElementById("btnNuevaSimulacion").click()
				})
				await page.waitForFunction(
					() =>
						window.calles.length === 0 &&
						window.edificios.length === 0,
					{ polling: 100 },
				)
				await clearToasts(page)
				await openAccordion(page, "#collapseConstructor")
				await openAccordion(page, "#collapseMapDrawingTools")

				const controls = await page.evaluate(() => ({
					constructorTitle: document
						.querySelector(
							'#collapseConstructor h6[data-i18n="mapConstructor.title"]',
						)
						.textContent.trim(),
					newSimulation: document
						.getElementById("btnNuevaSimulacion")
						.textContent.trim(),
					newTooltip: document
						.getElementById("btnNuevaSimulacion")
						.getAttribute("data-bs-title"),
					saveSimulation: document
						.getElementById("btnGuardarSimulacion")
						.textContent.trim(),
					saveTooltip: document
						.getElementById("btnGuardarSimulacion")
						.getAttribute("data-bs-title"),
					loadSimulation: document
						.getElementById("btnCargarSimulacion")
						.textContent.trim(),
					loadTooltip: document
						.getElementById("btnCargarSimulacion")
						.getAttribute("data-bs-title"),
					referenceTitle:
						document.querySelector(
							'#collapseConstructor h6[data-i18n="referenceImage.title"]',
						).textContent,
					upload: document
						.querySelector('label[for="inputImagenReferencia"]')
						.textContent.trim(),
					urlLabel: document
						.querySelector('label[for="inputUrlImagenReferencia"]')
						.textContent.trim(),
					urlPlaceholder: document
						.getElementById("inputUrlImagenReferencia")
						.getAttribute("placeholder"),
					link: document
						.getElementById("btnAgregarUrlImagenReferencia")
						.textContent.trim(),
					remove: document
						.getElementById("btnEliminarImagenReferencia")
						.textContent.trim(),
					lock: document
						.getElementById("btnBloquearImagenReferencia")
						.textContent.trim(),
					show: document
						.querySelector('label[for="mostrarImagenReferencia"]')
						.textContent.trim(),
					opacity: document
						.querySelector('label[for="opacidadImagenReferencia"]')
						.firstChild.textContent.trim(),
					help: document
						.querySelector(
							'#collapseConstructor p[data-i18n="referenceImage.help"]',
						)
						.textContent.trim(),
					labelTitle: document
						.querySelector('label[for="labelVisibility"]')
						.textContent.trim(),
					labelAria: document
						.getElementById("labelVisibility")
						.getAttribute("aria-label"),
					labelOptions: [
						...document.getElementById("labelVisibility").options,
					].map((option) => option.textContent),
					fontSize: document
						.querySelector('label[for="labelFontSize"]')
						.textContent.trim(),
					docLang: document.documentElement.lang,
				}))
				expect(controls).toEqual({
					constructorTitle: labels.constructor.title,
					newSimulation: labels.constructor.newSimulation,
					newTooltip: labels.constructor.newTooltip,
					saveSimulation: labels.constructor.saveSimulation,
					saveTooltip: labels.constructor.saveTooltip,
					loadSimulation: labels.constructor.loadSimulation,
					loadTooltip: labels.constructor.loadTooltip,
					referenceTitle: labels.reference.title,
					upload: labels.reference.upload,
					urlLabel: labels.reference.urlLabel,
					urlPlaceholder: labels.reference.urlPlaceholder,
					link: labels.reference.link,
					remove: labels.reference.remove,
					lock: labels.reference.lock,
					show: labels.reference.show,
					opacity: labels.reference.opacity,
					help: labels.reference.help,
					labelTitle: labels.labels.title,
					labelAria: labels.labels.title,
					labelOptions: labels.labels.options,
					fontSize: labels.labels.fontSize,
					docLang: language,
				})

				await edit(page, "#labelFontSize", 0)
				expect(
					await page.$eval(
						"#labelFontSizeError",
						(element) => element.textContent,
					),
				).toBe(labels.labels.fontSizeError)
				await edit(page, "#labelFontSize", 14)

				// Map labels keep user-authored names verbatim and are never translated.
				await page.evaluate(() => {
					window.crearCalle('Calle <b> & "Nombre"', 12, window.TIPOS.CONEXION, 120, 120, 0, 0, 1)
					window.agregarEdificio('Edificio <b> & "Nombre"', 300, 240, 40, 40, 0)
					window.pixiApp?.sceneManager?.renderAll?.()
				})
				await page.select("#labelVisibility", "both")
				expect(await page.evaluate(() => ({
					streets: window.calles.map((street) => street.nombre),
					buildings: window.edificios.map((building) => building.label),
					pixi: window.USE_PIXI
						? [
								...window.pixiApp.sceneManager.uiRenderer.etiquetas.values(),
							].map((container) => container.labelText.text)
						: null,
				}))).toEqual({
					streets: ['Calle <b> & "Nombre"'],
					buildings: ['Edificio <b> & "Nombre"'],
					pixi: usePixi ? ['Calle <b> & "Nombre"'] : null,
				})
				await page.select("#labelVisibility", "off")

				const dataUrl = await referenceDataUrl(page)
				await page.evaluate((data) => window.setReferenceImage(data), dataUrl)
				await page.waitForFunction(
					() => window.referenceImage?.image?.complete,
					{ polling: 100 },
				)
				const handles = await page.evaluate(() => ({
					selected: document
						.querySelector(".reference-image-frame")
						.getAttribute("aria-label"),
					rotate: document
						.querySelector(".reference-image-rotate")
						.getAttribute("aria-label"),
					rotateTitle: document
						.querySelector(".reference-image-rotate")
						.getAttribute("title"),
					resize: document
						.querySelector(".reference-image-resize")
						.getAttribute("aria-label"),
					resizeTitle: document
						.querySelector(".reference-image-resize")
						.getAttribute("title"),
				}))
				expect(handles).toEqual({
					selected: labels.reference.selected,
					rotate: labels.reference.rotate,
					rotateTitle: labels.reference.rotate,
					resize: labels.reference.resize,
					resizeTitle: labels.reference.resize,
				})

				await page.$eval("#btnBloquearImagenReferencia", (button) => button.click())
				expect(
					await page.$eval(
						"#btnBloquearImagenReferencia",
						(button) => button.textContent,
					),
				).toBe(labels.reference.unlock)
				expect(
					await page.evaluate(() => window.referenceImage.locked),
				).toBe(true)
				await page.$eval("#btnBloquearImagenReferencia", (button) => button.click())
				expect(
					await page.$eval(
						"#btnBloquearImagenReferencia",
						(button) => button.textContent,
					),
				).toBe(labels.reference.lock)
				expect(
					await page.evaluate(() => window.referenceImage.locked),
				).toBe(false)

				await page.$eval("#opacidadImagenReferencia", (input) => {
					input.value = "45"
					input.dispatchEvent(new Event("input", { bubbles: true }))
				})
				expect(
					await page.$eval(
						'label[for="opacidadImagenReferencia"]',
						(element) => element.textContent.trim(),
					),
				).toBe(`${labels.reference.opacity.trim()} 45%`)
				expect(
					await page.$eval(
						"#valorOpacidadImagenReferencia",
						(element) => element.textContent,
					),
				).toBe("45%")
				await page.$eval("#mostrarImagenReferencia", (input) => input.click())
				expect(
					await page.evaluate(() => window.referenceImage.visible),
				).toBe(false)
				expect(
					await page.$eval(
						".reference-image-frame",
						(frame) => getComputedStyle(frame).display,
					),
				).toBe("none")
				await page.$eval("#mostrarImagenReferencia", (input) => input.click())
				expect(
					await page.evaluate(() => window.referenceImage.visible),
				).toBe(true)

				const brokenUrl = new URL(
					"tests/smoke/fixtures/missing-reference-image.svg",
					page.url(),
				).href
				await page.evaluate((url) => window.setReferenceImage({ url }), brokenUrl)
				await page.waitForFunction(
					() => window.referenceImage?.unavailable === true,
					{ polling: 100 },
				)
				expect(
					await page.$eval(
						".reference-image-unavailable",
						(element) => ({
							text: element.textContent,
							display: getComputedStyle(element).display,
						}),
					),
				).toEqual({ text: labels.reference.unavailable, display: "block" })
				await page.evaluate((data) => window.setReferenceImage(data), dataUrl)
				await page.waitForFunction(
					() => window.referenceImage?.unavailable !== true,
					{ polling: 100 },
				)
				expect(
					await page.$eval(
						".reference-image-unavailable",
						(element) => getComputedStyle(element).display,
					),
				).toBe("none")

				await clearToasts(page)
				await page.evaluate(() => {
					const input = document.getElementById("inputUrlImagenReferencia")
					input.value = "not-a-valid-url"
					document.getElementById("btnAgregarUrlImagenReferencia").click()
				})
				let toast = await waitForToast(page)
				expect(toast.header).toContain("bg-danger")
				expect(toast.body).toBe(
					labels.reference.linkFailed(labels.reference.invalidUrl),
				)
				expect(toast.markup).toBe(0)

				await clearToasts(page)
				await page.evaluate(() => {
					const input = document.getElementById("inputImagenReferencia")
					const transfer = new DataTransfer()
					transfer.items.add(
						new File(["not an image"], "broken.png", {
							type: "image/png",
						}),
					)
					input.files = transfer.files
					input.dispatchEvent(new Event("change", { bubbles: true }))
				})
				toast = await waitForToast(page)
				expect(toast.header).toContain("bg-danger")
				expect(toast.body).toBe(
					labels.reference.uploadFailed(labels.reference.loadFailed),
				)
				expect(toast.markup).toBe(0)
				expect(
					await page.evaluate(() => window.referenceImage?.dataUrl),
				).toBe(dataUrl)

				await page.$eval("#btnEliminarImagenReferencia", (button) => button.click())
				expect(
					await page.evaluate(() => window.referenceImage),
				).toBeNull()
				expect(
					await page.$eval(
						"#btnBloquearImagenReferencia",
						(button) => button.disabled,
					),
				).toBe(true)

				// New simulation: cancellation keeps the map, confirmation clears it.
				await page.evaluate(() => {
					window.crearCalle('Unsaved <b> & "Street"', 8, window.TIPOS.CONEXION, 100, 100, 0, 0, 1)
					window.__mapConfirm = null
					window.confirm = (message) => {
						window.__mapConfirm = message
						return false
					}
				})
				await clearToasts(page)
				await page.$eval("#btnNuevaSimulacion", (button) => button.click())
				expect(await page.evaluate(() => window.__mapConfirm)).toBe(
					labels.constructor.newConfirm,
				)
				expect(
					await page.evaluate(() => window.calles.map((street) => street.nombre)),
				).toContain('Unsaved <b> & "Street"')
				expect(await page.$$eval(".toast", (elements) => elements.length)).toBe(0)

				await page.evaluate(() => {
					window.confirm = () => true
				})
				await page.$eval("#btnNuevaSimulacion", (button) => button.click())
				await page.waitForFunction(() => window.calles.length === 0)
				toast = await waitForToast(page)
				expect(toast.header).toContain("bg-success")
				expect(toast.body).toBe(labels.constructor.created)
				expect(toast.markup).toBe(0)

				// Save: translated prompt, cancellation, and a payload without
				// localization fields.
				await page.evaluate(() => {
					window.crearCalle('Saved <b> & "Street"', 8, window.TIPOS.CONEXION, 100, 100, 0, 0, 1)
					window.agregarEdificio('Saved <b> & "Building"', 250, 240, 40, 40, 0)
				})
				await clearToasts(page)
				const savedJson = await saveJson(page, 'Mapa <b> & "X"')
				expect(await page.evaluate(() => window.__mapPrompt)).toEqual({
					title: labels.constructor.savePromptTitle,
					defaultValue: labels.constructor.defaultSimulationName,
				})
				const saved = JSON.parse(savedJson)
				expect(saved.nombre).toBe('Mapa <b> & "X"')
				expect(saved.calles[0].nombre).toBe('Saved <b> & "Street"')
				expect(saved.edificios[0].label).toBe('Saved <b> & "Building"')
				for (const key of [
					"language",
					"idioma",
					"locale",
					"localization",
					"interfaceLanguage",
				]) {
					expect(saved, key).not.toHaveProperty(key)
				}
				expect(JSON.stringify(saved)).not.toContain("interfaceLanguage")
				toast = await waitForToast(page)
				expect(toast.header).toContain("bg-success")
				expect(toast.body).toBe(labels.constructor.saved('Mapa <b> & "X"'))
				expect(toast.markup).toBe(0)

				await clearToasts(page)
				await page.evaluate(() => {
					window.prompt = () => null
				})
				await page.$eval("#btnGuardarSimulacion", (button) => button.click())
				expect(await page.$$eval(".toast", (elements) => elements.length)).toBe(0)
				expect(
					await page.evaluate(() => window.calles[0].nombre),
				).toBe('Saved <b> & "Street"')

				// Load: cancellation keeps unsaved edits, confirmation replaces
				// the map, and malformed imports report an error.
				await page.evaluate(() => {
					window.calles[0].nombre = 'Edited <b> & "Street"'
				})
				await clearToasts(page)
				await importJson(page, savedJson, false)
				await page.waitForFunction(() => window.__mapConfirm !== null, {
					polling: 100,
				})
				expect(await page.evaluate(() => window.__mapConfirm)).toBe(
					labels.constructor.loadConfirm('Mapa <b> & "X"'),
				)
				expect(
					await page.evaluate(() => window.calles[0].nombre),
				).toBe('Edited <b> & "Street"')
				expect(await page.$$eval(".toast", (elements) => elements.length)).toBe(0)

				await importJson(page, savedJson, true)
				await page.waitForFunction(
					() => window.calles[0]?.nombre === 'Saved <b> & "Street"',
					{ polling: 100, timeout: 20000 },
				)
				toast = await waitForToast(page)
				expect(toast.header).toContain("bg-success")
				expect(toast.body).toBe(
					labels.constructor.loaded(
						'Mapa <b> & "X"',
						1,
						1,
						0,
					),
				)
				expect(toast.markup).toBe(0)

				await clearToasts(page)
				await importJson(page, "{", true)
				toast = await waitForToast(page)
				expect(toast.header).toContain("bg-danger")
				expect(
					toast.body.startsWith(
						labels.constructor.loadFailed(""),
					),
				).toBe(true)
				expect(toast.markup).toBe(0)

				await clearToasts(page)
				await importJson(page, "{}", true)
				toast = await waitForToast(page)
				expect(toast.header).toContain("bg-danger")
				expect(toast.body).toBe(
					labels.constructor.loadFailed(
						labels.constructor.invalidFormat,
					),
				)
				expect(toast.markup).toBe(0)
				expect(
					await page.evaluate(() => window.calles[0].nombre),
				).toBe('Saved <b> & "Street"')

				// A language-preference change never mutates saved content.
				await page.select(
					"#languagePreference",
					language === "es" ? "en" : "es",
				)
				const afterPreference = await saveJson(
					page,
					'Mapa <b> & "X"',
				)
				expect(
					JSON.parse(afterPreference).calles[0].nombre,
				).toBe('Saved <b> & "Street"')
				for (const key of ["language", "idioma", "locale"]) {
					expect(JSON.parse(afterPreference), key).not.toHaveProperty(key)
				}
				expect(simulator.pageErrors).toEqual([])
			} finally {
				await simulator.close()
			}
		}
	}, 240000)

	it("round-trips complete maps in both language directions", async () => {
		const reference = { es: null, en: null }
		let savedSpanish
		let savedEnglish
		let spanishSnapshot
		let englishSnapshot
		let returnedSnapshot

		const spanish = await openSimulator({
			usePixi,
			languagePreference: "es",
			freezeFrames: false,
		})
		try {
			if (usePixi) {
				await spanish.page.waitForFunction(
					() => Boolean(window.pixiApp?.sceneManager),
					{ timeout: 60000, polling: 100 },
				)
			}
			await hideLoadingScreen(spanish.page)
			await spanish.page.evaluate(() => {
				window.confirm = () => true
				document.getElementById("btnNuevaSimulacion").click()
			})
			await spanish.page.waitForFunction(
				() =>
					window.calles.length === 0 &&
					window.edificios.length === 0,
				{ polling: 100 },
			)
			reference.es = await buildExchangeMap(spanish.page)
			savedSpanish = await saveJson(
				spanish.page,
				'Mapa de intercambio <b> & "ES"',
			)
			await importJson(spanish.page, savedSpanish, true)
			await waitForExchangeMap(spanish.page)
			const published = JSON.parse(savedSpanish)
			for (const key of [
				"language",
				"idioma",
				"locale",
				"localization",
				"interfaceLanguage",
			]) {
				expect(published, key).not.toHaveProperty(key)
			}
			expect(published.nombre).toBe('Mapa de intercambio <b> & "ES"')
			expect(published.calles.map((street) => street.nombre)).toEqual([
				'Ruta <b> & "A"',
				'Ruta <b> & "B"',
				'Glorieta <b> & "R"',
			])
			expect(published.calles[0].laneDirections).toEqual([-1, 1])
			expect(published.calles[0].laneGenerationEnabled).toEqual([
				true,
				false,
			])
			expect(published.conexiones[0].tipo).toBe("LINEAL")
			expect(published.edificios[1].imageData).toMatch(
				/^data:image\/png;base64,/,
			)
			expect(published.edificios[2]).toMatchObject({
				label: "ESCOM",
				imagen: "escom",
				canvasImageKey: "ESCOM",
			})
			expect(published.imagenReferencia.dataUrl).toBe(reference.es)
			spanishSnapshot = await readSnapshot(spanish.page)
			spanishSnapshot.language = "shared"
		} finally {
			await spanish.close()
		}

		const english = await openSimulator({
			usePixi,
			languagePreference: "en",
			freezeFrames: false,
		})
		try {
			if (usePixi) {
				await english.page.waitForFunction(
					() => Boolean(window.pixiApp?.sceneManager),
					{ timeout: 60000, polling: 100 },
				)
			}
			await hideLoadingScreen(english.page)
			await importJson(english.page, savedSpanish, true)
			await waitForExchangeMap(english.page)
			englishSnapshot = await readSnapshot(english.page)
			expect(englishSnapshot.language).toBe("en")
			expect(
				await english.page.$eval(
					'#collapseConstructor h6[data-i18n="mapConstructor.title"]',
					(element) => element.textContent.trim(),
				),
			).toBe(copy.en.constructor.title)
			englishSnapshot.language = "shared"
			expect(englishSnapshot).toEqual(spanishSnapshot)
			savedEnglish = await saveJson(
				english.page,
				'Exchange map <b> & "EN"',
			)
			expect(
				JSON.parse(savedEnglish).calles.map(
					(street) => street.nombre,
				),
			).toEqual(spanishSnapshot.streets.map((street) => street.name))
			expect(JSON.parse(savedEnglish).nombre).toBe(
				'Exchange map <b> & "EN"',
			)
			for (const key of [
				"language",
				"idioma",
				"locale",
				"localization",
				"interfaceLanguage",
			]) {
				expect(JSON.parse(savedEnglish), key).not.toHaveProperty(key)
			}
			expect(english.pageErrors).toEqual([])
		} finally {
			await english.close()
		}

		const returned = await openSimulator({
			usePixi,
			languagePreference: "es",
			freezeFrames: false,
		})
		try {
			if (usePixi) {
				await returned.page.waitForFunction(
					() => Boolean(window.pixiApp?.sceneManager),
					{ timeout: 60000, polling: 100 },
				)
			}
			await hideLoadingScreen(returned.page)
			await importJson(returned.page, savedEnglish, true)
			await waitForExchangeMap(returned.page)
			returnedSnapshot = await readSnapshot(returned.page)
			expect(returnedSnapshot.language).toBe("es")
			returnedSnapshot.language = "shared"
			expect(returnedSnapshot).toEqual(spanishSnapshot)
			expect(returned.pageErrors).toEqual([])
		} finally {
			await returned.close()
		}
	}, 240000)

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one layout sweep covers every viewport/theme combination.
	it("keeps constructor and reference controls reachable in English at mobile and desktop sizes in both themes", async () => {
		const simulator = await openSimulator({
			languagePreference: "en",
			usePixi,
			freezeFrames: false,
		})
		try {
			const { page } = simulator
			if (usePixi) {
				await page.waitForFunction(
					() => Boolean(window.pixiApp?.sceneManager),
					{ timeout: 60000, polling: 100 },
				)
			}
			await hideLoadingScreen(page)
			await page.evaluate(
				(data) => window.setReferenceImage(data),
				await referenceDataUrl(page),
			)
			await page.waitForFunction(
				() => window.referenceImage?.image?.complete,
				{ polling: 100 },
			)
			await page.select("#labelVisibility", "both")

			for (const viewport of [
				{ width: 390, height: 844 },
				{ width: 1440, height: 900 },
			]) {
				await page.setViewport(viewport)
				for (const theme of ["light", "dark"]) {
					if (theme === "dark") {
						await page.click("#switchModoOscuro")
						await page.waitForFunction(
							() => document.body.classList.contains("dark-mode"),
							{ polling: 100 },
						)
					} else if (
						await page.evaluate(() =>
							document.body.classList.contains("dark-mode"),
						)
					) {
						await page.click("#switchModoOscuro")
						await page.waitForFunction(
							() => !document.body.classList.contains("dark-mode"),
							{ polling: 100 },
						)
					}
					await openAccordion(page, "#collapseConstructor")
					const constructorLayout = await page.evaluate(() => {
						const selectors = [
							"#btnNuevaSimulacion",
							"#btnGuardarSimulacion",
							"#btnCargarSimulacion",
							'label[for="inputImagenReferencia"]',
							"#inputUrlImagenReferencia",
							"#btnAgregarUrlImagenReferencia",
							"#btnEliminarImagenReferencia",
							"#btnBloquearImagenReferencia",
							"#mostrarImagenReferencia",
							"#opacidadImagenReferencia",
						]
						const fitting = selectors.map((selector) => {
							const element = document.querySelector(selector)
							const rect = element.getBoundingClientRect()
							const style = getComputedStyle(element)
							return {
								fit:
									style.display !== "none" &&
									style.visibility !== "hidden" &&
									rect.width > 0 &&
									rect.height > 0 &&
									rect.left >= -1 &&
									rect.right <= window.innerWidth + 1,
								readable:
									style.color !== "rgba(0, 0, 0, 0)" &&
									style.color !== "transparent",
							}
						})
						return {
							fitting,
							overflow:
								document.documentElement.scrollWidth -
								window.innerWidth,
							labels: {
								newSimulation: document
									.getElementById("btnNuevaSimulacion")
									.textContent.trim(),
								lock: document
									.getElementById("btnBloquearImagenReferencia")
									.textContent.trim(),
								rotate: document
									.querySelector(".reference-image-rotate")
									.getAttribute("aria-label"),
							},
						}
					})
					await openAccordion(page, "#collapseMapDrawingTools")
					const toolsLayout = await page.evaluate(() => {
						const selectors = ["#labelVisibility", "#labelFontSize"]
						const fitting = selectors.map((selector) => {
							const element = document.querySelector(selector)
							const rect = element.getBoundingClientRect()
							const style = getComputedStyle(element)
							return {
								fit:
									style.display !== "none" &&
									style.visibility !== "hidden" &&
									rect.width > 0 &&
									rect.height > 0 &&
									rect.left >= -1 &&
									rect.right <= window.innerWidth + 1,
								readable:
									style.color !== "rgba(0, 0, 0, 0)" &&
									style.color !== "transparent",
							}
						})
						return {
							fitting,
							overflow:
								document.documentElement.scrollWidth -
								window.innerWidth,
							labelAria: document
								.getElementById("labelVisibility")
								.getAttribute("aria-label"),
						}
					})
					expect(
						[...constructorLayout.fitting, ...toolsLayout.fitting].every(
							(item) => item.fit,
						),
					).toBe(true)
					expect(
						[...constructorLayout.fitting, ...toolsLayout.fitting].every(
							(item) => item.readable,
						),
					).toBe(true)
					expect(constructorLayout.overflow).toBeLessThanOrEqual(1)
					expect(toolsLayout.overflow).toBeLessThanOrEqual(1)
					expect(constructorLayout.labels).toEqual({
						newSimulation: copy.en.constructor.newSimulation,
						lock: copy.en.reference.lock,
						rotate: copy.en.reference.rotate,
					})
					expect(toolsLayout.labelAria).toBe(copy.en.labels.title)
				}
			}
			expect(simulator.pageErrors).toEqual([])
		} finally {
			await simulator.close()
		}
	}, 180000)
})
