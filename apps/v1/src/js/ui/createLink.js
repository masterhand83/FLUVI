/* Map-first creation and editing of directed street connections. */
(() => {
	const button = document.getElementById("createLinkButton"),
		panel = document.getElementById("linkDraftPanel");
	if (!button || !panel) return;
	const sourceSelect = document.getElementById("linkSourceStreet"),
		destinationSelect = document.getElementById("linkDestinationStreet");
	const typeSelect = document.getElementById("linkTypeSelect"),
		addExit = document.getElementById("linkAddExit");
	const status = document.getElementById("linkDraftStatus"),
		rowsElement = document.getElementById("linkMappingRows");
	const message = document.getElementById("linkDraftMessage"),
		notice = document.getElementById("linkDraftNotice"),
		pickStatus = document.getElementById("linkMapPickStatus");
	let draft = null,
		suppressClick = false,
		pickRow = null,
		pickPhase = null,
		hoverStreet = null,
		previewFrame = null,
		previewSignature = "";
	const preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	preview.id = "linkDraftPreview";
	preview.setAttribute("aria-hidden", "true");
	preview.setAttribute("data-testid", "link-draft-preview");
	preview.hidden = true;
	document.body.append(preview);
	const streets = () => (Array.isArray(window.calles) ? window.calles : []);
	const name = (s) => s?.nombre || s?.name || s?.id || "";
	const types = {
		LINEAL: window.TIPOS_CONEXION?.LINEAL || "lineal",
		INCORPORACION: window.TIPOS_CONEXION?.INCORPORACION || "incorporacion",
		PROBABILISTICA: window.TIPOS_CONEXION?.PROBABILISTICA || "probabilistica",
	};
	const entry = (street, lane) => window.getLaneEntryCell(street, lane);
	const exit = (street, lane) => window.getLaneExitCell(street, lane);
	const direction = (street, lane) => window.getLaneDirection(street, lane);
	const effective = (v, s) => (Number(v) === -1 ? s - 1 : Number(v));
	const roundabout = (street) => window.roundaboutStreet?.isRoundabout(street) ?? street?.geometryType === "roundabout";
	const explicitCells = () => roundabout(draft?.source) || roundabout(draft?.destination);
	function defaultMapping(source, destination, sourceLane, destinationLane) {
		const needsCells = roundabout(source) || roundabout(destination);
		return {
			"source-lane": sourceLane,
			"source-cell": needsCells ? null : exit(source, sourceLane),
			"destination-lane": destinationLane,
			"destination-cell": needsCells ? null : entry(destination, destinationLane),
		};
	}
	function stopRowPick() {
		pickRow = pickPhase = null;
		pickStatus.hidden = true;
		pickStatus.textContent = "";
		for (const control of rowsElement.querySelectorAll(
			"[data-testid='link-pick-source'], [data-testid='link-pick-destination']",
		)) {
			control.setAttribute("aria-pressed", "false");
			markPickRow(control, false);
		}
	}
	function markPickRow(control, active) {
		const row = control.closest("[data-testid='link-mapping-row']");
		for (const cls of ["border", "border-primary", "rounded", "p-1"])
			row.classList.toggle(cls, active);
	}
	function setPickStatus(text) {
		pickStatus.hidden = false;
		pickStatus.textContent = text;
	}
	function close() {
		stopRowPick();
		draft = null;
		hoverStreet = null;
		cancelAnimationFrame(previewFrame);
		previewFrame = null;
		previewSignature = "";
		preview.replaceChildren();
		preview.hidden = true;
		panel.hidden = true;
		panel.setAttribute("aria-hidden", "true");
		panel.removeAttribute("aria-invalid");
		message.textContent = notice.textContent = "";
		button.classList.remove("active");
	}
	function selectors() {
		for (const [select, picked] of [
			[sourceSelect, draft?.source],
			[destinationSelect, draft?.destination],
		]) {
			select.replaceChildren(new Option("Selecciona una calle", ""));
			for (const { street } of window.streetListUI.sortedEntries(streets()))
				select.add(new Option(name(street), street.id));
			select.value = picked?.id || "";
		}
	}
	function defaults() {
		if (!draft.source || !draft.destination) return [];
		if (draft.type === types.INCORPORACION)
			return Array.from({ length: draft.source.carriles }, (_, lane) => ({
				...defaultMapping(draft.source, draft.destination, lane, 0),
				"destination-cell": explicitCells() ? null :
					entry(draft.destination, 0) + direction(draft.destination, 0) * lane,
				chance: 100,
			}));
		return Array.from(
			{
				length:
					draft.type === types.LINEAL
						? Math.min(draft.source.carriles, draft.destination.carriles)
						: 1,
			},
			(_, lane) => ({
				...defaultMapping(draft.source, draft.destination, lane, draft.type === types.LINEAL ? lane : 0),
				chance: 100,
			}),
		);
	}
	function input(row, key, label, value, min, max, step = "1") {
		const wrap = document.createElement("label");
		wrap.textContent = label;
		const el = document.createElement("input");
		el.type = "number";
		el.className = "form-control form-control-sm";
		el.min = min;
		el.max = max;
		el.step = step;
		el.value = value;
		el.dataset.testid = key;
		el.addEventListener("input", updateNotice);
		wrap.append(el);
		row.append(wrap);
	}
	function pickButton(container, row, index, phase) {
		const label = `Elegir ${phase === "source" ? "origen" : "destino"} en mapa para correspondencia ${index + 1}`;
		const pick = document.createElement("button");
		pick.type = "button";
		pick.className = "btn btn-outline-secondary btn-sm mb-1 align-self-start";
		pick.dataset.testid = `link-pick-${phase}`;
		pick.dataset.phase = phase;
		pick.textContent = "📍";
		pick.title = label;
		pick.setAttribute("aria-label", label);
		pick.setAttribute("aria-pressed", "false");
		pick.setAttribute("aria-controls", "linkMapPickStatus");
		pick.addEventListener("click", () => {
			if (pickRow === row && pickPhase === phase) {
				stopRowPick();
				return;
			}
			stopRowPick();
			pickRow = row;
			pickPhase = phase;
			pick.setAttribute("aria-pressed", "true");
			markPickRow(pick, true);
			setPickStatus(
				`Correspondencia ${index + 1}: elige una celda de ${phase === "source" ? "origen" : "destino"} en ${name(phase === "source" ? draft.source : draft.destination)}. Escape cancela.`,
			);
		});
		container.append(pick);
	}
	function renderLinealSummary() {
		const summary = document.createElement("div");
		summary.className = "small";
		summary.dataset.testid = "link-lineal-summary";
		summary.textContent = `Correspondencias: ${mappings().map((m) => {
			const sourceCell = effective(m["source-cell"], draft.source.tamano),
				destinationCell = m["destination-cell"];
			const sourceEnd = sourceCell === draft.source.tamano - 1 ? "última celda" : sourceCell === 0 ? "primera celda" : "celda";
			const destinationEnd = destinationCell === 0 ? "primera celda" : destinationCell === draft.destination.tamano - 1 ? "última celda" : "celda";
			return `carril ${m["source-lane"] + 1}: ${sourceEnd} de origen (${sourceCell}) → carril ${m["destination-lane"] + 1}, ${destinationEnd} de destino (${destinationCell})`;
		}).join("; ")}.`;
		rowsElement.append(summary);
		const matched = new Set(mappings().map((m) => m["source-lane"]));
		for (let lane = 0; lane < draft.source.carriles; lane++) {
			if (matched.has(lane)) continue;
			const el = document.createElement("div");
			el.className = "link-unmatched small";
			el.dataset.testid = "link-unmatched-lane";
			el.textContent = `Carril origen ${lane + 1} sin correspondencia`;
			rowsElement.append(el);
		}
	}
	function renderMappingRow(m, index) {
		const sourceCells = draft.type === types.PROBABILISTICA || explicitCells(),
			linealEndpoints = draft.type === types.LINEAL && !explicitCells();
		const row = document.createElement("div");
		row.className = "link-mapping-row";
		row.dataset.testid = "link-mapping-row";
		const origin = document.createElement("div");
		origin.className = "d-flex flex-column gap-1";
		const destination = document.createElement("div");
		destination.className = "d-flex flex-column gap-1";
		if (sourceCells)
			pickButton(origin, row, index, "source");
		input(
			origin,
			"source-lane",
			"Carril origen",
			m["source-lane"],
			0,
			draft.source.carriles - 1,
		);
		if (sourceCells)
			cellInput(origin, "source", m["source-cell"]);
		else {
			fixedCell(origin, "source", m["source-cell"]);
		}
		if (!linealEndpoints)
			pickButton(destination, row, index, "destination");
		input(
			destination,
			"destination-lane",
			"Carril destino",
			m["destination-lane"],
			0,
			draft.destination.carriles - 1,
		);
		if (linealEndpoints) {
			fixedCell(destination, "destination", m["destination-cell"]);
		} else cellInput(destination, "destination", m["destination-cell"]);
		row.append(origin, destination);
		if (draft.type === types.PROBABILISTICA)
			input(row, "chance", "Probabilidad (%)", m.chance, 0, 100, "any");
		if (draft.type !== types.INCORPORACION) removeMappingButton(row);
		rowsElement.append(row);
	}
	function cellInput(container, phase, cell) {
		const street = draft[phase];
		input(container, `${phase}-cell`, phase === "source" ? "Celda origen" : "Celda destino",
			cell ?? "", phase === "source" && !roundabout(street) ? -1 : 0, street.tamano - 1);
	}
	function removeMappingButton(row) {
		const remove = document.createElement("button");
		remove.type = "button";
		remove.textContent = "×";
		remove.setAttribute("aria-label", draft.type === types.LINEAL ? "Eliminar correspondencia" : "Eliminar salida");
		remove.addEventListener("click", () => {
			const index = [...rowsElement.querySelectorAll("[data-testid='link-mapping-row']")].indexOf(row);
			draft.rows = mappings();
			draft.rows.splice(index, 1);
			renderRows();
		});
		row.append(remove);
	}
	function fixedCell(container, phase, savedCell) {
		const street = draft[phase],
			laneInput = container.querySelector(`[data-testid='${phase}-lane']`),
			endpoint = phase === "source" ? exit : entry;
		const fixed = document.createElement("span");
		fixed.className = "small";
		fixed.dataset.testid = `link-fixed-${phase}-cell`;
		// Retain saved explicit cells until the corresponding lane changes.
		fixed.dataset.cell = savedCell;
		const update = () => {
			const cell = effective(fixed.dataset.cell, street.tamano);
			const end = cell === street.tamano - 1 ? "última" : cell === 0 ? "primera" : "celda";
			fixed.textContent = `Celda ${phase === "source" ? "origen" : "destino"}: ${end} del carril ${Number(laneInput.value) + 1} (${cell})`;
		};
		update();
		container.append(fixed);
		laneInput.addEventListener("input", () => {
			fixed.dataset.cell = endpoint(street, Number(laneInput.value));
			update();
			updateNotice();
		});
	}
	function renderRows() {
		stopRowPick();
		rowsElement.replaceChildren();
		if (!draft?.source || !draft.destination) return;
		for (const [index, mapping] of draft.rows.entries())
			renderMappingRow(mapping, index);
		updateNotice();
	}
	function cellPoint(street, lane, cell) {
		if (roundabout(street)) return window.roundaboutStreet?.coordinates(street, lane, cell);
		const curved =
			street.esCurva && (street.bezierGeometry || street.vertices?.length > 0);
		const coordinates =
			(curved && window.obtenerCoordenadasGlobalesCeldaConCurva) ||
			window.obtenerCoordenadasGlobalesCelda;
		return coordinates?.(street, lane, cell);
	}
	function screenPoint(point, canvas, rect) {
		if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
			return null;
		const camera = window.USE_PIXI && window.pixiApp?.cameraController;
		if (camera) {
			const screen = camera.worldToScreen(point.x, point.y);
			return {
				x: (screen.x * rect.width) / window.pixiApp.app.screen.width,
				y: (screen.y * rect.height) / window.pixiApp.app.screen.height,
			};
		}
		return {
			x:
				((point.x * (Number(window.escala) || 1) +
					(Number(window.offsetX) || 0)) *
					rect.width) /
				canvas.width,
			y:
				((point.y * (Number(window.escala) || 1) +
					(Number(window.offsetY) || 0)) *
					rect.height) /
				canvas.height,
		};
	}
	function previewMappings() {
		if (!draft?.source) return [];
		if (draft.destination)
			return mappings()
				.filter((m) => !invalidMapping(m, draft.source, draft.destination))
				.map((m) => ({
					source: draft.source,
					destination: draft.destination,
					mapping: m,
				}));
		if (!hoverStreet || hoverStreet === draft.source) return [];
		if (roundabout(draft.source) || roundabout(hoverStreet)) return [];
		return [
			{
				source: draft.source,
				destination: hoverStreet,
				mapping: {
					...defaultMapping(draft.source, hoverStreet, 0, 0),
				},
			},
		];
	}
	function drawPreview() {
		if (!draft) return;
		const canvas = document.getElementById("simuladorCanvas");
		const rect = canvas.getBoundingClientRect();
		const arrows = previewMappings()
			.map(({ source, destination, mapping }) => {
				const start = screenPoint(
					cellPoint(
						source,
						mapping["source-lane"],
						effective(mapping["source-cell"], source.tamano),
					),
					canvas,
					rect,
				);
				const end = screenPoint(
					cellPoint(
						destination,
						mapping["destination-lane"],
						mapping["destination-cell"],
					),
					canvas,
					rect,
				);
				return start && end ? { start, end } : null;
			})
			.filter(Boolean);
		const signature = JSON.stringify([
			rect.left,
			rect.top,
			rect.width,
			rect.height,
			draft.type,
			arrows,
		]);
		if (signature !== previewSignature) {
			previewSignature = signature;
			preview.style.left = `${rect.left}px`;
			preview.style.top = `${rect.top}px`;
			preview.setAttribute("width", rect.width);
			preview.setAttribute("height", rect.height);
			preview.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
			preview.replaceChildren(
				...arrows.map(({ start, end }) => {
					const arrow = document.createElementNS(
						"http://www.w3.org/2000/svg",
						"path",
					);
					const angle = Math.atan2(end.y - start.y, end.x - start.x);
					const wing = (offset) =>
						`${end.x - 11 * Math.cos(angle + offset)},${end.y - 11 * Math.sin(angle + offset)}`;
					arrow.setAttribute(
						"d",
						`M ${start.x},${start.y} L ${end.x},${end.y} M ${wing(Math.PI / 6)} L ${end.x},${end.y} L ${wing(-Math.PI / 6)}`,
					);
					arrow.setAttribute("data-testid", "link-preview-arrow");
					arrow.setAttribute("fill", "none");
					arrow.setAttribute(
						"stroke",
						{
							[types.LINEAL]: "#15803d",
							[types.INCORPORACION]: "#c2410c",
							[types.PROBABILISTICA]: "#7c3aed",
						}[draft.type],
					);
					arrow.setAttribute("stroke-width", "3");
					arrow.setAttribute("stroke-dasharray", "7 5");
					arrow.setAttribute("stroke-opacity", "0.8");
					return arrow;
				}),
			);
			preview.hidden = !arrows.length;
		}
		previewFrame = requestAnimationFrame(drawPreview);
	}
	function show(source = null, destination = null, link = null) {
		cancelAnimationFrame(previewFrame);
		hoverStreet = null;
		previewSignature = "";
		window.drawStreetTool?.deactivate();
		window.streetEditPause?.();
		draft = {
			source,
			destination,
			type:
				link?.tipo === types.INCORPORACION
					? types.INCORPORACION
					: link?.tipo === types.PROBABILISTICA
						? types.PROBABILISTICA
						: types.LINEAL,
			editing: link,
			rows: link
				? [
						{
							"source-lane": link.carrilOrigen,
							"source-cell": link.posOrigen,
							"destination-lane": link.carrilDestino,
							"destination-cell": link.posDestino,
							chance: (link.probabilidadTransferencia ?? 1) * 100,
						},
					]
				: [],
		};
		panel.hidden = false;
		panel.setAttribute("aria-hidden", "false");
		panel.removeAttribute("aria-invalid");
		button.classList.add("active");
		status.textContent = link
			? "Edita la correspondencia y guarda los cambios."
			: "Elige la calle de origen en el mapa.";
		message.textContent = notice.textContent = "";
		typeSelect.value =
			Object.keys(types).find((k) => types[k] === draft.type) || "LINEAL";
		updateAddButton();
		selectors();
		renderRows();
		previewFrame = requestAnimationFrame(drawPreview);
	}
	function choose(street) {
		if (!draft || !street) return;
		if (!draft.source) {
			draft.source = street;
			status.textContent = `Origen: ${name(street)}. Elige otra calle como destino.`;
		} else if (!draft.destination) {
			if (street === draft.source) {
				status.textContent = "El destino debe ser una calle distinta.";
				return;
			}
			draft.destination = street;
			draft.rows = defaults();
			status.textContent = explicitCells()
				? "Elige celdas de origen y destino en el mapa o escribe sus índices antes de guardar."
				: "Revisa las correspondencias antes de guardar.";
		} else return;
		selectors();
		renderRows();
	}
	function worldPoint(e) {
		const c = document.getElementById("simuladorCanvas"),
			r = c.getBoundingClientRect();
		if (window.USE_PIXI && window.pixiApp?.cameraController) {
			const s = window.pixiApp.app?.screen;
			return window.pixiApp.cameraController.screenToWorld(
				((e.clientX - r.left) * (s?.width || r.width)) / r.width,
				((e.clientY - r.top) * (s?.height || r.height)) / r.height,
			);
		}
		return {
			x:
				(((e.clientX - r.left) * c.width) / r.width -
					(Number(window.offsetX) || 0)) /
				(Number(window.escala) || 1),
			y:
				(((e.clientY - r.top) * c.height) / r.height -
					(Number(window.offsetY) || 0)) /
				(Number(window.escala) || 1),
		};
	}
	function mapPick(e) {
		const c = document.getElementById("simuladorCanvas");
		if (
			e.target !== c &&
			!(pickRow && e.target.closest?.(".street-endpoint-handle"))
		)
			return;
		if (suppressClick) {
			suppressClick = false;
			e.preventDefault();
			e.stopImmediatePropagation();
			return;
		}
		if (!draft || draft.destination || pickRow) return;
		const p = worldPoint(e),
			hit = window.encontrarCalleEnPunto?.(p.x, p.y);
		if (hit) {
			e.preventDefault();
			e.stopImmediatePropagation();
			choose(hit.calle);
		}
	}
	function pickCell(e) {
		const row = pickRow;
		if (!row || !draft) return;
		const phase = pickPhase;
		const expected = phase === "source" ? draft.source : draft.destination;
		const p = worldPoint(e);
		const hit = window.encontrarCalleEnPunto?.(p.x, p.y);
		const index =
			[
				...rowsElement.querySelectorAll("[data-testid='link-mapping-row']"),
			].indexOf(row) + 1;
		if (hit?.calle !== expected) {
			const reason = hit ? "calle incorrecta" : "fuera de la calle";
			setPickStatus(
				`Correspondencia ${index}: ${reason}. Elige una celda de ${phase === "source" ? "origen" : "destino"} en ${name(expected)}.`,
			);
			return;
		}
		const cell = window.cellGeometryIndex?.findNearest(p.x, p.y, [expected]);
		if (!validPickedCell(cell, expected)) {
			setPickStatus(
				`Correspondencia ${index}: no se encontró una celda válida en ${name(expected)}. Vuelve a intentarlo.`,
			);
			return;
		}
		applyPickedCell(row, phase, cell, index);
	}
	function applyPickedCell(row, phase, cell, index) {
		const lane = row.querySelector(`[data-testid='${phase}-lane']`);
		const position = row.querySelector(`[data-testid='${phase}-cell']`);
		lane.value = cell.carril;
		position.value = cell.indice;
		draft.rows = mappings();
		updateNotice();
		stopRowPick();
		setPickStatus(
			`Correspondencia ${index}: ${phase === "source" ? "origen" : "destino"} elegido en el mapa (carril ${cell.carril}, celda ${cell.indice}). Revisa los campos antes de guardar.`,
		);
	}
	function validPickedCell(cell, expected) {
		return (
			cell?.calle === expected &&
			Number.isInteger(cell.carril) &&
			Number.isInteger(cell.indice) &&
			cell.carril >= 0 &&
			cell.carril < expected.carriles &&
			cell.indice >= 0 &&
			cell.indice < expected.tamano
		);
	}
	function mappings() {
		if (!draft?.source || !draft.destination) return [];
		return readRows();
	}
	function readRows() {
		const value = (row, key) => {
			const text = row.querySelector(`[data-testid='${key}']`).value;
			return text.trim() === "" ? NaN : Number(text);
		};
		return [
			...rowsElement.querySelectorAll("[data-testid='link-mapping-row']"),
		].map((row) => ({
			"source-lane": value(row, "source-lane"),
			"source-cell": readSourceCell(row, value),
			"destination-lane": value(row, "destination-lane"),
			"destination-cell": draft.type === types.LINEAL && !explicitCells()
				? Number(row.querySelector("[data-testid='link-fixed-destination-cell']").dataset.cell)
				: value(row, "destination-cell"),
			...(draft.type === types.PROBABILISTICA
				? { chance: value(row, "chance") }
				: {}),
		}));
	}
	function readSourceCell(row, value) {
		if (explicitCells() || draft.type === types.PROBABILISTICA)
			return value(row, "source-cell");
		if (draft.type === types.LINEAL)
			return Number(row.querySelector("[data-testid='link-fixed-source-cell']").dataset.cell);
		const lane = value(row, "source-lane"), saved = draft.editing;
		if (saved?.tipo === types.INCORPORACION && draft.source === saved.origen &&
			lane === saved.carrilOrigen && effective(saved.posOrigen, draft.source.tamano) === exit(draft.source, lane))
			return saved.posOrigen;
		return exit(draft.source, lane);
	}
	function mappingKey(mapping, source) {
		return [
			mapping["source-lane"],
			effective(mapping["source-cell"], source.tamano),
			mapping["destination-lane"],
			mapping["destination-cell"],
		].join(":");
	}
	function invalidMapping(mapping, source, destination) {
		return (
			!Number.isInteger(mapping["source-lane"]) ||
			mapping["source-lane"] < 0 ||
			mapping["source-lane"] >= source.carriles ||
			!Number.isInteger(mapping["destination-lane"]) ||
			mapping["destination-lane"] < 0 ||
			mapping["destination-lane"] >= destination.carriles ||
			!Number.isInteger(mapping["source-cell"]) ||
			(roundabout(source) && mapping["source-cell"] === -1) ||
			(mapping["source-cell"] !== -1 &&
				(mapping["source-cell"] < 0 ||
					mapping["source-cell"] >= source.tamano)) ||
			!Number.isInteger(mapping["destination-cell"]) ||
			mapping["destination-cell"] < 0 ||
			mapping["destination-cell"] >= destination.tamano ||
			!window.isConnectionDirectionCompatible({
				origen: source,
				destino: destination,
				carrilOrigen: mapping["source-lane"],
				carrilDestino: mapping["destination-lane"],
				posOrigen: mapping["source-cell"],
				posDestino: mapping["destination-cell"],
			}) ||
			(draft.type === types.PROBABILISTICA &&
				(!Number.isFinite(mapping.chance) ||
					mapping.chance < 0 ||
					mapping.chance > 100))
		);
	}
	function isDuplicate(m, s, d) {
		return (window.conexiones || []).some(
			(l) =>
				l !== draft.editing &&
				l.origen === s &&
				l.destino === d &&
				l.carrilOrigen === m["source-lane"] &&
				l.carrilDestino === m["destination-lane"] &&
				effective(l.posOrigen, s.tamano) ===
					effective(m["source-cell"], s.tamano) &&
				l.posDestino === m["destination-cell"],
		);
	}
	function updateNotice() {
		notice.textContent = "";
		if (!draft?.source || !draft.destination) return;
		updateLinealSummary();
		const ms = mappings();
		if (
			ms.some((mapping) =>
				invalidMapping(mapping, draft.source, draft.destination),
			)
		)
			return;
		const keys = new Set();
		for (const m of ms) {
			const key = mappingKey(m, draft.source);
			if (keys.has(key) || isDuplicate(m, draft.source, draft.destination))
				return;
			keys.add(key);
		}
		const overlap = ms.some((m) =>
			(window.conexiones || []).some(
				(l) =>
					l !== draft.editing &&
					((l.origen === draft.source &&
						l.carrilOrigen === m["source-lane"] &&
						effective(l.posOrigen, draft.source.tamano) ===
							effective(m["source-cell"], draft.source.tamano)) ||
						(l.destino === draft.destination &&
							l.carrilDestino === m["destination-lane"] &&
							l.posDestino === m["destination-cell"])),
			),
		);
		if (overlap)
			notice.textContent =
				"Existe un solapamiento no idéntico; puedes guardarlo.";
	}
	function updateLinealSummary() {
		for (const el of rowsElement.querySelectorAll("[data-testid='link-lineal-summary'], [data-testid='link-unmatched-lane']")) el.remove();
		if (draft.type === types.LINEAL && !explicitCells()) renderLinealSummary();
	}
	function validate(ms, s, d) {
		if (!s || !d || s === d) return "Selecciona dos calles distintas.";
		const rows = [
				...rowsElement.querySelectorAll("[data-testid='link-mapping-row']"),
			],
			keys = new Set();
		let bad = false,
			duplicateFound = false;
		ms.forEach((m, i) => {
			const key = mappingKey(m, s);
			const dup = keys.has(key) || isDuplicate(m, s, d);
			const invalidRow = invalidMapping(m, s, d);
			(
				rows[i] ||
				(draft.type === types.LINEAL
					? rowsElement.querySelector("[data-testid='link-lineal-summary']")
					: null)
			)?.classList.toggle("is-invalid", dup || invalidRow);
			bad ||= invalidRow;
			duplicateFound ||= dup;
			keys.add(key);
		});
		if (!ms.length) return "Añade al menos una correspondencia.";
		if (bad)
			return "Hay una correspondencia fuera de rango, con dirección incompatible o probabilidad inválida.";
		if (duplicateFound)
			return "Ya existe una correspondencia dirigida idéntica.";
		return "";
	}
	function refresh() {
		window.inicializarIntersecciones?.();
		window.construirMapaIntersecciones?.();
		if (window.pixiApp?.sceneManager) {
			window.pixiApp.sceneManager.conexionRenderer?.clearAll();
			if (window.mostrarConexiones)
				window.pixiApp.sceneManager.conexionRenderer?.renderAll(
					window.conexiones,
				);
			window.pixiApp.sceneManager.renderAll?.();
		} else window.renderizarCanvas?.();
		window.actualizarListaConexiones?.(window.calleSeleccionada);
	}
	function commitMappings(ms, source, destination) {
		const created = ms.map(
			(m) =>
				new window.ConexionCA(
					source,
					destination,
					m["source-lane"],
					m["destination-lane"],
					m["source-cell"],
					m["destination-cell"],
					draft.type === types.PROBABILISTICA ? m.chance / 100 : 1,
					draft.type,
				),
		);
		if (draft.editing) {
			const old = draft.editing;
			const index = window.conexiones.indexOf(old);
			if (index < 0) return false;
			const out = old.origen.conexionesSalida?.[old.carrilOrigen];
			if (out) {
				const i = out.indexOf(old);
				if (i >= 0) out.splice(i, 1);
			}
			window.conexiones.splice(index, 1, ...created);
		} else {
			window.conexiones.push(...created);
		}
		window.registrarConexiones?.(created);
		return true;
	}
	function save() {
		message.textContent = "";
		panel.removeAttribute("aria-invalid");
		if (
			draft.editing &&
			(!Array.isArray(window.conexiones) ||
				!window.conexiones.includes(draft.editing))
		) {
			message.textContent = "La conexión que editabas ya no existe.";
			panel.setAttribute("aria-invalid", "true");
			return;
		}
		const s = streets().find((x) => x.id === sourceSelect.value),
			d = streets().find((x) => x.id === destinationSelect.value),
			ms = mappings(),
			err = validate(ms, s, d);
		if (err) {
			message.textContent = err;
			panel.setAttribute("aria-invalid", "true");
			return;
		}
		if (!commitMappings(ms, s, d)) {
			message.textContent = "La conexión que editabas ya no existe.";
			panel.setAttribute("aria-invalid", "true");
			return;
		}
		refresh();
		close();
	}
	window.createLinkTool = {
		edit(link) {
			if (!link || !(window.conexiones || []).includes(link)) return false;
			show(link.origen, link.destino, link);
			return true;
		},
	};
	button.addEventListener("click", () => (draft ? close() : show()));
	window.addEventListener(
		"pointerdown",
		(e) => {
			if (
				!draft ||
				(draft.destination && !pickRow) ||
				(e.target !== document.getElementById("simuladorCanvas") &&
					!(pickRow && e.target.closest?.(".street-endpoint-handle"))) ||
				e.button !== 0
			)
				return;
			e.preventDefault();
			e.stopImmediatePropagation();
			suppressClick = true;
			if (pickRow) {
				pickCell(e);
				return;
			}
			const p = worldPoint(e),
				hit = window.encontrarCalleEnPunto?.(p.x, p.y);
			if (hit) choose(hit.calle);
		},
		true,
	);
	document.addEventListener("click", mapPick, true);
	window.addEventListener(
		"pointermove",
		(event) => {
			if (
				event.target !== document.getElementById("simuladorCanvas") ||
				!draft?.source ||
				draft.destination
			)
				return;
			const point = worldPoint(event);
			hoverStreet =
				window.encontrarCalleEnPunto?.(point.x, point.y)?.calle || null;
		},
		true,
	);
	document
		.getElementById("simuladorCanvas")
		.addEventListener("pointerleave", () => {
			hoverStreet = null;
		});
	for (const [select, key] of [
		[sourceSelect, "source"],
		[destinationSelect, "destination"],
	])
		select.addEventListener("change", () => {
			stopRowPick();
			const picked = streets().find((s) => s.id === select.value);
			if (
				!picked ||
				picked === draft?.[key === "source" ? "destination" : "source"]
			)
				return;
			draft[key] = picked;
			if (draft.source && draft.destination)
				draft.rows = defaults();
			status.textContent = explicitCells()
				? "Elige celdas de origen y destino en el mapa o escribe sus índices antes de guardar."
				: "Revisa las correspondencias antes de guardar.";
			renderRows();
		});
	typeSelect.addEventListener("change", () => {
		if (!draft) return;
		draft.type = types[typeSelect.value];
		draft.rows = defaults();
		updateAddButton();
		renderRows();
	});
	function updateAddButton() {
		addExit.hidden = draft.type === types.INCORPORACION;
		addExit.textContent = draft.type === types.LINEAL ? "＋ Añadir correspondencia" : "＋ Añadir salida";
	}
	addExit.addEventListener("click", () => {
		if (
			(draft?.type === types.PROBABILISTICA || draft?.type === types.LINEAL) &&
			draft.source &&
			draft.destination
		) {
			draft.rows = mappings();
			const used = new Set(draft.rows.map((m) => m["source-lane"]));
			const lane = draft.type === types.LINEAL
				? Array.from({ length: draft.source.carriles }, (_, i) => i).find((i) => !used.has(i)) ?? 0
				: 0;
			draft.rows.push({
				...defaultMapping(draft.source, draft.destination, lane, Math.min(lane, draft.destination.carriles - 1)),
				chance: 100,
			});
			renderRows();
		}
	});
	document
		.getElementById("linkDirectionReverse")
		.addEventListener("click", () => {
			if (!draft?.source || !draft.destination) return;
			[draft.source, draft.destination] = [draft.destination, draft.source];
			draft.rows = defaults();
			selectors();
			renderRows();
		});
	document.getElementById("linkSaveButton").addEventListener("click", save);
	document.getElementById("linkCancelButton").addEventListener("click", close);
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && draft) close();
	});
})();
