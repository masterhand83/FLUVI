/** Upload validation and single-click placement for image-backed buildings. */
(() => {
	const button = document.getElementById("uploadImageBuildingButton")
	const input = document.getElementById("uploadImageBuildingFile")
	const error = document.getElementById("uploadImageBuildingError")
	const canvas = document.getElementById("simuladorCanvas")
	if (!button || !input || !canvas) return

	const maxBytes = 5 * 1024 * 1024
	const acceptedTypes = new Set(["image/png", "image/jpeg", "image/webp"])
	let selectionVersion = 0
	let pendingBuilding = null
	let mapBuildingsAtActivation = null
	let pointerId = null

	function readAsDataUrl(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader()
			reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("No se pudo leer el archivo."))
			reader.onerror = () => reject(new Error("No se pudo leer el archivo."))
			reader.readAsDataURL(file)
		})
	}
	async function imageFormat(file) {
		const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
		if (bytes.length >= 8 && bytes.slice(0, 8).join() === [137, 80, 78, 71, 13, 10, 26, 10].join()) return "image/png"
		if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
		if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp"
		return null
	}
	function deactivate() {
		selectionVersion++
		pendingBuilding = null
		mapBuildingsAtActivation = null
		pointerId = null
		canvas.style.cursor = ""
		button.classList.remove("active")
		button.setAttribute("aria-pressed", "false")
		document.removeEventListener("pointerdown", onPointerDown, true)
		document.removeEventListener("pointerup", onPointerUp, true)
	}
	function activate(buildingData) {
		window.drawBuildingTool?.deactivate()
		window.drawStreetTool?.deactivate()
		window.drawRoundaboutTool?.deactivate()
		window.streetEditPause?.()
		pendingBuilding = buildingData
		mapBuildingsAtActivation = window.edificios
		canvas.style.cursor = "crosshair"
		button.classList.add("active")
		button.setAttribute("aria-pressed", "true")
		document.addEventListener("pointerdown", onPointerDown, true)
		document.addEventListener("pointerup", onPointerUp, true)
	}
	function onPointerDown(event) {
		if (!pendingBuilding || event.button !== 0 || event.target !== canvas) return
		pointerId = event.pointerId
		event.preventDefault()
		event.stopImmediatePropagation()
	}
	function onPointerUp(event) {
		if (!pendingBuilding || pointerId !== event.pointerId) return
		event.preventDefault()
		event.stopImmediatePropagation()
		pointerId = null
		const rect = canvas.getBoundingClientRect()
		const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
		if (!inside) return deactivate()
		if (window.edificios !== mapBuildingsAtActivation) {
			error.textContent = "El mapa cambió durante la carga. Vuelve a seleccionar la imagen."
			return deactivate()
		}
		const point = window.buildingInspector.worldPoint(event)
		const { dataUrl, mimeType, width, height } = pendingBuilding
		const building = window.agregarEdificio(window.buildingInspector.nextName(), point.x, point.y, width, height, 0)
		building.appearanceMode = "image"
		building.imageDataUrl = dataUrl
		building.imageMimeType = mimeType
		building.imageAspectRatio = width / height
		window.uploadedBuildingImages?.remember(building, pendingBuilding.image)
		window.edificioSeleccionado = building
		document.dispatchEvent(new CustomEvent("building-selected", { detail: { building } }))
		deactivate()
	}
	function validateFile(file) {
		if (file.type && !acceptedTypes.has(file.type)) return "Formato no compatible. Selecciona una imagen PNG, JPEG o WebP."
		if (file.size > maxBytes) return "La imagen supera el límite de 5 MB."
		return ""
	}
	async function inspectImageFile(file) {
		const mimeType = await imageFormat(file)
		if (!mimeType) return { error: file.type && acceptedTypes.has(file.type)
			? "El archivo está dañado o no se puede decodificar como imagen."
			: "Formato no compatible. Selecciona una imagen PNG, JPEG o WebP." }
		if (file.type && file.type !== mimeType) return { error: "Formato no compatible. Selecciona una imagen PNG, JPEG o WebP." }
		return { mimeType }
	}
	async function processFile(file, version) {
		const validationError = validateFile(file)
		if (validationError) {
			error.textContent = validationError
			return
		}
		try {
			const inspected = await inspectImageFile(file)
			if (inspected.error) {
				error.textContent = inspected.error
				return
			}
			const dataUrl = await readAsDataUrl(file)
			const image = await window.uploadedBuildingImages.decode(dataUrl)
			if (version !== selectionVersion) return
			const scale = 160 / Math.max(image.naturalWidth, image.naturalHeight)
			activate({ dataUrl, mimeType: inspected.mimeType, image, width: image.naturalWidth * scale, height: image.naturalHeight * scale })
		} catch {
			if (version === selectionVersion) error.textContent = "El archivo está dañado o no se puede decodificar como imagen."
		}
	}

	button.addEventListener("click", () => {
		error.textContent = ""
		if (pendingBuilding) deactivate()
		input.click()
	})
	input.addEventListener("change", () => {
		const file = input.files?.[0]
		input.value = ""
		if (!file) return
		error.textContent = ""
		deactivate()
		const version = ++selectionVersion
		processFile(file, version)
	})
	document.addEventListener("keydown", event => {
		if (pendingBuilding && event.key === "Escape") deactivate()
	})
	window.uploadImageBuildingTool = { deactivate, isActive: () => Boolean(pendingBuilding) }
})()
