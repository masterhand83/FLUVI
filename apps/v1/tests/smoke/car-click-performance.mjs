// Run from apps/v1: node tests/smoke/car-click-performance.mjs
// Requires Chrome/Chromium (CHROME_PATH overrides autodetection).
import assert from "node:assert/strict";
import { openSimulator } from "../helpers/simulator.mjs";

const percentile = (values, fraction) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.ceil(fraction * sorted.length) - 1];
};

async function frames(page, count) {
	await page.evaluate(n => new Promise(resolve => {
		let remaining = n;
		const next = () => (--remaining ? requestAnimationFrame(next) : resolve());
		requestAnimationFrame(next);
	}), count);
}

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 97, usePixi, freezeFrames: false });
	const { page } = sim;
	try {
		if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.sceneManager?.calleRenderer);
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
			const street = window.crearCalle("Perf click target", 24, window.TIPOS.CONEXION, world.x, world.y, 0, 0, 1, 0);
			window.__perfStreet = street;
			window.calleSeleccionada = null;
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
		await page.mouse.move(target.x, target.y);
		await page.evaluate(() => {
			const samples = { durations: [], values: [], frameTimes: [], ticks: 0 };
			window.__perfSamples = samples;
			const originalFrame = window.recordSimulationFrame;
			window.recordSimulationFrame = (...args) => {
				samples.ticks++;
				return originalFrame?.(...args);
			};
			const record = (started) => {
				samples.durations.push(performance.now() - started);
				samples.values.push(window.__perfStreet.arreglo[0][6]);
			};
			if (window.USE_PIXI) {
				const renderer = window.pixiApp.sceneManager.calleRenderer;
				const original = renderer.onCalleClick;
				renderer.onCalleClick = function (...args) {
					const started = performance.now();
					try { return original.apply(this, args); }
					finally { if (args[0] === window.__perfStreet) record(started); }
				};
			} else {
				const canvas = document.getElementById("simuladorCanvas");
				let started;
				canvas.addEventListener("click", () => { started = performance.now(); }, true);
				// Added after the application's click listener: measures its synchronous work.
				canvas.addEventListener("click", () => record(started));
			}
			let last;
			const sample = now => {
				if (last !== undefined) samples.frameTimes.push({ at: now, gap: now - last });
				last = now;
				requestAnimationFrame(sample);
			};
			requestAnimationFrame(sample);
			window.clickActionManager?.setActiveAction("add");
		});
		assert.equal(await page.evaluate(() => window.isPaused), false, "simulation must be running");
		// Warm both renderers and gather a same-run idle reference, not a machine-specific FPS target.
		await frames(page, 60);
		const idleEnd = await page.evaluate(() => performance.now());
		const initialTicks = await page.evaluate(() => window.__perfSamples.ticks);
		const interactionStart = await page.evaluate(() => performance.now());
		for (let i = 0; i < 12; i++) {
			// Reset only the isolated test cell, not the simulation or its animation loop.
			await page.evaluate(() => { window.__perfStreet.arreglo[0][6] = 0; });
			await page.mouse.click(target.x, target.y);
			await frames(page, 2);
		}
		const data = await page.evaluate(() => ({ ...window.__perfSamples, end: performance.now(), paused: window.isPaused }));
		assert.equal(data.paused, false, "car clicks must not pause the simulation");
		assert.ok(data.ticks > initialTicks, "simulation must continue ticking during clicks");
		assert.equal(data.durations.length, 12, "every physical click must reach the road handler");
		assert.ok(data.values.every(value => value >= 1 && value <= 6),
			`each click must add a vehicle immediately: ${JSON.stringify(data.values)}`);
		const idle = data.frameTimes.filter(f => f.at <= idleEnd).map(f => f.gap);
		const active = data.frameTimes.filter(f => f.at >= interactionStart && f.at <= data.end).map(f => f.gap);
		assert.ok(idle.length >= 40 && active.length >= 12, "need enough frames for a meaningful comparison");
		const idleP75 = percentile(idle, 0.75);
		const activeP75 = percentile(active, 0.75);
		const clickP75 = percentile(data.durations, 0.75);
		console.log(`${usePixi ? "Pixi" : "Canvas"}: click p75=${clickP75.toFixed(1)}ms, RAF p75 idle=${idleP75.toFixed(1)}ms active=${activeP75.toFixed(1)}ms, ticks=${data.ticks - initialTicks}`);
		// The absolute guard catches expensive synchronous handlers even when idle FPS is poor.
		// The differential guard catches repeated FPS collapse without assuming 60 FPS in CI.
		assert.ok(clickP75 < 12, `car click handler took ${clickP75.toFixed(1)}ms p75 (${usePixi ? "Pixi" : "Canvas"})`);
		assert.ok(activeP75 < Math.max(80, idleP75 * 4),
			`clicking cars degraded RAF p75 from ${idleP75.toFixed(1)}ms to ${activeP75.toFixed(1)}ms`);
	} finally {
		await sim.close();
	}
}
