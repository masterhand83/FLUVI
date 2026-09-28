(() => {
	const button = document.getElementById("drawStreetButton");
	const inspector = document.getElementById("streetInspector");
	const closeButton = document.getElementById("streetInspectorClose");
	const fields = {
		name: document.getElementById("streetInspectorName"),
		x: document.getElementById("streetInspectorX"),
		y: document.getElementById("streetInspectorY"),
		endX: document.getElementById("streetInspectorEndX"),
		endY: document.getElementById("streetInspectorEndY"),
		angle: document.getElementById("streetInspectorAngle"),
		cells: document.getElementById("streetInspectorCells"),
		lanes: document.getElementById("streetInspectorLanes"),
		type: document.getElementById("streetInspectorType"),
		generation: document.getElementById("streetInspectorGeneration"),
		laneChange: document.getElementById("streetInspectorLaneChange"),
	};
	const generationRow = document.getElementById("streetInspectorGenerationRow");
	const endXRow = document.getElementById("streetInspectorEndXRow");
	const endYRow = document.getElementById("streetInspectorEndYRow");
	const controlsHost = document.getElementById("streetInspectorBezierControls");
	const addControlButton = document.getElementById("streetInspectorAddControl");
	const addChoice = document.getElementById("streetInspectorAddChoice");
	const pointLabel = document.getElementById("streetInspectorSelectedPointLabel");
	const selectedControlPanel = document.getElementById(
		"streetInspectorSelectedControl",
	);
	const deleteControlButton = document.getElementById(
		"streetInspectorDeleteControl",
	);
	const error = document.getElementById("streetInspectorError");
	const dependentSummary = document.getElementById("streetInspectorDependentSummary");
	const canvas = document.getElementById("simuladorCanvas");
	if (!button || !inspector) return;

	let selected = null;
	let focusedField = null;
	let committing = false;
	let selectedControlIndex = null;
	let selectedSegmentIndex = null;
	let selectedAnchorIndex = null;
	let previewCanvas = null;
	let previewEscapedField = null;
	let skipBlurCommit = false;
	const isBezier = (street) =>
		window.streetBezier?.isBezier?.(street) ?? Boolean(
			street &&
				(street.bezierGeometry === true ||
					!(
						street.esCurva &&
						Array.isArray(street.vertices) &&
						street.vertices.length > 0
					)) &&
				Array.isArray(street.bezierControls) &&
				Number.isFinite(street.endX) &&
				Number.isFinite(street.endY),
		);
	const sections = (street) => {
		if (window.streetBezier?.segments) return window.streetBezier.segments(street);
		return Array.isArray(street.bezierSegments)
			? street.bezierSegments.map((s) => ({ controls: s.controls.map((p) => ({ ...p })), end: { ...s.end } }))
			: [{ controls: (street.bezierControls || []).map((p) => ({ ...p })), end: { x: street.endX, y: street.endY } }];
	};
	const sectionIndex = (parts) => selectedAnchorIndex != null
		? selectedAnchorIndex
		: selectedSegmentIndex != null ? selectedSegmentIndex : parts.length - 1;
	const candidateWithSections = (street, parts, forceSegments = false) => {
		const candidate = {
			...street,
			bezierGeometry: true,
			esCurva: true,
			endX: parts.at(-1).end.x,
			endY: parts.at(-1).end.y,
		};
		if (forceSegments || Array.isArray(street.bezierSegments) || parts.length > 1) {
			candidate.bezierSegments = parts;
			// Legacy consumers may still inspect this field; segmented roads use the sections.
			candidate.bezierControls = [];
		} else {
			delete candidate.bezierSegments;
			candidate.bezierControls = parts[0].controls.map((p) => ({ ...p }));
		}
		return candidate;
	};
	const editable = Object.values(fields);
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Rebuilds inspector rows and values from one selected street snapshot.
	const readModel = (calle) => {
		fields.name.value = calle.nombre || "";
		fields.x.value = calle.x ?? "";
		fields.y.value = calle.y ?? "";
		fields.endX.value = calle.endX ?? "";
		fields.endY.value = calle.endY ?? "";
		endXRow.hidden = endYRow.hidden = !isBezier(calle);
		fields.angle.value = calle.angulo ?? "";
		fields.cells.value = calle.tamano ?? calle.arreglo?.[0]?.length ?? "";
		fields.lanes.value = calle.carriles ?? calle.arreglo?.length ?? "";
		fields.type.value = calle.tipo || "conexion";
		fields.generation.value = Number(calle.probabilidadGeneracion || 0) * 100;
		fields.laneChange.value =
			Number(calle.probabilidadSaltoDeCarril || 0) * 100;
		generationRow.hidden = calle.tipo !== "generador";
		addControlButton.hidden = calle.esCurva && !isBezier(calle);
		if (controlsHost) {
			controlsHost.replaceChildren();
			controlsHost.hidden = !isBezier(calle);
			const parts = isBezier(calle) ? sections(calle) : [];
			const count = document.createElement("strong");
			count.textContent = `Secciones (${parts.length})`;
			controlsHost.append(count);
			const addRow = (labelText, kind, segmentIndex, controlIndex) => {
				const row = document.createElement("div");
				row.className = `street-inspector-control ${kind === "anchor" ? "anchor" : ""}`;
				const label = document.createElement("span");
				label.textContent = labelText;
				const select = document.createElement("button");
				select.type = "button";
				select.className = "btn btn-sm btn-outline-secondary";
				select.textContent = "Seleccionar";
				select.setAttribute("aria-pressed", String(kind === "anchor" ? selectedAnchorIndex === segmentIndex : selectedAnchorIndex == null && selectedSegmentIndex === segmentIndex && selectedControlIndex === controlIndex));
				select.addEventListener("click", () => kind === "anchor" ? selectAnchor(segmentIndex) : selectControl(segmentIndex, controlIndex));
				const remove = document.createElement("button");
				remove.type = "button";
				remove.className = "btn btn-sm btn-outline-danger";
				remove.textContent = "−";
				remove.setAttribute("aria-label", `Eliminar ${labelText.toLowerCase()}`);
				remove.addEventListener("click", () => {
					if (kind === "anchor") selectAnchor(segmentIndex);
					else selectControl(segmentIndex, controlIndex);
					deleteSelectedControl();
				});
				row.append(label, select, remove);
				controlsHost.append(row);
			};
			parts.forEach((part, segmentIndex) => {
				const heading = document.createElement("button");
				heading.type = "button";
				heading.className = "btn btn-sm btn-outline-secondary street-inspector-section";
				heading.textContent = `Sección ${segmentIndex + 1}`;
				heading.setAttribute("aria-pressed", String(selectedSegmentIndex === segmentIndex && selectedAnchorIndex == null && selectedControlIndex == null));
				heading.addEventListener("click", () => {
					selectedSegmentIndex = segmentIndex;
					selectedAnchorIndex = null;
					selectedControlIndex = null;
					readModel(selected);
				});
				controlsHost.append(heading);
				part.controls.forEach((_, index) => {
					addRow(`Control ${index + 1}`, "control", segmentIndex, index);
				});
				if (segmentIndex < parts.length - 1) addRow(`Ancla fija ${segmentIndex + 1}`, "anchor", segmentIndex);
			});
		}
		const parts = isBezier(calle) ? sections(calle) : [];
		const point = selectedAnchorIndex != null ? parts[selectedAnchorIndex]?.end : parts[selectedSegmentIndex]?.controls[selectedControlIndex];
		selectedControlPanel.hidden =
			!point;
		if (!selectedControlPanel.hidden) {
			pointLabel.textContent = selectedAnchorIndex != null ? "Ancla fija seleccionada" : "Control seleccionado";
			deleteControlButton.textContent = selectedAnchorIndex != null ? "Eliminar ancla" : "Eliminar control";
		}
	};
	function show(calle) {
		if (selected !== calle) {
			clearDimensionPreview();
			selectedControlIndex = null;
			selectedSegmentIndex = null;
			selectedAnchorIndex = null;
			addChoice.hidden = true;
			for (const field of editable) {
				field.setCustomValidity("");
				field.removeAttribute("aria-invalid");
			}
		}
		selected = calle || null;
		if (!selected) {
			inspector.hidden = true;
			return;
		}
		readModel(selected);
		inspector.hidden = false;
		error.textContent = "";
	}
	function fail(field, message) {
		error.textContent = message;
		field.setAttribute("aria-invalid", "true");
		field.setCustomValidity(message);
		return false;
	}
	function refresh() {
		window.renderizarCanvas?.();
		if (window.USE_PIXI && window.pixiApp?.sceneManager)
			window.pixiApp.sceneManager.renderAll();
	}
	function refreshDerivedGeometry(street) {
		window.cellGeometryIndex?.invalidate?.(street);
		window.inicializarIntersecciones?.();
		window.construirMapaIntersecciones?.();
	}
	function clearDimensionPreview() {
		if (dependentSummary) { dependentSummary.hidden = true; dependentSummary.textContent = ""; }
		previewCanvas?.remove();
		previewCanvas = null;
	}
	function previewCanvasForMap() {
		if (!previewCanvas) {
			previewCanvas = document.createElement("canvas");
			previewCanvas.className = "street-inspector-preview-overlay";
			previewCanvas.setAttribute("aria-hidden", "true");
			document.body.append(previewCanvas);
		}
		const rect = canvas.getBoundingClientRect();
		const ratio = window.devicePixelRatio || 1;
		previewCanvas.style.left = `${rect.left}px`; previewCanvas.style.top = `${rect.top}px`;
		previewCanvas.style.width = `${rect.width}px`; previewCanvas.style.height = `${rect.height}px`;
		previewCanvas.width = Math.max(1, Math.round(rect.width * ratio));
		previewCanvas.height = Math.max(1, Math.round(rect.height * ratio));
		const ctx = previewCanvas.getContext("2d");
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		ctx.translate(Number(window.offsetX) || 0, Number(window.offsetY) || 0);
		ctx.scale(Number(window.escala) || 1, Number(window.escala) || 1);
		return { ctx, scale: Number(window.escala) || 1 };
	}
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Candidate construction, dependent inspection and overlay rendering form one validated preview transaction.
	function previewDimensions(field) {
		if (!selected || (field !== fields.cells && field !== fields.lanes)) return;
		if (!canvas || !window.obtenerCoordenadasGlobalesCelda) return;
		const n = Number(field.value);
		if (!field.value.trim() || !Number.isInteger(n) || n < 1 || n > (field === fields.cells ? 2500 : 10)) { clearDimensionPreview(); return; }
		let proposed = { ...selected, arreglo: selected.arreglo, celulasEsperando: selected.celulasEsperando };
		let cells = field === fields.cells ? n : Number(selected.tamano);
		const lanes = field === fields.lanes ? n : Number(selected.carriles);
		if (isBezier(selected)) {
			if (field === fields.cells) {
				const geometry = window.streetBezier?.validate?.(selected);
				if (!geometry?.valid || !geometry.cells) { clearDimensionPreview(); return; }
				proposed = scaleCurve(selected, n / geometry.cells);
				proposed.carriles = lanes;
				const scaledValidation = window.streetBezier.validate(proposed);
				if (!scaledValidation.valid) { clearDimensionPreview(); return; }
				cells = scaledValidation.cells;
			} else {
				proposed = { ...selected, carriles: lanes };
				const geometry = window.streetBezier?.validate?.(proposed);
				if (!geometry?.valid) { clearDimensionPreview(); return; }
				cells = geometry.cells;
			}
		}
		proposed.tamano = cells; proposed.carriles = lanes;
		const report = window.streetDependentPreview?.inspect?.(selected, { tamano: cells, carriles: lanes });
		if (dependentSummary && report) {
			const c = report.counts;
			dependentSummary.textContent = `Conexiones: ${c.survivingConnections} se mantienen, ${c.lostConnections} se perderían · Pares de parking: ${c.survivingParkingPairs} / ${c.lostParkingPairs} · Marcas: ${c.survivingScenarioMarks} / ${c.lostScenarioMarks} (se mantienen / se perderían)`;
			dependentSummary.hidden = false;
		}
		const { ctx, scale } = previewCanvasForMap();
		const cellSize = Number(window.celda_tamano) || 5;
		const coordinate = (lane, index) => isBezier(proposed)
			? window.streetBezier.coordinates(proposed, lane, index)
			: proposed.esCurva && window.obtenerCoordenadasGlobalesCeldaConCurva
				? window.obtenerCoordenadasGlobalesCeldaConCurva(proposed, lane, index)
				: window.obtenerCoordenadasGlobalesCelda(proposed, lane, index);
		ctx.fillStyle = "rgba(13, 110, 253, .28)";
		ctx.strokeStyle = "rgba(13, 110, 253, .9)";
		ctx.lineWidth = 1 / scale;
		for (let lane = 0; lane < lanes; lane++) for (let index = 0; index < cells; index++) {
			const point = coordinate(lane, index);
			const angle = Number(point.angulo ?? proposed.angulo ?? 0) * Math.PI / 180;
			const half = cellSize / 2;
			ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(-angle);
			ctx.fillRect(-half, -half, cellSize, cellSize); ctx.strokeRect(-half, -half, cellSize, cellSize); ctx.restore();
		}
	}
	function uniqueName(value) {
		return !(window.calles || []).some(
			(calle) =>
				calle !== selected &&
				calle.nombre.trim().toLocaleLowerCase() === value.toLocaleLowerCase(),
		);
	}
	function scaleCurve(street, factor) {
		const x = street.x,
			y = street.y;
		const move = (p) => ({ x: x + (p.x - x) * factor, y: y + (p.y - y) * factor });
		return candidateWithSections(street, sections(street).map((part) => ({ controls: part.controls.map(move), end: move(part.end) })));
	}
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Validation is intentionally centralized so commits share one atomic model-update path.
	function commit(field) {
		if (!selected || committing || !field) return true;
		committing = true;
		field.setCustomValidity("");
		field.removeAttribute("aria-invalid");
		error.textContent = "";
		const value = field.value.trim();
		const numeric = Number(value);
		try {
			if (field === fields.name) {
				if (!value) return fail(field, "El nombre no puede estar vacío.");
				if (!uniqueName(value))
					return fail(field, "Ya existe una calle con ese nombre.");
				selected.nombre = value;
				selected.id = value;
				for (const id of ["selectCalle", "selectCalleEditor"]) {
					const selector = document.getElementById(id);
					const index = (window.calles || []).indexOf(selected);
					const option = selector?.querySelector(`option[value="${index}"]`);
					if (option) option.textContent = value;
				}
			} else if (
				field === fields.x ||
				field === fields.y ||
				field === fields.angle ||
				field === fields.endX ||
				field === fields.endY
			) {
				if (value === "" || !Number.isFinite(numeric))
					return fail(field, "Introduce un número válido.");
				const prop =
					field === fields.angle
						? "angulo"
						: field === fields.x
							? "x"
							: field === fields.y
								? "y"
								: field === fields.endX
									? "endX"
									: "endY";
				if (numeric !== selected[prop]) window.streetEditPause?.();
				if (isBezier(selected) && numeric !== selected[prop]) {
					let candidate = candidateWithSections(selected, sections(selected));
					let transform = (p) => p;
					if (prop === "x" || prop === "y") {
						const dx = prop === "x" ? numeric - selected.x : 0,
							dy = prop === "y" ? numeric - selected.y : 0;
						candidate.x += dx;
						candidate.y += dy;
						transform = (p) => ({ x: p.x + dx, y: p.y + dy });
					} else if (prop === "angulo") {
						const a =
								((Number(selected.angulo || 0) - numeric) * Math.PI) / 180,
							ox = selected.x,
							oy = selected.y;
						const rotate = (p) => ({
							x: ox + (p.x - ox) * Math.cos(a) - (p.y - oy) * Math.sin(a),
							y: oy + (p.x - ox) * Math.sin(a) + (p.y - oy) * Math.cos(a),
						});
						candidate.angulo = numeric;
						transform = rotate;
					} else {
						const oldEnd = { x: selected.endX, y: selected.endY },
							newEnd = {
								x: prop === "endX" ? numeric : selected.endX,
								y: prop === "endY" ? numeric : selected.endY,
							};
						const sx =
								Math.abs(oldEnd.x - selected.x) > 1e-8
									? (newEnd.x - selected.x) / (oldEnd.x - selected.x)
									: 1,
							sy =
								Math.abs(oldEnd.y - selected.y) > 1e-8
									? (newEnd.y - selected.y) / (oldEnd.y - selected.y)
									: 1;
						transform = (p) => ({
							x: Math.abs(oldEnd.x - selected.x) > 1e-8
							? selected.x + (p.x - selected.x) * sx : p.x + newEnd.x - oldEnd.x,
							y: Math.abs(oldEnd.y - selected.y) > 1e-8
							? selected.y + (p.y - selected.y) * sy : p.y + newEnd.y - oldEnd.y,
						});
					}
					candidate = candidateWithSections(candidate, sections(candidate).map((part) => ({ controls: part.controls.map(transform), end: transform(part.end) })));
					if (!applyCurve(candidate))
						return fail(field, "La geometría de la curva no es válida.");
					return true;
				}
				const old = selected[prop];
				selected[prop] = numeric;
				if (
					selected.esCurva &&
					window.streetBezier?.validate &&
					!window.streetBezier.validate(selected).valid
				) {
					selected[prop] = old;
					return fail(field, "La geometría de la curva no es válida.");
				}
				if (old !== numeric) refreshDerivedGeometry(selected);
			} else if (field === fields.cells || field === fields.lanes) {
				if (
					!value ||
					!Number.isInteger(numeric) ||
					numeric < 1 ||
					(field === fields.cells && numeric > 2500)
				)
					return fail(field, "Introduce un número entero entre 1 y 2500.");
				const cells =
					field === fields.cells ? numeric : Number(selected.tamano);
				const lanes =
					field === fields.lanes ? numeric : Number(selected.carriles);
				if (field === fields.lanes && numeric > 10)
					return fail(field, "El número máximo de carriles es 10.");
				if (field === fields.cells && isBezier(selected)) {
					const currentGeometry = window.streetBezier.validate(selected);
					if (!currentGeometry.valid || !currentGeometry.cells)
						return fail(field, "La geometría de la curva no es válida.");
					const candidate = scaleCurve(
						selected,
						numeric / currentGeometry.cells,
					);
					candidate.tamano = numeric;
					if (!applyCurve(candidate))
						return fail(field, "La geometría no admite ese número de celdas.");
					return true;
				}
				if (field === fields.lanes && isBezier(selected)) {
					const proposed = { ...selected, carriles: lanes };
					const result = window.streetBezier.validate(proposed);
					if (!result.valid)
						return fail(field, "La geometría de la curva no es válida.");
					window.streetEditPause?.();
					if (result.cells !== selected.tamano || lanes !== selected.carriles) {
						if (window.editorCalles?.aplicarNuevasDimensiones) {
							window.editorCalles.aplicarNuevasDimensiones(
								selected,
								result.cells,
								lanes,
							);
						} else {
							selected.arreglo = Array.from({ length: lanes }, (_, lane) =>
								Array.from(
									{ length: result.cells },
									(_, index) => selected.arreglo?.[lane]?.[index] ?? 0,
								),
							);
							selected.celulasEsperando = Array.from(
								{ length: lanes },
								(_, lane) =>
									Array.from(
										{ length: result.cells },
										(_, index) =>
											selected.celulasEsperando?.[lane]?.[index] ?? false,
									),
							);
						}
					}
					selected.tamano = result.cells;
					selected.carriles = lanes;
					refresh();
					readModel(selected);
					return true;
				}
				if (window.editorCalles?.aplicarNuevasDimensiones) {
					if (cells !== selected.tamano || lanes !== selected.carriles)
						window.streetEditPause?.();
					window.editorCalles.aplicarNuevasDimensiones(selected, cells, lanes);
				} else {
					selected.tamano = cells;
					selected.carriles = lanes;
					selected.arreglo = Array.from({ length: lanes }, (_, i) =>
						Array.from(
							{ length: cells },
							(_, j) => selected.arreglo?.[i]?.[j] ?? 0,
						),
					);
					selected.celulasEsperando = Array.from({ length: lanes }, (_, i) =>
						Array.from(
							{ length: cells },
							(_, j) => selected.celulasEsperando?.[i]?.[j] ?? false,
						),
					);
				}
			} else if (field === fields.type) {
				if (!["generador", "conexion", "devorador"].includes(value))
					return fail(field, "Selecciona un tipo de calle válido.");
				if (value !== selected.tipo) window.streetEditPause?.();
				if (value === "generador" && selected.tipo !== "generador")
					selected.probabilidadGeneracion = 0.5;
				if (value !== "generador") selected.probabilidadGeneracion = 0;
				selected.tipo = value;
				generationRow.hidden = value !== "generador";
			} else {
				if (
					value === "" ||
					!Number.isFinite(numeric) ||
					numeric < 0 ||
					numeric > 100
				)
					return fail(field, "La probabilidad debe estar entre 0 y 100 %.");
				if (field === fields.generation)
					selected.probabilidadGeneracion = numeric / 100;
				else selected.probabilidadSaltoDeCarril = numeric / 100;
			}
			refresh();
			readModel(selected);
			return true;
		} finally {
			committing = false;
		}
	}
	editable.forEach((field) => {
		field.addEventListener("focus", () => {
			focusedField = field;
		});
		field.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				if (commit(field)) { clearDimensionPreview(); skipBlurCommit = true; field.blur(); }
			}
			if (event.key === "Escape") {
				clearDimensionPreview();
				previewEscapedField = field;
				readModel(selected);
				field.blur();
				error.textContent = "";
			}
		});
		field.addEventListener("blur", () => {
			if (previewEscapedField === field) previewEscapedField = null;
			else if (skipBlurCommit) skipBlurCommit = false;
			else commit(field);
			clearDimensionPreview();
			if (focusedField === field) focusedField = null;
		});
		field.addEventListener("input", () => {
			field.setCustomValidity("");
			field.removeAttribute("aria-invalid");
			error.textContent = "";
			previewDimensions(field);
		});
	});
	fields.type.addEventListener("change", () => commit(fields.type));
	window.streetInspector = {
		finishFocusedEdit() {
			if (focusedField) return commit(focusedField);
			return true;
		},
		refresh() {
			if (selected && !focusedField) readModel(selected);
		},
		getSelected() {
			return selected;
		},
		selectControl(index) {
			selectControl(...arguments);
		},
		selectAnchor(index) {
			selectAnchor(index);
		},
		getSelectedControlIndex() {
			return selectedSegmentIndex === 0 && selectedAnchorIndex == null ? selectedControlIndex : null;
		},
		getSelectedHandleKind() {
			if (selectedAnchorIndex != null) return `anchor:${selectedAnchorIndex}`;
			if (selectedControlIndex != null) return `control:${selectedSegmentIndex}:${selectedControlIndex}`;
			return null;
		},
		setGeometryError(message) {
			error.textContent = message || "";
		},
	};
	function selectControl(segmentIndex, index = undefined) {
		if (index === undefined) [segmentIndex, index] = [0, segmentIndex];
		if (!isBezier(selected) || !sections(selected)[segmentIndex]?.controls[index]) return;
		selectedSegmentIndex = segmentIndex;
		selectedAnchorIndex = null;
		selectedControlIndex = index;
		readModel(selected);
	}
	function selectAnchor(index) {
		if (!isBezier(selected) || index < 0 || index >= sections(selected).length - 1) return;
		selectedAnchorIndex = index;
		selectedSegmentIndex = index;
		selectedControlIndex = null;
		readModel(selected);
	}
	function applyCurve(candidate, before = selected) {
		const result = window.streetBezier?.validate?.(candidate);
		if (!result?.valid || !Number.isInteger(result.cells) || result.cells < 1) {
			return false;
		}
		candidate.tamano = result.cells;
		window.streetEditPause?.();
		if (candidate.tamano !== before.tamano)
			window.editorCalles?.aplicarNuevasDimensiones?.(
				before,
				candidate.tamano,
				before.carriles,
			);
		for (const key of [
			"esCurva",
			"bezierGeometry",
			"x",
			"y",
			"angulo",
			"tamano",
			"endX",
			"endY",
			"bezierControls",
			"bezierSegments",
		]) {
			if (key === "bezierSegments" && !Array.isArray(candidate.bezierSegments)) delete before.bezierSegments;
			else before[key] = candidate[key];
		}
		// Once converted, legacy angle-offset vertices must not overlay or intercept
		// the independently editable exterior Bezier controls.
		if (candidate.bezierGeometry) before.vertices = [];
		refreshDerivedGeometry(before);
		window.streetGeometryEditor?.setInvalidPreview?.(false);
		window.streetGeometryEditor?.refresh?.();
		refresh();
		readModel(before);
		return true;
	}
	function deleteSelectedControl() {
		if (!isBezier(selected) || (selectedControlIndex == null && selectedAnchorIndex == null)) return;
		const parts = sections(selected);
		if (selectedAnchorIndex != null) {
			const index = selectedAnchorIndex;
			// The removed corner must not survive as an off-path control: two
			// straight legs become one straight leg after removing their anchor.
			parts.splice(index, 2, {
				controls: [...parts[index].controls, ...parts[index + 1].controls],
				end: { ...parts[index + 1].end },
			});
		} else parts[selectedSegmentIndex].controls.splice(selectedControlIndex, 1);
		const candidate = candidateWithSections(selected, parts);
		if (applyCurve(candidate)) {
			selectedAnchorIndex = null;
			selectedSegmentIndex = Math.min(selectedSegmentIndex ?? 0, parts.length - 1);
			selectedControlIndex = null;
			readModel(selected);
		} else
			error.textContent =
				"No se puede eliminar el punto: la curva resultante no es válida.";
	}
	deleteControlButton?.addEventListener("click", deleteSelectedControl);
	addControlButton?.addEventListener("click", () => {
		if (!selected || (selected.esCurva && !isBezier(selected))) return;
		addChoice.hidden = !addChoice.hidden;
		if (!addChoice.hidden) document.getElementById("streetInspectorChooseBezier")?.focus();
	});
	document.getElementById("streetInspectorCancelAdd")?.addEventListener("click", () => {
		addChoice.hidden = true;
		addControlButton.focus();
	});
	addChoice?.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		addChoice.hidden = true;
		addControlButton.focus();
	});
	function initialCandidate() {
		if (!selected || (selected.esCurva && !isBezier(selected))) return;
		const before = selected;
		const straightEndX =
			before.x +
			before.tamano *
				(Number(window.celda_tamano) || 5) *
				Math.cos(((before.angulo || 0) * Math.PI) / 180);
		const straightEndY =
			before.y -
			before.tamano *
				(Number(window.celda_tamano) || 5) *
				Math.sin(((before.angulo || 0) * Math.PI) / 180);
		return isBezier(before) ? candidateWithSections(before, sections(before)) : candidateWithSections(before, [{ controls: [], end: { x: straightEndX, y: straightEndY } }]);
	}
	// Degree elevation preserves the selected section's entire curve.
	document.getElementById("streetInspectorChooseBezier")?.addEventListener("click", () => {
		addChoice.hidden = true;
		const candidate = initialCandidate();
		if (!candidate) return;
		const parts = sections(candidate);
		const index = sectionIndex(parts);
		const start = index ? parts[index - 1].end : { x: candidate.x, y: candidate.y };
		const points = [
			start,
			...parts[index].controls,
			parts[index].end,
		];
		const degree = points.length - 1;
		const elevated = [];
		for (let i = 1; i <= degree; i++) {
			const t = i / (degree + 1),
				a = points[i - 1],
				b = points[i];
			elevated.push({ x: t * a.x + (1 - t) * b.x, y: t * a.y + (1 - t) * b.y });
		}
		parts[index].controls = elevated;
		if (applyCurve(candidateWithSections(candidate, parts))) {
			selectedSegmentIndex = index;
			selectedAnchorIndex = null;
			selectedControlIndex = elevated.length - 1;
			readModel(selected);
			window.streetGeometryEditor?.refresh?.();
		}
	});
	document.getElementById("streetInspectorChooseAnchor")?.addEventListener("click", () => {
		addChoice.hidden = true;
		const candidate = initialCandidate();
		if (!candidate) return;
		const parts = sections(candidate);
		const index = sectionIndex(parts);
		const split = window.streetBezier?.splitSegment?.(candidate, index, 0.5);
		if (!Array.isArray(split) || split.length !== parts.length + 1) {
			error.textContent = "No se pudo dividir esta sección.";
			return;
		}
		if (applyCurve(candidateWithSections(candidate, split, true))) selectAnchor(index);
		else error.textContent = "La geometría de la curva no es válida.";
	});
	document.addEventListener(
		"keydown",
		(event) => {
			if (
				event.key !== "Delete" ||
				(selectedControlIndex == null && selectedAnchorIndex == null) ||
				!isBezier(selected)
			)
				return;
			if (event.target.matches?.("input,textarea,select")) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			deleteSelectedControl();
		},
		true,
	);

	function updateDrawButton() {
		const active = Boolean(window.drawStreetTool?.isActive?.());
		button.setAttribute("aria-pressed", String(active));
		button.classList.toggle("active", active);
	}
	button.addEventListener("click", () => {
		const tool = window.drawStreetTool;
		if (!tool) return;
		if (tool.isActive()) tool.deactivate();
		else tool.activate();
		updateDrawButton();
	});
	closeButton?.addEventListener("click", () => {
		for (const id of ["selectCalleEditor", "selectCalle"]) {
			const selector = document.getElementById(id);
			if (selector) {
				selector.value = "";
				selector.dispatchEvent(new Event("change", { bubbles: true }));
			}
		}
		window.calleSeleccionada = null;
		show(null);
	});
	document.addEventListener("street-drawn", (event) =>
		show(event.detail?.calle),
	);
	document
		.getElementById("selectCalle")
		?.addEventListener("change", () => show(window.calleSeleccionada));
	document
		.getElementById("selectCalleEditor")
		?.addEventListener("change", () =>
			window.setTimeout(() => show(window.calleSeleccionada), 0),
		);
	const syncSelection = (event) => {
		if (inspector.contains(event.target)) return;
		window.setTimeout(() => show(window.calleSeleccionada), 0);
	};
	document.addEventListener("pointerup", syncSelection, true);
	canvas?.addEventListener("click", syncSelection, true);
	document.addEventListener("click", (event) => {
		if (event.target !== canvas) updateDrawButton();
	});
	updateDrawButton();
})();
