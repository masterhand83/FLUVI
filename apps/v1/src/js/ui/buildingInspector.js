/** Map-first rectangular Edificio creation and immediate editing. */
(() => {
	let canvas = document.getElementById("simuladorCanvas")
	const button = document.getElementById("drawBuildingButton")
	const polygonButton = document.getElementById("drawPolygonBuildingButton")
	const imageButton = document.getElementById("uploadBuildingImageButton")
	const imageInput = document.getElementById("buildingImageInput")
	const imageStatus = document.getElementById("buildingImageStatus")
	const imageCancel = document.getElementById("buildingImageCancel")
	const replaceImageButton = document.getElementById("buildingInspectorReplaceImage")
	const replacementInput = document.getElementById("buildingInspectorImageInput")
	const replacementStatus = document.getElementById("buildingInspectorImageStatus")
	const inspector = document.getElementById("buildingInspector")
	if (!canvas || !button || !inspector) return

	const lock = document.getElementById("buildingProportionLock")
	const error = document.getElementById("buildingInspectorError")
	const fields = {
		name: document.getElementById("buildingInspectorName"),
		x: document.getElementById("buildingInspectorX"),
		y: document.getElementById("buildingInspectorY"),
		width: document.getElementById("buildingInspectorWidth"),
		height: document.getElementById("buildingInspectorHeight"),
		angle: document.getElementById("buildingInspectorAngle"),
	}
	const palette = [...document.querySelectorAll('[name="buildingColor"]')]
	for (const swatch of palette) swatch.style.setProperty("--swatch", swatch.value)
	const vertexEditor = document.createElement("section")
	vertexEditor.className = "building-vertex-editor"
	vertexEditor.innerHTML = '<label for="buildingInspectorVertices">Vértices (X, Y por línea; añade o elimina líneas)</label><textarea id="buildingInspectorVertices" rows="5" spellcheck="false"></textarea>'
	inspector.append(vertexEditor)
	const vertexText = vertexEditor.querySelector("textarea")

	let active = false
	let polygonMode = false
	let placementImage = null
	let uploadToken = 0
	let uploadPending = false
	let polygonPoints = []
	let drawPanel = null
	let gesture = null
	let preview = null
	let polygonPreview = null
	let selected = null
	let handleGesture = null
	let lastSelection
	let replacementToken = 0
	let replacementTarget = null

	const normalizeColor = value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : ""
	const isUploadedImage = building => building?.appearanceMode === "uploaded-image"
	const isImageBuilding = building => !!window.buildingImageAppearance?.isImage(building)
	function replacementRotation(building) {
		return !isUploadedImage(building) || building.imageRotationConvention === "legacy"
			? { imageRotationConvention: "legacy" } : {}
	}
	function imageRotationSign(building) {
		if (!window.USE_PIXI || !isImageBuilding(building)) return 1
		return !isUploadedImage(building) || building.imageRotationConvention === "legacy" ? -1 : 1
	}
	function imageRatio(building) {
		// Bundled artwork historically filled stretched bounds. Preserve that
		// displayed ratio rather than snapping old maps to the source image.
		if (!isUploadedImage(building)) return building.width / building.height
		const width = building.imageElement?.naturalWidth || building.imageNaturalWidth
		const height = building.imageElement?.naturalHeight || building.imageNaturalHeight
		return width > 0 && height > 0 ? width / height : building.width / building.height
	}
	const inside = event => {
		const rect = canvas.getBoundingClientRect()
		return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
	}
	function worldPoint(event) {
		const rect = canvas.getBoundingClientRect()
		const screenX = event.clientX - rect.left
		const screenY = event.clientY - rect.top
		if (window.USE_PIXI && window.pixiApp?.cameraController) {
			const screen = window.pixiApp.app?.screen
			return window.pixiApp.cameraController.screenToWorld(
				screenX * (screen?.width || rect.width) / rect.width,
				screenY * (screen?.height || rect.height) / rect.height,
			)
		}
		return {
			x: (screenX * canvas.width / rect.width - (Number(window.offsetX) || 0)) / (Number(window.escala) || 1),
			y: (screenY * canvas.height / rect.height - (Number(window.offsetY) || 0)) / (Number(window.escala) || 1),
		}
	}
	function screenPoint(point) {
		const rect = canvas.getBoundingClientRect()
		const parent = canvas.parentElement.getBoundingClientRect()
		const camera = window.USE_PIXI && window.pixiApp?.cameraController
		const raw = camera ? camera.worldToScreen(point.x, point.y) : {
			x: point.x * (Number(window.escala) || 1) + (Number(window.offsetX) || 0),
			y: point.y * (Number(window.escala) || 1) + (Number(window.offsetY) || 0),
		}
		const screen = camera ? window.pixiApp.app?.screen : null
		return {
			x: rect.left - parent.left + raw.x * rect.width / (screen?.width || canvas.width),
			y: rect.top - parent.top + raw.y * rect.height / (screen?.height || canvas.height),
		}
	}
	function redraw(building = selected) {
		if (window.USE_PIXI && building && window.pixiApp?.sceneManager?.edificioRenderer) {
			const renderer = window.pixiApp.sceneManager.edificioRenderer
			renderer.removeEdificioSprite(building)
			renderer.renderEdificio(building)
		}
		window.renderizarCanvas?.()
	}
	function readModel(building) {
		if (!building) return
		fields.name.value = building.label ?? ""
		for (const key of ["x", "y", "width", "height"]) fields[key].value = building[key] ?? ""
		fields.angle.value = building.angle ?? 0
		const polygon = building.geometryType === "polygon"
		fields.x.closest("div").hidden = polygon
		fields.y.closest("div").hidden = polygon
		fields.width.closest("div").hidden = polygon
		fields.height.closest("div").hidden = polygon
		fields.angle.closest("div").hidden = polygon
		const image = isImageBuilding(building)
		lock.closest("label").hidden = polygon || image
		document.getElementById("buildingColorPalette").closest("div").hidden = image
		replaceImageButton.hidden = !image
		replacementStatus.hidden = !image
		vertexEditor.hidden = !polygon
		if (polygon) vertexText.value = building.vertices.map(point => `${point.x}, ${point.y}`).join("\n")
		const color = normalizeColor(building.color)
		for (const swatch of palette) swatch.setAttribute("aria-pressed", String(normalizeColor(swatch.value) === color))
		error.textContent = ""
		for (const field of Object.values(fields)) {
			field.removeAttribute("aria-invalid")
			field.setCustomValidity("")
		}
	}
	function show(building) {
		const next = building && window.edificios?.includes(building) ? building : null
		if (next !== selected) {
			cancelReplacement()
			handleGesture = null
		}
		selected = next
		lastSelection = selected
		inspector.hidden = !selected
		if (selected) readModel(selected)
		syncHandles()
	}
	function fail(field, message) {
		field.setAttribute("aria-invalid", "true")
		field.setCustomValidity(message)
		error.textContent = message
	}
	const polygonReason = reason => ({
		"invalid-vertices": "Las coordenadas deben ser números finitos y se necesitan al menos tres vértices.",
		"too-few-distinct-vertices": "El polígono necesita al menos tres vértices distintos.",
		"zero-area": "El polígono debe encerrar un área mayor que cero.",
		"zero-length-edge": "Dos vértices consecutivos no pueden coincidir.",
		"self-intersection": "El polígono no puede cruzarse a sí mismo.",
	})[reason]
	function validatePolygon(vertices) {
		return window.edificioPolygonGeometry?.validate(vertices) || { valid: false, reason: "invalid-vertices" }
	}
	function updatePolygonMetadata(building) {
		const bounds = window.edificioPolygonGeometry.bounds(building.vertices)
		const center = window.edificioPolygonGeometry.center(building.vertices)
		Object.assign(building, { x: center.x, y: center.y, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY })
	}
	function applyPolygonVertices(vertices) {
		if (selected?.geometryType !== "polygon") return false
		const result = validatePolygon(vertices)
		if (!result.valid) {
			error.textContent = polygonReason(result.reason) || `Geometría inválida: ${result.reason}.`
			return false
		}
		selected.vertices = vertices.map(point => ({ x: Number(point.x), y: Number(point.y) }))
		updatePolygonMetadata(selected)
		redraw()
		syncHandles()
		return true
	}
	function readPolygonText() {
		const vertices = vertexText.value.trim().split(/\n+/).map(line => {
			const [x, y] = line.split(/[;,\s]+/).filter(Boolean)
			return { x: Number(x), y: Number(y) }
		})
		return vertices
	}
	vertexText.addEventListener("input", () => applyPolygonVertices(readPolygonText()))
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One atomic validation path prevents partial numeric edits from reaching the model.
	function commit(field) {
		if (!selected || !field) return
		field.removeAttribute("aria-invalid")
		field.setCustomValidity("")
		error.textContent = ""
		if (field === fields.name) {
			const value = field.value.trim()
			if (!value) return fail(field, "El nombre no puede estar vacío.")
			if (value !== selected.label) window.buildingImageAppearance?.preserveBundledIdentity(selected)
			selected.label = value
			window.actualizarSelectorEdificios?.()
		} else {
			const value = Number(field.value)
			if (field.value.trim() === "" || !Number.isFinite(value)) return fail(field, "Introduce un número válido.")
			const key = Object.entries(fields).find(([, input]) => input === field)?.[0]
			if ((key === "width" || key === "height") && value <= 0) return fail(field, "El tamaño debe ser mayor que cero.")
			if (isImageBuilding(selected) && (key === "width" || key === "height")) {
				const ratio = imageRatio(selected)
				const other = key === "width" ? value / ratio : value * ratio
				if (!Number.isFinite(other) || other <= 0) return fail(field, "Introduce un tamaño proporcional válido.")
				selected[key === "width" ? "height" : "width"] = other
			}
			selected[key] = key === "angle" ? ((value % 360) + 360) % 360 : value
			if ((lock.checked || isImageBuilding(selected)) && (key === "width" || key === "height")) {
				if (!isImageBuilding(selected)) selected[key === "width" ? "height" : "width"] = value
				readModel(selected)
			}
		}
		redraw()
		syncHandles()
	}
	for (const field of Object.values(fields)) field.addEventListener("input", () => commit(field))
	for (const swatch of palette) swatch.addEventListener("click", () => {
		if (!selected || isImageBuilding(selected)) return
		selected.color = swatch.value
		readModel(selected)
		redraw()
	})

	function nextName() {
		const names = new Set((window.edificios || []).map(building => building.label))
		let number = 1
		while (names.has(`Edificio ${number}`)) number++
		return `Edificio ${number}`
	}
	function selectBuilding(building) {
		const index = window.edificios.indexOf(building)
		const type = document.getElementById("selectTipoObjeto")
		if (type) {
			type.value = "edificio"
			type.dispatchEvent(new Event("change", { bubbles: true }))
		}
		window.actualizarSelectorEdificios?.()
		const selector = document.getElementById("selectEdificio")
		if (selector) {
			selector.value = String(index)
			selector.dispatchEvent(new Event("change", { bubbles: true }))
		}
		window.edificioSeleccionado = building
		window.calleSeleccionada = null
		show(building)
		document.dispatchEvent(new CustomEvent("building-selected", { detail: { building } }))
	}
	function ensurePreview() {
		if (preview) return
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
		svg.classList.add("street-draw-preview", "building-draw-preview")
		const rectangle = document.createElementNS("http://www.w3.org/2000/svg", "rect")
		polygonPreview = document.createElementNS("http://www.w3.org/2000/svg", "polygon")
		svg.append(rectangle, polygonPreview)
		canvas.parentElement.append(svg)
		preview = rectangle
		drawPanel = document.createElement("div")
		drawPanel.className = "building-draw-panel"
		drawPanel.hidden = true
		drawPanel.innerHTML = '<span id="buildingDrawStatus">Coloca vértices en el mapa.</span><button type="button" id="buildingDrawFinish" class="btn btn-sm btn-success">Cerrar / terminar</button><button type="button" id="buildingDrawCancel" class="btn btn-sm btn-outline-secondary">Cancelar</button>'
		canvas.parentElement.append(drawPanel)
		drawPanel.querySelector("#buildingDrawFinish").addEventListener("click", createPolygon)
		drawPanel.querySelector("#buildingDrawCancel").addEventListener("click", deactivate)
	}
	function updatePreview(event) {
		if (!gesture || !preview) return
		const rect = canvas.getBoundingClientRect()
		let dx = event.clientX - gesture.clientX
		let dy = event.clientY - gesture.clientY
		if (lock.checked) {
			const side = Math.max(Math.abs(dx), Math.abs(dy))
			dx = Math.sign(dx || 1) * side
			dy = Math.sign(dy || 1) * side
		}
		preview.setAttribute("x", String(Math.min(gesture.clientX, gesture.clientX + dx) - rect.left))
		preview.setAttribute("y", String(Math.min(gesture.clientY, gesture.clientY + dy) - rect.top))
		preview.setAttribute("width", String(Math.abs(dx)))
		preview.setAttribute("height", String(Math.abs(dy)))
	}
	function clearGesture() {
		if (gesture && canvas.hasPointerCapture?.(gesture.pointerId)) canvas.releasePointerCapture(gesture.pointerId)
		gesture = null
		if (preview) preview.hidden = true
	}
	function onDrawDown(event) {
		if (!active || event.button !== 0 || event.target !== canvas || !inside(event)) return
		const point = worldPoint(event)
		if (placementImage) {
			event.preventDefault()
			event.stopImmediatePropagation()
			gesture = { ...point, pointerId: event.pointerId }
			canvas.setPointerCapture?.(event.pointerId)
			return
		}
		if (polygonMode) {
			event.preventDefault()
			event.stopImmediatePropagation()
			gesture = { ...point, pointerId: event.pointerId }
			return
		}
		if (window.encontrarEdificioEnPunto?.(point.x, point.y) || window.encontrarCalleEnPunto?.(point.x, point.y)) return
		event.preventDefault()
		event.stopImmediatePropagation()
		gesture = { ...point, clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId }
		canvas.setPointerCapture?.(event.pointerId)
		ensurePreview()
		preview.hidden = false
		updatePreview(event)
	}
	function onDrawMove(event) {
		if (!placementImage && gesture?.pointerId === event.pointerId) updatePreview(event)
	}
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The rectangle and polygon pointer-up paths share one capture listener to avoid duplicate map event handling.
	function onDrawUp(event) {
		if (!gesture || gesture.pointerId !== event.pointerId) return
		event.preventDefault()
		event.stopImmediatePropagation()
		if (placementImage) {
			const origin = gesture
			clearGesture()
			if (!inside(event)) return
			const { imageData, imageElement } = placementImage
			// A 120-world-unit maximum keeps artwork usable regardless of source resolution.
			const scale = 120 / Math.max(imageElement.naturalWidth, imageElement.naturalHeight)
			const building = window.agregarEdificio(nextName(), origin.x, origin.y, imageElement.naturalWidth * scale, imageElement.naturalHeight * scale, 0)
			Object.assign(building, { appearanceMode: "uploaded-image", imageData, imageElement })
			deactivate()
			redraw(building)
			selectBuilding(building)
			imageStatus.textContent = "Edificio con imagen creado."
			return
		}
		if (polygonMode) {
			const point = worldPoint(event)
			gesture = null
			if (!inside(event)) return
			const first = polygonPoints[0]
			if (first && Math.hypot(first.x - point.x, first.y - point.y) < 12 / (Number(window.escala) || 1)) return createPolygon()
			if (window.encontrarEdificioEnPunto?.(point.x, point.y) || window.encontrarCalleEnPunto?.(point.x, point.y)) return
			polygonPoints.push(point)
			updatePolygonPreview()
			return
		}
		const origin = gesture
		const valid = inside(event)
		let end = worldPoint(event)
		if (lock.checked) {
			const dx = end.x - origin.x
			const dy = end.y - origin.y
			const side = Math.max(Math.abs(dx), Math.abs(dy))
			end = { x: origin.x + Math.sign(dx || 1) * side, y: origin.y + Math.sign(dy || 1) * side }
		}
		clearGesture()
		if (!valid) return
		const width = Math.abs(end.x - origin.x)
		const height = Math.abs(end.y - origin.y)
		if (width < 1 || height < 1) {
			error.textContent = "Arrastra un área válida para crear el edificio."
			return
		}
		const building = window.agregarEdificio(nextName(), (origin.x + end.x) / 2, (origin.y + end.y) / 2, width, height, 0)
		building.appearanceMode = "rectangular"
		building.color = "#A0522D"
		redraw(building)
		selectBuilding(building)
		deactivate()
	}
	function updatePolygonPreview() {
		if (!polygonPreview) return
		polygonPreview.setAttribute("points", polygonPoints.map(point => {
			const screen = screenPoint(point)
			return `${screen.x},${screen.y}`
		}).join(" "))
		drawPanel?.querySelector("#buildingDrawStatus")?.replaceChildren(document.createTextNode(`${polygonPoints.length} vértice(s). Clic en el primero o «Cerrar / terminar».`))
	}
	function createPolygon() {
		if (!polygonMode || polygonPoints.length < 3) {
			if (drawPanel) drawPanel.querySelector("#buildingDrawStatus").textContent = "Se necesitan al menos tres vértices."
			return
		}
		const result = validatePolygon(polygonPoints)
		if (!result.valid) {
			drawPanel.querySelector("#buildingDrawStatus").textContent = polygonReason(result.reason) || `Geometría inválida: ${result.reason}.`
			return
		}
		const center = window.edificioPolygonGeometry.center(polygonPoints)
		const bounds = window.edificioPolygonGeometry.bounds(polygonPoints)
		const building = window.agregarEdificio(nextName(), center.x, center.y, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 0)
		building.geometryType = "polygon"
		building.vertices = polygonPoints.map(point => ({ ...point }))
		building.appearanceMode = "polygon"
		building.color = "#A0522D"
		redraw(building)
		selectBuilding(building)
		deactivate()
	}
	function activate(asPolygon = false, image = null) {
		if (active) return
		if (uploadPending) deactivate()
		canvas = document.getElementById("simuladorCanvas") || canvas
		polygonMode = asPolygon
		placementImage = image
		polygonPoints = []
		window.drawStreetTool?.deactivate()
		window.drawRoundaboutTool?.deactivate()
		window.streetEditPause?.()
		active = true
		button.classList.add("active")
		button.setAttribute("aria-pressed", "true")
		canvas.style.cursor = "crosshair"
		button.setAttribute("aria-pressed", String(!polygonMode && !placementImage))
		polygonButton?.setAttribute("aria-pressed", String(polygonMode))
		button.classList.toggle("active", !polygonMode && !placementImage)
		polygonButton?.classList.toggle("active", polygonMode)
		imageButton?.setAttribute("aria-pressed", String(!!placementImage))
		imageButton?.classList.toggle("active", !!placementImage)
		lock.closest("label").hidden = polygonMode || !!placementImage
		ensurePreview()
		preview.hidden = polygonMode || !!placementImage
		polygonPreview.hidden = !polygonMode
		drawPanel.hidden = !polygonMode && !placementImage
		if (placementImage) {
			drawPanel.querySelector("#buildingDrawFinish").hidden = true
			drawPanel.querySelector("#buildingDrawStatus").textContent = "Haz clic en el centro del edificio con imagen."
		}
		document.addEventListener("pointerdown", onDrawDown, true)
		document.addEventListener("pointermove", onDrawMove, true)
		document.addEventListener("pointerup", onDrawUp, true)
		document.addEventListener("pointercancel", clearGesture, true)
	}
	function deactivate() {
		// Reset must invalidate decoding even before placement has been armed.
		cancelReplacement()
		uploadToken++
		uploadPending = false
		placementImage = null
		if (imageStatus) imageStatus.textContent = ""
		if (imageCancel) imageCancel.hidden = true
		imageButton?.classList.remove("active")
		imageButton?.setAttribute("aria-pressed", "false")
		if (!active) return
		clearGesture()
		active = false
		polygonMode = false
		polygonPoints = []
		button.classList.remove("active")
		button.setAttribute("aria-pressed", "false")
		polygonButton?.classList.remove("active")
		polygonButton?.setAttribute("aria-pressed", "false")
		lock.closest("label").hidden = selected?.geometryType === "polygon" || isImageBuilding(selected)
		canvas.style.cursor = ""
		document.removeEventListener("pointerdown", onDrawDown, true)
		document.removeEventListener("pointermove", onDrawMove, true)
		document.removeEventListener("pointerup", onDrawUp, true)
		document.removeEventListener("pointercancel", clearGesture, true)
		preview?.ownerSVGElement?.remove()
		preview = null
		polygonPreview = null
		drawPanel?.remove()
		drawPanel = null
	}
	const toggleTool = () => active ? deactivate() : activate(false)
	button.addEventListener("click", toggleTool)
	polygonButton?.addEventListener("click", () => active ? deactivate() : activate(true))
	document.getElementById("btnAgregarEdificio")?.addEventListener("click", toggleTool)
	imageButton?.addEventListener("click", () => {
		deactivate()
		imageInput.value = ""
		imageInput.click()
	})
	imageCancel?.addEventListener("click", deactivate)
	function cancelReplacement() {
		replacementToken++
		replacementTarget = null
		if (replacementStatus) replacementStatus.textContent = ""
	}
	function readImageFile(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader()
			reader.onload = () => resolve(reader.result)
			reader.onerror = reject
			reader.onabort = reject
			reader.readAsDataURL(file)
		})
	}
	function imageFileError(file) {
		if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "Formato no admitido. Usa PNG, JPEG o WebP."
		if (file.size > window.buildingImageCodec.maxBytes) return "La imagen no puede superar 5 MB."
		return ""
	}
	function replacementIsCurrent(token, building, buildings) {
		return token === replacementToken && selected === building &&
			window.edificioSeleccionado === building && window.edificios === buildings && buildings.includes(building)
	}
	function replacementFailed(token, building, buildings) {
		if (replacementIsCurrent(token, building, buildings)) {
			replacementStatus.textContent = "No se pudo leer la imagen. Elige un PNG, JPEG o WebP válido."
		}
	}
	replaceImageButton?.addEventListener("click", () => {
		if (!selected || !isImageBuilding(selected) || !window.edificios?.includes(selected)) return
		deactivate()
		replacementTarget = selected
		replacementInput.value = ""
		replacementInput.click()
	})
	replacementInput?.addEventListener("change", async () => {
		const building = replacementTarget
		const file = replacementInput.files?.[0]
		if (!building || !file) return
		const token = ++replacementToken
		const buildings = window.edificios
		const current = () => replacementIsCurrent(token, building, buildings)
		if (!current()) return
		const message = imageFileError(file)
		if (message) {
			replacementStatus.textContent = message
			return
		}
		replacementStatus.textContent = "Comprobando imagen…"
		try {
			const imageData = await readImageFile(file)
			if (!current()) return
			const imageElement = await window.buildingImageCodec.decode(imageData)
			if (!current()) return
			// Publish only after validation and decoding: failures keep all old state.
			const scale = 120 / Math.max(imageElement.naturalWidth, imageElement.naturalHeight)
			handleGesture = null
			Object.assign(building, {
				...replacementRotation(building),
				appearanceMode: "uploaded-image", imageData, imageElement,
				imageNaturalWidth: imageElement.naturalWidth, imageNaturalHeight: imageElement.naturalHeight,
				width: imageElement.naturalWidth * scale, height: imageElement.naturalHeight * scale,
			})
			readModel(building)
			redraw(building)
			syncHandles()
			replacementStatus.textContent = "Imagen reemplazada."
		} catch {
			replacementFailed(token, building, buildings)
		}
	})
	imageInput?.addEventListener("change", async () => {
		deactivate()
		const file = imageInput.files?.[0]
		if (!file) return
		const message = imageFileError(file)
		if (message) {
			imageStatus.textContent = message
			return
		}
		const token = ++uploadToken
		uploadPending = true
		imageCancel.hidden = false
		imageStatus.textContent = "Comprobando imagen…"
		try {
			const imageData = await readImageFile(file)
			if (token !== uploadToken) return
			const imageElement = await window.buildingImageCodec.decode(imageData)
			if (token !== uploadToken) return
			uploadPending = false
			activate(false, { imageData, imageElement })
			imageStatus.textContent = "Imagen lista. Haz clic en su centro en el mapa; Escape cancela."
		} catch {
			if (token !== uploadToken) return
			uploadPending = false
			imageCancel.hidden = true
			imageStatus.textContent = "No se pudo leer la imagen. Elige un PNG, JPEG o WebP válido."
		}
	})
	document.addEventListener("keydown", event => {
		if ((active || uploadPending) && event.key === "Escape") deactivate()
		if (replacementTarget && event.key === "Escape") cancelReplacement()
	})

	const handles = ["move", "resize", "rotate"].map(kind => {
		const handle = document.createElement("button")
		handle.type = "button"
		handle.className = `building-map-handle building-${kind}-handle`
		handle.setAttribute("aria-label", kind === "move" ? "Mover edificio" : kind === "resize" ? "Cambiar tamaño del edificio" : "Girar edificio")
		handle.hidden = true
		canvas.parentElement.append(handle)
		handle.dataset.buildingHandle = kind
		return handle
	})
	const vertexHandles = []
	function rotatedPoint(building, localX, localY) {
		const angle = imageRotationSign(building) * (building.angle || 0) * Math.PI / 180
		return { x: building.x + localX * Math.cos(angle) - localY * Math.sin(angle), y: building.y + localX * Math.sin(angle) + localY * Math.cos(angle) }
	}
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One placement pass keeps the three shared handles and the variable polygon vertex handles synchronized.
	function syncHandles() {
		canvas = document.getElementById("simuladorCanvas") || canvas
		const building = selected && window.edificioSeleccionado === selected && window.edificios?.includes(selected) ? selected : null
		for (const handle of handles) handle.hidden = !building || active
		for (const handle of vertexHandles) handle.hidden = true
		if (!building || active) return
		if (building.geometryType === "polygon") {
			while (vertexHandles.length < building.vertices.length) {
				const handle = document.createElement("button")
				handle.type = "button"
				handle.className = "building-map-handle building-vertex-handle"
				handle.setAttribute("aria-label", "Mover vértice del edificio")
				handle.dataset.buildingHandle = "vertex"
				canvas.parentElement.append(handle)
				vertexHandles.push(handle)
			}
			vertexHandles.forEach((handle, index) => {
				handle.hidden = false
				handle.dataset.vertexIndex = String(index)
				const point = screenPoint(building.vertices[index])
				Object.assign(handle.style, { left: `${point.x}px`, top: `${point.y}px` })
			})
			const bounds = window.edificioPolygonGeometry.bounds(building.vertices)
			const center = window.edificioPolygonGeometry.center(building.vertices)
			const rotation = screenPoint({ x: center.x, y: bounds.minY - 30 / (Number(window.escala) || 1) })
			const centerScreen = screenPoint(center)
			Object.assign(handles[0].style, { left: `${centerScreen.x}px`, top: `${centerScreen.y}px` })
			handles[1].hidden = true
			Object.assign(handles[2].style, { left: `${rotation.x}px`, top: `${rotation.y}px` })
			return
		}
		const points = [
			{ x: building.x, y: building.y },
			rotatedPoint(building, building.width / 2, building.height / 2),
			rotatedPoint(building, 0, -building.height / 2 - 30 / (Number(window.escala) || 1)),
		]
		handles.forEach((handle, index) => {
			const point = screenPoint(points[index])
			Object.assign(handle.style, { left: `${point.x}px`, top: `${point.y}px` })
		})
	}
	function startHandle(kind, event, handle) {
		if (!selected || event.button !== 0) return
		event.preventDefault()
		event.stopImmediatePropagation()
		const point = worldPoint(event)
		handleGesture = { kind, index: Number(handle.dataset.vertexIndex), pointerId: event.pointerId, start: point, before: { x: selected.x, y: selected.y, width: selected.width, height: selected.height, angle: selected.angle || 0, vertices: selected.vertices?.map(vertex => ({ ...vertex })) } }
		handleGesture.rotationSign = imageRotationSign(selected)
		handleGesture.lastValidVertices = handleGesture.before.vertices?.map(vertex => ({ ...vertex }))
		handle.setPointerCapture?.(event.pointerId)
	}
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Polygon transform and legacy rectangle gestures use a shared validated pointer handler.
	function moveHandle(event) {
		if (!handleGesture || event.pointerId !== handleGesture.pointerId || !selected) return
		const point = worldPoint(event)
		const before = handleGesture.before
		if (selected.geometryType === "polygon") {
			let next
			if (handleGesture.kind === "vertex") {
				next = before.vertices.map((vertex, index) => index === handleGesture.index ? point : vertex)
			} else if (handleGesture.kind === "move") {
				const dx = point.x - handleGesture.start.x
				const dy = point.y - handleGesture.start.y
				next = before.vertices.map(vertex => ({ x: vertex.x + dx, y: vertex.y + dy }))
			} else {
				const center = window.edificioPolygonGeometry.center(before.vertices)
				const a0 = Math.atan2(handleGesture.start.y - center.y, handleGesture.start.x - center.x)
				const a1 = Math.atan2(point.y - center.y, point.x - center.x)
				const delta = a1 - a0
				next = before.vertices.map(vertex => {
					const dx = vertex.x - center.x, dy = vertex.y - center.y
					return { x: center.x + dx * Math.cos(delta) - dy * Math.sin(delta), y: center.y + dx * Math.sin(delta) + dy * Math.cos(delta) }
				})
			}
			const validation = validatePolygon(next)
			if (!validation.valid) {
				selected.vertices = handleGesture.lastValidVertices.map(vertex => ({ ...vertex }))
				error.textContent = polygonReason(validation.reason) || `Geometría inválida: ${validation.reason}.`
			} else {
				selected.vertices = next
				handleGesture.lastValidVertices = next.map(vertex => ({ ...vertex }))
				updatePolygonMetadata(selected)
				readModel(selected)
			}
			redraw()
			syncHandles()
			return
		}
		if (handleGesture.kind === "move") {
			selected.x = before.x + point.x - handleGesture.start.x
			selected.y = before.y + point.y - handleGesture.start.y
		} else if (handleGesture.kind === "rotate") {
			const visualAngle = Math.atan2(point.y - before.y, point.x - before.x) * 180 / Math.PI + 90
			selected.angle = ((visualAngle * handleGesture.rotationSign) % 360 + 360) % 360
		} else {
			const angle = -before.angle * handleGesture.rotationSign * Math.PI / 180
			const dx = point.x - before.x
			const dy = point.y - before.y
			let width = Math.abs(2 * (dx * Math.cos(angle) - dy * Math.sin(angle)))
			let height = Math.abs(2 * (dx * Math.sin(angle) + dy * Math.cos(angle)))
			if (isImageBuilding(selected)) {
				const ratio = imageRatio(selected)
				height = Math.max(width / ratio, height)
				width = height * ratio
			} else if (lock.checked) width = height = Math.max(width, height)
			if (width >= 1 && height >= 1) Object.assign(selected, { width, height })
		}
		readModel(selected)
		redraw()
		syncHandles()
	}
	function finishHandle() { handleGesture = null }
	document.addEventListener("pointerdown", event => {
		const handle = event.target.closest?.(".building-map-handle")
		if (handle) startHandle(handle.dataset.buildingHandle, event, handle)
	}, true)
	document.addEventListener("pointermove", moveHandle, true)
	document.addEventListener("pointerup", finishHandle, true)
	document.addEventListener("pointercancel", finishHandle, true)

	document.getElementById("buildingInspectorClose")?.addEventListener("click", () => {
		window.edificioSeleccionado = null
		const selector = document.getElementById("selectEdificio")
		if (selector) selector.value = ""
		show(null)
		redraw()
	})
	document.getElementById("selectEdificio")?.addEventListener("change", () => window.setTimeout(() => show(window.edificioSeleccionado), 0))
	document.addEventListener("building-selected", event => show(event.detail?.building))
	document.addEventListener("pointerup", () => window.setTimeout(() => {
		if (window.edificioSeleccionado !== selected) show(window.edificioSeleccionado)
	}, 0), true)
	window.setInterval(() => {
		if (window.edificioSeleccionado !== lastSelection || (selected && !window.edificios?.includes(selected))) {
			lastSelection = window.edificioSeleccionado
			show(lastSelection)
		} else syncHandles()
	}, 100)

	window.drawBuildingTool = { activate, deactivate, isActive: () => active }
	window.buildingInspector = { show, refresh: () => selected && readModel(selected) }
})()
