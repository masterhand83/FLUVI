import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
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

const fill = (page, selector, value) =>
	page.$eval(
		selector,
		(element, next) => {
			element.value = String(next)
			element.dispatchEvent(new Event("input", { bubbles: true }))
			element.dispatchEvent(new Event("change", { bubbles: true }))
		},
		value,
	)

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

const canvasBox = (page) =>
	page.$eval("#simuladorCanvas", (canvas) => {
		const rect = canvas.getBoundingClientRect()
		return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
	})

const screenPoint = async (page, u, v) => {
	const box = await canvasBox(page)
	return { x: box.x + box.width * u, y: box.y + box.height * v }
}

const dragBuilding = async (page, from, to) => {
	await page.mouse.move(from.x, from.y)
	await page.mouse.down()
	await page.mouse.move(to.x, to.y, { steps: 5 })
	await page.mouse.up()
}

const selectBuilding = (page, index) =>
	page.evaluate((index) => {
		const building = window.edificios[index]
		window.edificioSeleccionado = building
		window.buildingInspector.show(building)
	}, index)

const chooseFile = async (page, selector, path) => {
	const button = await page.waitForSelector(selector, { visible: true, timeout: 5000 })
	const chooser = page.waitForFileChooser({ timeout: 5000 })
	try {
		await button.click()
	} catch (error) {
		await chooser.catch(() => {})
		throw error
	}
	await (await chooser).accept([path])
}

const makeFixtures = async (page, directory) => {
	const files = {}
	for (const [name, mime, width, height, color] of [
		["artwork", "image/png", 240, 120, "#12dc83"],
		["replacement", "image/png", 60, 240, "#e82d63"],
	]) {
		const data = await page.evaluate(
			({ mime, width, height, color }) => {
				const canvas = document.createElement("canvas")
				canvas.width = width
				canvas.height = height
				const context = canvas.getContext("2d")
				context.fillStyle = color
				context.fillRect(0, 0, width, height)
				return canvas.toDataURL(mime, 1)
			},
			{ mime, width, height, color },
		)
		files[name] = join(directory, `${name}.png`)
		await writeFile(files[name], Buffer.from(data.split(",")[1], "base64"))
	}
	files.unsupported = join(directory, "unsupported.svg")
	await writeFile(
		files.unsupported,
		'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="green"/></svg>',
	)
	files.corrupt = join(directory, "corrupt.png")
	await writeFile(files.corrupt, "not a decodable PNG")
	return files
}

