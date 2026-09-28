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
		notice = document.getElementById("linkDraftNotice");
	let draft = null,
		suppressClick = false;
	const streets = () => (Array.isArray(window.calles) ? window.calles : []);
	const name = (s) => s?.nombre || s?.name || s?.id || "";
	const types = {
		LINEAL: window.TIPOS_CONEXION?.LINEAL || "lineal",
		INCORPORACION: window.TIPOS_CONEXION?.INCORPORACION || "incorporacion",
		PROBABILISTICA: window.TIPOS_CONEXION?.PROBABILISTICA || "probabilistica",
	};
	function close() {
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
	function renderRows() {
		rowsElement.replaceChildren();
		if (!draft?.source || !draft.destination) return;
		for (const m of draft.rows) {
			const row = document.createElement("div");
			row.className = "link-mapping-row";
			row.dataset.testid = "link-mapping-row";
			input(
				row,
				"source-lane",
				"Carril origen",
				m["source-lane"],
				0,
				draft.source.carriles - 1,
			);
			input(
				row,
				"source-cell",
				"Celda origen",
				m["source-cell"],
				-1,
				draft.source.tamano - 1,
			);
			input(
				row,
				"destination-lane",
				"Carril destino",
				m["destination-lane"],
				0,
				draft.destination.carriles - 1,
			);
			input(
				row,
				"destination-cell",
				"Celda destino",
				m["destination-cell"],
				0,
				draft.destination.tamano - 1,
			);
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
		for (
			let lane = Math.min(draft.source.carriles, draft.destination.carriles);
			draft.type === types.LINEAL && lane < draft.source.carriles;
			lane++
		) {
			const el = document.createElement("div");
			el.className = "link-unmatched small";
			el.dataset.testid = "link-unmatched-lane";
			el.textContent = `Carril origen ${lane + 1} sin correspondencia`;
			rowsElement.append(el);
		}
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
			? "Edita la correspondencia y guarda los cambios."
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
		if (e.target !== c) return;
		if (suppressClick) {
			suppressClick = false;
			e.preventDefault();
			e.stopImmediatePropagation();
			return;
		}
		if (!draft || draft.destination) return;
		const p = worldPoint(e),
			hit = window.encontrarCalleEnPunto?.(p.x, p.y);
		if (hit) {
			e.preventDefault();
			e.stopImmediatePropagation();
			choose(hit.calle);
		}
	}
	function mappings() {
		return [
			...rowsElement.querySelectorAll("[data-testid='link-mapping-row']"),
		].map((row) =>
			Object.fromEntries(
				["source-lane", "source-cell", "destination-lane", "destination-cell"]
					.map((k) => {
						const v = row.querySelector(`[data-testid='${k}']`).value;
						return [k, v.trim() === "" ? NaN : Number(v)];
					})
					.concat(
						row.querySelector("[data-testid='chance']")
							? [
									[
										"chance",
										row.querySelector("[data-testid='chance']").value.trim() ===
										""
											? NaN
											: Number(
													row.querySelector("[data-testid='chance']").value,
												),
									],
								]
							: [],
					),
			),
		);
	}
	const effective = (v, s) => (Number(v) === -1 ? s - 1 : Number(v));
	function invalid(m, s, d) {
		return (
			!Number.isInteger(m["source-lane"]) ||
			m["source-lane"] < 0 ||
			m["source-lane"] >= s.carriles ||
			!Number.isInteger(m["destination-lane"]) ||
			m["destination-lane"] < 0 ||
			m["destination-lane"] >= d.carriles ||
			!Number.isInteger(m["source-cell"]) ||
			(m["source-cell"] !== -1 &&
				(m["source-cell"] < 0 || m["source-cell"] >= s.tamano)) ||
			!Number.isInteger(m["destination-cell"]) ||
			m["destination-cell"] < 0 ||
			m["destination-cell"] >= d.tamano ||
			(draft.type === types.PROBABILISTICA &&
				(!Number.isFinite(m.chance) || m.chance < 0 || m.chance > 100))
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
		if (ms.some((m) => invalid(m, draft.source, draft.destination))) return;
		const keys = new Set();
		for (const m of ms) {
			const key = [
				m["source-lane"],
				effective(m["source-cell"], draft.source.tamano),
				m["destination-lane"],
				m["destination-cell"],
			].join(":");
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
			const key = [
				m["source-lane"],
				effective(m["source-cell"], s.tamano),
				m["destination-lane"],
				m["destination-cell"],
			].join(":");
			const dup = keys.has(key) || isDuplicate(m, s, d);
			const invalidRow = invalid(m, s, d);
			rows[i]?.classList.toggle("is-invalid", dup || invalidRow);
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
				draft.destination ||
				e.target !== document.getElementById("simuladorCanvas") ||
				e.button !== 0
			)
				return;
			e.preventDefault();
			e.stopImmediatePropagation();
			suppressClick = true;
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
