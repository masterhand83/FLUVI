(() => {
    const button = document.getElementById('drawStreetButton');
    const inspector = document.getElementById('streetInspector');
    const closeButton = document.getElementById('streetInspectorClose');
    const name = document.getElementById('streetInspectorName');
    const cells = document.getElementById('streetInspectorCells');
    const lanes = document.getElementById('streetInspectorLanes');
    const type = document.getElementById('streetInspectorType');
    const canvas = document.getElementById('simuladorCanvas');

    if (!button || !inspector) return;

    function setStreet(calle) {
        if (!calle) {
            inspector.hidden = true;
            return;
        }

        name.textContent = calle.nombre || 'Calle sin nombre';
        const laneArrays = Array.isArray(calle.arreglo) ? calle.arreglo : [];
        const actualCells = laneArrays[0]?.length ?? calle.tamano;
        cells.textContent = String(actualCells);
        lanes.textContent = String(laneArrays.length || calle.carriles || 0);
        type.textContent = calle.tipo || '—';
        inspector.hidden = false;
    }

    function updateDrawButton() {
        const active = Boolean(window.drawStreetTool?.isActive?.());
        button.setAttribute('aria-pressed', String(active));
        button.classList.toggle('active', active);
    }

    button.addEventListener('click', () => {
        const tool = window.drawStreetTool;
        if (!tool) return;
        if (tool.isActive()) tool.deactivate();
        else tool.activate();
        updateDrawButton();
    });

    closeButton?.addEventListener('click', () => { inspector.hidden = true; });
    document.addEventListener('street-drawn', (event) => setStreet(event.detail?.calle));
    document.getElementById('selectCalle')?.addEventListener('change', () => setStreet(window.calleSeleccionada));
    document.getElementById('selectCalleEditor')?.addEventListener('change', syncSelectionFromSelector);

    function syncSelectionFromSelector() {
        window.setTimeout(() => setStreet(window.calleSeleccionada), 0);
    }

    // Canvas selection handlers update window.calleSeleccionada during pointer events.
    // Defer reading until those handlers (including Pixi's) have completed.
    const syncSelection = () => window.setTimeout(() => {
        if (window.calleSeleccionada) setStreet(window.calleSeleccionada);
        else setStreet(null);
    }, 0);
    document.addEventListener('pointerup', syncSelection, true);
    canvas?.addEventListener('click', syncSelection, true);

    document.addEventListener('click', (event) => {
        if (event.target === canvas) return;
        updateDrawButton();
    });
    updateDrawButton();
})();
