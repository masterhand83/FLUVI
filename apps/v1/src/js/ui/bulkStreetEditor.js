/* Shared Canvas/Pixi Shift-drag selection; only lane count and directions are editable. */
(() => {
	const canvas = () => document.getElementById('simuladorCanvas');
	const panel = document.createElement('aside');
	panel.id = 'bulkStreetInspector';
	panel.className = 'street-inspector';
	panel.hidden = true;
	panel.setAttribute('aria-label', tr('bulkStreetEditor.title'));
	const heading = document.createElement('strong');
	const close = document.createElement('button');
	close.type = 'button';
	close.textContent = '×';
	close.className = 'btn btn-sm btn-outline-secondary';
	close.setAttribute('aria-label', tr('common.close'));
	const header = document.createElement('div');
	header.className = 'street-inspector-heading';
	header.append(heading, close);
	const label = document.createElement('label');
	label.className = 'street-inspector-field';
	label.append(tr('streetInspector.lanes'));
	const lanes = document.createElement('input');
	lanes.id = 'bulkStreetLanes';
	lanes.type = 'number';
	lanes.min = '1';
	lanes.max = '10';
	lanes.step = '1';
	label.append(lanes);
	const directions = document.createElement('div');
	directions.id = 'bulkStreetDirections';
	directions.setAttribute('aria-label', tr('streetInspector.laneDirections'));
	const error = document.createElement('div');
	error.className = 'street-inspector-error';
	error.setAttribute('role', 'alert');
	panel.append(header, label, directions, error);
	canvas()?.parentElement.append(panel);
	let selected = [], gesture = null, suppressClick = false;
	let highlights = [];
	const rectangle = document.createElement('div');
	rectangle.id = 'streetSelectionRectangle';
	rectangle.hidden = true;
	function decorate(element) {
		Object.assign(element.style, { position: 'fixed', pointerEvents: 'none', zIndex: '1050', border: '2px dashed #1688ed', background: 'rgba(22,136,237,.12)' });
		document.body.append(element);
	}
	decorate(rectangle);
	function world(event) {
		const c = canvas(), r = c.getBoundingClientRect();
		const camera = window.USE_PIXI && window.pixiApp?.cameraController;
		const screen = camera ? window.pixiApp.app.screen : c;
		const x = (event.clientX - r.left) * screen.width / r.width;
		const y = (event.clientY - r.top) * screen.height / r.height;
		return camera ? camera.screenToWorld(x, y) : { x: (x - window.offsetX) / window.escala, y: (y - window.offsetY) / window.escala };
	}
	function bounds(street) {
		if (street.geometryType === 'roundabout') {
			const b = window.roundaboutStreet.bounds(street);
			return { left: b.minX, right: b.maxX, top: b.minY, bottom: b.maxY };
		}
		const half = (Number(window.celda_tamano) || 5) / 2;
		const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
		for (let lane = 0; lane < street.carriles; lane++) {
			for (let cell = 0; cell < street.tamano; cell++) {
				const p = window.obtenerCoordenadasGlobalesCeldaConCurva(street, lane, cell);
				const angle = -(p.angulo ?? street.angulo ?? 0) * Math.PI / 180;
				const extent = half * (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)));
				box.left = Math.min(box.left, p.x - extent);
				box.right = Math.max(box.right, p.x + extent);
				box.top = Math.min(box.top, p.y - extent);
				box.bottom = Math.max(box.bottom, p.y + extent);
			}
		}
		return box;
	}
	function place(element, left, top, right, bottom) {
		Object.assign(element.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
	}
	function clear() {
		selected = [];
		gesture = null;
		suppressClick = false;
		panel.hidden = rectangle.hidden = true;
		for (const item of highlights) item.element.remove();
		highlights = [];
	}
	function read() {
		heading.textContent = tr('bulkStreetEditor.count', { count: selected.length });
		lanes.value = selected.every(s => s.carriles === selected[0].carriles) ? selected[0].carriles : '';
		lanes.placeholder = tr('bulkStreetEditor.mixed');
		directions.replaceChildren();
		const count = Math.max(...selected.map(s => s.carriles));
		for (let lane = 0; lane < count; lane++) {
			const row = document.createElement('label');
			row.className = 'street-inspector-field';
			row.append(tr('bulkStreetEditor.lane', { lane: lane + 1 }));
			const input = document.createElement('select');
			for (const [value, text] of [['', tr('bulkStreetEditor.mixed')], ['1', tr('streetInspector.direction.forward')], ['-1', tr('streetInspector.direction.reverse')]]) input.add(new Option(text, value));
			const values = selected.map(s => lane < s.carriles ? (s.laneDirections?.[lane] === -1 ? -1 : 1) : null);
			input.value = values.every(v => v === values[0]) ? String(values[0]) : '';
			input.addEventListener('change', () => {
				if (!input.value) return;
				window.streetEditPause?.();
				for (const street of selected) {
					if (lane >= street.carriles) continue;
					street.laneDirections = Array.from({ length: street.carriles }, (_, i) => i === lane ? Number(input.value) : (street.laneDirections?.[i] === -1 ? -1 : 1));
					document.dispatchEvent(new CustomEvent('street-lane-directions-changed', { detail: { calle: street } }));
				}
				refresh();
				read();
			});
			row.append(input);
			directions.append(row);
		}
	}
	function refresh() {
		window.cellGeometryIndex?.invalidate();
		window.renderizarCanvas?.();
		if (window.USE_PIXI) window.pixiApp?.sceneManager?.renderAll();
		for (const item of highlights) item.box = bounds(item.street);
		syncHighlights();
	}
	lanes.addEventListener('change', () => {
		const count = Number(lanes.value);
		if (!Number.isInteger(count) || count < 1 || count > 10) {
			error.textContent = tr('streetInspector.errors.maxLanes');
			return;
		}
		// Validate every candidate before changing any street.
		const plans = selected.map(street => {
			const candidate = { ...street, carriles: count };
			const result = street.geometryType === 'roundabout' ? window.roundaboutStreet.validate(candidate)
				: window.streetBezier?.isBezier(street) ? window.streetBezier.validate(candidate) : { valid: true, cells: street.tamano };
			return { street, result };
		});
		const invalid = plans.find(p => !p.result.valid);
		if (invalid) {
			error.textContent = window.streetInspector.geometryErrorMessage(invalid.result.reason, 'streetInspector.errors.invalidCurve');
			return;
		}
		window.streetEditPause?.();
		for (const { street, result } of plans) {
			if (street.carriles !== count) window.editorCalles.aplicarNuevasDimensiones(street, result.cells, count);
		}
		error.textContent = '';
		refresh();
		read();
	});
	function syncHighlights() {
		if (!selected.length) return;
		if (selected.some(s => !window.calles.includes(s))) { clear(); return; }
		const c = canvas(), r = c.getBoundingClientRect();
		const camera = window.USE_PIXI && window.pixiApp?.cameraController;
		const screen = camera ? window.pixiApp.app.screen : c;
		const project = (x, y) => camera ? camera.worldToScreen(x, y) : { x: x * window.escala + window.offsetX, y: y * window.escala + window.offsetY };
		for (const { element, box } of highlights) {
			const a = project(box.left, box.top), b = project(box.right, box.bottom);
			const left = Math.max(r.left, r.left + a.x * r.width / screen.width);
			const top = Math.max(r.top, r.top + a.y * r.height / screen.height);
			const right = Math.min(r.right, r.left + b.x * r.width / screen.width);
			const bottom = Math.min(r.bottom, r.top + b.y * r.height / screen.height);
			element.hidden = right <= left || bottom <= top;
			if (!element.hidden) place(element, left, top, right, bottom);
		}
	}
	function stop(event) { event.preventDefault(); event.stopImmediatePropagation(); }
	window.addEventListener('pointerdown', event => {
		const mapHandle = event.target.closest?.('.street-endpoint-handle, .building-map-handle, .reference-image-frame');
		if (event.target !== canvas() && !mapHandle) return;
		if (!event.shiftKey || event.button !== 0) { clear(); return; }
		clear();
		window.drawStreetTool?.deactivate?.();
		window.drawRoundaboutTool?.deactivate?.();
		window.drawBuildingTool?.deactivate?.();
		window.createLinkTool?.cancel?.();
		window.streetInspector?.finishFocusedEdit?.();
		window.buildingInspector?.show(null);
		window.calleSeleccionada = window.edificioSeleccionado = null;
		for (const id of ['selectCalle', 'selectCalleEditor']) {
			const selector = document.getElementById(id);
			if (selector) { selector.value = ''; selector.dispatchEvent(new Event('change')); }
		}
		gesture = { start: world(event), x: event.clientX, y: event.clientY, pointerId: event.pointerId };
		suppressClick = true;
		rectangle.hidden = false;
		place(rectangle, event.clientX, event.clientY, event.clientX, event.clientY);
		stop(event);
	}, true);
	window.addEventListener('pointermove', event => {
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		place(rectangle, Math.min(gesture.x, event.clientX), Math.min(gesture.y, event.clientY), Math.max(gesture.x, event.clientX), Math.max(gesture.y, event.clientY));
		stop(event);
	}, true);
	window.addEventListener('pointerup', event => {
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		const end = world(event), start = gesture.start;
		const box = { left: Math.min(start.x, end.x), right: Math.max(start.x, end.x), top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y) };
		const moved = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 3;
		gesture = null;
		rectangle.hidden = true;
		if (moved) selected = (window.calles || []).filter(street => {
			const b = bounds(street);
			return b.left >= box.left && b.right <= box.right && b.top >= box.top && b.bottom <= box.bottom;
		});
		if (selected.length) {
			for (const street of selected) {
				const element = document.createElement('div');
				decorate(element);
				highlights.push({ element, street, box: bounds(street) });
			}
			error.textContent = '';
			read();
			panel.hidden = false;
			syncHighlights();
		}
		stop(event);
		setTimeout(() => { suppressClick = false; }, 0);
	}, true);
	for (const type of ['mousedown', 'mousemove', 'mouseup', 'click']) window.addEventListener(type, event => {
		if ((gesture || suppressClick) && event.target === canvas()) stop(event);
	}, true);
	document.addEventListener('pointercancel', () => { if (gesture) clear(); }, true);
	window.addEventListener('blur', clear);
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape' && (gesture || selected.length)) { clear(); stop(event); }
	}, true);
	close.addEventListener('click', clear);
	window.bulkStreetEditor = { clear, getSelected: () => [...selected] };
	const tick = () => { syncHighlights(); requestAnimationFrame(tick); };
	requestAnimationFrame(tick);
})();
