import assert from "node:assert/strict";
import { openSimulator } from "../helpers/simulator.mjs";

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ usePixi, freezeFrames: false });
	try {
		const { page } = sim;
		if (usePixi)
			await page.waitForFunction(() => !!window.pixiApp?.cameraController);
		await page.evaluate(() => window.hideLoadingScreen?.());
		const points = await page.evaluate(() => {
			const canvas = document.getElementById("simuladorCanvas");
			const rect = canvas.getBoundingClientRect();
			const camera = window.pixiApp?.cameraController;
			const toWorld = (x, y) =>
				camera
					? camera.screenToWorld(x - rect.left, y - rect.top)
					: {
							x: (x - rect.left - window.offsetX) / window.escala,
							y: (y - rect.top - window.offsetY) / window.escala,
						};
			for (let y = rect.top + 200; y < rect.bottom - 160; y += 40) {
				for (let x = rect.left + 280; x < rect.right - 170; x += 40) {
					if (
						[0, 0.5, 1].every((t) => {
							const p = toWorld(x + t * 40, y + t * 40);
							return (
								!encontrarCalleEnPunto(p.x, p.y) &&
								!encontrarEdificioEnPunto(p.x, p.y)
							);
						})
					)
						return { start: { x, y }, end: { x: x + 40, y: y + 40 } };
				}
			}
			throw new Error("No empty diagonal available");
		});
		await page.click("#drawStreetButton");
		await page.mouse.move(points.start.x, points.start.y);
		await page.mouse.down();
		await page.mouse.move(points.end.x, points.end.y, { steps: 5 });
		await page.mouse.up();
		const result = await page.evaluate(({ start, end }) => {
			const road = window.calles.at(-1);
			const rect = document
				.getElementById("simuladorCanvas")
				.getBoundingClientRect();
			const camera = window.pixiApp?.cameraController;
			const mid = {
				x: (start.x + end.x) / 2 - rect.left,
				y: (start.y + end.y) / 2 - rect.top,
			};
			const point = camera
				? camera.screenToWorld(mid.x, mid.y)
				: {
						x: (mid.x - window.offsetX) / window.escala,
						y: (mid.y - window.offsetY) / window.escala,
					};
			return {
				street: road.nombre,
				angle: road.angulo,
				hit: encontrarCalleEnPunto(point.x, point.y)?.calle === road,
			};
		}, points);
		assert.ok(
			result.hit,
			`${usePixi ? "Pixi" : "Canvas"} diagonal street ${result.street} at ${result.angle}° must follow its drag shadow`,
		);
		console.log(
			`✅ diagonal street follows drag preview (${usePixi ? "Pixi" : "Canvas"})`,
		);
	} finally {
		await sim.close();
	}
}
