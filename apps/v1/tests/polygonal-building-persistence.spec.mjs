import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSimulator } from "./helpers/simulator.mjs";

describe.each([
	["Canvas", false],
	["Pixi", true],
])("polygon Edificio persistence in %s", (_, usePixi) => {
	let source;
	let restored;

	beforeEach(async () => {
		source = await openSimulator({ usePixi, freezeFrames: false });
		if (usePixi) {
			await source.page.waitForFunction(
				() => !!window.pixiApp?.sceneManager?.edificioRenderer,
				{ timeout: 30000 },
			);
		}
		await source.page.evaluate(() => {
			window.hideLoadingScreen?.();
			window.confirm = () => true;
			window.alert = () => {};
			document.getElementById("btnNuevaSimulacion").click();
		});
		await source.page.waitForFunction(() => window.edificios?.length === 0);
	}, 180000);

	afterEach(async () => {
		await source?.close();
		await restored?.close();
	});

	it("exports and reloads polygon geometry, placement, color, and appearance mode", async () => {
		const savedJson = await source.page.evaluate(async () => {
			const vertices = [
				{ x: 120.25, y: 230.5 },
				{ x: 190.75, y: 224.25 },
				{ x: 204.5, y: 288.75 },
				{ x: 145.125, y: 310.5 },
			];
			const building = window.agregarEdificio("Persistent polygon", 162.375, 267.375, 84.25, 86.25, 0);
			Object.assign(building, {
				geometryType: "polygon",
				vertices,
				color: "#2468AC",
				appearanceMode: "polygon",
			});
			window.prompt = () => "Polygon round trip";
			const createObjectURL = URL.createObjectURL;
			URL.createObjectURL = (blob) => {
				window.__polygonExport = blob.text();
				return "blob:polygon-persistence-test";
			};
			window.guardarSimulacion();
			URL.createObjectURL = createObjectURL;
			return await window.__polygonExport;
		});

		const exported = JSON.parse(savedJson).edificios[0];
		expect(exported).toMatchObject({
			geometryType: "polygon",
			vertices: [
				{ x: 120.25, y: 230.5 },
				{ x: 190.75, y: 224.25 },
				{ x: 204.5, y: 288.75 },
				{ x: 145.125, y: 310.5 },
			],
			color: "#2468AC",
			appearanceMode: "polygon",
			x: 162.375,
			y: 267.375,
		});

		restored = await openSimulator({ usePixi, freezeFrames: false });
		if (usePixi) {
			await restored.page.waitForFunction(
				() => !!window.pixiApp?.sceneManager?.edificioRenderer,
				{ timeout: 30000 },
			);
		}
		await restored.page.evaluate(async (json) => {
			window.hideLoadingScreen?.();
			window.confirm = () => true;
			window.alert = () => {};
			const file = new File([json], "polygon.json", { type: "application/json" });
			await window.cargarSimulacion({ target: { files: [file], value: "" } });
		}, savedJson);
		await restored.page.waitForFunction(
			() => window.edificios?.[0]?.label === "Persistent polygon",
			{ polling: 100, timeout: 10000 },
		);

		const loaded = await restored.page.evaluate(() => {
			const { geometryType, vertices, color, appearanceMode, x, y } = window.edificios[0];
			return { geometryType, vertices, color, appearanceMode, x, y };
		});
		expect(loaded).toEqual({
			geometryType: "polygon",
			vertices: exported.vertices,
			color: "#2468AC",
			appearanceMode: "polygon",
			x: 162.375,
			y: 267.375,
		});
	}, 180000);

	it("exports and reloads uploaded building image data without runtime image objects", async () => {
		const imageDataUrl = await source.page.evaluate(() => {
			const canvas = document.createElement("canvas");
			canvas.width = 20;
			canvas.height = 10;
			canvas.getContext("2d").fillRect(0, 0, canvas.width, canvas.height);
			return canvas.toDataURL("image/png");
		});
		const savedJson = await source.page.evaluate(async (dataUrl) => {
			const building = window.agregarEdificio("Uploaded image", 120, 140, 80, 60, 0);
			Object.assign(building, {
				imageDataUrl: dataUrl,
				imageMimeType: "image/png",
				image: new Image(),
				texture: new (class RuntimeTexture {})(),
			});
			window.prompt = () => "Uploaded image round trip";
			const createObjectURL = URL.createObjectURL;
			URL.createObjectURL = (blob) => {
				window.__uploadedImageExport = blob.text();
				return "blob:uploaded-image-persistence-test";
			};
			window.guardarSimulacion();
			URL.createObjectURL = createObjectURL;
			return await window.__uploadedImageExport;
		}, imageDataUrl);

		const exported = JSON.parse(savedJson).edificios[0];
		expect(exported).toMatchObject({
			imageDataUrl,
			imageMimeType: "image/png",
		});
		expect(exported).not.toHaveProperty("image");
		expect(exported).not.toHaveProperty("texture");

		restored = await openSimulator({ usePixi, freezeFrames: false });
		if (usePixi) {
			await restored.page.waitForFunction(
				() => !!window.pixiApp?.sceneManager?.edificioRenderer,
				{ timeout: 30000 },
			);
		}
		await restored.page.evaluate(async (json) => {
			window.hideLoadingScreen?.();
			window.confirm = () => true;
			window.alert = () => {};
			const file = new File([json], "uploaded-image.json", { type: "application/json" });
			window.cargarSimulacion({ target: { files: [file], value: "" } });
		}, savedJson);
		await restored.page.waitForFunction(
			() => window.edificios?.[0]?.label === "Uploaded image" && !!window.uploadedBuildingImages?.get(window.edificios[0]),
			{ polling: 100, timeout: 10000 },
		);

		const loaded = await restored.page.evaluate(() => {
			const { imageDataUrl: dataUrl, imageMimeType, image, texture } = window.edificios[0];
			return { imageDataUrl: dataUrl, imageMimeType, hasImageObject: !!image, hasTextureObject: !!texture };
		});
		expect(loaded).toEqual({
			imageDataUrl,
			imageMimeType: "image/png",
			hasImageObject: false,
			hasTextureObject: false,
		});
	}, 180000);
});
