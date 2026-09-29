/** Map-first glorieta creation: drag from its center to the inner edge. */
(() => {
    const button = document.getElementById('drawRoundaboutButton');
    let canvas = document.getElementById('simuladorCanvas');
    if (!button || !canvas) return;
    let active = false;
    let gesture = null;
    let overlay = null;
    let circle = null;
    let outerCircle = null;
    let cursor = '';
    let suppressClick = false;
    const size = () => Number(window.celda_tamano) || 5;
    function inside(e) {
        const r = canvas.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
    }
    function world(e) {
        const r = canvas.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        const camera = window.USE_PIXI && window.pixiApp?.cameraController;
        return camera ? camera.screenToWorld(
            x * window.pixiApp.app.screen.width / r.width,
            y * window.pixiApp.app.screen.height / r.height
        ) : {
            x: (x * canvas.width / r.width - (window.offsetX || 0)) / (window.escala || 1),
            y: (y * canvas.height / r.height - (window.offsetY || 0)) / (window.escala || 1)
        };
    }
    function preview(e) {
        if (!gesture || !circle) return;
        const r = canvas.getBoundingClientRect();
        circle.setAttribute('cx', gesture.clientX - r.left);
        circle.setAttribute('cy', gesture.clientY - r.top);
        circle.setAttribute('r', Math.hypot(e.clientX - gesture.clientX, e.clientY - gesture.clientY));
        circle.setAttribute('stroke', '#1976d2');
        const radius = Math.hypot(e.clientX - gesture.clientX, e.clientY - gesture.clientY);
        const point = world(e);
        const worldRadius = Math.hypot(point.x - gesture.x, point.y - gesture.y);
        outerCircle?.setAttribute('cx', gesture.clientX - r.left);
        outerCircle?.setAttribute('cy', gesture.clientY - r.top);
        outerCircle?.setAttribute('r', worldRadius ? radius * (1 + size() / worldRadius) : 0);
    }
    function clear() {
        if (gesture && canvas.hasPointerCapture?.(gesture.pointerId)) canvas.releasePointerCapture(gesture.pointerId);
        gesture = null;
        circle?.setAttribute('r', '0');
        outerCircle?.setAttribute('r', '0');
    }
    function deactivate() {
        if (!active) return;
        clear();
        active = false;
        canvas.style.cursor = cursor;
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
        canvas.removeEventListener('pointerdown', down, true);
        canvas.removeEventListener('pointermove', move, true);
        canvas.removeEventListener('pointerup', up, true);
        canvas.removeEventListener('pointercancel', clear, true);
        document.removeEventListener('keydown', key);
        overlay?.remove();
        overlay = circle = outerCircle = null;
        window.setTimeout(() => canvas.removeEventListener('click', click, true), 0);
    }
    function activate() {
        if (active) return;
        // Pixi replaces the original canvas asynchronously during startup.
        canvas = document.getElementById('simuladorCanvas');
        if (!canvas) return;
        window.drawStreetTool?.deactivate();
        if (!document.getElementById('linkDraftPanel')?.hidden) document.getElementById('linkCancelButton')?.click();
        window.createLinkTool?.cancel?.();
        window.streetEditPause?.();
        active = true;
        cursor = canvas.style.cursor;
        canvas.style.cursor = 'crosshair';
        button.classList.add('active');
        button.setAttribute('aria-pressed', 'true');
        overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        overlay.classList.add('street-draw-preview');
        circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        for (const [key, value] of Object.entries({ fill: 'none', stroke: '#1976d2', 'stroke-width': '3', 'stroke-dasharray': '6 4' })) circle.setAttribute(key, value);
        outerCircle = circle.cloneNode();
        overlay.append(circle, outerCircle);
        canvas.parentElement.append(overlay);
        canvas.addEventListener('pointerdown', down, true);
        canvas.addEventListener('pointermove', move, true);
        canvas.addEventListener('pointerup', up, true);
        canvas.addEventListener('pointercancel', clear, true);
        canvas.addEventListener('click', click, true);
        document.addEventListener('keydown', key);
    }
    function down(e) {
        if (e.button !== 0 || !inside(e)) return;
        const p = world(e);
        // The center is the island, not pavement: it may contain an existing
        // map object. The active drawing tool must own this pointer gesture.
        e.preventDefault();
        e.stopImmediatePropagation();
        gesture = { ...p, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId };
        canvas.setPointerCapture?.(e.pointerId);
        preview(e);
    }
    function move(e) { if (gesture?.pointerId === e.pointerId) preview(e); }
    function up(e) {
        if (gesture?.pointerId !== e.pointerId) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        suppressClick = true;
        window.setTimeout(() => { suppressClick = false; }, 0);
        const start = gesture, validRelease = inside(e), end = world(e);
        clear();
        if (!validRelease) return;
        const radius = Math.hypot(end.x - start.x, end.y - start.y);
        const geometry = window.roundaboutStreet?.validate?.({ geometryType: 'roundabout', tipo: 'conexion', x: start.x, y: start.y, innerRadius: radius, startAngle: 0, carriles: 1 });
        if (!geometry?.valid) {
            button.setAttribute('data-bs-title', geometry?.reason || 'El radio interior no es válido');
            button.classList.add('draw-street-retry');
            window.setTimeout(() => button.classList.remove('draw-street-retry'), 1200);
            return;
        }
        createAndSelect(start, radius, geometry.cells);
        deactivate();
    }
    function createAndSelect(start, radius, cells) {
        const used = new Set((window.calles || []).map(street => street.nombre));
        let n = 1;
        while (used.has(`Glorieta ${n}`)) n++;
        const street = window.crearCalle(`Glorieta ${n}`, cells, window.TIPOS.CONEXION, start.x, start.y, 0, 0, 1, 0.02);
        Object.assign(street, { geometryType: 'roundabout', innerRadius: radius, startAngle: 0, tamano: cells, vertices: [], esCurva: false });
        const index = window.calles.indexOf(street);
        for (const id of ['selectCalle', 'selectCalleEditor']) {
            const select = document.getElementById(id);
            if (!select) continue;
            if (!Array.from(select.options).some(option => option.value === String(index))) {
                select.innerHTML = '<option value="">Selecciona una calle</option>';
                window.streetListUI.sortedEntries(window.calles).forEach(({ street: entry, index: i }) => {
                    select.add(new Option(entry.nombre, i));
                });
            }
            select.value = String(index);
        }
        document.getElementById('selectCalle')?.dispatchEvent(new Event('change', { bubbles: true }));
        window.calleSeleccionada = street;
        window.edificioSeleccionado = null;
        window.cellGeometryIndex?.invalidate?.(street);
        window.pixiApp?.sceneManager?.renderAll?.();
        window.renderizarCanvas?.();
        document.dispatchEvent(new CustomEvent('street-drawn', { detail: { calle: street } }));
    }
    function click(e) { if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); suppressClick = false; } }
    function key(e) { if (e.key === 'Escape') deactivate(); }
    button.addEventListener('click', () => active ? deactivate() : activate());
    document.getElementById('createLinkButton')?.addEventListener('click', deactivate, true);
    window.drawRoundaboutTool = { activate, deactivate, isActive: () => active, finishGesture: () => clear() };
})();
