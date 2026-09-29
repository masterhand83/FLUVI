/** Map-first rectangular Edificio creation and immediate editing. */
(() => {
	let canvas = document.getElementById("simuladorCanvas")
	const button = document.getElementById("drawBuildingButton")
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

	let active = false
	let gesture = null
	let preview = null
	let selected = null
	let handleGesture = null
	let lastSelection = undefined

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
			if (lock.checked && (key === "width" || key === "height")) {
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
		svg.append(rectangle)
		canvas.parentElement.append(svg)
		preview = rectangle
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
	function onDrawUp(event) {
		if (!gesture || gesture.pointerId !== event.pointerId) return
		event.preventDefault()
		event.stopImmediatePropagation()
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
	function activate() {
		if (active) return
		canvas = document.getElementById("simuladorCanvas") || canvas
		window.drawStreetTool?.deactivate()
		window.drawRoundaboutTool?.deactivate()
		window.streetEditPause?.()
		active = true
		button.classList.add("active")
		button.setAttribute("aria-pressed", "true")
		canvas.style.cursor = "crosshair"
		document.addEventListener("pointerdown", onDrawDown, true)
		document.addEventListener("pointermove", onDrawMove, true)
		document.addEventListener("pointerup", onDrawUp, true)
		document.addEventListener("pointercancel", clearGesture, true)
	}
	function deactivate() {
		if (!active) return
		clearGesture()
		active = false
		button.classList.remove("active")
		button.setAttribute("aria-pressed", "false")
		canvas.style.cursor = ""
		document.removeEventListener("pointerdown", onDrawDown, true)
		document.removeEventListener("pointermove", onDrawMove, true)
		document.removeEventListener("pointerup", onDrawUp, true)
		document.removeEventListener("pointercancel", clearGesture, true)
		preview?.ownerSVGElement?.remove()
		preview = null
	}
	const toggleTool = () => active ? deactivate() : activate()
	button.addEventListener("click", toggleTool)
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
	function rotatedPoint(building, localX, localY) {
		const angle = (building.angle || 0) * Math.PI / 180
		return { x: building.x + localX * Math.cos(angle) - localY * Math.sin(angle), y: building.y + localX * Math.sin(angle) + localY * Math.cos(angle) }
	}
	function syncHandles() {
		canvas = document.getElementById("simuladorCanvas") || canvas
		const building = selected && window.edificioSeleccionado === selected && window.edificios?.includes(selected) ? selected : null
		for (const handle of handles) handle.hidden = !building || active
		if (!building || active) return
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
		handleGesture = { kind, pointerId: event.pointerId, start: point, before: { x: selected.x, y: selected.y, width: selected.width, height: selected.height, angle: selected.angle || 0 } }
		handle.setPointerCapture?.(event.pointerId)
	}
	function moveHandle(event) {
		if (!handleGesture || event.pointerId !== handleGesture.pointerId || !selected) return
		const point = worldPoint(event)
		const before = handleGesture.before
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
			if (lock.checked) width = height = Math.max(width, height)
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
	window.buildingInspector = { show, refresh: () => selected && readModel(selected) }
})()
