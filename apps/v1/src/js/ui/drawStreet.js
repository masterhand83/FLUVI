/** Map-first straight Calle creation; the canvas owns only gestures begun on empty space. */
(() => {
    let active = false;
    let start = null;
    let pointerId = null;
    let view = null;
    let preview = null;
    let cueTimer = null;
    let originalCursor = '';
    const cellSize = () => window.celda_tamano || 5;

    function inside(event) {
        const rect = view.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX < rect.right &&
            event.clientY >= rect.top && event.clientY < rect.bottom;
    }

    function worldPoint(event) {
        const rect = view.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const camera = window.USE_PIXI && window.pixiApp?.cameraController;
        return camera ? camera.screenToWorld(x, y) : {
            x: (x * view.width / rect.width - window.offsetX) / window.escala,
            y: (y * view.height / rect.height - window.offsetY) / window.escala
        };
    }

    function clearGesture() {
        if (pointerId !== null && view.hasPointerCapture?.(pointerId)) view.releasePointerCapture(pointerId);
        start = null;
        pointerId = null;
        if (preview) preview.hidden = true;
    }

    function showPreview(event) {
        if (!preview) return;
        const rect = view.getBoundingClientRect();
        preview.setAttribute('x1', start.clientX - rect.left);
        preview.setAttribute('y1', start.clientY - rect.top);
        preview.setAttribute('x2', event.clientX - rect.left);
        preview.setAttribute('y2', event.clientY - rect.top);
        preview.hidden = false;
    }

    function retryCue() {
        const button = document.getElementById('drawStreetButton');
        if (!button) return;
        button.classList.add('draw-street-retry');
        button.setAttribute('data-bs-title', 'Arrastra al menos una celda para crear una calle');
        clearTimeout(cueTimer);
        cueTimer = setTimeout(() => button.classList.remove('draw-street-retry'), 1200);
    }

    function nextName() {
        const used = new Set((window.calles || []).map(calle => calle.nombre));
        let n = 1;
        while (used.has(`Street ${n}`)) n++;
        return `Street ${n}`;
    }

    function selectStreet(calle) {
        const index = window.calles.indexOf(calle);
        for (const id of ['selectCalle', 'selectCalleEditor']) {
            const selector = document.getElementById(id);
            if (!selector) continue;
            if (!Array.from(selector.options).some(option => option.value === String(index))) {
                selector.add(new Option(calle.nombre, index));
            }
            selector.value = String(index);
        }
        document.getElementById('selectCalle')?.dispatchEvent(new Event('change', { bubbles: true }));
        window.calleSeleccionada = calle;
        window.edificioSeleccionado = null;
        if (window.USE_PIXI && window.pixiApp?.sceneManager) {
            window.pixiApp.sceneManager.renderAll();
        }
        window.renderizarCanvas?.();
        document.dispatchEvent(new CustomEvent('street-drawn', { detail: { calle } }));
    }

    function onDown(event) {
        if (!active || event.button !== 0 || !inside(event)) return;
        const point = worldPoint(event);
        if (encontrarCalleEnPunto(point.x, point.y) || encontrarEdificioEnPunto(point.x, point.y)) return;
        event.preventDefault();
        event.stopPropagation();
        start = { ...point, clientX: event.clientX, clientY: event.clientY };
        pointerId = event.pointerId;
        view.setPointerCapture?.(pointerId);
        showPreview(event);
    }

    function onMove(event) {
        if (start && event.pointerId === pointerId) showPreview(event);
    }

    function onUp(event) {
        if (!start || event.pointerId !== pointerId) return;
        const origin = start;
        const validRelease = inside(event);
        const end = worldPoint(event);
        clearGesture();
        if (!validRelease) return;
        const dx = end.x - origin.x;
        const dy = end.y - origin.y;
        const distance = Math.hypot(dx, dy);
        if (distance < cellSize()) { retryCue(); return; }
        const cells = Math.max(1, Math.round(distance / cellSize()));
        // Calle geometry uses clockwise-negative angles in screen coordinates.
        const angle = -Math.atan2(dy, dx) * 180 / Math.PI;
        const calle = window.crearCalle(nextName(), cells, window.TIPOS.CONEXION,
            origin.x, origin.y, angle, 0, 1, 0.02);
        selectStreet(calle);
        deactivate();
    }

    function onKey(event) {
        if (active && event.key === 'Escape') {
            clearGesture();
            deactivate();
        }
    }

    function activate() {
        if (active) return;
        view = document.getElementById('simuladorCanvas');
        if (!view) return;
        active = true;
        originalCursor = view.style.cursor;
        view.style.cursor = 'crosshair';
        preview = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        preview.classList.add('street-draw-preview');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('stroke', '#1976d2');
        line.setAttribute('stroke-width', '3');
        line.setAttribute('stroke-dasharray', '6 4');
        preview.appendChild(line);
        view.parentElement.appendChild(preview);
        preview = line;
        preview.hidden = true;
        view.addEventListener('pointerdown', onDown, true);
        view.addEventListener('pointermove', onMove, true);
        view.addEventListener('pointerup', onUp, true);
        view.addEventListener('pointercancel', clearGesture, true);
        document.addEventListener('keydown', onKey);
    }

    function deactivate() {
        if (!active) return;
        clearGesture();
        active = false;
        view.style.cursor = originalCursor;
        view.removeEventListener('pointerdown', onDown, true);
        view.removeEventListener('pointermove', onMove, true);
        view.removeEventListener('pointerup', onUp, true);
        view.removeEventListener('pointercancel', clearGesture, true);
        document.removeEventListener('keydown', onKey);
        preview?.ownerSVGElement?.remove();
        preview = null;
        document.getElementById('drawStreetButton')?.setAttribute('aria-pressed', 'false');
        document.getElementById('drawStreetButton')?.classList.remove('active');
    }

    window.drawStreetTool = { activate, deactivate, isActive: () => active };
})();
