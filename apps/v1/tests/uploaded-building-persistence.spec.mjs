import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSimulator } from "./helpers/simulator.mjs";

async function prepare(usePixi) {
	const sim = await openSimulator({ usePixi, freezeFrames: false });
	if (usePixi) await sim.page.waitForFunction(() => !!window.pixiApp?.sceneManager?.edificioRenderer, { timeout: 30000 });
	await sim.page.evaluate(() => {
		window.hideLoadingScreen?.();
		window.confirm = () => true;
		window.alert = () => {};
		document.getElementById("btnNuevaSimulacion").click();
	});
	return sim;
}

describe.each([["Canvas", false], ["Pixi", true]])("uploaded Edificio persistence in %s", (_, usePixi) => {
	let source;
	let restored;
	beforeEach(async () => { source = await prepare(usePixi); }, 180000);
	afterEach(async () => { await source?.close(); await restored?.close(); });

	it("embeds only data and restores PNG/JPEG/WebP artwork, geometry and visible bounds in a fresh app", async () => {
		const json = await source.page.evaluate(async () => {
			const artwork = document.createElement("canvas");
			artwork.width = 40;
			artwork.height = 20;
			artwork.getContext("2d").fillStyle = "#ef1234";
			artwork.getContext("2d").fillRect(0, 0, 40, 20);
			for (const [index, type] of ["png", "jpeg", "webp"].entries()) {
				const imageData = artwork.toDataURL(`image/${type}`);
				const imageElement = new Image();
				imageElement.src = imageData;
				await imageElement.decode();
				const building = window.agregarEdificio(type, 200 + index * 200, 200, 120, 60, 30);
				Object.assign(building, { appearanceMode: "uploaded-image", imageData, imageElement });
				// Creation already rendered a rectangle before the UI attached the image.
				window.pixiApp?.sceneManager?.edificioRenderer.renderEdificio(building);
				// A live browser resource and arbitrary renderer state must never leak into JSON.
				building.rendererResource = { self: building };
			}
			window.prompt = () => "Uploaded round trip";
			const original = URL.createObjectURL;
			URL.createObjectURL = blob => { window.__export = blob.text(); return "blob:uploaded-test"; };
			window.guardarSimulacion();
			URL.createObjectURL = original;
			return await window.__export;
		});
		const saved = JSON.parse(json);
		for (const building of saved.edificios) {
			expect(building.imageData).toMatch(/^data:image\/(png|jpeg|webp);base64,/);
			expect(building).not.toHaveProperty("imageElement");
			expect(building).not.toHaveProperty("rendererResource");
		}
		if (usePixi) {
			const promotedAndReleased = await source.page.evaluate(() => {
				const scene = window.pixiApp.sceneManager;
				const sprite = scene.edificioSprites.get(window.edificios[0]);
				const texture = sprite.texture;
				const base = texture.baseTexture;
				const promoted = sprite instanceof PIXI.Sprite && texture.width === 40;
				document.getElementById("btnNuevaSimulacion").click();
				return promoted && base.destroyed && sprite.destroyed;
			});
			expect(promotedAndReleased).toBe(true);
		}
		restored = await prepare(usePixi);
		await restored.page.evaluate(json => {
			window.cargarSimulacion({ target: { files: [new File([json], "map.json")], value: "" } });
		}, json);
		await restored.page.waitForFunction(() => window.edificios?.length === 3 && window.edificios.every(b => b.imageElement?.naturalWidth === 40));
		if (usePixi) await restored.page.waitForFunction(() => window.edificios.every(b => window.pixiApp.sceneManager.edificioSprites.get(b)?.texture?.width === 40));
		const result = await restored.page.evaluate(pixi => {
			const buildings = window.edificios;
			const angle = Math.PI / 6;
			const first = buildings[0];
			const hit = distance => window.encontrarEdificioEnPunto(first.x + distance * Math.cos(angle), first.y + distance * Math.sin(angle))?.edificio === first;
			let pixels;
			let bounds;
			if (pixi) {
				const scene = window.pixiApp.sceneManager;
				const sprite = scene.edificioSprites.get(first);
				const point = sprite.toLocal(new PIXI.Point(first.x + 59 * Math.cos(angle), first.y + 59 * Math.sin(angle)), scene.getLayer('buildings'));
				bounds = sprite.visible && sprite.hitArea.contains(point.x, point.y);
				const extracted = scene.app.renderer.extract.canvas(sprite);
				pixels = [...extracted.getContext("2d").getImageData(extracted.width / 2 + 15, extracted.height / 2, 1, 1).data];
				first.width = 200;
				first.height = 100;
				scene.edificioRenderer.updateEdificioSprite(first);
				bounds = bounds && Math.abs(sprite.scale.x * sprite.texture.width - 200) < 0.01;
			} else {
				escala = 1; offsetX = 0; offsetY = 0;
				window.renderizarCanvas();
				const canvas = document.getElementById("simuladorCanvas");
				const x = first.x + 20 * Math.cos(angle);
				const y = first.y + 20 * Math.sin(angle);
				pixels = [...canvas.getContext("2d").getImageData(x, y, 1, 1).data];
				bounds = true;
			}
			return { modes: buildings.map(b => b.appearanceMode), natural: buildings.map(b => [b.imageNaturalWidth, b.imageNaturalHeight]), inside: hit(59), outside: hit(110), pixels, bounds };
		}, usePixi);
		expect(result.modes).toEqual(Array(3).fill("uploaded-image"));
		expect(result.natural).toEqual(Array(3).fill([40, 20]));
		expect(result.inside).toBe(true);
		expect(result.outside).toBe(false);
		expect(result.bounds).toBe(true);
		expect(result.pixels[0]).toBeGreaterThan(200);
		expect(result.pixels[1]).toBeLessThan(80);
		expect(result.pixels[3]).toBe(255);
	}, 180000);

	it("omits invalid uploads, preserves legacy buildings, and prevents stale decoding from replacing a newer map", async () => {
		await source.page.evaluate(() => {
			const load = buildings => window.cargarSimulacion({ target: { files: [new File([JSON.stringify({ nombre: "validation", calles: [], edificios: buildings })], "map.json")], value: "" } });
			const base = { appearanceMode: "uploaded-image", x: 10, y: 10, width: 20, height: 10 };
			load([
				{ ...base, imageData: "https://example.com/image.png" },
				{ ...base, imageData: "data:image/svg+xml;base64,AAAA" },
				{ ...base, imageData: "data:image/png;base64,AAAA" },
				{ ...base, imageData: `data:image/png;base64,${"A".repeat(7 * 1024 * 1024)}` },
				{ label: "legacy", x: 10, y: 10, width: 20, height: 10, color: "#123456" },
			]);
		});
		await source.page.waitForFunction(() => window.edificios?.[0]?.label === "legacy");
		expect(await source.page.evaluate(() => window.edificios.map(b => ({ label: b.label, color: b.color, mode: b.appearanceMode })))).toEqual([{ label: "legacy", color: "#123456" }]);
		await source.page.evaluate(() => {
			const native = window.Image;
			window.Image = function () {
				const image = new native();
				Object.defineProperty(image, "onload", { set(callback) { window.__releaseDecode = callback; } });
				return image;
			};
			window.__restoreImage = () => { window.Image = native; };
			const canvas = document.createElement("canvas");
			canvas.width = 20; canvas.height = 10;
			window.cargarSimulacion({ target: { files: [new File([JSON.stringify({ nombre: "old", calles: [], edificios: [{ appearanceMode: "uploaded-image", imageData: canvas.toDataURL(), x: 10, y: 10, width: 20, height: 10 }] })], "old.json")], value: "" } });
		});
		await source.page.waitForFunction(() => typeof window.__releaseDecode === "function");
		await source.page.evaluate(() => {
			window.__restoreImage();
			window.cargarSimulacion({ target: { files: [new File([JSON.stringify({ nombre: "newer", calles: [], edificios: [{ label: "newer", x: 40, y: 40, width: 20, height: 10 }] })], "newer.json")], value: "" } });
		});
		await source.page.waitForFunction(() => window.edificios?.[0]?.label === "newer");
		await source.page.evaluate(async () => {
			window.__releaseDecode();
			await new Promise(resolve => setTimeout(resolve, 200));
		});
		expect(await source.page.evaluate(() => ({ labels: window.edificios.map(b => b.label), name: window.simulacionActual.nombre }))).toEqual({ labels: ["newer"], name: "newer" });
	}, 180000);
});
