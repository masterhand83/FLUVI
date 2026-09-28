import assert from "node:assert/strict";
import { openSimulator } from "../helpers/simulator.mjs";

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 97, usePixi, freezeFrames: false });
	const { page } = sim;
	try {
		if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.cameraController);
		await page.evaluate(() => window.hideLoadingScreen?.());
		await page.waitForFunction(() => document.getElementById("loadingScreen")?.style.display === "none");
		const target = await page.evaluate(() => {
			const canvas = document.getElementById("simuladorCanvas");
			const rect = canvas.getBoundingClientRect();
			const camera = window.USE_PIXI ? window.pixiApp.cameraController : null;
			const screen = { x: rect.width * 0.58, y: rect.height * 0.7 };
			const world = camera ? camera.screenToWorld(screen.x, screen.y) : {
				x: (screen.x * canvas.width / rect.width - window.offsetX) / window.escala,
				y: (screen.y * canvas.height / rect.height - window.offsetY) / window.escala,
			};
			const street = window.crearCalle("Clickable cars", 24, window.TIPOS.CONEXION, world.x, world.y, 0, 0, 1, 0);
			window.__testStreet = street;
			const index = window.calles.indexOf(street);
			for (const id of ["selectCalle", "selectCalleEditor"]) {
				document.getElementById(id).add(new Option(street.nombre, index));
			}
			const selector = document.getElementById("selectCalle");
			selector.value = String(index);
			selector.dispatchEvent(new Event("change", { bubbles: true }));
			window.calleSeleccionada = street;
			window.pixiApp?.sceneManager?.renderAll();
			window.renderizarCanvas?.();
			const p = { x: street.x + 6.5 * window.celda_tamano, y: street.y + window.celda_tamano / 2 };
			const s = camera ? camera.worldToScreen(p.x, p.y) : {
				x: p.x * window.escala + window.offsetX,
				y: p.y * window.escala + window.offsetY,
			};
			return { x: rect.left + s.x * rect.width / (camera ? window.pixiApp.app.screen.width : canvas.width),
				y: rect.top + s.y * rect.height / (camera ? window.pixiApp.app.screen.height : canvas.height) };
		});
		await page.$eval("#btnPauseResume", button => button.click());
		assert.equal(await page.evaluate(() => window.isPaused), true);
		const visual = async () => page.evaluate(({ x, y }) => {
			if (window.USE_PIXI) {
				const renderer = window.pixiApp.sceneManager.carroRenderer;
				const id = renderer.getCarroId(window.__testStreet, 0, 6);
				const sprite = window.pixiApp.sceneManager.carroSprites.get(id);
				return Boolean(sprite?.visible && sprite.parent);
			}
			const canvas = document.getElementById("simuladorCanvas");
			const rect = canvas.getBoundingClientRect();
			const sx = (x - rect.left) * canvas.width / rect.width;
			const sy = (y - rect.top) * canvas.height / rect.height;
			const pixels = canvas.getContext("2d").getImageData(sx - 4, sy - 4, 8, 8).data;
			return Array.from(pixels).reduce((hash, value) => (Math.imul(hash, 31) + value) | 0, 0);
		}, target);
		const beforeVisual = await visual();
		await page.mouse.click(target.x, target.y);
		assert.notEqual(await page.evaluate(() => window.calleSeleccionada.arreglo[0][6]), 0,
			`clicking a selected Calle cell while paused adds a car (${usePixi ? "Pixi" : "Canvas"})`);
		assert.notEqual(await visual(), beforeVisual,
			"the car appears on screen immediately while paused");
		assert.equal(await page.evaluate(() => window.streetGeometryEditor.gesture), null);
		await page.mouse.click(target.x, target.y);
		assert.equal(await page.evaluate(() => window.calleSeleccionada.arreglo[0][6]), 0,
			"a second click removes the vehicle while paused");
		await page.evaluate(() => { window.calleSeleccionada = null; });
		await page.waitForFunction(() => Array.from(document.querySelectorAll('.street-endpoint-handle')).every(h => h.hidden));
		const unselectedVisual = await visual();
		await page.mouse.click(target.x, target.y);
		assert.notEqual(await page.evaluate(() => window.__testStreet.arreglo[0][6]), 0,
			"clicking an unselected Calle while paused adds a car");
		assert.notEqual(await visual(), unselectedVisual,
			"an unselected Calle shows the new car immediately while paused");
		await page.mouse.click(target.x, target.y);
		await page.evaluate(() => { window.calleSeleccionada = window.__testStreet; });
		const oldX = await page.evaluate(() => window.calleSeleccionada.x);
		await page.mouse.move(target.x, target.y);
		await page.mouse.down();
		await page.mouse.move(target.x + 20, target.y + 12, { steps: 5 });
		await page.mouse.up();
		assert.notEqual(await page.evaluate(() => window.calleSeleccionada.x), oldX,
			"dragging a selected street still edits its geometry");
		assert.equal(await page.evaluate(() => window.calleSeleccionada.arreglo[0].some(Boolean)), false,
			"a street drag does not add a car");
		// Continue clicking at the cell's new position.
		target.x += 20;
		target.y += 12;
		await page.$eval("#btnPauseResume", button => button.click());
		assert.equal(await page.evaluate(() => window.isPaused), false);
		await page.mouse.click(target.x, target.y);
		assert.equal(await page.evaluate(() => window.isPaused), false,
			"clicking a cell while running does not pause the simulation");
		assert.ok(await page.evaluate(() => window.calleSeleccionada.arreglo[0].some(Boolean)),
			"clicking a cell while running adds a vehicle");
		console.log(`✅ selected Calle car clicks while paused and running (${usePixi ? "Pixi" : "Canvas"})`);
	} finally {
		await sim.close();
	}
}
