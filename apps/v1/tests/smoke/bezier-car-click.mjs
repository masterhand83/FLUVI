import assert from "node:assert/strict";
import { openSimulator } from "../helpers/simulator.mjs";

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 97, usePixi, freezeFrames: false });
	try {
		const { page } = sim;
		if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.cameraController);
		await page.evaluate(() => window.hideLoadingScreen?.());
		await page.waitForFunction(() => document.getElementById("loadingScreen")?.style.display === "none");
		const { target, oldFootprint } = await page.evaluate(() => {
			const canvas = document.getElementById("simuladorCanvas");
			const rect = canvas.getBoundingClientRect();
			const camera = window.USE_PIXI ? window.pixiApp.cameraController : null;
			const screen = { x: rect.width * 0.58, y: rect.height * 0.72 };
			const origin = camera ? camera.screenToWorld(screen.x, screen.y) : {
				x: (screen.x * canvas.width / rect.width - window.offsetX) / window.escala,
				y: (screen.y * canvas.height / rect.height - window.offsetY) / window.escala,
			};
			const curve = { x: origin.x, y: origin.y, endX: origin.x + 120, endY: origin.y,
				carriles: 1, bezierControls: [{ x: origin.x + 60, y: origin.y - 90 }] };
			const cells = window.streetBezier.validate(curve).cells;
			const street = window.crearCalle("Bezier click target", cells, window.TIPOS.CONEXION,
				origin.x, origin.y, 0, 0, 1, 0);
			// Render the original straight road first: conversion must remove its hit area.
			window.pixiApp?.sceneManager?.renderAll();
			window.renderizarCanvas?.();
			Object.assign(street, { esCurva: true, bezierGeometry: true, endX: curve.endX,
				endY: curve.endY, bezierControls: curve.bezierControls, vertices: [] });
			window.__bezierClickStreet = street;
			const index = window.calles.indexOf(street);
			for (const id of ["selectCalle", "selectCalleEditor"])
				document.getElementById(id).add(new Option(street.nombre, index));
			const select = document.getElementById("selectCalle");
			select.value = String(index);
			select.dispatchEvent(new Event("change", { bubbles: true }));
			window.calleSeleccionada = street;
			window.pixiApp?.sceneManager?.renderAll();
			window.renderizarCanvas?.();
			const cell = Math.floor(cells / 2);
			window.__bezierClickCell = cell;
			const center = window.streetBezier.coordinates(street, 0, cell);
			const project = p => {
				const s = camera ? camera.worldToScreen(p.x, p.y) : {
					x: p.x * window.escala + window.offsetX, y: p.y * window.escala + window.offsetY,
				};
				return { x: rect.left + s.x * rect.width / (camera ? window.pixiApp.app.screen.width : canvas.width),
					y: rect.top + s.y * rect.height / (camera ? window.pixiApp.app.screen.height : canvas.height) };
			};
			return { target: project(center), oldFootprint: project({ x: origin.x + 60, y: origin.y + 2.5 }) };
		});
		const ghost = await page.evaluate(() => {
			const s = window.__bezierClickStreet;
			return window.encontrarCeldaMasCercana(s.x + 60, s.y + 2.5)?.calle === s ||
				encontrarCalleEnPunto(s.x + 60, s.y + 2.5)?.calle === s;
		});
		assert.equal(ghost, false, "original straight footprint must not retain a road hit area");
		await page.mouse.click(oldFootprint.x, oldFootprint.y);
		assert.equal(await page.evaluate(() => window.streetGeometryEditor?.gesture), null,
			"empty original footprint must not start a street drag");
		await page.$eval("#btnPauseResume", button => button.click());
		await page.mouse.click(target.x, target.y);
		assert.ok(await page.evaluate(() => {
			const s = window.__bezierClickStreet;
			return s.arreglo[0][window.__bezierClickCell] > 0;
		}), "a tap on the visible Bezier cell adds a car while paused");
		await page.mouse.click(target.x, target.y);
		await page.$eval("#btnPauseResume", button => button.click());
		assert.equal(await page.evaluate(() => window.isPaused), false);
		await page.mouse.click(target.x, target.y);
		assert.equal(await page.evaluate(() => window.isPaused), false,
			"a car tap must not turn into a pause-and-drag gesture");
		assert.ok(await page.evaluate(() => window.__bezierClickStreet.arreglo[0].some(Boolean)),
			"running traffic retains the vehicle after the clicked cell advances");
		console.log(`✅ Bezier car clicks and no old-footprint hit area (${usePixi ? "Pixi" : "Canvas"})`);
	} finally {
		await sim.close();
	}
}
