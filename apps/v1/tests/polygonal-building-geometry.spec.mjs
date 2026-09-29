import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSimulator } from "./helpers/simulator.mjs";

describe.each([
	["Canvas", false],
	["Pixi", true],
])("polygonal building geometry in %s", (_, usePixi) => {
	let sim;

	beforeEach(async () => {
		sim = await openSimulator({ usePixi, freezeFrames: true });
		if (usePixi) {
			await sim.page.waitForFunction(
				() => !!window.pixiApp?.sceneManager?.edificioRenderer,
				{
					polling: 100,
					timeout: 30000,
				},
			);
		}
	}, 180000);
	afterEach(async () => sim?.close());

	it("validates polygon geometry and hits only the actual footprint", async () => {
		const result = await sim.page.evaluate((pixi) => {
			const vertices = [
				{ x: 100, y: 100 },
				{ x: 160, y: 100 },
				{ x: 160, y: 120 },
				{ x: 120, y: 120 },
				{ x: 120, y: 160 },
				{ x: 100, y: 160 },
			];
			const edificio = { geometryType: "polygon", vertices, label: "L" };
			window.edificios = [edificio];
			let pixiHitArea = null;
			if (pixi) {
				const sprite =
					window.pixiApp.sceneManager.edificioRenderer.renderEdificio(edificio);
				pixiHitArea = {
					inside: sprite.hitArea.contains(110, 150),
					outside: sprite.hitArea.contains(150, 150),
				};
			}
			return {
				valid: window.edificioPolygonGeometry.validate(vertices),
				tooFew: window.edificioPolygonGeometry.validate(vertices.slice(0, 2))
					.valid,
				zeroArea: window.edificioPolygonGeometry.validate([
					{ x: 0, y: 0 },
					{ x: 2, y: 0 },
					{ x: 4, y: 0 },
				]).valid,
				selfIntersecting: window.edificioPolygonGeometry.validate([
					{ x: 0, y: 0 },
					{ x: 4, y: 4 },
					{ x: 0, y: 4 },
					{ x: 4, y: 0 },
					{ x: 5, y: -1 },
				]),
				inside:
					window.encontrarEdificioEnPunto(110, 150)?.edificio === edificio,
				outside: window.encontrarEdificioEnPunto(150, 150),
				pixiHitArea,
			};
		}, usePixi);

		expect(result.valid.valid).toBe(true);
		expect(result.tooFew).toBe(false);
		expect(result.zeroArea).toBe(false);
		expect(result.selfIntersecting).toEqual({
			valid: false,
			reason: "self-intersection",
		});
		expect(result.inside).toBe(true);
		expect(result.outside).toBeNull();
		if (usePixi)
			expect(result.pixiHitArea).toEqual({ inside: true, outside: false });
	}, 180000);
});
