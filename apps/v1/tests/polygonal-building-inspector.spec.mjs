import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSimulator } from "./helpers/simulator.mjs";

describe.each([
	["Canvas", false],
	["Pixi", true],
])("polygonal building inspector in %s", (_, usePixi) => {
	let sim;
	beforeEach(async () => {
		sim = await openSimulator({ usePixi, freezeFrames: false });
		if (usePixi)
			await sim.page.waitForFunction(
				() => !!window.pixiApp?.sceneManager?.edificioRenderer,
				{ timeout: 30000 },
			);
		await sim.page.evaluate(() => {
			window.hideLoadingScreen?.();
			window.confirm = () => true;
			window.alert = () => {};
			document.getElementById("btnNuevaSimulacion").click();
		});
		await sim.page.waitForFunction(() => window.edificios?.length === 0);
		await sim.page.waitForFunction(
			() =>
				getComputedStyle(document.getElementById("loadingScreen")).display ===
				"none",
			{ timeout: 30000 },
		);
	}, 180000);
	afterEach(async () => sim?.close());

	it("creates one valid polygon, cancels with Escape, and supports immediate geometry edits", async () => {
		const points = await sim.page.evaluate(() => {
			const canvas = document.getElementById("simuladorCanvas");
			const rect = canvas.getBoundingClientRect();
			const screen = (u, v) => ({
				x: rect.left + rect.width * u,
				y: rect.top + rect.height * v,
			});
			const candidates = [
				[0.72, 0.24],
				[0.78, 0.24],
				[0.78, 0.31],
				[0.72, 0.31],
				[0.66, 0.24],
				[0.66, 0.31],
			];
			const safe = candidates.filter(([u, v]) => {
				const p = screen(u, v);
				const world = window.USE_PIXI
					? window.pixiApp.cameraController.screenToWorld(
							((p.x - rect.left) * window.pixiApp.app.screen.width) /
								rect.width,
							((p.y - rect.top) * window.pixiApp.app.screen.height) /
								rect.height,
						)
					: {
							x:
								(((p.x - rect.left) * canvas.width) / rect.width -
									window.offsetX) /
								window.escala,
							y:
								(((p.y - rect.top) * canvas.height) / rect.height -
									window.offsetY) /
								window.escala,
						};
				return (
					!window.encontrarCalleEnPunto(world.x, world.y) &&
					!window.encontrarEdificioEnPunto(world.x, world.y)
				);
			});
			if (safe.length < 4)
				throw new Error("No se encontró un área libre en el mapa");
			return safe.slice(0, 4).map(([u, v]) => screen(u, v));
		});
		await sim.page.$eval("#drawPolygonBuildingButton", (button) =>
			button.click(),
		);
		await sim.page.keyboard.press("Escape");
		expect(await sim.page.evaluate(() => window.edificios.length)).toBe(0);

		await sim.page.$eval("#drawPolygonBuildingButton", (button) =>
			button.click(),
		);
		expect(
			await sim.page.evaluate(() => window.drawBuildingTool.isActive()),
		).toBe(true);
		for (const point of points) await sim.page.mouse.click(point.x, point.y);
		expect(
			await sim.page.$eval("#buildingDrawStatus", (el) => el.textContent),
		).toContain("4 vértice");
		await sim.page.$eval("#buildingDrawFinish", (button) => button.click());
		expect(
			await sim.page.evaluate(() => ({
				count: window.edificios.length,
				polygon: window.edificios[0]?.geometryType,
				appearance: window.edificios[0]?.appearanceMode,
				vertices: window.edificios[0]?.vertices.length,
				selected: window.edificioSeleccionado === window.edificios[0],
			})),
		).toEqual({
			count: 1,
			polygon: "polygon",
			appearance: "polygon",
			vertices: 4,
			selected: true,
		});
		expect(
			await sim.page.$$eval(
				'[name="buildingColor"]',
				(buttons) => buttons.length,
			),
		).toBe(6);
		const center = {
			x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
			y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
		};
		await sim.page.evaluate(() => {
			window.edificioSeleccionado = null;
			window.dibujarEdificios?.();
		});
		await sim.page.evaluate(({ x, y }) => {
			if (window.USE_PIXI) {
				const renderer = window.pixiApp.sceneManager.edificioRenderer;
				const building = window.edificios[0];
				const sprite = renderer.scene.edificioSprites.get(building);
				const rect = document
					.getElementById("simuladorCanvas")
					.getBoundingClientRect();
				const world = window.pixiApp.cameraController.screenToWorld(
					((x - rect.left) * window.pixiApp.app.screen.width) / rect.width,
					((y - rect.top) * window.pixiApp.app.screen.height) / rect.height,
				);
				if (!sprite.hitArea.contains(world.x, world.y))
					throw new Error("Polygon hit target missed its footprint");
				sprite.emit("pointerdown", {
					data: { originalEvent: { ctrlKey: true, metaKey: false } },
					stopPropagation() {},
				});
				return;
			}
			const canvas = document.getElementById("simuladorCanvas");
			canvas.dispatchEvent(
				new MouseEvent("click", {
					bubbles: true,
					clientX: x,
					clientY: y,
					ctrlKey: true,
				}),
			);
		}, center);
		expect(
			await sim.page.evaluate(
				() => window.edificioSeleccionado === window.edificios[0],
			),
		).toBe(true);

		const before = await sim.page.evaluate(() =>
			JSON.stringify(window.edificioSeleccionado.vertices),
		);
		await sim.page.$eval("#buildingInspectorVertices", (textarea) => {
			const rows = textarea.value.split("\n");
			const [x, y] = rows[0].split(", ").map(Number);
			rows[0] = `${x + 3}, ${y}`;
			textarea.value = rows.join("\n");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(
			await sim.page.evaluate(
				() => window.edificioSeleccionado.vertices[0].x,
			),
		).not.toBe(JSON.parse(before)[0].x);
		const beforeInvalid = await sim.page.evaluate(() =>
			JSON.stringify(window.edificioSeleccionado.vertices),
		);
		await sim.page.$eval("#buildingInspectorVertices", (textarea) => {
			const [a, b, c, d] = textarea.value.split("\n");
			textarea.value = [a, c, b, d].join("\n");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(
			await sim.page.evaluate(() =>
				JSON.stringify(window.edificioSeleccionado.vertices),
			),
		).toBe(beforeInvalid);
		expect(
			await sim.page.$eval("#buildingInspectorError", (el) => el.textContent),
		).toContain("área");

		const handle = await sim.page.$(".building-vertex-handle:not([hidden])");
		const box = await handle.boundingBox();
		await sim.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await sim.page.mouse.down();
		await sim.page.mouse.move(
			box.x + box.width / 2 + 18,
			box.y + box.height / 2 + 12,
			{ steps: 3 },
		);
		await sim.page.mouse.up();
		expect(
			await sim.page.evaluate(
				() =>
					window.edificioPolygonGeometry.validate(
						window.edificioSeleccionado.vertices,
					).valid,
			),
		).toBe(true);
		const movedBefore = await sim.page.evaluate(() =>
			JSON.stringify(window.edificioSeleccionado.vertices),
		);
		const move = await sim.page.$(".building-move-handle:not([hidden])");
		const moveBox = await move.boundingBox();
		await sim.page.mouse.move(
			moveBox.x + moveBox.width / 2,
			moveBox.y + moveBox.height / 2,
		);
		await sim.page.mouse.down();
		await sim.page.mouse.move(
			moveBox.x + moveBox.width / 2 + 20,
			moveBox.y + moveBox.height / 2 + 12,
			{ steps: 3 },
		);
		await sim.page.mouse.up();
		expect(
			await sim.page.evaluate(() =>
				JSON.stringify(window.edificioSeleccionado.vertices),
			),
		).not.toBe(movedBefore);
		const rotate = await sim.page.$(".building-rotate-handle:not([hidden])");
		const rotateBox = await rotate.boundingBox();
		await sim.page.mouse.move(
			rotateBox.x + rotateBox.width / 2,
			rotateBox.y + rotateBox.height / 2,
		);
		await sim.page.mouse.down();
		await sim.page.mouse.move(
			rotateBox.x + rotateBox.width / 2 + 28,
			rotateBox.y + rotateBox.height / 2 + 16,
			{ steps: 3 },
		);
		await sim.page.mouse.up();
		expect(
			await sim.page.evaluate(
				() =>
					window.edificioPolygonGeometry.validate(
						window.edificioSeleccionado.vertices,
					).valid,
			),
		).toBe(true);
	}, 180000);
});