const copy = {
	en: {
		rectangle: "▭ Building",
		rectangleTooltip: "Drag two corners to create a rectangular building",
		square: "Square",
		polygon: "⬠ Polygon",
		polygonTooltip: "Place vertices on the map; close the polygon to finish",
		imageButton: "🖼️ Building with image",
		imageHelp:
			"PNG, JPEG, or WebP, up to 5 MB. Then click the building's center.",
		cancelImage: "Cancel image",
		inspectorName: "Name",
		fieldLabels: ["X", "Y", "Width", "Height", "Angle (°)", "Color"],
		palette: "Building color",
		colors: ["Brown", "Gray", "Blue", "Sky", "Green", "Legacy brown"],
		close: "Close the building inspector",
		replaceImage: "Replace image",
		deleteBuilding: "Delete building",
		defaultName: "Building {{number}}",
		handles: ["Move building", "Resize building", "Rotate building"],
		vertexHandle: "Move building vertex",
		draw: {
			placeVertices: "Place vertices on the map.",
			finish: "Close / finish",
			cancel: "Cancel",
			minimumVertices: "At least three vertices are required.",
			vertices3:
				"3 vertices. Click the first one or «Close / finish».",
			vertices4:
				"4 vertices. Click the first one or «Close / finish».",
			placeImage: "Click the center of the image building.",
		},
		image: {
			reading: "Checking image…",
			ready: "Image ready. Click its center on the map; Escape cancels.",
			created: "Image building created.",
			replaced: "Image replaced.",
		},
		errors: {
			nameRequired: "The name cannot be empty.",
			invalidNumber: "Enter a valid number.",
			sizePositive: "The size must be greater than zero.",
			imageFormat: "Unsupported format. Use PNG, JPEG, or WebP.",
			imageRead:
				"The image could not be read. Choose a valid PNG, JPEG, or WebP.",
			polygonZeroArea: "The polygon must enclose an area greater than zero.",
			polygonSelfIntersection: "The polygon cannot cross itself.",
			invalidDrag: "Drag a valid area to create the building.",
		},
		noSelection: "No building is selected.",
		legacy: {
			titleNew: "🏢 Add New Building",
			titleEdit: "✏️ Edit Building",
			basicInfo: "📋 Basic Information",
			name: "Name:",
			namePlaceholder: "e.g., Central Building",
			positionX: "X position:",
			positionY: "Y position:",
			width: "Width:",
			height: "Height:",
			angle: "Angle (°):",
			cancel: "✖ Cancel",
			create: "✓ Create Building",
			update: "✓ Update Building",
			nameRequired: "The name is required.",
		},
		deleteConfirm: (name) => `Delete the building "${name}"?`,
		deletedToast: (name) => `Building "${name}" deleted successfully.`,
		updatedToast: (name) => `Building "${name}" updated successfully.`,
	},
	es: {
		rectangle: "▭ Edificio",
		rectangleTooltip: "Arrastra dos esquinas para crear un edificio rectangular",
		square: "Cuadrado",
		polygon: "⬠ Polígono",
		polygonTooltip:
			"Coloca vértices en el mapa; cierra el polígono para terminar",
		imageButton: "🖼️ Edificio con imagen",
		imageHelp:
			"PNG, JPEG o WebP, hasta 5 MB. Después, haz clic en el centro del edificio.",
		cancelImage: "Cancelar imagen",
		inspectorName: "Nombre",
		fieldLabels: ["X", "Y", "Ancho", "Alto", "Ángulo (°)", "Color"],
		palette: "Color del edificio",
		colors: ["Café", "Gris", "Azul", "Cielo", "Verde", "Café heredado"],
		close: "Cerrar el inspector de edificio",
		replaceImage: "Reemplazar imagen",
		deleteBuilding: "Eliminar edificio",
		defaultName: "Edificio {{number}}",
		handles: ["Mover edificio", "Cambiar tamaño del edificio", "Girar edificio"],
		vertexHandle: "Mover vértice del edificio",
		draw: {
			placeVertices: "Coloca vértices en el mapa.",
			finish: "Cerrar / terminar",
			cancel: "Cancelar",
			minimumVertices: "Se necesitan al menos tres vértices.",
			vertices3:
				"3 vértices. Haz clic en el primero o en «Cerrar / terminar».",
			vertices4:
				"4 vértices. Haz clic en el primero o en «Cerrar / terminar».",
			placeImage: "Haz clic en el centro del edificio con imagen.",
		},
		image: {
			reading: "Comprobando imagen…",
			ready: "Imagen lista. Haz clic en su centro en el mapa; Escape cancela.",
			created: "Edificio con imagen creado.",
			replaced: "Imagen reemplazada.",
		},
		errors: {
			nameRequired: "El nombre no puede estar vacío.",
			invalidNumber: "Introduce un número válido.",
			sizePositive: "El tamaño debe ser mayor que cero.",
			imageFormat: "Formato no admitido. Usa PNG, JPEG o WebP.",
			imageRead:
				"No se pudo leer la imagen. Elige un PNG, JPEG o WebP válido.",
			polygonZeroArea: "El polígono debe encerrar un área mayor que cero.",
			polygonSelfIntersection: "El polígono no puede cruzarse a sí mismo.",
			invalidDrag: "Arrastra un área válida para crear el edificio.",
		},
		noSelection: "No hay ningún edificio seleccionado.",
		legacy: {
			titleNew: "🏢 Agregar Nuevo Edificio",
			titleEdit: "✏️ Editar Edificio",
			basicInfo: "📋 Información Básica",
			name: "Nombre:",
			namePlaceholder: "Ej: Edificio Central",
			positionX: "Posición X:",
			positionY: "Posición Y:",
			width: "Ancho:",
			height: "Alto:",
			angle: "Ángulo (°):",
			cancel: "✖ Cancelar",
			create: "✓ Crear Edificio",
			update: "✓ Actualizar Edificio",
			nameRequired: "El nombre es obligatorio.",
		},
		deleteConfirm: (name) => `¿Eliminar el edificio «${name}»?`,
		deletedToast: (name) => `Edificio «${name}» eliminado correctamente.`,
		updatedToast: (name) => `Edificio «${name}» actualizado correctamente.`,
	},
}

const safePoint = async (page, u, v) => {
	const point = await screenPoint(page, u, v)
	const usable = await page.evaluate(({ x, y }) => {
		const canvas = document.getElementById("simuladorCanvas")
		const hit = document.elementFromPoint(x, y)
		if (hit !== canvas) return false
		const rect = canvas.getBoundingClientRect()
		const world = window.USE_PIXI
			? window.pixiApp.cameraController.screenToWorld(
					((x - rect.left) * window.pixiApp.app.screen.width) / rect.width,
					((y - rect.top) * window.pixiApp.app.screen.height) / rect.height,
				)
			: {
					x:
						(((x - rect.left) * canvas.width) / rect.width - window.offsetX) /
						window.escala,
					y:
						(((y - rect.top) * canvas.height) / rect.height - window.offsetY) /
						window.escala,
				}
		return (
			!window.encontrarCalleEnPunto(world.x, world.y) &&
			!window.encontrarEdificioEnPunto(world.x, world.y)
		)
	}, point)
	return usable ? point : null
}

