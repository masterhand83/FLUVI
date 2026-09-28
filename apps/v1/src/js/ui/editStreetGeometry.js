/* Selected-street map gestures for straight and Bezier streets. */
(() => {
	let canvas = document.getElementById("simuladorCanvas");
	if (!canvas) return;
	const editor = { gesture: null, handles: [], suppressCanvasClick: false };
	const cellSize = () => Number(window.celda_tamano) || 5;
	const selected = () => {
		const s = window.calleSeleccionada;
		return s && window.calles?.includes(s) && (!s.esCurva || isBezier(s))
			? s
			: null;
	};
	const isBezier = (s) =>
		Boolean(
			s &&
				(s.bezierGeometry === true ||
					!(s.esCurva && Array.isArray(s.vertices) && s.vertices.length > 0)) &&
				Array.isArray(s.bezierControls) &&
				Number.isFinite(s.endX) &&
				Number.isFinite(s.endY),
		);
	const clone = (s) => ({
		...s,
		bezierControls: (s.bezierControls || []).map((p) => ({ ...p })),
		...(s.bezierSegments && {
			bezierSegments: s.bezierSegments.map((segment) => ({
				controls: segment.controls.map((p) => ({ ...p })),
				end: { ...segment.end },
			})),
		}),
	});
	const segments = (s) => s.bezierSegments || null;
	const handlesFor = (s) => segments(s)
		? segments(s).flatMap((segment, section) => [
			...segment.controls.map((p, index) => ({ kind: `control:${section}:${index}`, p })),
			...(section < segments(s).length - 1 ? [{ kind: `anchor:${section}`, p: segment.end }] : []),
		])
		: (s.bezierControls || []).map((p, index) => ({ kind: `control:0:${index}`, p }));
	function transformCurve(s, points, source = s) {
		if (segments(source)) {
			s.bezierSegments = segments(source).map((segment) => ({
				controls: segment.controls.map(points),
				end: points(segment.end),
			}));
			s.endX = s.bezierSegments.at(-1).end.x;
			s.endY = s.bezierSegments.at(-1).end.y;
		} else if (source.bezierControls) s.bezierControls = source.bezierControls.map(points);
	}
	const worldAt = (e) => {
		const r = canvas.getBoundingClientRect();
		if (window.USE_PIXI && window.pixiApp?.cameraController) {
			const z = window.pixiApp.app?.screen;
			return window.pixiApp.cameraController.screenToWorld(
				((e.clientX - r.left) * (z?.width || r.width)) / r.width,
				((e.clientY - r.top) * (z?.height || r.height)) / r.height,
			);
		}
		const scale = Number(window.escala) || 1;
		return {
			x:
				(((e.clientX - r.left) * canvas.width) / r.width -
					(Number(window.offsetX) || 0)) /
				scale,
			y:
				(((e.clientY - r.top) * canvas.height) / r.height -
					(Number(window.offsetY) || 0)) /
				scale,
		};
	};
	const endpoint = (s, end) =>
		end && isBezier(s)
			? { x: Number(s.endX), y: Number(s.endY) }
			: { x: Number(s.x), y: Number(s.y) };
	const straightEnd = (s) => {
		const a = (s.angulo * Math.PI) / 180,
			d = s.tamano * cellSize();
		return { x: s.x + d * Math.cos(a), y: s.y - d * Math.sin(a) };
	};
	const endpoints = (s) => [
		endpoint(s, false),
		isBezier(s) ? endpoint(s, true) : straightEnd(s),
	];
	const curvePoint = (s, t) =>
		window.streetBezier?.point?.(s, t) || {
			x: s.x + (s.endX - s.x) * t,
			y: s.y + (s.endY - s.y) * t,
		};
	function render(s) {
		if (window.USE_PIXI) {
			const r = window.pixiApp?.sceneManager?.calleRenderer;
			if (s.esCurva) r?.renderCalleCurva?.(s);
			else r?.renderCalleRecta?.(s);
			window.pixiApp?.sceneManager?.refreshEtiquetas?.();
		} else window.renderizarCanvas?.();
		sync();
	}
	function place(h, p) {
		const r = canvas.getBoundingClientRect(),
			pr = canvas.parentElement.getBoundingClientRect(),
			cam = window.USE_PIXI && window.pixiApp?.cameraController;
		const q = cam
			? cam.worldToScreen(p.x, p.y)
			: {
					x: p.x * (Number(window.escala) || 1) + (Number(window.offsetX) || 0),
					y: p.y * (Number(window.escala) || 1) + (Number(window.offsetY) || 0),
				};
		const z = cam ? window.pixiApp.app?.screen : null;
		h.style.left = `${r.left - pr.left + (q.x * r.width) / (z?.width || canvas.width)}px`;
		h.style.top = `${r.top - pr.top + (q.y * r.height) / (z?.height || canvas.height)}px`;
	}
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Handle synchronization deliberately keeps DOM and camera updates together.
	function sync() {
		canvas = document.getElementById("simuladorCanvas") || canvas;
		const s = selected();
		const items =
			s && !window.drawStreetTool?.isActive?.()
				? [
						...endpoints(s).map((p, i) => ({ kind: i ? "end" : "start", p })),
						...(isBezier(s) ? handlesFor(s) : []),
					]
				: [];
		while (editor.handles.length < items.length) {
			const h = document.createElement("button");
			h.type = "button";
			h.className = "street-endpoint-handle";
			canvas.parentElement.append(h);
			editor.handles.push(h);
		}
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Applies independent visibility and placement state per handle.
		editor.handles.forEach((h, i) => {
			const item = items[i];
			h.hidden = !item;
			if (item) {
				h.dataset.kind = item.kind;
				if (item.kind === "start" || item.kind === "end") h.dataset.end = item.kind;
				else delete h.dataset.end;
				h.classList.toggle("selected", item.kind === window.streetInspector?.getSelectedHandleKind?.());
				h.classList.toggle("street-anchor-handle", item.kind.startsWith("anchor:"));
				h.setAttribute(
					"aria-label",
					item.kind.startsWith("anchor:") ? `Mover ancla ${Number(item.kind.split(":")[1]) + 1}` : item.kind.startsWith("control:")
						? `Mover control ${Number(item.kind.split(":")[2]) + 1}`
						: `Mover ${item.kind === "start" ? "inicio" : "fin"} de calle`,
				);
				if (h.parentElement !== canvas.parentElement)
					canvas.parentElement.append(h);
				place(h, item.p);
			}
		});
	}
	const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Hit testing checks endpoint, control, then shape priority.
	function hit(p, s) {
		const ends = endpoints(s),
			r = 14 / (Number(window.escala) || 1);
		if (dist(p, ends[0]) < r) return "start";
		if (dist(p, ends[1]) < r) return "end";
		for (const item of handlesFor(s))
			if (dist(p, item.p) < r) return item.kind;
		if (isBezier(s)) {
			// The same cell geometry used for clicks defines the draggable body.
			// Fixed-count curve samples miss cells on long Bezier streets.
			if (window.cellGeometryIndex) {
				if (window.cellGeometryIndex.nearbyStreets(p.x, p.y, window.calles).has(s))
					return "body";
			} else {
				for (let i = 0; i < 30; i++)
					if (
						dist(p, curvePoint(s, i / 30)) <
						Math.max(12 / (Number(window.escala) || 1), (s.carriles * cellSize()) / 2)
					)
						return "body";
			}
		} else {
			const d = ends[1],
				dx = d.x - ends[0].x,
				dy = d.y - ends[0].y,
				t = Math.max(
					0,
					Math.min(
						1,
						((p.x - ends[0].x) * dx + (p.y - ends[0].y) * dy) /
							(dx * dx + dy * dy || 1),
					),
				);
			if (
				dist(p, { x: ends[0].x + t * dx, y: ends[0].y + t * dy }) <
				(s.carriles * cellSize()) / 2 + 8
			)
				return "body";
		}
		return null;
	}
	function validate(s) {
		const result = isBezier(s) ? window.streetBezier?.validate?.(s) : null;
		return (
			result || {
				valid:
					[s.x, s.y, s.angulo, s.tamano].every(Number.isFinite) &&
					Number.isInteger(s.tamano) &&
					s.tamano >= 1,
				cells: s.tamano,
			}
		);
	}
	function setInvalidPreview(invalid, reason) {
		canvas.classList.toggle("street-geometry-invalid", invalid);
		window.streetInspector?.setGeometryError?.(
			invalid
				? `Geometría inválida${reason ? `: ${reason}` : ""}. Se revertirá al soltar.`
				: "",
		);
	}
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Gesture finalization restores before applying a single validated commit.
	function finish(commit) {
		const g = editor.gesture;
		if (!g) return;
		// Pixi receives vehicle clicks on pointerdown, which the selected-street
		// editor captures. A body tap is not a geometry edit: dispatch its cell
		// action on release without pausing the simulation.
		if (commit && g.kind === "body" && !g.didDrag && window.USE_PIXI) {
			const cell = window.encontrarCeldaMasCercana?.(g.origin.x, g.origin.y);
			if (cell?.calle === g.street && window.clickActionManager?.executeAction(cell)) {
				window.pixiApp?.sceneManager?.carroRenderer?.updateCell?.(
					cell.calle,
					cell.carril,
					cell.indice,
				);
			}
		}
		if (g.kind === "body" && !g.didDrag) {
			editor.gesture = null;
			return;
		}
		// Canvas emits a click after a completed drag; that click must not also
		// toggle the vehicle under the released pointer.
		if (g.didDrag && !window.USE_PIXI) editor.suppressCanvasClick = true;
		Object.assign(g.street, g.before);
		const result = validate(g.proposed);
		if (commit && result.valid) {
			g.proposed.tamano = result.cells;
			if (g.proposed.tamano !== g.before.tamano)
				window.editorCalles?.aplicarNuevasDimensiones?.(
					g.street,
					g.proposed.tamano,
					g.street.carriles,
				);
			for (const key of [
				"x",
				"y",
				"angulo",
				"tamano",
				"endX",
				"endY",
				"bezierControls",
				"bezierSegments",
			])
				if (key in g.proposed) g.street[key] = g.proposed[key];
			window.streetInspector?.refresh?.();
		}
		render(g.street);
		if (window.USE_PIXI) window.pixiApp?.sceneManager?.renderAll();
		canvas.style.cursor = "";
		setInvalidPreview(false);
		editor.gesture = null;
	}
	editor.finishGesture = () => finish(true);
	editor.refresh = sync;
	editor.selectControl = (index) =>
		window.streetInspector?.selectControl?.(index);
	editor.setInvalidPreview = setInvalidPreview;
	window.streetGeometryEditor = editor;
	function follow() {
		sync();
		requestAnimationFrame(follow);
	}
	requestAnimationFrame(follow);
	document.addEventListener("click", (event) => {
		if (!editor.suppressCanvasClick) return;
		editor.suppressCanvasClick = false;
		if (event.target !== canvas) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	}, true);
	document.addEventListener(
		"pointerdown",
		(e) => {
			editor.suppressCanvasClick = false;
			canvas = document.getElementById("simuladorCanvas") || canvas;
			const s = selected();
			if (
				editor.gesture ||
				e.button !== 0 ||
				e.ctrlKey || e.metaKey ||
				window.estadoEscenarios?.modoBloqueoActivo ||
				window.esModoSeleccionCallesActivo?.() ||
				window.drawStreetTool?.isActive?.() ||
				!s
			)
				return;
			const kind =
				e.target.closest?.(".street-endpoint-handle")?.dataset.kind ||
				hit(worldAt(e), s);
			if (
				!kind ||
				(e.target !== canvas && !e.target.closest?.(".street-endpoint-handle"))
			)
				return;
			if (kind !== "body") window.streetEditPause?.();
			if (kind.startsWith("control:")) {
				const [, section, index] = kind.split(":").map(Number);
				window.streetInspector?.selectControl?.(section, index);
			} else if (kind.startsWith("anchor:"))
				window.streetInspector?.selectAnchor?.(Number(kind.split(":")[1]));
			const p = worldAt(e);
			editor.gesture = {
				street: s,
				before: clone(s),
				proposed: clone(s),
				kind,
				origin: p,
				pointerId: e.pointerId,
				didDrag: false,
			};
			e.preventDefault();
			e.stopImmediatePropagation();
		},
		true,
	);
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One gesture state machine keeps preview transforms atomic.
	document.addEventListener(
		"pointermove",
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One gesture state machine keeps preview transforms atomic.
		(e) => {
			const g = editor.gesture;
			if (!g || e.pointerId !== g.pointerId) return;
			const p = worldAt(e),
				s = g.proposed,
				b = g.before,
				dx = p.x - g.origin.x,
				dy = p.y - g.origin.y;
			if (g.kind === "body" && !g.didDrag) {
				if (Math.hypot(dx, dy) * (Number(window.escala) || 1) < 3) return;
				g.didDrag = true;
				window.streetEditPause?.();
			}
			if (g.kind === "body") {
				if (e.shiftKey) {
					const center = {
							x: (endpoints(b)[0].x + endpoints(b)[1].x) / 2,
							y: (endpoints(b)[0].y + endpoints(b)[1].y) / 2,
						},
						a0 = Math.atan2(g.origin.y - center.y, g.origin.x - center.x),
						a1 = Math.atan2(p.y - center.y, p.x - center.x),
						a = a1 - a0,
						rot = (q) => ({
							x:
								center.x +
								(q.x - center.x) * Math.cos(a) -
								(q.y - center.y) * Math.sin(a),
							y:
								center.y +
								(q.x - center.x) * Math.sin(a) +
								(q.y - center.y) * Math.cos(a),
						});
					if (isBezier(s)) {
						const st = rot({ x: b.x, y: b.y }),
							en = rot({ x: b.endX, y: b.endY });
						s.x = st.x;
						s.y = st.y;
						s.endX = en.x;
						s.endY = en.y;
						s.angulo = b.angulo - (a * 180) / Math.PI;
						transformCurve(s, rot, b);
					} else {
						s.x = b.x;
						s.y = b.y;
						s.angulo = b.angulo - (a * 180) / Math.PI;
					}
				} else {
					s.x = b.x + dx;
					s.y = b.y + dy;
					if (isBezier(s)) {
						s.endX = b.endX + dx;
						s.endY = b.endY + dy;
						transformCurve(s, (c) => ({ x: c.x + dx, y: c.y + dy }), b);
					}
				}
			} else if (g.kind.startsWith("control:")) {
				const [, section, index] = g.kind.split(":").map(Number);
				if (segments(s)) s.bezierSegments[section].controls[index] = { x: p.x, y: p.y };
				else s.bezierControls[index] = { x: p.x, y: p.y };
			} else if (g.kind.startsWith("anchor:")) {
				const section = Number(g.kind.split(":")[1]);
				s.bezierSegments[section].end = { x: p.x, y: p.y };
			} else if (!isBezier(s)) {
				const fixed = g.kind === "start" ? straightEnd(b) : { x: b.x, y: b.y },
					vx = g.kind === "start" ? fixed.x - p.x : p.x - fixed.x,
					vy = g.kind === "start" ? fixed.y - p.y : p.y - fixed.y,
					len = Math.hypot(vx, vy);
				if (len >= cellSize()) {
					s.tamano = Math.max(1, Math.round(len / cellSize()));
					s.angulo = (Math.atan2(-vy, vx) * 180) / Math.PI;
					s.x =
						g.kind === "start"
							? fixed.x -
								Math.cos((s.angulo * Math.PI) / 180) * s.tamano * cellSize()
							: fixed.x;
					s.y =
						g.kind === "start"
							? fixed.y +
								Math.sin((s.angulo * Math.PI) / 180) * s.tamano * cellSize()
							: fixed.y;
				}
			} else {
				const fixed =
						g.kind === "start" ? endpoint(b, true) : endpoint(b, false),
					moving = { x: p.x, y: p.y };
				if (g.kind === "start") {
					s.x = p.x;
					s.y = p.y;
				} else {
					s.endX = p.x;
					s.endY = p.y;
				}
				const old = endpoint(b, g.kind === "end"),
					ratio = dist(fixed, moving) / (dist(fixed, old) || 1);
				transformCurve(s, (c) => ({
					x: fixed.x + (c.x - fixed.x) * ratio,
					y: fixed.y + (c.y - fixed.y) * ratio,
				}), b);
				if (g.kind === "end" && segments(s)) {
					s.endX = p.x;
					s.endY = p.y;
					s.bezierSegments.at(-1).end = { x: p.x, y: p.y };
				}
			}
			const result = validate(s);
			setInvalidPreview(!result.valid, result.reason);
			if (result.valid) s.tamano = result.cells;
			Object.assign(g.street, s);
			render(g.street);
			e.preventDefault();
			e.stopImmediatePropagation();
		},
		true,
	);
	document.addEventListener(
		"pointerup",
		(e) => {
			const g = editor.gesture;
			if (!g || e.pointerId !== g.pointerId) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			const r = canvas.getBoundingClientRect();
			finish(
				e.clientX >= r.left &&
					e.clientX < r.right &&
					e.clientY >= r.top &&
					e.clientY < r.bottom,
			);
		},
		true,
	);
	document.addEventListener(
		"pointercancel",
		(e) => {
			if (editor.gesture?.pointerId === e.pointerId) finish(false);
		},
		true,
	);
	window.addEventListener(
		"keydown",
		(e) => {
			if (e.key === "Escape" && editor.gesture) {
				e.preventDefault();
				finish(false);
			}
		},
		true,
	);
})();
