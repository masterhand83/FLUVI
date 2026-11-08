import { describe, expect, it } from 'vitest';
import { openSimulator } from './helpers/simulator.mjs';

describe('rectangle bulk street editing', () => {
    it('uses actual curved, rotated and roundabout footprints', async () => {
        const sim = await openSimulator({ usePixi: false });
        const { page } = sim;
        try {
            await page.evaluate(() => {
                window.hideLoadingScreen?.();
                window.calles.splice(0);
                window.conexiones.splice(0);
                window.edificios.splice(0);
                window.crearCalle('Rotated', 10, 'conexion', 80, 110, 45, 0, 2, 0);
                const curve = window.crearCalle('Bezier', 10, 'conexion', 120, 100, 0, 0, 1, 0);
                Object.assign(curve, { esCurva: true, bezierGeometry: true, bezierControls: [{ x: 145, y: 50 }], endX: 170, endY: 100, vertices: [] });
                window.editorCalles.aplicarNuevasDimensiones(curve, window.streetBezier.validate(curve).cells, 1);
                window.calles.push(window.roundaboutStreet.createStreet({ nombre: 'Ring', x: 110, y: 160, innerRadius: 12, carriles: 2 }));
                const outside = window.crearCalle('Bows outside', 10, 'conexion', 65, 190, 0, 0, 1, 0);
                Object.assign(outside, { esCurva: true, bezierGeometry: true, bezierControls: [{ x: 110, y: 300 }], endX: 170, endY: 190, vertices: [] });
                window.editorCalles.aplicarNuevasDimensiones(outside, window.streetBezier.validate(outside).cells, 1);
                escala = 2; offsetX = offsetY = 20;
                window.escala = escala; window.offsetX = offsetX; window.offsetY = offsetY;
                window.renderizarCanvas();
            });
            await page.waitForFunction(() => getComputedStyle(document.getElementById('loadingScreen')).display === 'none', { polling: 100 });
            const points = await page.evaluate(() => {
                const c = document.getElementById('simuladorCanvas'), r = c.getBoundingClientRect();
                return [[50, 50], [190, 210]].map(([x, y]) => ({ x: r.left + (x * window.escala + window.offsetX) * r.width / c.width, y: r.top + (y * window.escala + window.offsetY) * r.height / c.height }));
            });
            await page.keyboard.down('Shift');
            await page.mouse.move(points[0].x, points[0].y);
            await page.mouse.down();
            await page.mouse.move(points[1].x, points[1].y);
            await page.mouse.up();
            await page.keyboard.up('Shift');
            expect(await page.evaluate(() => window.bulkStreetEditor.getSelected().map(s => s.nombre))).toEqual(['Rotated', 'Bezier', 'Ring']);
            expect(sim.pageErrors).toEqual([]);
        } finally { await sim.close(); }
    }, 60000);

    for (const usePixi of [false, true]) {
        it(`selects enclosed roads and edits only lanes (${usePixi ? 'Pixi' : 'Canvas'})`, async () => {
            const sim = await openSimulator({ usePixi, languagePreference: 'en' });
            const { page } = sim;
            try {
                await page.waitForFunction(() => window.bulkStreetEditor && window.editorCalles);
                if (usePixi) await page.waitForFunction(() => window.pixiApp?.cameraController, { polling: 100 });
                else await page.evaluate(() => window.hideLoadingScreen?.());
                await page.waitForFunction(() => getComputedStyle(document.getElementById('loadingScreen')).display === 'none', { polling: 100 });
                const points = await page.evaluate(() => {
                    window.hideLoadingScreen?.();
                    window.calles.splice(0);
                    window.conexiones.splice(0);
                    window.edificios.splice(0);
                    const a = window.crearCalle('Bulk A', 10, 'conexion', 100, 100, 0, 0, 1, .25);
                    const b = window.crearCalle('Bulk B', 10, 'generador', 100, 140, 0, .7, 2, .4);
                    window.crearCalle('Partial', 20, 'conexion', 150, 180, 0, 0, 1, .1);
                    a.laneDirections = [-1];
                    b.laneDirections = [1, -1];
                    b.arreglo[0][3] = 2;
                    const camera = window.USE_PIXI && window.pixiApp?.cameraController;
                    if (camera) {
                        camera.scale = 2;
                        camera.offsetX = camera.offsetY = 20;
                        camera.applyTransform();
                        camera.updateGlobals();
                    } else {
                        escala = 2; offsetX = offsetY = 20;
                        window.escala = escala; window.offsetX = offsetX; window.offsetY = offsetY;
                    }
                    window.pixiApp?.sceneManager?.renderAll();
                    window.renderizarCanvas?.();
                    const c = document.getElementById('simuladorCanvas'), r = c.getBoundingClientRect();
                    const screen = camera ? window.pixiApp.app.screen : c;
                    const project = (x, y) => {
                        const p = camera ? camera.worldToScreen(x, y) : { x: x * window.escala + window.offsetX, y: y * window.escala + window.offsetY };
                        return { x: r.left + p.x * r.width / screen.width, y: r.top + p.y * r.height / screen.height };
                    };
                    return [project(90, 90), project(180, 195)];
                });
                const view = await page.evaluate(() => [window.escala, window.offsetX, window.offsetY]);
                await page.evaluate(() => window.drawStreetTool.activate());
                await page.keyboard.down('Shift');
                await page.mouse.move(points[0].x, points[0].y);
                await page.mouse.down();
                await page.mouse.move(points[1].x, points[1].y, { steps: 5 });
                expect(await page.$eval('#streetSelectionRectangle', el => !el.hidden && el.getBoundingClientRect().width > 0)).toBe(true);
                await page.mouse.up();
                await page.keyboard.up('Shift');
                expect(await page.evaluate(() => window.bulkStreetEditor.getSelected().map(s => s.nombre))).toEqual(['Bulk A', 'Bulk B']);
                expect(await page.evaluate(() => window.drawStreetTool.isActive())).toBe(false);
                expect(await page.evaluate(() => window.calles.length)).toBe(3);
                expect(await page.evaluate(() => [window.escala, window.offsetX, window.offsetY])).toEqual(view);
                expect(await page.$eval('#bulkStreetLanes', el => el.value)).toBe('');
                expect(await page.$eval('#bulkStreetDirections select', el => el.value)).toBe('');
                expect(await page.$$eval('#bulkStreetInspector input', inputs => inputs.length)).toBe(1);
                await page.select('#bulkStreetDirections select', '-1');
                expect(await page.evaluate(() => window.calles.slice(0, 2).map(s => s.laneDirections))).toEqual([[-1], [-1, -1]]);
                await page.$eval('#bulkStreetLanes', el => { el.value = '3'; el.dispatchEvent(new Event('change')); });
                expect(await page.evaluate(() => window.calles.map(s => s.carriles))).toEqual([3, 3, 1]);
                expect(await page.evaluate(() => window.calles.slice(0, 2).map(s => [s.tipo, s.probabilidadGeneracion, s.probabilidadSaltoDeCarril, s.tamano, s.laneDirections]))).toEqual([
                    ['conexion', 0, .25, 10, [-1, 1, 1]], ['generador', .7, .4, 10, [-1, -1, 1]],
                ]);
                expect(await page.evaluate(() => window.calles[1].arreglo[0][3])).toBe(2);
                await page.$eval('#bulkStreetLanes', el => { el.value = '11'; el.dispatchEvent(new Event('change')); });
                expect(await page.evaluate(() => window.calles.map(s => s.carriles))).toEqual([3, 3, 1]);
                expect(await page.$eval('#bulkStreetInspector [role="alert"]', el => el.textContent)).not.toBe('');
                await page.keyboard.press('Escape');
                expect(await page.$eval('#bulkStreetInspector', el => el.hidden)).toBe(true);
                // Escape during a drag must not leave mouse/click input intercepted.
                await page.keyboard.down('Shift');
                await page.mouse.move(points[0].x, points[0].y);
                await page.mouse.down();
                await page.mouse.move(points[1].x, points[1].y);
                await page.keyboard.press('Escape');
                await page.mouse.up();
                expect(await page.$eval('#streetSelectionRectangle', el => el.hidden)).toBe(true);
                // Bottom-right to top-left works too, including after cancellation.
                await page.mouse.move(points[1].x, points[1].y);
                await page.mouse.down();
                await page.mouse.move(points[0].x, points[0].y);
                await page.mouse.up();
                await page.keyboard.up('Shift');
                expect(await page.evaluate(() => window.bulkStreetEditor.getSelected().map(s => s.nombre))).toEqual(['Bulk A', 'Bulk B']);
                // Reject a geometry-invalid lane resize atomically across all roads.
                await page.evaluate(() => {
                    const original = window.streetBezier.validate;
                    window.__restoreBulkValidation = () => { window.streetBezier.validate = original; };
                    const b = window.calles[1];
                    b.bezierControls = [];
                    b.endX = 150; b.endY = 140;
                    window.streetBezier.validate = candidate => candidate.carriles === 10
                        ? { valid: false, reason: 'folded-lane-overlap' } : original(candidate);
                });
                await page.$eval('#bulkStreetLanes', el => { el.value = '10'; el.dispatchEvent(new Event('change')); });
                expect(await page.evaluate(() => window.calles.map(s => s.carriles))).toEqual([3, 3, 1]);
                await page.evaluate(() => { window.__restoreBulkValidation(); limpiarSimulacionActual(); });
                expect(await page.evaluate(() => window.bulkStreetEditor.getSelected())).toEqual([]);
                expect(await page.$eval('#bulkStreetInspector', el => el.hidden)).toBe(true);
                expect(sim.pageErrors).toEqual([]);
            } finally { await sim.close(); }
        }, 60000);
    }
});
