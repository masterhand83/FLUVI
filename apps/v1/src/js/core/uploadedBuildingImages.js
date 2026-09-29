/** Decodes persisted uploaded-building data URLs without adding browser objects to the model. */
(() => {
	const decoded = new WeakMap()
	const pending = new WeakMap()

	function decode(dataUrl) {
		return new Promise((resolve, reject) => {
			const image = new Image()
			image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0
				? resolve(image)
				: reject(new Error("La imagen no contiene píxeles decodificables."))
			image.onerror = () => reject(new Error("No se pudo decodificar la imagen."))
			image.src = dataUrl
		})
	}

	function remember(building, image) {
		if (!building || !image?.naturalWidth || !image?.naturalHeight) return
		decoded.set(building, { source: building.imageDataUrl, image })
	}

	function get(building) {
		const source = building?.imageDataUrl
		if (typeof source !== "string" || !source.startsWith("data:image/")) return null
		const cached = decoded.get(building)
		if (cached?.source === source) return cached.image
		if (!pending.has(building)) {
			const promise = decode(source).then(image => {
				// A removed/replaced building or changed source must not repaint a newer map.
				if (building.imageDataUrl !== source || !window.edificios?.includes(building)) return
				decoded.set(building, { source, image })
				window.pixiApp?.sceneManager?.edificioRenderer?.renderEdificio(building)
				window.renderizarCanvas?.()
			}).catch(() => {}).finally(() => pending.delete(building))
			pending.set(building, promise)
		}
		return null
	}

	window.uploadedBuildingImages = { decode, get, remember }
})()
