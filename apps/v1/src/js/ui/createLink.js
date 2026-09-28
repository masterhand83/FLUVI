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
		pickPhase = null;
	const streets = () => (Array.isArray(window.calles) ? window.calles : []);
	const name = (s) => s?.nombre || s?.name || s?.id || "";
	const types = {
		LINEAL: window.TIPOS_CONEXION?.LINEAL || "lineal",
		INCORPORACION: window.TIPOS_CONEXION?.INCORPORACION || "incorporacion",
		PROBABILISTICA: window.TIPOS_CONEXION?.PROBABILISTICA || "probabilistica",
	};
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
				"source-lane": lane,
				"source-cell": draft.source.tamano - 1,
				"destination-lane": 0,
				"destination-cell": lane,
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
				"source-lane": lane,
				"source-cell": draft.source.tamano - 1,
				"destination-lane": draft.type === types.LINEAL ? lane : 0,
				"destination-cell": 0,
				chance: 100,
			}),
		);
	}
	function linealMappings(source, destination) {
		const all = Array.from(
			{ length: Math.min(source.carriles, destination.carriles) },
			(_, lane) => ({
				"source-lane": lane,
				"source-cell": source.tamano - 1,
				"destination-lane": lane,
				"destination-cell": 0,
			}),
		);
		return draft.editing
			? all.filter(
					(mapping) => mapping["source-lane"] === draft.editing.carrilOrigen,
				)
			: all;
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
		summary.textContent = `Correspondencia fija: última celda de origen (${draft.source.tamano - 1}) → primera celda de destino (0), ${draft.editing ? `carril ${draft.editing.carrilOrigen + 1}` : `por carriles coincidentes (1–${Math.min(draft.source.carriles, draft.destination.carriles)})`}.`;
		rowsElement.append(summary);
		for (
			let lane = draft.destination.carriles;
			lane < draft.source.carriles;
			lane++
		) {
			const el = document.createElement("div");
			el.className = "link-unmatched small";
			el.dataset.testid = "link-unmatched-lane";
			el.textContent = `Carril origen ${lane + 1} sin correspondencia`;
			rowsElement.append(el);
		}
	}
	function renderMappingRow(m, index) {
		const row = document.createElement("div");
		row.className = "link-mapping-row";
		row.dataset.testid = "link-mapping-row";
		const origin = document.createElement("div");
		origin.className = "d-flex flex-column gap-1";
		const destination = document.createElement("div");
		destination.className = "d-flex flex-column gap-1";
		if (draft.type === types.PROBABILISTICA)
			pickButton(origin, row, index, "source");
		input(
			origin,
			"source-lane",
			"Carril origen",
			m["source-lane"],
			0,
			draft.source.carriles - 1,
		);
		if (draft.type === types.PROBABILISTICA)
			input(
				origin,
				"source-cell",
				"Celda origen",
				m["source-cell"],
				-1,
				draft.source.tamano - 1,
			);
		else {
			const fixed = document.createElement("span");
			fixed.className = "small";
			fixed.textContent = `Celda origen: última (${draft.source.tamano - 1})`;
			origin.append(fixed);
		}
		pickButton(destination, row, index, "destination");
		input(
			destination,
			"destination-lane",
			"Carril destino",
			m["destination-lane"],
			0,
			draft.destination.carriles - 1,
		);
		input(
			destination,
			"destination-cell",
			"Celda destino",
			m["destination-cell"],
			0,
			draft.destination.tamano - 1,
		);
		row.append(origin, destination);
		if (draft.type === types.PROBABILISTICA)
			input(row, "chance", "Probabilidad (%)", m.chance, 0, 100, "any");
		if (draft.type === types.PROBABILISTICA) {
			const remove = document.createElement("button");
			remove.type = "button";
			remove.textContent = "×";
			remove.setAttribute("aria-label", "Eliminar salida");
			remove.addEventListener("click", () => {
				const index = [...rowsElement.children].indexOf(row);
				draft.rows = mappings();
				draft.rows.splice(index, 1);
				renderRows();
			});
			row.append(remove);
		}
		rowsElement.append(row);
	}
	function renderRows() {
		stopRowPick();
		rowsElement.replaceChildren();
		if (!draft?.source || !draft.destination) return;
		if (draft.type === types.LINEAL) renderLinealSummary();
		else
			for (const [index, mapping] of draft.rows.entries())
				renderMappingRow(mapping, index);
		updateNotice();
	}
	function show(source = null, destination = null, link = null) {
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
			? draft.type === types.LINEAL
				? "Revisa la correspondencia fija y guarda los cambios."
				: "Edita la correspondencia y guarda los cambios."
			: "Elige la calle de origen en el mapa.";
		message.textContent = notice.textContent = "";
		typeSelect.value =
			Object.keys(types).find((k) => types[k] === draft.type) || "LINEAL";
		addExit.hidden = draft.type !== types.PROBABILISTICA;
		selectors();
		renderRows();
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
			status.textContent = "Revisa las correspondencias antes de guardar.";
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
		if (draft?.type === types.LINEAL)
			return draft.source && draft.destination
				? linealMappings(draft.source, draft.destination)
				: [];
		const value = (row, key) => {
			const text = row.querySelector(`[data-testid='${key}']`).value;
			return text.trim() === "" ? NaN : Number(text);
		};
		return [
			...rowsElement.querySelectorAll("[data-testid='link-mapping-row']"),
		].map((row) => ({
			"source-lane": value(row, "source-lane"),
			"source-cell":
				draft.type === types.INCORPORACION
					? draft.source.tamano - 1
					: value(row, "source-cell"),
			"destination-lane": value(row, "destination-lane"),
			"destination-cell": value(row, "destination-cell"),
			...(draft.type === types.PROBABILISTICA
				? { chance: value(row, "chance") }
				: {}),
		}));
	}
	const effective = (v, s) => (Number(v) === -1 ? s - 1 : Number(v));
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
			(mapping["source-cell"] !== -1 &&
				(mapping["source-cell"] < 0 ||
					mapping["source-cell"] >= source.tamano)) ||
			!Number.isInteger(mapping["destination-cell"]) ||
			mapping["destination-cell"] < 0 ||
			mapping["destination-cell"] >= destination.tamano ||
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
			return "Hay una correspondencia fuera de rango o probabilidad inválida.";
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
			if (draft.source && draft.destination && !draft.editing)
				draft.rows = defaults();
			status.textContent = "Revisa las correspondencias antes de guardar.";
			renderRows();
		});
	typeSelect.addEventListener("change", () => {
		if (!draft) return;
		draft.type = types[typeSelect.value];
		draft.rows = defaults();
		addExit.hidden = draft.type !== types.PROBABILISTICA;
		renderRows();
	});
	addExit.addEventListener("click", () => {
		if (
			draft?.type === types.PROBABILISTICA &&
			draft.source &&
			draft.destination
		) {
			draft.rows = mappings();
			draft.rows.push({
				"source-lane": 0,
				"source-cell": draft.source.tamano - 1,
				"destination-lane": 0,
				"destination-cell": 0,
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
