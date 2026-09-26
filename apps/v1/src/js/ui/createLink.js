/* Map-first creation of directed street connections. */
(() => {
	const button = document.getElementById("createLinkButton");
	const panel = document.getElementById("linkDraftPanel");
	if (!button || !panel) return;
	const sourceSelect = document.getElementById("linkSourceStreet");
	const destinationSelect = document.getElementById("linkDestinationStreet");
	const status = document.getElementById("linkDraftStatus");
	const rowsElement = document.getElementById("linkMappingRows");
	const message = document.getElementById("linkDraftMessage");
	const notice = document.getElementById("linkDraftNotice");
	const canvas = () => document.getElementById("simuladorCanvas");
	let draft = null;
	let suppressClick = false;
	const streets = () => Array.isArray(window.calles) ? window.calles : [];
	const name = (street) => street.nombre || street.name || street.id;

	function close() {
		draft = null;
		panel.hidden = true;
		panel.setAttribute("aria-hidden", "true");
		panel.removeAttribute("aria-invalid");
		message.textContent = "";
		notice.textContent = "";
		button.classList.remove("active");
	}
	function show() {
		window.drawStreetTool?.deactivate();
		window.streetEditPause?.();
		draft = { source: null, destination: null };
		panel.hidden = false;
		panel.setAttribute("aria-hidden", "false");
		panel.removeAttribute("aria-invalid");
		button.classList.add("active");
		status.textContent = "Elige la calle de origen en el mapa.";
		rowsElement.replaceChildren();
		message.textContent = "";
		notice.textContent = "";
		renderSelectors();
	}
	function renderSelectors() {
		for (const [select, picked] of [[sourceSelect, draft?.source], [destinationSelect, draft?.destination]]) {
			select.replaceChildren(new Option("Selecciona una calle", ""));
			for (const street of streets()) select.add(new Option(name(street), street.id));
			select.value = picked?.id || "";
		}
	}
	function makeNumber(testId, label, value, min, max) {
		const wrap = document.createElement("label");
		wrap.textContent = label;
		const input = document.createElement("input");
		input.type = "number";
		input.className = "form-control form-control-sm";
		input.min = String(min);
		input.max = String(max);
		input.step = "1";
		input.value = String(value);
		input.dataset.testid = testId;
		input.addEventListener("input", updateOverlapNotice);
		wrap.append(input);
		return wrap;
	}
	function renderRows() {
		rowsElement.replaceChildren();
		if (!draft?.source || !draft.destination) return;
		for (let lane = 0; lane < Math.min(draft.source.carriles, draft.destination.carriles); lane++) {
			const row = document.createElement("div");
			row.className = "link-mapping-row";
			row.dataset.testid = "link-mapping-row";
			row.append(makeNumber("source-lane", "Carril origen", lane, 0, draft.source.carriles - 1));
			row.append(makeNumber("source-cell", "Celda origen", draft.source.tamano - 1, 0, draft.source.tamano - 1));
			row.append(makeNumber("destination-lane", "Carril destino", lane, 0, draft.destination.carriles - 1));
			row.append(makeNumber("destination-cell", "Celda destino", 0, 0, draft.destination.tamano - 1));
			rowsElement.append(row);
		}
		for (let lane = Math.min(draft.source.carriles, draft.destination.carriles); lane < draft.source.carriles; lane++) {
			const unmatched = document.createElement("div");
			unmatched.className = "link-unmatched small";
			unmatched.dataset.testid = "link-unmatched-lane";
			unmatched.textContent = `Carril origen ${lane + 1} sin correspondencia`;
			rowsElement.append(unmatched);
		}
		updateOverlapNotice();
	}
	function choose(street) {
		if (!draft || !street) return;
		if (!draft.source) {
			draft.source = street;
			status.textContent = `Origen: ${name(street)}. Elige otra calle como destino.`;
		} else if (!draft.destination) {
			if (street === draft.source) {
				status.textContent = "El destino debe ser una calle distinta. Elige otra calle.";
				return;
			}
			draft.destination = street;
			status.textContent = "Revisa las correspondencias Lineales antes de guardar.";
		} else return;
		renderSelectors();
		renderRows();
	}
	function worldPoint(event) {
		const element = canvas();
		const rect = element.getBoundingClientRect();
		if (window.USE_PIXI && window.pixiApp?.cameraController) {
			const screen = window.pixiApp.app?.screen;
			return window.pixiApp.cameraController.screenToWorld(
				((event.clientX - rect.left) * (screen?.width || rect.width)) / rect.width,
				((event.clientY - rect.top) * (screen?.height || rect.height)) / rect.height,
			);
		}
		return {
			x: (((event.clientX - rect.left) * element.width) / rect.width - (Number(window.offsetX) || 0)) / (Number(window.escala) || 1),
			y: (((event.clientY - rect.top) * element.height) / rect.height - (Number(window.offsetY) || 0)) / (Number(window.escala) || 1),
		};
	}
	function onCanvasDown(event) {
		if (!draft || draft.destination || event.target !== canvas() || event.button !== 0) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		suppressClick = true;
		const point = worldPoint(event);
		const hit = window.encontrarCalleEnPunto?.(point.x, point.y);
		if (hit) choose(hit.calle);
	}
	function onCanvasClick(event) {
		if (event.target !== canvas()) return;
		if (suppressClick) {
			suppressClick = false;
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		if (!draft || draft.destination) return;
		const point = worldPoint(event);
		const hit = window.encontrarCalleEnPunto?.(point.x, point.y);
		if (!hit) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		choose(hit.calle);
	}
	function mappings() {
		return [...rowsElement.querySelectorAll("[data-testid='link-mapping-row']")].map((row) => Object.fromEntries(
			["source-lane", "source-cell", "destination-lane", "destination-cell"].map((key) => {
				const value = row.querySelector(`[data-testid='${key}']`).value;
				return [key, value.trim() === "" ? NaN : Number(value)];
			}),
		));
	}
	function effectiveCell(value, size) { return Number(value) === -1 ? size - 1 : Number(value); }
	function invalidMapping(mapping, source, destination) {
		return !Number.isInteger(mapping["source-lane"]) || mapping["source-lane"] < 0 || mapping["source-lane"] >= source.carriles ||
			!Number.isInteger(mapping["destination-lane"]) || mapping["destination-lane"] < 0 || mapping["destination-lane"] >= destination.carriles ||
			!Number.isInteger(mapping["source-cell"]) || (mapping["source-cell"] !== -1 && (mapping["source-cell"] < 0 || mapping["source-cell"] >= source.tamano)) ||
			!Number.isInteger(mapping["destination-cell"]) || mapping["destination-cell"] < 0 || mapping["destination-cell"] >= destination.tamano;
	}
	function duplicate(mapping, source, destination) {
		return (window.conexiones || []).some((link) => link.origen === source && link.destino === destination &&
			link.carrilOrigen === mapping["source-lane"] && link.carrilDestino === mapping["destination-lane"] &&
			effectiveCell(link.posOrigen, source.tamano) === effectiveCell(mapping["source-cell"], source.tamano) &&
			link.posDestino === mapping["destination-cell"]);
	}
	function updateOverlapNotice() {
		notice.textContent = "";
		if (!draft?.source || !draft.destination) return;
		const proposed = mappings();
		if (proposed.some((mapping) => invalidMapping(mapping, draft.source, draft.destination))) return;
		const overlap = proposed.some((mapping) => (window.conexiones || []).some((link) =>
			!duplicate(mapping, draft.source, draft.destination) &&
			((link.origen === draft.source && link.carrilOrigen === mapping["source-lane"] && effectiveCell(link.posOrigen, draft.source.tamano) === effectiveCell(mapping["source-cell"], draft.source.tamano)) ||
			 (link.destino === draft.destination && link.carrilDestino === mapping["destination-lane"] && link.posDestino === mapping["destination-cell"]))));
		if (overlap) notice.textContent = "Existe un solapamiento no idéntico; puedes guardarlo.";
	}
	function reject(text) {
		message.textContent = text;
		panel.setAttribute("aria-invalid", "true");
	}
	function validate(source, destination, proposed) {
		if (!source || !destination || source === destination) return "Selecciona dos calles distintas.";
		const rows = [...rowsElement.querySelectorAll("[data-testid='link-mapping-row']")];
		const keys = new Set();
		let invalid = !proposed.length;
		let repeated = false;
		proposed.forEach((mapping, index) => {
			const key = [mapping["source-lane"], effectiveCell(mapping["source-cell"], source.tamano), mapping["destination-lane"], mapping["destination-cell"]].join(":");
			const duplicateRow = keys.has(key) || duplicate(mapping, source, destination);
			const badRow = invalidMapping(mapping, source, destination) || duplicateRow;
			rows[index]?.classList.toggle("is-invalid", badRow);
			invalid ||= invalidMapping(mapping, source, destination);
			repeated ||= duplicateRow;
			keys.add(key);
		});
		if (invalid) return "Hay una correspondencia fuera de rango.";
		if (repeated) return "Ya existe una correspondencia dirigida idéntica.";
		return "";
	}
	function save() {
		message.textContent = "";
		panel.removeAttribute("aria-invalid");
		const source = streets().find((street) => street.id === sourceSelect.value);
		const destination = streets().find((street) => street.id === destinationSelect.value);
		const proposed = mappings();
		const error = validate(source, destination, proposed);
		if (error) return reject(error);
		const created = proposed.map((mapping) => new window.ConexionCA(source, destination, mapping["source-lane"], mapping["destination-lane"], mapping["source-cell"], mapping["destination-cell"], 1, window.TIPOS_CONEXION.LINEAL));
		window.registrarConexiones?.(created);
		window.conexiones.push(...created);
		window.inicializarIntersecciones?.();
		window.construirMapaIntersecciones?.();
		if (window.pixiApp?.sceneManager) {
			window.pixiApp.sceneManager.conexionRenderer?.clearAll();
			if (window.mostrarConexiones) window.pixiApp.sceneManager.conexionRenderer?.renderAll(window.conexiones);
			window.pixiApp.sceneManager.renderAll?.();
		} else window.renderizarCanvas?.();
		window.actualizarListaConexiones?.(window.calleSeleccionada);
		close();
	}
	button.addEventListener("click", () => draft ? close() : show());
	// Pixi replaces #simuladorCanvas during initialization; delegate to the live view.
	window.addEventListener("pointerdown", onCanvasDown, true);
	document.addEventListener("click", onCanvasClick, true);
	sourceSelect.addEventListener("change", () => {
		const chosen = streets().find((street) => street.id === sourceSelect.value);
		if (chosen && chosen !== draft?.destination) {
			draft.source = chosen;
			if (draft.destination) { status.textContent = "Revisa las correspondencias Lineales antes de guardar."; renderRows(); }
			else status.textContent = "Elige otra calle como destino.";
		}
	});
	destinationSelect.addEventListener("change", () => {
		const chosen = streets().find((street) => street.id === destinationSelect.value);
		if (chosen && chosen !== draft?.source) {
			draft.destination = chosen;
			status.textContent = "Revisa las correspondencias Lineales antes de guardar.";
			renderRows();
		}
	});
	document.getElementById("linkDirectionReverse").addEventListener("click", () => {
		if (!draft?.source || !draft.destination) return;
		[draft.source, draft.destination] = [draft.destination, draft.source];
		status.textContent = "Dirección invertida. Revisa las correspondencias Lineales.";
		renderSelectors(); renderRows();
	});
	document.getElementById("linkSaveButton").addEventListener("click", save);
	document.getElementById("linkCancelButton").addEventListener("click", close);
	document.addEventListener("keydown", (event) => { if (event.key === "Escape" && draft) close(); });
})();
