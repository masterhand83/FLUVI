import assert from 'node:assert/strict';
import { openSimulator } from '../helpers/simulator.mjs';

for (const usePixi of [false, true]) {
    const sim = await openSimulator({ seed: 73, usePixi, freezeFrames: true });
    const { page } = sim;
    try {
        await page.waitForFunction(() => window.streetInspector?.refresh && window.editorCalles?.aplicarNuevasDimensiones);
        await page.evaluate(() => {
            window.hideLoadingScreen?.();
            const road = window.crearCalle('Lane direction UI check', 12, 'conexion', 200, 200, 0, 0, 2, 0);
            road.arreglo[1][3] = 2;
            const selector = document.getElementById('selectCalle');
            selector.add(new Option(road.nombre, window.calles.indexOf(road)));
            window.calleSeleccionada = road;
            selector.value = String(window.calles.indexOf(road));
            selector.dispatchEvent(new Event('change', { bubbles: true }));
            const target = window.crearCalle('Lane direction target', 12, 'conexion', 400, 200, 0, 0, 1, 0);
            const link = new window.ConexionCA(road, target, 1, 0, -1, 0);
            window.registrarConexiones([link]);
            window.conexiones.push(link);
            document.getElementById('listaConexionesContainer').style.display = 'block';
            window.actualizarListaConexiones?.(road);
        });
        await page.waitForFunction(() => document.querySelectorAll('#streetInspectorLaneDirections button').length === 2);
        assert.equal(await page.$$eval('#streetInspectorLaneDirections select', selects => selects.length), 0);
        assert.deepEqual(await page.$$eval('#streetInspectorLaneDirections button', buttons =>
            buttons.map(button => [button.textContent, button.getAttribute('aria-pressed')])), [['→', 'false'], ['→', 'false']]);
        await page.evaluate(() => document.querySelectorAll('#streetInspectorLaneDirections button')[1].click());
        assert.deepEqual(await page.$$eval('#streetInspectorLaneDirections button', buttons =>
            buttons.map(button => [button.textContent, button.getAttribute('aria-pressed')])), [['→', 'false'], ['←', 'true']]);
        await page.evaluate(() => {
            const button = document.querySelectorAll('#streetInspectorLaneDirections button')[1];
            button.click();
            button.click();
        });
        assert.deepEqual(await page.evaluate(() => Array.from(window.calleSeleccionada.laneDirections)), [1, -1]);
        assert.equal(await page.evaluate(() => window.calleSeleccionada.arreglo[1][3]), 2);
        assert.ok(await page.$eval('#listaConexiones', el => el.textContent.includes('Sentido incompatible')));
        assert.ok(await page.$eval('#listaConexiones', el => !!el.querySelector('button[title="Editar"]')));
        await page.evaluate(() => window.editorCalles.aplicarNuevasDimensiones(window.calleSeleccionada, 14, 3));
        assert.deepEqual(await page.evaluate(() => Array.from(window.calleSeleccionada.laneDirections)), [1, -1, 1]);
        assert.equal(await page.evaluate(() => window.calleSeleccionada.arreglo[1][3]), 2);
        assert.deepEqual(await page.evaluate(() => {
            const source = window.crearCalle('Legacy reverse source', 8, 'conexion', 600, 200, 0, 0, 1, 0);
            const destination = window.crearCalle('Legacy reverse destination', 8, 'conexion', 700, 200, 0, 0, 1, 0);
            source.laneDirections[0] = destination.laneDirections[0] = -1;
            const lineal = crearConexionLinealSimple(source, destination);
            const probabilistic = crearConexionProbabilisticaAvanzada(source, 0, destination,
                [{ carrilDestino: 0, posOrigen: 0, posDestino: 7, probabilidad: 1 }]);
            return [lineal, probabilistic].map(([link]) => [link.posOrigen, link.posDestino, window.isConnectionDirectionCompatible(link)]);
        }), [[0, 7, true], [0, 7, true]], 'legacy modal helpers preserve reverse source cell zero');

        const saved = await page.evaluate(async () => {
            const oldPrompt = window.prompt, oldCreate = URL.createObjectURL;
            let blob;
            window.prompt = () => 'lane direction test';
            URL.createObjectURL = value => { blob = value; return 'blob:test'; };
            try { window.guardarSimulacion(); return JSON.parse(await blob.text()); }
            finally { window.prompt = oldPrompt; URL.createObjectURL = oldCreate; }
        });
        assert.deepEqual(saved.calles.find(c => c.nombre === 'Lane direction UI check').laneDirections, [1, -1, 1]);
        const link = saved.conexiones.find(c => c.detalles.some(d => d.posOrigen === -1) && c.origenIdx === saved.calles.findIndex(s => s.nombre === 'Lane direction UI check'));
        assert.equal(link.detalles[0].posOrigen, -1, 'legacy -1 remains physical last cell');
        const load = async data => {
            await page.evaluate(() => { window.__previousDirectionRoad = window.calles.find(c => c.nombre === 'Lane direction UI check'); });
            await page.evaluate(async payload => {
                window.__oldDirectionConfirm = window.confirm;
                window.confirm = () => true;
                const file = new File([JSON.stringify(payload)], 'directions.json', { type: 'application/json' });
                window.cargarSimulacion({ target: { files: [file], value: '' } });
            }, data);
            await page.waitForFunction(() => window.calles.some(c => c.nombre === 'Lane direction UI check' && c !== window.__previousDirectionRoad));
            await page.evaluate(() => { window.confirm = window.__oldDirectionConfirm; });
        };
        await load(saved);
        assert.deepEqual(await page.evaluate(() => Array.from(window.calles.find(c => c.nombre === 'Lane direction UI check').laneDirections)), [1, -1, 1]);
        saved.calles.find(c => c.nombre === 'Lane direction UI check').laneDirections = [0, -1, 'reverse', -1];
        await load(saved);
        assert.deepEqual(await page.evaluate(() => Array.from(window.calles.find(c => c.nombre === 'Lane direction UI check').laneDirections)), [1, -1, 1]);
        delete saved.calles.find(c => c.nombre === 'Lane direction UI check').laneDirections;
        await load(saved);
        assert.deepEqual(await page.evaluate(() => Array.from(window.calles.find(c => c.nombre === 'Lane direction UI check').laneDirections)), [1, 1, 1]);
    } finally {
        await sim.close();
    }
}
