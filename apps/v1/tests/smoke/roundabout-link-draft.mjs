import assert from 'node:assert/strict';
import { openSimulator } from '../helpers/simulator.mjs';

for (const usePixi of [false, true]) {
    const sim = await openSimulator({ seed: 432, usePixi, freezeFrames: false });
    const { page } = sim;
    try {
        if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.sceneManager);
        await page.evaluate(() => {
            document.getElementById('loadingScreen').style.display = 'none';
            window.streetEditPause?.();
            const circle = window.roundaboutStreet.createStreet({ nombre: 'Link circle', x: 150, y: 160,
                innerRadius: 25, carriles: 2 }, window.celda_tamano);
            window.calles.push(circle);
            window.crearCalle('Link straight', 15, window.TIPOS.CONEXION, 320, 180, 0, 0, 2, 0);
            window.cellGeometryIndex?.invalidate(circle);
            window.pixiApp?.sceneManager?.renderAll();
        });
        if (usePixi) {
            assert.deepEqual(await page.evaluate(() => {
                const circle = window.calles.find(c => c.id === 'Link circle');
                const surface = window.pixiApp.sceneManager.calleSprites.get(circle)?.children[0];
                return [surface?.hitArea?.contains(0, 0), surface?.hitArea?.contains(circle.innerRadius + 2, 0)];
            }), [false, true], 'center island is not part of the Pixi road hit area');
        }

        const rows = '#linkMappingRows [data-testid="link-mapping-row"]';
        await page.click('[data-bs-target="#collapseMapDrawingTools"]');
        await page.waitForSelector('#collapseMapDrawingTools.show', { visible: true });
        async function set(row, key, value) {
            await page.$eval(`${rows}:nth-child(${row}) [data-testid="${key}"]`, (el, next) => {
                el.value = next;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }, String(value));
        }
        await page.click('#createLinkButton');
        await page.select('#linkSourceStreet', 'Link circle');
        await page.select('#linkDestinationStreet', 'Link straight');
        assert.equal(await page.$eval(`${rows} [data-testid="source-cell"]`, el => el.value), '');
        assert.equal(await page.$eval(`${rows} [data-testid="destination-cell"]`, el => el.value), '');
        await page.click('#linkSaveButton');
        assert.match(await page.$eval('#linkDraftMessage', el => el.textContent), /fuera de rango/);
        for (const row of [1, 2]) {
            await set(row, 'source-cell', row + 4);
            await set(row, 'destination-cell', row + 2);
        }
        await page.click('#linkSaveButton');
        assert.deepEqual(await page.evaluate(() => window.conexiones.slice(-2).map(c => [c.posOrigen, c.posDestino])), [[5, 3], [6, 4]]);

        await page.click('#createLinkButton');
        await page.select('#linkSourceStreet', 'Link straight');
        await page.select('#linkDestinationStreet', 'Link circle');
        await page.select('#linkTypeSelect', 'PROBABILISTICA');
        assert.equal(await page.$eval(`${rows} [data-testid="destination-cell"]`, el => el.value), '');
        await set(1, 'source-cell', 8);
        await page.click(`${rows} [data-testid="link-pick-destination"]`);
        await page.evaluate(() => {
            const circle = window.calles.find(c => c.id === 'Link circle');
            const point = window.roundaboutStreet.coordinates(circle, 0, 9);
            const canvas = document.getElementById('simuladorCanvas');
            const rect = canvas.getBoundingClientRect();
            const screen = window.USE_PIXI && window.pixiApp?.cameraController
                ? window.pixiApp.cameraController.worldToScreen(point.x, point.y)
                : { x: point.x * window.escala + window.offsetX,
                    y: point.y * window.escala + window.offsetY };
            const width = window.USE_PIXI ? window.pixiApp.app.screen.width : canvas.width;
            const height = window.USE_PIXI ? window.pixiApp.app.screen.height : canvas.height;
            canvas.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true, button: 0,
                clientX: rect.left + screen.x * rect.width / width,
                clientY: rect.top + screen.y * rect.height / height
            }));
        });
        assert.equal(await page.$eval(`${rows} [data-testid="destination-cell"]`, el => el.value), '9',
            await page.$eval('#linkMapPickStatus', el => el.textContent));
        await page.click('#linkSaveButton');
        assert.deepEqual(await page.evaluate(() => {
            const c = window.conexiones.at(-1);
            return [c.posOrigen, c.posDestino, c.tipo];
        }), [8, 9, 'probabilistica']);
        console.log(`roundabout link draft (${usePixi ? 'Pixi' : 'Canvas'}): passed`);
    } finally {
        await sim.close();
    }
}
