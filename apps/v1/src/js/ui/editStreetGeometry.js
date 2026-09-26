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
            const screen = window.pixiApp.app?.screen;
            return window.pixiApp.cameraController.screenToWorld(
                (event.clientX - rect.left) * (screen?.width || rect.width) / rect.width,
                (event.clientY - rect.top) * (screen?.height || rect.height) / rect.height);
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
    const handles = Object.fromEntries(['start', 'end'].map(end => {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'street-endpoint-handle';
        handle.dataset.end = end;
        handle.setAttribute('aria-label', end === 'start' ? 'Mover inicio de calle' : 'Mover fin de calle');
        handle.hidden = true;
        canvas.parentElement.append(handle);
        return [end, handle];
    }));

    function placeHandle(handle, point) {
        const rect = canvas.getBoundingClientRect();
        const parentRect = canvas.parentElement.getBoundingClientRect();
        const camera = window.USE_PIXI && window.pixiApp?.cameraController;
        const screen = camera ? camera.worldToScreen(point.x, point.y) : {
            x: point.x * (Number(window.escala) || 1) + (Number(window.offsetX) || 0),
            y: point.y * (Number(window.escala) || 1) + (Number(window.offsetY) || 0)
        };
        const width = camera ? (window.pixiApp.app?.screen?.width || rect.width) : canvas.width;
        const height = camera ? (window.pixiApp.app?.screen?.height || rect.height) : canvas.height;
        handle.style.left = `${rect.left - parentRect.left + screen.x * rect.width / width}px`;
        handle.style.top = `${rect.top - parentRect.top + screen.y * rect.height / height}px`;
    }
    function syncHandles() {
        const current = document.getElementById('simuladorCanvas');
        if (current) canvas = current; // Pixi replaces the original canvas during initialization.
        const street = isStraightSelected();
        const visible = street && !window.drawStreetTool?.isActive?.();
        const points = visible ? endpoints(street) : [];
        for (const [index, end] of ['start', 'end'].entries()) {
            const handle = handles[end];
            if (handle.parentElement !== canvas.parentElement) canvas.parentElement.append(handle);
            handle.hidden = !visible;
            if (visible) placeHandle(handle, points[index]);
        }
    }
    // Selection and both camera implementations change without a common event; follow their
    // current state so handles also survive Pixi's asynchronous canvas replacement.
    function followCamera() {
        syncHandles();
        requestAnimationFrame(followCamera);
    }
    requestAnimationFrame(followCamera);

    function renderStreet(street) {
        if (window.USE_PIXI) {
            const renderer = window.pixiApp?.sceneManager?.calleRenderer;
            renderer?.renderCalleRecta(street);
            window.pixiApp?.sceneManager?.refreshEtiquetas?.();
        } else window.renderizarCanvas?.();
        syncHandles();
    }
    function finishGesture(commit) {
        const gesture = editor.gesture;
        if (!gesture) return;
        const { street, before, proposed } = gesture;
        // The dimension helper must see the original size so it can preserve indexed cells
        // and vehicles, and prune only references that no longer fit the committed length.
        Object.assign(street, before);
        if (commit && valid(proposed)) {
            if (proposed.tamano !== before.tamano) window.editorCalles?.aplicarNuevasDimensiones(street, proposed.tamano, street.carriles);
            Object.assign(street, proposed);
            window.streetInspector?.refresh?.();
        }
        renderStreet(street);
        // Cars, connections and parking links also depend on the committed geometry.
        if (window.USE_PIXI) window.pixiApp?.sceneManager?.renderAll();
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
        if (!Number.isFinite(length) || length < cellSize()) return;
        street.tamano = Math.max(1, Math.round(length / cellSize()));
        street.angulo = Math.atan2(-dy, dx) * 180 / Math.PI;
        if (gesture.kind === 'start') {
            street.x = fixed.x - Math.cos(street.angulo * Math.PI / 180) * street.tamano * cellSize();
            street.y = fixed.y + Math.sin(street.angulo * Math.PI / 180) * street.tamano * cellSize();
        } else { street.x = fixed.x; street.y = fixed.y; }
    }

    document.addEventListener('pointerdown', event => {
        canvas = document.getElementById('simuladorCanvas');
        const end = event.target.closest?.('.street-endpoint-handle')?.dataset.end;
        if (editor.gesture || event.button !== 0 || (event.target !== canvas && !handles[end]?.isSameNode(event.target)) || window.drawStreetTool?.isActive?.()) return;
        const street = isStraightSelected();
        if (!street) return;
        const point = worldAt(event), kind = end || hitKind(point, street);
        if (!kind) return;

        // Structural-edit mode must pause even when this gesture is later cancelled.
        window.streetEditPause?.();
        editor.gesture = { street, kind, before: geometry(street), proposed: geometry(street), pointerId: event.pointerId, origin: point };
        event.target.setPointerCapture?.(event.pointerId);
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
        Object.assign(g.street, street);
        renderStreet(g.street);
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
