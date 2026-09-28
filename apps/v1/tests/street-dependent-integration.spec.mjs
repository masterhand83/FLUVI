import { describe, expect, it } from "vitest";
import { openSimulator } from "./helpers/simulator.mjs";

describe("street dependent geometry integration", () => {
	for (const usePixi of [false, true]) {
		it(`previews, cancels and commits curved-source dependents in ${usePixi ? "Pixi" : "Canvas"}`, async () => {
			const sim = await openSimulator({ seed: 83, usePixi, freezeFrames: false });
			const { page } = sim;
			try {
				if (usePixi) await page.waitForFunction(() => !!window.pixiApp?.cameraController, { timeout: 30000 });
				await page.evaluate(() => window.hideLoadingScreen?.());
				// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The browser fixture wires a complete map-level dependent graph in one page context.
				const { streetId, oldSize } = await page.evaluate(() => {
					const canvas = document.getElementById("simuladorCanvas"), rect = canvas.getBoundingClientRect();
					const screen = { x: rect.width * .48, y: rect.height * .48 };
					const world = window.USE_PIXI ? window.pixiApp.cameraController.screenToWorld(screen.x, screen.y)
						: { x: (screen.x * canvas.width / rect.width - window.offsetX) / window.escala, y: (screen.y * canvas.height / rect.height - window.offsetY) / window.escala };
					const street = window.crearCalle("Dependent preview source", 12, window.TIPOS.CONEXION, world.x, world.y, 0, 0, 1, .02);
					const span = street.tamano * window.celda_tamano;
					Object.assign(street, { esCurva: true, bezierGeometry: true, vertices: [], endX: world.x + span, endY: world.y,
						bezierControls: [{ x: world.x + span / 3, y: world.y - 2 }, { x: world.x + span * 2 / 3, y: world.y + 2 }] });
					if (!window.streetBezier.validate(street).valid) throw new Error("Test Bezier road failed validation");
					const index = window.calles.indexOf(street), other = window.calles.find(road => road !== street);
					for (const id of ["selectCalle", "selectCalleEditor"]) document.getElementById(id).add(new Option(street.nombre, index));
					const select = document.getElementById("selectCalle"); select.value = String(index); select.dispatchEvent(new Event("change", { bubbles: true }));
					window.calleSeleccionada = street;
					const dynamic = new window.ConexionCA(street, other, 0, 0, -1, 0, .37, "probabilistica");
					const numbered = new window.ConexionCA(street, other, 0, 0, street.tamano - 1, 0, 1, "lineal");
					window.conexiones.push(dynamic, numbered);
					street.conexionesSalida[0].push(dynamic);
					if (numbered.carrilOrigen !== 0) street.conexionesSalida[numbered.carrilOrigen].push(numbered);
					const parkingIn = { tipo: "entrada", calleId: street.id, carril: 0, indice: 1 };
					const parkingOut = { tipo: "salida", calleId: other.id, carril: 0, indice: 0 };
					const lostIn = { tipo: "entrada", calleId: street.id, carril: 0, indice: street.tamano - 1 };
					const lostOut = { ...parkingOut, indice: 1 };
					window.edificios.push({ id: "preview-pair", esEstacionamiento: true, conexiones: [parkingIn, parkingOut, lostIn, lostOut], vehiculosActuales: 2 });
					window.estadoEscenarios.celdasBloqueadas.set(`${street.id}:0:1`, { tipo: 7 });
					window.estadoEscenarios.celdasBloqueadas.set(`${street.id}:${numbered.carrilOrigen}:${street.tamano - 1}`, { tipo: 7 });
					window.pixiApp?.sceneManager?.renderAll(); window.renderizarCanvas?.(); window.streetGeometryEditor?.refresh();
					return { streetId: street.id, oldSize: street.tamano };
				});
				await page.$eval("#btnConexiones", button => button.click());
				if (usePixi) await page.evaluate(() => window.pixiApp.sceneManager.renderAll());
				await page.waitForFunction(() => document.querySelector('.street-endpoint-handle[data-kind="end"]')?.getBoundingClientRect().width > 0);
				const dragShort = async (release = false, fraction = .28) => page.evaluate(({ release, fraction }) => {
					const road = window.calleSeleccionada, canvas = document.getElementById("simuladorCanvas"), rect = canvas.getBoundingClientRect();
					const project = p => {
						if (window.USE_PIXI) { const q = window.pixiApp.cameraController.worldToScreen(p.x, p.y), z = window.pixiApp.app.screen; return { x: rect.left + q.x * rect.width / z.width, y: rect.top + q.y * rect.height / z.height }; }
						return { x: rect.left + (p.x * window.escala + window.offsetX) * rect.width / canvas.width, y: rect.top + (p.y * window.escala + window.offsetY) * rect.height / canvas.height };
					};
					const from = project({ x: road.endX, y: road.endY }), start = project({ x: road.x, y: road.y });
					const to = { x: from.x + (start.x - from.x) * fraction, y: from.y + (start.y - from.y) * fraction };
					const pointer = (type, target, p) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 91, clientX: p.x, clientY: p.y }));
					pointer("pointerdown", canvas, from); pointer("pointermove", document, to);
					if (release) pointer("pointerup", document, to);
				}, { release, fraction });
				await dragShort();
				expect(await page.evaluate(() => window.streetGeometryEditor.gesture?.kind)).toBe("end");
				// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Inspect overlay pixels and both renderer backings in one synchronous browser snapshot.
				const preview = await page.evaluate(id => {
					const road = window.calles.find(item => String(item.id) === String(id));
					const overlay = [...document.querySelectorAll("canvas[aria-hidden='true']")].find(node => node.style.position === "fixed");
					const data = overlay?.getContext("2d")?.getImageData(0, 0, overlay.width, overlay.height).data || [];
					const proposed = window.streetGeometryEditor.gesture?.proposed;
					const start = window.streetBezier.coordinates(proposed, 0, proposed.tamano - 1);
					const canvas = document.getElementById("simuladorCanvas"), rect = canvas.getBoundingClientRect();
					const world = window.USE_PIXI ? window.pixiApp.cameraController.worldToScreen(start.x, start.y) : { x: start.x * window.escala + window.offsetX, y: start.y * window.escala + window.offsetY };
					const screen = { x: world.x * rect.width / (window.USE_PIXI ? window.pixiApp.app.screen.width : canvas.width), y: world.y * rect.height / (window.USE_PIXI ? window.pixiApp.app.screen.height : canvas.height) };
					const alphaAt = (x, y) => { const dpr = window.devicePixelRatio || 1, x0 = Math.max(0, Math.round(x * dpr) - 4), y0 = Math.max(0, Math.round(y * dpr) - 4); return overlay.getContext("2d").getImageData(x0, y0, 9, 9).data.some((value, index) => index % 4 === 3 && value > 0); };
					const links = window.conexiones.filter(link => link.origen === road);
					let oldArrowsHidden;
					if (window.USE_PIXI) oldArrowsHidden = links.every(link => window.pixiApp.sceneManager.conexionGraphics.get(link)?.visible === false);
					else {
						let drawn = 0; const originals = links.map(link => link.dibujar);
						links.forEach(link => { link.dibujar = () => { drawn++; }; });
						try { window.renderizarCanvas(); oldArrowsHidden = drawn === 0; } finally { links.forEach((link, index) => { link.dibujar = originals[index]; }); }
					}
					return { proposed: proposed.tamano, live: road.tamano, proposedArrowAtNewEnd: alphaAt(screen.x, screen.y), oldArrowsHidden,
						counts: window.streetGeometryEditor.dependentPreview?.counts,
						alpha: [...new Set([...data].filter((_, i) => i % 4 === 3 && data[i] > 0))] };
				}, streetId);
				expect(preview.proposed).toBeLessThan(oldSize);
				expect(preview.live).toBe(oldSize);
				expect(preview.proposedArrowAtNewEnd).toBe(true);
				expect(preview.oldArrowsHidden).toBe(true);
				expect(preview.alpha.length).toBeGreaterThan(1);
				expect(preview.alpha).toContain(255);
				expect(preview.alpha.some(value => value < 255)).toBe(true);
				expect(preview.counts).toMatchObject({ survivingConnections: 1, lostConnections: 1, survivingParkingPairs: 1, lostParkingPairs: 1, survivingScenarioMarks: 1, lostScenarioMarks: 1 });
				await page.keyboard.press("Escape");
				const cancelled = await page.evaluate(id => {
					const road = window.calles.find(item => String(item.id) === String(id));
					return { size: road.tamano, links: window.conexiones.filter(link => link.origen === road).length,
						visible: !window.USE_PIXI || window.conexiones.filter(link => link.origen === road).every(link => window.pixiApp.sceneManager.conexionGraphics.get(link)?.visible === true),
						pairs: window.edificios.find(item => item.id === "preview-pair").conexiones.length,
						marks: [...window.estadoEscenarios.celdasBloqueadas.keys()].filter(key => key.startsWith(`${id}:`)).length };
				}, streetId);
				expect(cancelled).toEqual({ size: oldSize, links: 2, visible: true, pairs: 4, marks: 2 });
				await dragShort(false, 1);
				const invalid = await page.evaluate(() => ({ marked: document.getElementById("simuladorCanvas").classList.contains("street-geometry-invalid"),
					links: window.conexiones.filter(link => link.origen === window.calleSeleccionada).length,
					pairs: window.edificios.find(item => item.id === "preview-pair").conexiones.length }));
				expect(invalid.marked).toBe(true);
				await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, pointerId: 91 })));
				expect(await page.evaluate(() => window.conexiones.filter(link => link.origen === window.calleSeleccionada).length)).toBe(2);
				expect(await page.evaluate(() => window.edificios.find(item => item.id === "preview-pair").conexiones.length)).toBe(4);
				await dragShort(true);
				const committed = await page.evaluate(id => {
					const road = window.calles.find(item => String(item.id) === String(id));
					const survivors = window.conexiones.filter(link => link.origen === road);
					return { size: road.tamano, survivors: survivors.map(link => ({ pos: link.posOrigen, prob: link.probabilidadTransferencia, type: link.tipo })),
						newLast: window.streetBezier.coordinates(road, 0, road.tamano - 1),
						pairs: window.edificios.find(item => item.id === "preview-pair").conexiones.length,
						marks: [...window.estadoEscenarios.celdasBloqueadas.keys()].filter(key => key.startsWith(`${id}:`)).length };
				}, streetId);
				expect(committed.size).toBeLessThan(oldSize);
				expect(committed.survivors).toEqual([{ pos: -1, prob: .37, type: "probabilistica" }]);
				expect(committed.newLast).toEqual(await page.evaluate(id => { const road = window.calles.find(item => String(item.id) === String(id)); return window.streetBezier.coordinates(road, 0, road.tamano - 1); }, streetId));
				expect(committed.pairs).toBe(2);
				expect(committed.marks).toBe(1);
				await page.$eval("#btnPauseResume", button => button.click());
				await page.$eval("#btnPaso", button => button.click());
			} finally { await sim.close(); }
		});
	}
});
