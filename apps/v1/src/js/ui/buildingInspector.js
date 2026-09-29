/** Map-first rectangular Edificio creation and immediate editing. */
(() => {
	let canvas = document.getElementById("simuladorCanvas")
	const button = document.getElementById("drawBuildingButton")
	const polygonButton = document.getElementById("drawPolygonBuildingButton")
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
	let polygonPoints = []
	let drawPanel = null
	let gesture = null
	let preview = null
	let polygonPreview = null
	let selected = null
	let handleGesture = null
	let lastSelection

	const normalizeColor = value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : ""
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
		const image = building.appearanceMode === "image" && Number(building.imageAspectRatio) > 0
		fields.x.closest("div").hidden = polygon
		fields.y.closest("div").hidden = polygon
		fields.width.closest("div").hidden = polygon
		fields.height.closest("div").hidden = polygon
		fields.angle.closest("div").hidden = polygon
		lock.closest("label").hidden = polygon || image
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
		selected = building && window.edificios?.includes(building) ? building : null
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
			selected.label = value
			window.actualizarSelectorEdificios?.()
		} else {
			const value = Number(field.value)
			if (field.value.trim() === "" || !Number.isFinite(value)) return fail(field, "Introduce un número válido.")
			const key = Object.entries(fields).find(([, input]) => input === field)?.[0]
			if ((key === "width" || key === "height") && value <= 0) return fail(field, "El tamaño debe ser mayor que cero.")
			selected[key] = key === "angle" ? ((value % 360) + 360) % 360 : value
			if (selected.appearanceMode === "image" && (key === "width" || key === "height")) {
				const ratio = Number(selected.imageAspectRatio) || selected.width / selected.height
				selected[key === "width" ? "height" : "width"] = key === "width" ? value / ratio : value * ratio
				readModel(selected)
			} else if (lock.checked && (key === "width" || key === "height")) {
				selected[key === "width" ? "height" : "width"] = value
				readModel(selected)
			}
		}
		redraw()
		syncHandles()
	}
	for (const field of Object.values(fields)) field.addEventListener("input", () => commit(field))
	for (const swatch of palette) swatch.addEventListener("click", () => {
		if (!selected) return
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
		if (gesture?.pointerId === event.pointerId) updatePreview(event)
	}
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The rectangle and polygon pointer-up paths share one capture listener to avoid duplicate map event handling.
	function onDrawUp(event) {
		if (!gesture || gesture.pointerId !== event.pointerId) return
		event.preventDefault()
		event.stopImmediatePropagation()
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
	function activate(asPolygon = false) {
		if (active) return
		canvas = document.getElementById("simuladorCanvas") || canvas
		polygonMode = asPolygon
		polygonPoints = []
		window.drawStreetTool?.deactivate()
		window.drawRoundaboutTool?.deactivate()
		window.streetEditPause?.()
		active = true
		button.classList.add("active")
		button.setAttribute("aria-pressed", "true")
		canvas.style.cursor = "crosshair"
		button.setAttribute("aria-pressed", String(!polygonMode))
		polygonButton?.setAttribute("aria-pressed", String(polygonMode))
		button.classList.toggle("active", !polygonMode)
		polygonButton?.classList.toggle("active", polygonMode)
		lock.closest("label").hidden = polygonMode
		ensurePreview()
		preview.hidden = polygonMode
		polygonPreview.hidden = !polygonMode
		drawPanel.hidden = !polygonMode
		document.addEventListener("pointerdown", onDrawDown, true)
		document.addEventListener("pointermove", onDrawMove, true)
		document.addEventListener("pointerup", onDrawUp, true)
		document.addEventListener("pointercancel", clearGesture, true)
	}
	function deactivate() {
		if (!active) return
		clearGesture()
		active = false
		polygonMode = false
		polygonPoints = []
		button.classList.remove("active")
		button.setAttribute("aria-pressed", "false")
		polygonButton?.classList.remove("active")
		polygonButton?.setAttribute("aria-pressed", "false")
		lock.closest("label").hidden = selected?.geometryType === "polygon" || selected?.appearanceMode === "image"
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
	document.addEventListener("keydown", event => {
		if (active && event.key === "Escape") deactivate()
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
		const angle = (building.angle || 0) * Math.PI / 180
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
			selected.angle = ((Math.atan2(point.y - before.y, point.x - before.x) * 180 / Math.PI + 90) % 360 + 360) % 360
		} else {
			const angle = -before.angle * Math.PI / 180
			const dx = point.x - before.x
			const dy = point.y - before.y
			let width = Math.abs(2 * (dx * Math.cos(angle) - dy * Math.sin(angle)))
			let height = Math.abs(2 * (dx * Math.sin(angle) + dy * Math.cos(angle)))
			if (selected.appearanceMode === "image") {
				const scale = Math.max(1 / before.width, width / before.width, height / before.height)
				width = before.width * scale
				height = before.height * scale
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
		if (window.edificioSeleccionado !== lastSelection) {
			lastSelection = window.edificioSeleccionado
			show(lastSelection)
		} else syncHandles()
	}, 100)

	window.drawBuildingTool = { activate, deactivate, isActive: () => active }
	window.buildingInspector = { show, refresh: () => selected && readModel(selected), worldPoint, nextName }
})()
