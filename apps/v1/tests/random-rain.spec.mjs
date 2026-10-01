import { describe, expect, it } from 'vitest';
import { openSimulator } from './helpers/simulator.mjs';

describe('random rain', () => {
    it('keeps floods stationary at devourer exits and connection sources until explicitly cleared', async () => {
        const simulator = await openSimulator();
        try {
            const result = await simulator.page.evaluate(() => {
                window.inicializarEscenarios();
                if (!window.isPaused) document.getElementById('btnPauseResume').click();
                const input = document.getElementById('probabilidadLluvia');
                input.value = '100';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                Math.random = () => 0;
                const road = (name, type, cells) => {
                    const street = window.crearCalle(name, cells.length, type, 0, 0, 0, 0, 1, 0);
                    street.arreglo[0] = cells;
                    return street;
                };
                const run = (roads, links = []) => {
                    const source = roads[0];
                    window.calles.splice(0, window.calles.length, ...roads);
                    window.conexiones.splice(0, window.conexiones.length, ...links);
                    links.forEach(link => { source.conexionesSalida[0].push(link); });
                    window.estadoEscenarios.celdasBloqueadas.clear();
                    const toggle = document.getElementById('toggleLluviaAleatoria');
                    toggle.click();
                    document.getElementById('btnPaso').click();
                    toggle.click();
                    const before = window.exportarBloqueos();
                    for (let i = 0; i < 3; i++) document.getElementById('btnPaso').click();
                    const sourceCells = [...source.arreglo[0]];
                    const destinationCells = roads.slice(1).map(street => [...street.arreglo[0]]);
                    const after = window.exportarBloqueos();
                    window.limpiarTodosLosBloqueosSilencioso();
                    return { before, after, sourceCells, destinationCells, cleared: [...source.arreglo[0]] };
                };
                const sinks = [1, -1].map(direction => {
                    const source = road('Sink', TIPOS.DEVORADOR, direction === 1 ? [7, 0] : [0, 7]);
                    source.laneDirections[0] = direction;
                    return run([source]);
                });
                const links = ['lineal', 'incorporacion', 'probabilistica'].map(type => {
                    const source = road('Source', TIPOS.CONEXION, [0]);
                    const destination = road('Destination', TIPOS.CONEXION, [0, 0, 0]);
                    return run([source, destination], [new window.ConexionCA(source, destination, 0, 0, 0, 0, 1, type)]);
                });
                return { sinks, links };
            });
            for (const sink of result.sinks) {
                expect(sink.sourceCells).toEqual([7, 7]);
                expect(sink.after).toEqual(sink.before);
            }
            expect(result.sinks[0].cleared).toEqual([7, 0]);
            expect(result.sinks[1].cleared).toEqual([0, 7]);
            for (const link of result.links) {
                expect(link.sourceCells).toEqual([7]);
                expect(link.destinationCells).toEqual([[0, 0, 0]]);
                expect(link.after).toEqual(link.before);
                expect(link.cleared).toEqual([0]);
            }
            expect(simulator.pageErrors).toEqual([]);
        } finally {
            await simulator.close();
        }
    }, 30000);

    for (const usePixi of [false, true]) {
        it(`renders random floods as water in ${usePixi ? 'Pixi' : 'Canvas'}`, async () => {
            const simulator = await openSimulator({ usePixi });
            try {
                if (usePixi) await simulator.page.waitForFunction(() => !!window.pixiApp?.sceneManager, { polling: 100, timeout: 30000 });
                await simulator.page.evaluate(() => window.inicializarEscenarios());
                const result = await simulator.page.evaluate(() => {
                    if (!window.isPaused) document.getElementById('btnPauseResume').click();
                    const input = document.getElementById('probabilidadLluvia');
                    input.value = '100';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    document.getElementById('toggleLluviaAleatoria').click();
                    const context = document.getElementById('simuladorCanvas').getContext('2d');
                    const oldDraw = context?.drawImage;
                    let waterDrawn = false;
                    if (context) context.drawImage = function(image, ...args) {
                        if (image.src?.endsWith('/Inundacion.png')) waterDrawn = true;
                        return oldDraw.call(this, image, ...args);
                    };
                    try {
                        document.getElementById('btnPaso').click();
                        return { waterDrawn, floods: window.exportarBloqueos().length };
                    } finally {
                        if (context) context.drawImage = oldDraw;
                    }
                });
                if (usePixi) result.waterDrawn = await simulator.page.evaluate(() => {
                    const renderer = window.pixiApp.sceneManager.carroRenderer;
                    return Array.from(renderer.scene.carroSprites.values())
                        .some(sprite => sprite.texture === renderer.assets.getTexture('inundacion'));
                });
                expect(result).toEqual({ waterDrawn: true, floods: 1 });
                expect(simulator.pageErrors).toEqual([]);
            } finally {
                await simulator.close();
            }
        }, 60000);
    }

    it('allows saving a rain-only scenario before any flooding occurs', async () => {
        const simulator = await openSimulator();
        try {
            await simulator.page.evaluate(() => {
                window.inicializarEscenarios();
                window.inicializarGestionEscenarios();
                document.getElementById('btnGuardarEscenario').click();
            });
            await simulator.page.waitForFunction(() => document.getElementById('modalGuardarEscenario').classList.contains('show'), { polling: 50, timeout: 5000 });
            expect(simulator.pageErrors).toEqual([]);
        } finally {
            await simulator.close();
        }
    }, 30000);

    it('uses equal street odds, respects the probability threshold, and never replaces occupied cells', async () => {
        const simulator = await openSimulator();
        try {
            const result = await simulator.page.evaluate(() => {
                window.inicializarEscenarios();
                if (!window.isPaused) document.getElementById('btnPauseResume').click();
                window.conexiones.length = 0;
                const road = (name, cells) => {
                    const street = window.crearCalle(name, cells.length, TIPOS.CONEXION, 0, 0, 0, 0, 1, 0);
                    street.arreglo[0] = cells;
                    return street;
                };
                const input = document.getElementById('probabilidadLluvia');
                input.value = '50';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                document.getElementById('toggleLluviaAleatoria').click();
                const run = random => {
                    const long = road('Long street', Array(100).fill(0));
                    const short = road('Short:street', [0]);
                    const occupied = road('Occupied', [1, 7, 8, 9]);
                    window.calles.splice(0, window.calles.length, long, short, occupied);
                    window.estadoEscenarios.celdasBloqueadas.clear();
                    Math.random = () => random;
                    document.getElementById('btnPaso').click();
                    return { flooded: window.exportarBloqueos().map(cell => cell.key),
                        occupied: occupied.arreglo[0], short: short.arreglo[0] };
                };
                const lowerHalf = run(0.49);
                const failedRoll = run(0.5);
                input.value = '100';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                const upperHalf = run(0.5);
                const saved = window.crearEscenarioJSON('Colon street flood');
                const savedFloods = saved.celdasBloqueadas;
                window.cargarEscenarioDesdeJSON(saved);
                const restored = window.calles[1].arreglo[0];
                // No eligible street is a no-op, not an infinite retry loop.
                window.calles.splice(0, window.calles.length, road('Full', [7]));
                document.getElementById('toggleLluviaAleatoria').click();
                document.getElementById('btnPaso').click();
                const full = window.calles[0].arreglo[0];
                window.calles.length = 0;
                document.getElementById('btnPaso').click();
                return { lowerHalf, failedRoll, upperHalf, savedFloods, restored, full };
            });
            expect(result.lowerHalf.flooded).toEqual(['Long street:0:49']);
            expect(result.failedRoll.flooded).toEqual([]);
            expect(result.upperHalf.flooded).toEqual(['Short:street:0:0']);
            for (const run of [result.lowerHalf, result.failedRoll, result.upperHalf]) {
                expect(run.occupied).toEqual([1, 7, 8, 9]);
            }
            expect(result.savedFloods).toEqual([{ calleNombre: 'Short:street', calleId: 'Short:street',
                carril: 0, indice: 0, tipo: 'inundacion', texture: 'inundacion' }]);
            expect(result.restored).toEqual([7]);
            expect(result.full).toEqual([7]);
            expect(simulator.pageErrors).toEqual([]);
        } finally {
            await simulator.close();
        }
    }, 30000);

    it('round-trips map probability with rain off and defaults older maps to 10%', async () => {
        const simulator = await openSimulator();
        try {
            const saved = await simulator.page.evaluate(async () => {
                window.inicializarEscenarios();
                const input = document.getElementById('probabilidadLluvia');
                input.value = '64';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                document.getElementById('toggleLluviaAleatoria').click();
                const oldPrompt = window.prompt, oldCreate = URL.createObjectURL;
                let blob;
                window.prompt = () => 'Rain map';
                URL.createObjectURL = value => { blob = value; return 'blob:rain-test'; };
                try { window.guardarSimulacion(); return JSON.parse(await blob.text()); }
                finally { window.prompt = oldPrompt; URL.createObjectURL = oldCreate; }
            });
            expect(saved.lluviaAleatoria).toEqual({ probabilidad: 64 });
            // Keep one street so replacement is quick and its identity signals completion.
            saved.calles = saved.calles.slice(0, 1);
            saved.conexiones = [];
            saved.edificios = [];
            const load = async payload => {
                await simulator.page.evaluate(data => {
                    window.__previousRainStreet = window.calles[0];
                    window.confirm = () => true;
                    window.cargarSimulacion({ target: { files: [new File([JSON.stringify(data)], 'rain.json')], value: '' } });
                }, payload);
                await simulator.page.waitForFunction(() => window.calles[0] && window.calles[0] !== window.__previousRainStreet);
                return simulator.page.evaluate(() => ({ probability: document.getElementById('probabilidadLluvia').value,
                    active: document.getElementById('toggleLluviaAleatoria').checked }));
            };
            expect(await load(saved)).toEqual({ probability: '64', active: false });
            delete saved.lluviaAleatoria;
            expect(await load(saved)).toEqual({ probability: '10', active: false });
            expect(simulator.pageErrors).toEqual([]);
        } finally {
            await simulator.close();
        }
    }, 30000);

    it('saves rain probability in scenarios and restores it with rain off', async () => {
        const simulator = await openSimulator();
        try {
            const result = await simulator.page.evaluate(() => {
                window.inicializarEscenarios();
                const input = document.getElementById('probabilidadLluvia');
                input.value = '37';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                document.getElementById('toggleLluviaAleatoria').click();
                const saved = JSON.parse(JSON.stringify(window.crearEscenarioJSON('Light rain')));
                input.value = '100';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                const loaded = window.cargarEscenarioDesdeJSON(saved);
                return { saved: saved.lluviaAleatoria, loaded: loaded.exito,
                    probability: input.value, active: document.getElementById('toggleLluviaAleatoria').checked };
            });
            expect(result).toEqual({ saved: { probabilidad: 37 }, loaded: true, probability: '37', active: false });
            expect(simulator.pageErrors).toEqual([]);
        } finally {
            await simulator.close();
        }
    }, 30000);

    it('floods one empty cell per successful step and stops without clearing floods', async () => {
        const simulator = await openSimulator();
        try {
            const result = await simulator.page.evaluate(() => {
                window.inicializarEscenarios();
                if (!window.isPaused) document.getElementById('btnPauseResume').click();
                const toggle = document.getElementById('toggleLluviaAleatoria');
                const probability = document.getElementById('probabilidadLluvia');
                if (!toggle || !probability) return { missingControls: true };
                const setProbability = value => {
                    probability.value = String(value);
                    probability.dispatchEvent(new Event('input', { bubbles: true }));
                };
                const step = () => document.getElementById('btnPaso').click();
                const floods = () => window.exportarBloqueos().filter(cell => cell.tipo === 'inundacion').length;
                setProbability(100);
                toggle.click();
                const beforeStep = floods();
                step();
                const afterOne = floods();
                step();
                const afterTwo = floods();
                setProbability(0);
                step();
                const afterZero = floods();
                setProbability(100);
                toggle.click();
                step();
                return { beforeStep, afterOne, afterTwo, afterZero, afterOff: floods(),
                    label: document.getElementById('probabilidadLluviaValor').textContent };
            });
            expect(result).toEqual({ beforeStep: 0, afterOne: 1, afterTwo: 2,
                afterZero: 2, afterOff: 2, label: '100%' });
            expect(simulator.pageErrors).toEqual([]);
        } finally {
            await simulator.close();
        }
    }, 30000);
});
