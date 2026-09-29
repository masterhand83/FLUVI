import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSimulator } from "./helpers/simulator.mjs";

describe.each([
	["Canvas", false],
	["Pixi", true],
])("uploaded building image rendering in %s", (_, usePixi) => {
	let sim;

	beforeEach(async () => {
		sim = await openSimulator({ usePixi, freezeFrames: true });
		if (usePixi) {
			await sim.page.waitForFunction(
				() => !!window.pixiApp?.sceneManager?.edificioRenderer,
				{ polling: 100, timeout: 30000 },
			);
		}
	}, 180000);
	afterEach(async () => sim?.close());

	it("uses decoded uploads for appearance while keeping a rectangular hit target", async () => {
		const result = await sim.page.evaluate(async (pixi) => {
			const canvas = document.createElement("canvas");
			canvas.width = 2;
			canvas.height = 2;
			canvas.getContext("2d").fillRect(0, 0, 2, 2);
			const imageDataUrl = canvas.toDataURL("image/png");
			const image = new Image();
			image.src = imageDataUrl;
			await image.decode();
			let lookups = 0;
			let decodingPending = pixi;
			window.uploadedBuildingImages = {
				get(building) {
					lookups++;
					return !decodingPending && building.imageDataUrl === imageDataUrl
						? image
						: null;
				},
			};
			const building = {
				x: 250,
				y: 220,
				width: 120,
					height: 80,
					angle: 30,
					label: "Uploaded",
					color: "#123456",
				imageDataUrl,
			};
			window.edificios = [building];
			if (pixi) {
				const renderer = window.pixiApp.sceneManager.edificioRenderer;
				renderer.renderEdificio(building); // pending decode: keep the fallback
				decodingPending = false;
				await new Promise((resolve) => setTimeout(resolve, 150));
				const sprite = renderer.scene.edificioSprites.get(building);
				return {
					isSprite: sprite instanceof PIXI.Sprite,
					width: sprite.width,
					height: sprite.height,
					rotation: sprite.rotation,
					hitBounds: [sprite.hitArea.x, sprite.hitArea.y, sprite.hitArea.width, sprite.hitArea.height],
					hasLabel: !!renderer.etiquetasEdificios.get(building),
					lookupCount: lookups,
					serializedImage: JSON.parse(JSON.stringify(building)).imageDataUrl === imageDataUrl,
				};
			}
			const context = document.getElementById("simuladorCanvas").getContext("2d");
			const originalDrawImage = context.drawImage;
			let drewUploadedImage = false;
			context.drawImage = function (drawnImage, ...args) {
				if (drawnImage === image) drewUploadedImage = true;
				return originalDrawImage.call(this, drawnImage, ...args);
			};
			window.dibujarEdificios();
			context.drawImage = originalDrawImage;
			return {
				drewUploadedImage,
				lookupCount: lookups,
				hit: window.encontrarEdificioEnPunto(250, 220)?.edificio === building,
				outside: window.encontrarEdificioEnPunto(330, 220),
				serializedImage: JSON.parse(JSON.stringify(building)).imageDataUrl === imageDataUrl,
			};
		}, usePixi);

		expect(result.lookupCount).toBeGreaterThan(0);
		expect(result.serializedImage).toBe(true);
		if (usePixi) {
			expect(result.isSprite).toBe(true);
			expect(result.width).toBe(120);
			expect(result.height).toBe(80);
			expect(result.rotation).toBeCloseTo(-Math.PI / 6);
			expect(result.hitBounds).toEqual([-60, -40, 120, 80]);
			expect(result.hasLabel).toBe(true);
		} else {
			expect(result.drewUploadedImage).toBe(true);
			expect(result.hit).toBe(true);
			expect(result.outside).toBeNull();
		}
	}, 180000);
});