const firstSafe = async (page, candidates) => {
	for (const [u, v] of candidates) {
		const point = await safePoint(page, u, v)
		if (point) return point
	}
	throw new Error("No free map area available for the building workflow")
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One end-to-end browser workflow exercises the shared building appearance state.
const runBuildingWorkflow = async ({ page, language, usePixi, fixtures }) => {
	const labels = copy[language]
	await hideLoadingScreen(page)
	await clearToasts(page)

	await openAccordion(page, "#collapseMapDrawingTools")
	const drawing = await page.evaluate(() => {
		const text = (id) => document.getElementById(id).textContent.trim()
		return {
			rectangle: text("drawBuildingButton"),
			rectangleTooltip: document
				.getElementById("drawBuildingButton")
				.getAttribute("data-bs-title"),
			square: document
				.querySelector(".building-proportion-lock")
				.textContent.trim(),
			polygon: text("drawPolygonBuildingButton"),
			polygonTooltip: document
				.getElementById("drawPolygonBuildingButton")
				.getAttribute("data-bs-title"),
			image: text("uploadBuildingImageButton"),
			imageHelpKey: document
				.getElementById("buildingImageStatus")
				.getAttribute("data-i18n"),
			imageHelp: window.fluviI18n.t(
				document
					.getElementById("buildingImageStatus")
					.getAttribute("data-i18n"),
			),
			cancelImage: text("buildingImageCancel"),
		}
	})
	expect(drawing).toEqual({
		rectangle: labels.rectangle,
		rectangleTooltip: labels.rectangleTooltip,
		square: labels.square,
		polygon: labels.polygon,
		polygonTooltip: labels.polygonTooltip,
		image: labels.imageButton,
		imageHelp: labels.imageHelp,
		imageHelpKey: "buildingDrawing.imageHelp",
		cancelImage: labels.cancelImage,
	})

	// Rectangular building: gesture, immediate inspector, palette and handles.
	await page.click("#drawBuildingButton")
	expect(await page.evaluate(() => window.drawBuildingTool.isActive())).toBe(true)
	await page.keyboard.press("Escape")
	expect(await page.evaluate(() => window.drawBuildingTool.isActive())).toBe(false)
	expect(await page.evaluate(() => window.edificios.length)).toBe(0)

	await page.click("#drawBuildingButton")
	const rectStart = await firstSafe(page, [
		[0.45, 0.3],
		[0.5, 0.3],
		[0.4, 0.25],
	])
	await dragBuilding(page, rectStart, { x: rectStart.x + 90, y: rectStart.y + 55 })
	await page.waitForFunction(() => window.edificios.length === 1, {
		timeout: 5000,
	})
	await page.waitForFunction(
		() => document.getElementById("buildingInspector").hidden === false,
	)

	const inspector = await page.evaluate(() => ({
		label: document.getElementById("buildingInspector").getAttribute("aria-label"),
		name: document
			.querySelector("#buildingInspector .street-inspector-field")
			.firstChild.textContent.trim(),
		fields: [
			...document.querySelectorAll(
				"#buildingInspector .street-inspector-details dt",
			),
		].map((element) => element.textContent.trim()),
		palette: document
			.getElementById("buildingColorPalette")
			.getAttribute("aria-label"),
		colors: [...document.querySelectorAll('[name="buildingColor"]')].map(
			(element) => ({
				title: element.getAttribute("title"),
				label: element.getAttribute("aria-label"),
			}),
		),
		close: document
			.getElementById("buildingInspectorClose")
			.getAttribute("aria-label"),
		replace: document
			.getElementById("buildingInspectorReplaceImage")
			.textContent.trim(),
		deleteBuilding: document
			.getElementById("buildingInspectorDeleteBuilding")
			.textContent.trim(),
		handles: [...document.querySelectorAll(".building-map-handle")]
			.filter((handle) => !handle.hidden)
			.map((handle) => handle.getAttribute("aria-label")),
		defaultName: window.edificios[0].label,
		mode: window.edificios[0].appearanceMode,
	}))

	expect(inspector.label).toBe(
		language === "en" ? "Building inspector" : "Inspector de edificio",
	)
	expect(inspector.name).toBe(labels.inspectorName)
	expect(inspector.fields).toEqual(labels.fieldLabels)
	expect(inspector.palette).toBe(labels.palette)
	expect(inspector.colors.map((color) => color.title)).toEqual(labels.colors)
	expect(inspector.colors.map((color) => color.label)).toEqual(labels.colors)
	expect(inspector.close).toBe(labels.close)
	expect(inspector.replace).toBe(labels.replaceImage)
	expect(inspector.deleteBuilding).toBe(labels.deleteBuilding)
	expect(inspector.handles).toEqual(labels.handles)
	expect(inspector.mode).toBe("rectangular")
	expect(inspector.defaultName).toBe(
		labels.defaultName.replace("{{number}}", "1"),
	)

	await fill(page, "#buildingInspectorName", "")
	expect(
		await page.$eval("#buildingInspectorError", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.errors.nameRequired)
	expect(
		await page.$eval("#buildingInspectorName", (element) =>
			element.getAttribute("aria-invalid"),
		),
	).toBe("true")
	await fill(page, "#buildingInspectorWidth", "0")
	expect(
		await page.$eval("#buildingInspectorError", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.errors.sizePositive)
	await fill(page, "#buildingInspectorWidth", "130")

	const safeRectangleName = 'Tower <b> & "A"'
	await fill(page, "#buildingInspectorName", safeRectangleName)
	await page.click('[name="buildingColor"][value="#1F4E9E"]')
	await fill(page, "#buildingInspectorWidth", "130")
	await fill(page, "#buildingInspectorHeight", "75")
	await fill(page, "#buildingInspectorAngle", "18")
	expect(
		await page.evaluate(() => {
			const building = window.edificios[0]
			return {
				label: building.label,
				color: building.color,
				width: building.width,
				height: building.height,
				angle: building.angle,
				selector: [
					...document.getElementById("selectEdificio").options,
				].find((option) => option.textContent === building.label)?.textContent,
			}
		}),
	).toEqual({
		label: safeRectangleName,
		color: "#1F4E9E",
		width: 130,
		height: 75,
		angle: 18,
		selector: safeRectangleName,
	})

	// Legacy modal creation and editing use translated appearance controls.
	await page.evaluate(() => window.mostrarDialogoNuevoEdificio())
	await page.waitForSelector("#modalNuevoEdificio.show", { visible: true })
	await new Promise((resolve) => setTimeout(resolve, 600))
	const modal = await page.evaluate(() => ({
		title: document.getElementById("modalNuevoEdificioLabel").textContent.trim(),
		basicInfo: document
			.querySelector("#modalNuevoEdificio .modal-body h6")
			.textContent.trim(),
		name: document
			.querySelector('label[for="inputNombreEdificio"]')
			.textContent.trim(),
		placeholder: document
			.getElementById("inputNombreEdificio")
			.getAttribute("placeholder"),
		positionX: document
			.querySelector('label[for="inputXEdificio"]')
			.textContent.trim(),
		positionY: document
			.querySelector('label[for="inputYEdificio"]')
			.textContent.trim(),
		width: document
			.querySelector('label[for="inputWidthEdificio"]')
			.textContent.trim(),
		height: document
			.querySelector('label[for="inputHeightEdificio"]')
			.textContent.trim(),
		angle: document
			.querySelector('label[for="inputAnguloEdificio"]')
			.textContent.trim(),
		cancel: document
			.querySelector("#modalNuevoEdificio .modal-footer .btn-secondary")
			.textContent.trim(),
		create: document
			.getElementById("btnConfirmarNuevoEdificio")
			.textContent.trim(),
		close: document
			.querySelector("#modalNuevoEdificio .btn-close")
			.getAttribute("aria-label"),
	}))
	expect(modal).toEqual({
		title: labels.legacy.titleNew,
		basicInfo: labels.legacy.basicInfo,
		name: labels.legacy.name,
		placeholder: labels.legacy.namePlaceholder,
		positionX: labels.legacy.positionX,
		positionY: labels.legacy.positionY,
		width: labels.legacy.width,
		height: labels.legacy.height,
		angle: labels.legacy.angle,
		cancel: labels.legacy.cancel,
		create: labels.legacy.create,
		close: language === "en" ? "Close" : "Cerrar",
	})
	await clearToasts(page)
	await page.click("#btnConfirmarNuevoEdificio")
	let toast = await waitForToast(page)
	expect(toast.header).toContain("bg-danger")
	expect(toast.title).toContain("Error")
	expect(toast.body).toBe(labels.legacy.nameRequired)

	const legacyName = 'Legacy <b> & "Annex"'
	await fill(page, "#inputNombreEdificio", legacyName)
	await fill(page, "#inputXEdificio", "620")
	await fill(page, "#inputYEdificio", "620")
	await fill(page, "#inputWidthEdificio", "80")
	await fill(page, "#inputHeightEdificio", "45")
	await fill(page, "#inputAnguloEdificio", "0")
	await page.click("#btnConfirmarNuevoEdificio")
	await page.waitForFunction(
		(name) => window.edificios.some((building) => building.label === name),
		{ timeout: 5000 },
		legacyName,
	)
	await page.waitForSelector("#modalNuevoEdificio", { hidden: true })
	await page.waitForFunction(
		() => !document.querySelector(".modal-backdrop"),
		{ polling: 100 },
	)
	expect(
		await page.evaluate(() => ({
			count: window.edificios.length,
			label: window.edificios.at(-1).label,
			x: window.edificios.at(-1).x,
			width: window.edificios.at(-1).width,
		})),
	).toEqual({ count: 2, label: legacyName, x: 620, width: 80 })

	await clearToasts(page)
	await page.evaluate((name) => {
		const index = window.edificios.findIndex(
			(building) => building.label === name,
		)
		window.edificioSeleccionado = window.edificios[index]
		window.editarEdificioSeleccionado()
	}, legacyName)
	await page.waitForSelector("#modalNuevoEdificio.show", { visible: true })
	await new Promise((resolve) => setTimeout(resolve, 600))
	const editModal = await page.evaluate(() => ({
		title: document.getElementById("modalNuevoEdificioLabel").textContent.trim(),
		update: document
			.getElementById("btnConfirmarNuevoEdificio")
			.textContent.trim(),
	}))
	expect(editModal).toEqual({
		title: labels.legacy.titleEdit,
		update: labels.legacy.update,
	})
	const updatedLegacyName = 'Legacy <b> & "Annex" updated'
	await fill(page, "#inputNombreEdificio", updatedLegacyName)
	await page.click("#btnConfirmarNuevoEdificio")
	toast = await waitForToast(page)
	expect(toast.header).toContain("bg-success")
	expect(toast.body).toBe(labels.updatedToast(updatedLegacyName))
	expect(toast.markup).toBe(0)
	expect(
		await page.evaluate((name) =>
			window.edificios.some((building) => building.label === name), updatedLegacyName),
	).toBe(true)
	await page.waitForSelector("#modalNuevoEdificio", { hidden: true })
	await page.waitForFunction(
		() => !document.querySelector(".modal-backdrop"),
		{ polling: 100 },
	)
	await clearToasts(page)
	await page.evaluate(() => {
		window.edificioSeleccionado = null
		window.editarEdificioSeleccionado()
	})
	toast = await waitForToast(page)
	expect(toast.header).toContain("bg-warning")
	expect(toast.body).toBe(labels.noSelection)
	expect(toast.markup).toBe(0)

	// Polygonal building: cancellation, invalid geometry feedback, then a valid shape.
	await clearToasts(page)
	await page.click("#drawPolygonBuildingButton")
	expect(await page.evaluate(() => window.drawBuildingTool.isActive())).toBe(true)
	await page.keyboard.press("Escape")
	expect(await page.evaluate(() => window.drawBuildingTool.isActive())).toBe(false)

	await page.click("#drawPolygonBuildingButton")
	expect(
		await page.$eval("#buildingDrawStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.draw.placeVertices)
	expect(
		await page.$eval("#buildingDrawFinish", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.draw.finish)
	expect(
		await page.$eval("#buildingDrawCancel", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.draw.cancel)
	const collinear = []
	for (const v of [0.14, 0.2, 0.45, 0.55]) {
		for (const u of [0.55, 0.63, 0.71, 0.79]) {
			const point = await safePoint(page, u, v)
			if (point) collinear.push(point)
			if (collinear.length === 3) break
		}
		if (collinear.length === 3) break
		collinear.length = 0
	}
	expect(collinear).toHaveLength(3)
	for (const point of collinear) await page.mouse.click(point.x, point.y)
	expect(
		await page.$eval("#buildingDrawStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.draw.vertices3)
	await page.click("#buildingDrawFinish")
	expect(
		await page.$eval("#buildingDrawStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.errors.polygonZeroArea)
	expect(await page.evaluate(() => window.edificios.length)).toBe(2)
	await page.click("#buildingDrawCancel")
	expect(await page.evaluate(() => window.drawBuildingTool.isActive())).toBe(false)

	await page.click("#drawPolygonBuildingButton")
	let crossing = null
	for (const [u, v] of [
		[0.5, 0.45],
		[0.55, 0.4],
		[0.6, 0.45],
	]) {
		const points = [
			await safePoint(page, u, v),
			await safePoint(page, u + 0.12, v),
			await safePoint(page, u + 0.03, v + 0.1),
			await safePoint(page, u + 0.22, v + 0.1),
		]
		if (points.every(Boolean)) {
			crossing = [points[0], points[1], points[2], points[3]]
			break
		}
	}
	expect(crossing).not.toBeNull()
	for (const point of crossing) await page.mouse.click(point.x, point.y)
	expect(
		await page.$eval("#buildingDrawStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.draw.vertices4)
	await page.click("#buildingDrawFinish")
	expect(
		await page.$eval("#buildingDrawStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.errors.polygonSelfIntersection)
	expect(await page.evaluate(() => window.edificios.length)).toBe(2)
	await page.click("#buildingDrawCancel")
	expect(await page.evaluate(() => window.drawBuildingTool.isActive())).toBe(false)

	await page.click("#drawPolygonBuildingButton")
	const polygonPoints = [
		await firstSafe(page, [[0.72, 0.24], [0.7, 0.22]]),
		await firstSafe(page, [[0.8, 0.24], [0.78, 0.22]]),
		await firstSafe(page, [[0.8, 0.32], [0.78, 0.3]]),
		await firstSafe(page, [[0.72, 0.32], [0.7, 0.3]]),
	]
	for (const point of polygonPoints) await page.mouse.click(point.x, point.y)
	expect(
		await page.$eval("#buildingDrawStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.draw.vertices4)
	await page.click("#buildingDrawFinish")
	await page.waitForFunction(() => window.edificios.length === 3)
	const polygon = await page.evaluate(() => ({
		mode: window.edificios[2].appearanceMode,
		geometry: window.edificios[2].geometryType,
		vertices: window.edificios[2].vertices.length,
		selected: window.edificioSeleccionado === window.edificios[2],
		vertexHandles: [
			...document.querySelectorAll(".building-vertex-handle:not([hidden])"),
		].map((handle) => handle.getAttribute("aria-label")),
		visibleHandles: [...document.querySelectorAll(".building-map-handle")]
			.filter((handle) => !handle.hidden)
			.map((handle) => handle.getAttribute("aria-label")),
	}))
	expect(polygon).toEqual({
		mode: "polygon",
		geometry: "polygon",
		vertices: 4,
		selected: true,
		vertexHandles: Array(4).fill(labels.vertexHandle),
		visibleHandles: [
			labels.handles[0],
			labels.handles[2],
			...Array(4).fill(labels.vertexHandle),
		],
	})
	await fill(page, "#buildingInspectorName", "Polygon <b> & \"A\"")
	expect(
		await page.evaluate(() => window.edificios[2].label),
	).toBe('Polygon <b> & "A"')

	// Uploaded artwork: validation, cancellation, placement, replacement and
	// model preservation with renderer-owned hover text.
	await clearToasts(page)
	await chooseFile(page, "#uploadBuildingImageButton", fixtures.unsupported)
	await page.waitForFunction(
		(expected) =>
			document.getElementById("buildingImageStatus").textContent.trim() ===
			expected,
		{ timeout: 5000 },
		labels.errors.imageFormat,
	)
	expect(await page.evaluate(() => window.drawBuildingTool.isActive())).toBe(false)
	await chooseFile(page, "#uploadBuildingImageButton", fixtures.corrupt)
	await page.waitForFunction(
		(expected) =>
			document.getElementById("buildingImageStatus").textContent.trim() ===
			expected,
		{ timeout: 5000 },
		labels.errors.imageRead,
	)
	expect(await page.evaluate(() => window.drawBuildingTool.isActive())).toBe(false)
	expect(await page.evaluate(() => window.edificios.length)).toBe(3)

	await chooseFile(page, "#uploadBuildingImageButton", fixtures.artwork)
	await page.waitForFunction(() => window.drawBuildingTool.isActive(), {
		timeout: 5000,
	})
	expect(
		await page.$eval("#buildingImageStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.image.ready)
	expect(
		await page.$eval("#buildingImageCancel", (element) => ({
			hidden: element.hidden,
			text: element.textContent.trim(),
		})),
	).toEqual({ hidden: false, text: labels.cancelImage })
	await page.click("#buildingImageCancel")
	expect(await page.evaluate(() => window.drawBuildingTool.isActive())).toBe(false)
	expect(
		await page.$eval("#buildingImageStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe("")

	await chooseFile(page, "#uploadBuildingImageButton", fixtures.artwork)
	await page.waitForFunction(() => window.drawBuildingTool.isActive(), {
		timeout: 5000,
	})
	const imagePoint = await firstSafe(page, [
		[0.84, 0.62],
		[0.8, 0.65],
		[0.88, 0.55],
	])
	await page.mouse.click(imagePoint.x, imagePoint.y)
	await page.waitForFunction(() => window.edificios.length === 4, {
		timeout: 5000,
	})
	const uploaded = await page.evaluate(() => {
		const building = window.edificios[3]
		return {
			mode: building.appearanceMode,
			label: building.label,
			data: building.imageData,
			naturalWidth: building.imageElement?.naturalWidth,
			naturalHeight: building.imageElement?.naturalHeight,
			width: building.width,
			height: building.height,
			status: document.getElementById("buildingImageStatus").textContent.trim(),
			selected: window.edificioSeleccionado === building,
		}
	})
	expect(uploaded).toMatchObject({
		mode: "uploaded-image",
		naturalWidth: 240,
		naturalHeight: 120,
		status: labels.image.created,
		selected: true,
	})
	expect(uploaded.data.startsWith("data:image/png;base64,")).toBe(true)
	expect(uploaded.width / uploaded.height).toBeCloseTo(2, 5)
	expect(uploaded.label).toBe(labels.defaultName.replace("{{number}}", "1"))

	await fill(page, "#buildingInspectorName", 'Artwork <b> & "A"')
	await fill(page, "#buildingInspectorAngle", "27")
	const beforeReplacement = await page.evaluate(() => {
		const building = window.edificios[3]
		return {
			x: building.x,
			y: building.y,
			angle: building.angle,
			label: building.label,
			data: building.imageData,
		}
	})
	await chooseFile(page, "#buildingInspectorReplaceImage", fixtures.replacement)
	await page.waitForFunction(
		(expected) =>
			document.getElementById("buildingInspectorImageStatus").textContent
				.trim() === expected,
		{ timeout: 5000 },
		labels.image.replaced,
	)
	const replaced = await page.evaluate(() => {
		const building = window.edificios[3]
		return {
			x: building.x,
			y: building.y,
			angle: building.angle,
			label: building.label,
			data: building.imageData,
			naturalWidth: building.imageElement?.naturalWidth,
			naturalHeight: building.imageElement?.naturalHeight,
			width: building.width,
			height: building.height,
		}
	})
	expect(replaced).toMatchObject({
		x: beforeReplacement.x,
		y: beforeReplacement.y,
		angle: 27,
		label: 'Artwork <b> & "A"',
		naturalWidth: 60,
		naturalHeight: 240,
	})
	expect(replaced.data).not.toBe(beforeReplacement.data)
	expect(replaced.width / replaced.height).toBeCloseTo(0.25, 5)

	for (const invalid of [fixtures.unsupported, fixtures.corrupt]) {
		await chooseFile(page, "#buildingInspectorReplaceImage", invalid)
		await page.waitForFunction(
			(expected) =>
				document.getElementById("buildingInspectorImageStatus").textContent
					.trim() === expected,
			{ timeout: 5000 },
			invalid === fixtures.unsupported
				? labels.errors.imageFormat
				: labels.errors.imageRead,
		)
		expect(
			await page.evaluate(() => {
				const building = window.edificios[3]
				return {
					data: building.imageData,
					x: building.x,
					y: building.y,
					angle: building.angle,
					width: building.width,
					height: building.height,
				}
			}),
		).toEqual({
			data: replaced.data,
			x: replaced.x,
			y: replaced.y,
			angle: replaced.angle,
			width: replaced.width,
			height: replaced.height,
		})
	}

	const hover = await page.evaluate(() => {
		const building = window.edificios[3]
		if (window.USE_PIXI) {
			const sprite =
				window.pixiApp.sceneManager.edificioSprites.get(building)
			sprite.emit("pointerover")
			return document.getElementById("canvasTooltip").textContent
		}
		return null
	})
	if (usePixi) {
		expect(hover).toBe('Artwork <b> & "A"')
		await page.evaluate(() => {
			const sprite = window.pixiApp.sceneManager.edificioSprites.get(
				window.edificios[3],
			)
			sprite.emit("pointerout")
		})
	} else {
		const title = await page.evaluate(() => {
			const building = window.edificios[3]
			const canvas = document.getElementById("simuladorCanvas")
			const rect = canvas.getBoundingClientRect()
			const angle = (building.angle * Math.PI) / 180
			const worldX =
				building.x + building.width * 0.25 * Math.cos(angle)
			const worldY =
				building.y + building.width * 0.25 * Math.sin(angle)
			const raw = {
				x: worldX * window.escala + window.offsetX,
				y: worldY * window.escala + window.offsetY,
			}
			const clientX = rect.left + (raw.x * rect.width) / canvas.width
			const clientY = rect.top + (raw.y * rect.height) / canvas.height
			canvas.dispatchEvent(
				new MouseEvent("mousemove", {
					bubbles: true,
					clientX,
					clientY,
				}),
			)
			return canvas.title
		})
		expect(title).toBe('Artwork <b> & "A"')
		await page.evaluate(() => {
			document.getElementById("simuladorCanvas").title = ""
		})
	}

	// Confirmed deletion keeps the edited building until confirmation and uses
	// translated text plus explicit success severity.
	await page.evaluate((name) => {
		window.__buildingConfirmation = null
		window.__buildingName = name
		window.confirm = (message) => {
			window.__buildingConfirmation = message
			return false
		}
	}, 'Artwork <b> & "A"')
	await page.click("#buildingInspectorDeleteBuilding")
	expect(
		await page.evaluate(() => ({
			confirmation: window.__buildingConfirmation,
			exists: window.edificios.some(
				(building) => building.label === window.__buildingName,
			),
		})),
	).toEqual({
		confirmation: labels.deleteConfirm('Artwork <b> & "A"'),
		exists: true,
	})

	await clearToasts(page)
	await page.evaluate(() => {
		window.confirm = () => true
	})
	await page.click("#buildingInspectorDeleteBuilding")
	toast = await waitForToast(page)
	expect(toast.header).toContain("bg-success")
	expect(toast.body).toBe(labels.deletedToast('Artwork <b> & "A"'))
	expect(toast.markup).toBe(0)
	await page.waitForFunction(() => window.edificios.length === 3)

	return page.evaluate(() =>
		window.edificios.map((building) => ({
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
		})),
	)
}

describe("building appearance localization", () => {
	for (const usePixi of [false, true]) {
		it(`creates, edits, validates, and deletes rectangular, polygonal, and image buildings identically in Spanish and English with ${usePixi ? "Pixi" : "Canvas"}`, async () => {
			const directory = await mkdtemp("/tmp/opencode/building-localization-")
			const snapshots = []
			const builtInSnapshots = []
			let fixtures
			try {
				for (const language of ["es", "en"]) {
					const simulator = await openSimulator({
						usePixi,
						languagePreference: language,
						freezeFrames: false,
					})
					try {
						const { page } = simulator
						if (usePixi) {
							await page.waitForFunction(
								() => Boolean(window.pixiApp?.sceneManager?.edificioRenderer),
								{ timeout: 60000, polling: 100 },
							)
						}
						builtInSnapshots.push(
							await page.evaluate(() =>
								(window.edificios || []).map((building) => ({
									label: building.label,
									imagen: building.imagen,
									canvasImageKey: building.canvasImageKey,
									appearanceMode: building.appearanceMode,
									geometryType: building.geometryType,
									x: building.x,
									y: building.y,
									width: building.width,
									height: building.height,
									angle: building.angle,
									color: building.color,
								})),
							),
						)
						await page.evaluate(() => {
							window.hideLoadingScreen?.()
							window.confirm = () => true
							document.getElementById("btnNuevaSimulacion").click()
						})
						await page.waitForFunction(
							() => window.edificios?.length === 0,
							{ timeout: 10000 },
						)
						await page.waitForFunction(
							() =>
								getComputedStyle(
									document.getElementById("loadingScreen"),
								).display === "none",
						)
						fixtures ??= await makeFixtures(page, directory)
						snapshots.push(
							await runBuildingWorkflow({
								page,
								language,
								usePixi,
								fixtures,
							}),
						)
						expect(simulator.pageErrors).toEqual([])
					} finally {
						await simulator.close()
					}
				}
				expect(snapshots[1]).toEqual(snapshots[0])
				expect(builtInSnapshots[1]).toEqual(builtInSnapshots[0])
				expect(builtInSnapshots[0].some(
					(building) => building.imagen || building.canvasImageKey,
				)).toBe(true)
			} finally {
				await rm(directory, { recursive: true, force: true })
			}
		}, 180000)
	}
})

describe.each([
	["Canvas", false],
	["Pixi", true],
])("building appearance controls at mobile and desktop sizes in both themes in %s", (_, usePixi) => {
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One layout sweep covers every viewport/theme combination.
	it("keeps translated tools, inspector, and legacy modal reachable and readable", async () => {
		const simulator = await openSimulator({ languagePreference: "en", usePixi })
		try {
			const { page } = simulator
			if (usePixi) {
				await page.waitForFunction(
					() => Boolean(window.pixiApp?.sceneManager?.edificioRenderer),
					{ timeout: 60000, polling: 100 },
				)
			}
			await hideLoadingScreen(page)
			await page.evaluate(() => {
				const building = window.agregarEdificio("Mobile Building", 400, 300, 100, 50, 0)
				window.edificioSeleccionado = building
				window.buildingInspector.show(building)
			})

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

					const fits = (selectors) =>
						page.evaluate((selectors) => {
							const elements = selectors.map((selector) =>
								document.querySelector(selector),
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
						}, selectors)

					await openAccordion(page, "#collapseMapDrawingTools")
					const tools = await fits([
						"#drawBuildingButton",
						"#drawPolygonBuildingButton",
						"#uploadBuildingImageButton",
					])
					expect(tools.fit).toBe(true)
					expect(tools.overflow).toBeLessThanOrEqual(1)
					expect(
						await page.evaluate(() => ({
							rectangle: document
								.getElementById("drawBuildingButton")
								.textContent.trim(),
							rectangleTooltip: document
								.getElementById("drawBuildingButton")
								.getAttribute("data-bs-title"),
							polygon: document
								.getElementById("drawPolygonBuildingButton")
								.textContent.trim(),
							image: document
								.getElementById("uploadBuildingImageButton")
								.textContent.trim(),
						})),
					).toEqual({
						rectangle: "▭ Building",
						rectangleTooltip: "Drag two corners to create a rectangular building",
						polygon: "⬠ Polygon",
						image: "🖼️ Building with image",
					})

					const inspector = await page.evaluate(() => {
						const element = document.getElementById("buildingInspector")
						const rect = element.getBoundingClientRect()
						const styles = getComputedStyle(element)
						return {
							fit:
								rect.left >= -1 &&
								rect.top >= -1 &&
								rect.right <= window.innerWidth + 1 &&
								rect.bottom <= window.innerHeight + 1,
							scroll: element.scrollWidth - element.clientWidth,
							readable:
								styles.color !== "rgba(0, 0, 0, 0)" &&
								styles.display !== "none",
							name: document
								.querySelector("#buildingInspector .street-inspector-field")
								.firstChild.textContent.trim(),
							deleteBuilding: document
								.getElementById("buildingInspectorDeleteBuilding")
								.textContent.trim(),
						}
					})
					expect(inspector.fit).toBe(true)
					expect(inspector.scroll).toBeLessThanOrEqual(1)
					expect(inspector.readable).toBe(true)
					expect(inspector.name).toBe("Name")
					expect(inspector.deleteBuilding).toBe("Delete building")

					await page.evaluate(() => window.mostrarDialogoNuevoEdificio())
					await page.waitForSelector("#modalNuevoEdificio.show", {
						visible: true,
					})
					await new Promise((resolve) => setTimeout(resolve, 600))
					const modal = await page.evaluate(() => {
						const dialog = document
							.querySelector("#modalNuevoEdificio .modal-dialog")
							.getBoundingClientRect()
						const body = document.querySelector(
							"#modalNuevoEdificio .modal-body",
						)
						const label = document
							.querySelector('label[for="inputNombreEdificio"]')
							.getBoundingClientRect()
						const styles = getComputedStyle(
							document.querySelector('label[for="inputNombreEdificio"]'),
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
								.getElementById("modalNuevoEdificioLabel")
								.textContent.trim(),
							cancel: document
								.querySelector(
									"#modalNuevoEdificio .modal-footer .btn-secondary",
								)
								.textContent.trim(),
						}
					})
					expect(modal.fits).toBe(true)
					expect(modal.overflow).toBeLessThanOrEqual(1)
					expect(modal.labelVisible).toBe(true)
					expect(modal.readable).toBe(true)
					expect(modal.title).toBe("🏢 Add New Building")
					expect(modal.cancel).toBe("✖ Cancel")
					await page.$eval(
						"#modalNuevoEdificio [data-bs-dismiss='modal']",
						(button) => button.click(),
					)
					await page.waitForSelector("#modalNuevoEdificio", {
						hidden: true,
					})
					await page.waitForFunction(
						() => !document.querySelector(".modal-backdrop"),
						{ polling: 100 },
					)
				}
			}
			expect(simulator.pageErrors).toEqual([])
		} finally {
			await simulator.close()
		}
	}, 180000)
})
