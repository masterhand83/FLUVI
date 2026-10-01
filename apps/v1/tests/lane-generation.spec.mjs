import { describe, expect, it } from 'vitest';
import { openSimulator } from './helpers/simulator.mjs';

describe('per-lane generator controls', () => {
    for (const usePixi of [false, true]) {
        it(`toggles, resizes and persists generator lanes (${usePixi ? 'Pixi' : 'Canvas'})`, async () => {
            const sim = await openSimulator({ usePixi });
            const { page } = sim;
            try {
                await page.waitForFunction(() => window.streetInspector?.refresh && window.editorCalles?.aplicarNuevasDimensiones);
                await page.evaluate(() => {
                    const road = window.crearCalle('Lane generator test', 10, 'generador', 200, 200, 0, 1, 2, 0);
                    road.laneDirections = [1, -1];
                    const selector = document.getElementById('selectCalle');
                    selector.add(new Option(road.nombre, window.calles.indexOf(road)));
                    window.calleSeleccionada = road;
                    selector.value = String(window.calles.indexOf(road));
                    selector.dispatchEvent(new Event('change', { bubbles: true }));
                    window.configuracionTiempo.usarPerfiles = false;
                });
                const switches = '#streetInspectorLaneDirections input[type="checkbox"]';
                expect(await page.$$eval(switches, inputs => inputs.map(input => input.checked))).toEqual([true, true]);
                await page.evaluate(() => document.querySelectorAll('#streetInspectorLaneDirections input')[1].click());
                expect(await page.evaluate(() => {
                    const road = window.calleSeleccionada;
                    generarCelulas(road);
                    return [road.arreglo[0][0] > 0, road.arreglo[1][9] === 0];
                })).toEqual([true, true]);
                await page.evaluate(() => document.querySelectorAll('#streetInspectorLaneDirections input')[1].click());
                expect(await page.evaluate(() => {
                    generarCelulas(window.calleSeleccionada);
                    return window.calleSeleccionada.arreglo[1][9] > 0;
                })).toBe(true);
                await page.evaluate(() => {
                    document.querySelectorAll('#streetInspectorLaneDirections input')[1].click();
                    const road = window.calleSeleccionada;
                    window.editorCalles.aplicarNuevasDimensiones(road, 12, 3);
                });
                expect(await page.evaluate(() => window.calleSeleccionada.laneGenerationEnabled)).toEqual([true, false, true]);
                await page.evaluate(() => {
                    const road = window.calleSeleccionada;
                    window.editorCalles.aplicarNuevasDimensiones(road, 12, 1);
                    window.editorCalles.aplicarNuevasDimensiones(road, 12, 2);
                });
                expect(await page.evaluate(() => window.calleSeleccionada.laneGenerationEnabled)).toEqual([true, true]);
                await page.evaluate(() => { window.calleSeleccionada.laneGenerationEnabled[1] = false; });
                const saved = await page.evaluate(async () => {
                    const oldPrompt = window.prompt, oldCreate = URL.createObjectURL;
                    let blob;
                    window.prompt = () => 'generator lanes';
                    URL.createObjectURL = value => { blob = value; return 'blob:test'; };
                    try { window.guardarSimulacion(); return JSON.parse(await blob.text()); }
                    finally { window.prompt = oldPrompt; URL.createObjectURL = oldCreate; }
                });
                const roadData = saved.calles.find(road => road.nombre === 'Lane generator test');
                expect(roadData.laneGenerationEnabled).toEqual([true, false]);
                const load = async data => {
                    await page.evaluate(payload => {
                        window.__previousGeneratorRoad = window.calles.find(road => road.nombre === 'Lane generator test');
                        window.confirm = () => true;
                        window.cargarSimulacion({ target: { files: [new File([JSON.stringify(payload)], 'lanes.json')], value: '' } });
                    }, data);
                    await page.waitForFunction(() => window.calles.some(road => road.nombre === 'Lane generator test' && road !== window.__previousGeneratorRoad));
                    return page.evaluate(() => window.calles.find(road => road.nombre === 'Lane generator test').laneGenerationEnabled);
                };
                expect(await load(saved)).toEqual([true, false]);
                delete roadData.laneGenerationEnabled;
                expect(await load(saved)).toEqual([true, true]);
                expect(sim.pageErrors).toEqual([]);
            } finally {
                await sim.close();
            }
        }, 60000);
    }
});
