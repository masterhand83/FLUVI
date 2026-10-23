/**
 * mapBackgroundControls.js - Personalización del color de fondo del mapa
 *
 * El estado vive en `window.mapBackgroundCycle` (DayNightCycle) para que Pixi y
 * el fallback Canvas compartan el mismo color. Este módulo solo conecta los
 * controles del sidebar, refresca la vista previa y expone la preferencia para
 * el JSON del mapa.
 */

(function () {
    const DEFAULT_PRESET = 'sky';
    const DEFAULT_PICKER_COLOR = '#6AA0F0';
    const PRESETS = ['blue', 'guinda', 'grey', 'white', 'sky'];

    function getCycle() {
        return typeof window !== 'undefined' ? window.mapBackgroundCycle : null;
    }

    function getPreference() {
        const cycle = getCycle();
        return cycle ? cycle.toJSON() : { preset: DEFAULT_PRESET, color: DEFAULT_PICKER_COLOR };
    }

    function redraw() {
        const cycle = getCycle();
        if (!cycle) return;
        const color = cycle.getBackgroundColor();
        const renderer = window.pixiApp?.app?.renderer
            || window.pixiApp?.sceneManager?.app?.renderer;
        if (window.USE_PIXI && renderer?.background) {
            renderer.background.color = color;
            return;
        }
        if (typeof window.renderizarCanvas === 'function') {
            window.renderizarCanvas();
        }
    }

    function refreshControls() {
        const state = getPreference();

        document.querySelectorAll('[data-map-background-preset]').forEach(button => {
            const active = button.dataset.mapBackgroundPreset === state.preset;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        const picker = document.getElementById('mapBackgroundCustomColor');
        if (picker && state.preset === 'custom') {
            picker.value = state.color;
        }

        const preview = document.getElementById('mapBackgroundPreview');
        if (preview) {
            const cycle = getCycle();
            preview.style.backgroundColor = cycle
                ? cycle.getBackgroundColorCss()
                : state.color;
        }
    }

    function apply(preset, color) {
        const cycle = getCycle();
        if (!cycle) return getPreference();
        const state = cycle.setBackgroundPreset(preset, color);
        refreshControls();
        redraw();
        return state;
    }

    function reset() {
        return apply(DEFAULT_PRESET, null);
    }

    function fromJSON(data) {
        const cycle = getCycle();
        if (!cycle) return getPreference();
        const state = cycle.fromJSON(data);
        refreshControls();
        redraw();
        return state;
    }

    function init() {
        document.querySelectorAll('[data-map-background-preset]').forEach(button => {
            button.addEventListener('click', () => {
                apply(button.dataset.mapBackgroundPreset, null);
            });
        });

        const picker = document.getElementById('mapBackgroundCustomColor');
        if (picker) {
            if (!picker.value) picker.value = DEFAULT_PICKER_COLOR;
            picker.addEventListener('input', () => {
                apply('custom', picker.value);
            });
        }

        refreshControls();
    }

    window.mapBackgroundPreference = {
        presets: PRESETS,
        defaultPreset: DEFAULT_PRESET,
        get: getPreference,
        apply,
        reset,
        refresh: refreshControls,
        toJSON: getPreference,
        fromJSON
    };
    window.mapBackgroundPreferenceToJSON = getPreference;
    window.mapBackgroundPreferenceFromJSON = fromJSON;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
