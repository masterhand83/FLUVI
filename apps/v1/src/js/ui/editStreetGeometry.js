/* Drag editing for the selected straight street. Load after trafico.js and Pixi. */
(() => {
    let canvas = document.getElementById('simuladorCanvas');
    if (!canvas) return;

    const editor = { gesture: null };
    const cellSize = () => Number(window.celda_tamano) || 5;
    const isStraightSelected = () => {
        const street = window.calleSeleccionada;
        return street && !street.esCurva && window.calles?.includes(street) ? street : null;
    };
    const worldAt = event => {
        const rect = canvas.getBoundingClientRect();
        if (window.USE_PIXI && window.pixiApp?.cameraController) {
            return window.pixiApp.cameraController.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
        }
        const sx = (event.clientX - rect.left) * canvas.width / rect.width;
        const sy = (event.clientY - rect.top) * canvas.height / rect.height;
        const scale = Number(window.escala) || 1;
        return { x: (sx - (Number(window.offsetX) || 0)) / scale,
            y: (sy - (Number(window.offsetY) || 0)) / scale };
    };
    const geometry = street => ({ x: street.x, y: street.y, angulo: street.angulo, tamano: street.tamano });
    const endpoints = street => {
        const length = street.tamano * cellSize();
        const angle = street.angulo * Math.PI / 180;
        return [{ x: street.x, y: street.y },
            { x: street.x + length * Math.cos(angle), y: street.y - length * Math.sin(angle) }];
    };
    const distanceToSegment = (point, a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
    };
    const preview = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    preview.classList.add('street-draw-preview');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', '#e87516');
    line.setAttribute('stroke-width', '4');
    line.setAttribute('stroke-dasharray', '7 4');
    preview.append(line);
    canvas.parentElement.append(preview);
    preview.hidden = true;
    function showPreview(proposed) {
        const rect = canvas.getBoundingClientRect();
        const [start, end] = endpoints(proposed);
        const toScreen = point => window.USE_PIXI && window.pixiApp?.cameraController
            ? window.pixiApp.cameraController.worldToScreen(point.x, point.y)
            : ({ x: (point.x * window.escala + window.offsetX) * rect.width / canvas.width,
                y: (point.y * window.escala + window.offsetY) * rect.height / canvas.height });
        const a = toScreen(start), b = toScreen(end);
        for (const [key, value] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })) line.setAttribute(key, value);
        preview.hidden = false;
    }
    function finishGesture(commit) {
        const gesture = editor.gesture;
        if (!gesture) return;
        preview.hidden = true;
        if (commit && valid(gesture.proposed)) {
            const { street, proposed } = gesture;
            if (proposed.tamano !== street.tamano) window.editorCalles.aplicarNuevasDimensiones(street, proposed.tamano, street.carriles);
            Object.assign(street, proposed);
            if (window.USE_PIXI) window.pixiApp?.sceneManager?.renderAll();
            window.renderizarCanvas?.();
            window.streetInspector?.refresh?.();
        }
        canvas.style.cursor = '';
        editor.gesture = null;
    }
    function valid(street) {
        return [street.x, street.y, street.angulo, street.tamano].every(Number.isFinite) &&
            Number.isInteger(street.tamano) && street.tamano >= 1;
    }
    editor.finishGesture = () => finishGesture(true);
    window.streetGeometryEditor = editor;

    function hitKind(point, street) {
        const [start, end] = endpoints(street);
        const scale = Number(window.escala) || 1;
        const radius = 12 / scale;
        if (Math.hypot(point.x - start.x, point.y - start.y) <= radius) return 'start';
        if (Math.hypot(point.x - end.x, point.y - end.y) <= radius) return 'end';
        if (distanceToSegment(point, start, end) <= (street.carriles * cellSize() / 2 + 5 / scale)) return 'body';
        return null;
    }

    function resizePreview(gesture, point) {
        const { before, proposed: street } = gesture;
        const fixed = gesture.kind === 'start' ? endpoints(before)[1] : { x: before.x, y: before.y };
        const dx = gesture.kind === 'start' ? fixed.x - point.x : point.x - fixed.x;
        const dy = gesture.kind === 'start' ? fixed.y - point.y : point.y - fixed.y;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length < cellSize()) { street.tamano = 0; return; }
        street.tamano = Math.max(1, Math.round(length / cellSize()));
        street.angulo = Math.atan2(-dy, dx) * 180 / Math.PI;
        if (gesture.kind === 'start') {
            street.x = fixed.x - Math.cos(street.angulo * Math.PI / 180) * street.tamano * cellSize();
            street.y = fixed.y + Math.sin(street.angulo * Math.PI / 180) * street.tamano * cellSize();
        } else { street.x = fixed.x; street.y = fixed.y; }
    }

    document.addEventListener('pointerdown', event => {
        canvas = document.getElementById('simuladorCanvas');
        if (editor.gesture || event.button !== 0 || event.target !== canvas || window.drawStreetTool?.isActive?.()) return;
        const street = isStraightSelected();
        if (!street) return;
        const point = worldAt(event), kind = hitKind(point, street);
        if (!kind) return;

        // Structural-edit mode must pause even when this gesture is later cancelled.
        window.streetEditPause?.();
        editor.gesture = { street, kind, before: geometry(street), proposed: geometry(street), pointerId: event.pointerId, origin: point };
        canvas.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        event.stopImmediatePropagation();
        canvas.style.cursor = kind === 'body' ? 'grabbing' : 'crosshair';
    }, true);

    document.addEventListener('pointermove', event => {
        const g = editor.gesture;
        if (!g || event.pointerId !== g.pointerId) return;
        const point = worldAt(event), street = g.proposed, before = g.before;
        if (g.kind === 'body') {
            street.x = before.x + point.x - g.origin.x;
            street.y = before.y + point.y - g.origin.y;
        } else resizePreview(g, point);
        showPreview(street);
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);

    document.addEventListener('pointerup', event => {
        if (!editor.gesture || event.pointerId !== editor.gesture.pointerId) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const rect = canvas.getBoundingClientRect();
        finishGesture(event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom);
    }, true);
    document.addEventListener('pointercancel', event => {
        if (!editor.gesture || event.pointerId !== editor.gesture.pointerId) return;
        finishGesture(false);
    }, true);
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && editor.gesture) { event.preventDefault(); finishGesture(false); }
    }, true);
})();
