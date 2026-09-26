(() => {
    const button = document.getElementById('drawStreetButton');
    const inspector = document.getElementById('streetInspector');
    const closeButton = document.getElementById('streetInspectorClose');
    const fields = {
        name: document.getElementById('streetInspectorName'),
        x: document.getElementById('streetInspectorX'),
        y: document.getElementById('streetInspectorY'),
        angle: document.getElementById('streetInspectorAngle'),
        cells: document.getElementById('streetInspectorCells'),
        lanes: document.getElementById('streetInspectorLanes'),
        type: document.getElementById('streetInspectorType'),
        generation: document.getElementById('streetInspectorGeneration'),
        laneChange: document.getElementById('streetInspectorLaneChange')
    };
    const generationRow = document.getElementById('streetInspectorGenerationRow');
    const error = document.getElementById('streetInspectorError');
    const canvas = document.getElementById('simuladorCanvas');
    if (!button || !inspector) return;

    let selected = null;
    let focusedField = null;
    let committing = false;
    const editable = Object.values(fields);
    const readModel = (calle) => {
        fields.name.value = calle.nombre || '';
        fields.x.value = calle.x ?? '';
        fields.y.value = calle.y ?? '';
        fields.angle.value = calle.angulo ?? '';
        fields.cells.value = calle.tamano ?? calle.arreglo?.[0]?.length ?? '';
        fields.lanes.value = calle.carriles ?? calle.arreglo?.length ?? '';
        fields.type.value = calle.tipo || 'conexion';
        fields.generation.value = Number(calle.probabilidadGeneracion || 0) * 100;
        fields.laneChange.value = Number(calle.probabilidadSaltoDeCarril || 0) * 100;
        generationRow.hidden = calle.tipo !== 'generador';
    };
    function show(calle) {
        if (selected !== calle) for (const field of editable) {
            field.setCustomValidity('');
            field.removeAttribute('aria-invalid');
        }
        selected = calle || null;
        if (!selected) { inspector.hidden = true; return; }
        readModel(selected);
        inspector.hidden = false;
        error.textContent = '';
    }
    function fail(field, message) {
        error.textContent = message;
        field.setAttribute('aria-invalid', 'true');
        field.setCustomValidity(message);
        return false;
    }
    function refresh() {
        window.renderizarCanvas?.();
        if (window.USE_PIXI && window.pixiApp?.sceneManager) window.pixiApp.sceneManager.renderAll();
    }
    function uniqueName(value) {
        return !(window.calles || []).some(calle => calle !== selected && calle.nombre.trim().toLocaleLowerCase() === value.toLocaleLowerCase());
    }
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Validation is intentionally centralized so commits share one atomic model-update path.
    function commit(field) {
        if (!selected || committing || !field) return true;
        committing = true;
        field.setCustomValidity('');
        field.removeAttribute('aria-invalid');
        error.textContent = '';
        const value = field.value.trim();
        const numeric = Number(value);
        try {
            if (field === fields.name) {
                if (!value) return fail(field, 'El nombre no puede estar vacío.');
                if (!uniqueName(value)) return fail(field, 'Ya existe una calle con ese nombre.');
                selected.nombre = value;
                selected.id = value;
                for (const id of ['selectCalle', 'selectCalleEditor']) {
                    const selector = document.getElementById(id);
                    const index = (window.calles || []).indexOf(selected);
                    const option = selector?.querySelector(`option[value="${index}"]`);
                    if (option) option.textContent = value;
                }
            } else if (field === fields.x || field === fields.y || field === fields.angle) {
                if (value === '' || !Number.isFinite(numeric)) return fail(field, 'Introduce un número válido.');
                if (numeric !== selected[field === fields.angle ? 'angulo' : field === fields.x ? 'x' : 'y']) window.streetEditPause?.();
                if (field === fields.x) selected.x = numeric;
                else if (field === fields.y) selected.y = numeric;
                else selected.angulo = numeric;
            } else if (field === fields.cells || field === fields.lanes) {
                if (!value || !Number.isInteger(numeric) || numeric < 1 || (field === fields.cells && numeric > 2500)) return fail(field, 'Introduce un número entero entre 1 y 2500.');
                const cells = field === fields.cells ? numeric : Number(selected.tamano);
                const lanes = field === fields.lanes ? numeric : Number(selected.carriles);
                if (field === fields.lanes && numeric > 10) return fail(field, 'El número máximo de carriles es 10.');
                if (window.editorCalles?.aplicarNuevasDimensiones) {
                    if (cells !== selected.tamano || lanes !== selected.carriles) window.streetEditPause?.();
                    window.editorCalles.aplicarNuevasDimensiones(selected, cells, lanes);
                } else {
                    selected.tamano = cells; selected.carriles = lanes;
                    selected.arreglo = Array.from({ length: lanes }, (_, i) => Array.from({ length: cells }, (_, j) => selected.arreglo?.[i]?.[j] ?? 0));
                    selected.celulasEsperando = Array.from({ length: lanes }, (_, i) => Array.from({ length: cells }, (_, j) => selected.celulasEsperando?.[i]?.[j] ?? false));
                }
            } else if (field === fields.type) {
                if (!['generador', 'conexion', 'devorador'].includes(value)) return fail(field, 'Selecciona un tipo de calle válido.');
                if (value !== selected.tipo) window.streetEditPause?.();
                if (value === 'generador' && selected.tipo !== 'generador') selected.probabilidadGeneracion = 0.5;
                if (value !== 'generador') selected.probabilidadGeneracion = 0;
                selected.tipo = value;
                generationRow.hidden = value !== 'generador';
            } else {
                if (value === '' || !Number.isFinite(numeric) || numeric < 0 || numeric > 100) return fail(field, 'La probabilidad debe estar entre 0 y 100 %.');
                if (field === fields.generation) selected.probabilidadGeneracion = numeric / 100;
                else selected.probabilidadSaltoDeCarril = numeric / 100;
            }
            refresh();
            readModel(selected);
            return true;
        } finally { committing = false; }
    }
    editable.forEach((field) => {
        field.addEventListener('focus', () => { focusedField = field; });
        field.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); if (commit(field)) field.blur(); }
            if (event.key === 'Escape') { readModel(selected); field.blur(); error.textContent = ''; }
        });
        field.addEventListener('blur', () => { commit(field); if (focusedField === field) focusedField = null; });
        field.addEventListener('input', () => { field.setCustomValidity(''); field.removeAttribute('aria-invalid'); error.textContent = ''; });
    });
    fields.type.addEventListener('change', () => commit(fields.type));
    window.streetInspector = {
        finishFocusedEdit() { if (focusedField) return commit(focusedField); return true; },
        refresh() { if (selected && !focusedField) readModel(selected); }
    };

    function updateDrawButton() {
        const active = Boolean(window.drawStreetTool?.isActive?.());
        button.setAttribute('aria-pressed', String(active)); button.classList.toggle('active', active);
    }
    button.addEventListener('click', () => {
        const tool = window.drawStreetTool;
        if (!tool) return;
        if (tool.isActive()) tool.deactivate(); else tool.activate();
        updateDrawButton();
    });
    closeButton?.addEventListener('click', () => {
        for (const id of ['selectCalleEditor', 'selectCalle']) {
            const selector = document.getElementById(id);
            if (selector) { selector.value = ''; selector.dispatchEvent(new Event('change', { bubbles: true })); }
        }
        window.calleSeleccionada = null; show(null);
    });
    document.addEventListener('street-drawn', event => show(event.detail?.calle));
    document.getElementById('selectCalle')?.addEventListener('change', () => show(window.calleSeleccionada));
    document.getElementById('selectCalleEditor')?.addEventListener('change', () => window.setTimeout(() => show(window.calleSeleccionada), 0));
    const syncSelection = event => {
        if (inspector.contains(event.target)) return;
        window.setTimeout(() => show(window.calleSeleccionada), 0);
    };
    document.addEventListener('pointerup', syncSelection, true);
    canvas?.addEventListener('click', syncSelection, true);
    document.addEventListener('click', event => { if (event.target !== canvas) updateDrawButton(); });
    updateDrawButton();
})();
