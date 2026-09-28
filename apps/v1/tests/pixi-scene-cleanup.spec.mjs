import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../src/js/renderer/SceneManager.js", import.meta.url), "utf8");

describe("Pixi scene cleanup", () => {
	 it("destroys scene display objects without destroying textures and resets renderer caches", () => {
		const destroyed = [];
		class Container {
			children = [];
			addChild(child) { this.children.push(child); child.parent = this; }
			removeChildren() { const children = this.children.splice(0); children.forEach(child => { child.parent = null; }); return children; }
		}
		const window = {};
		const context = { window, PIXI: { Container }, DayNightCycle: class {}, console };
		runInNewContext(source, context);
		const app = { stage: new Container() };
		const scene = new window.SceneManager(app, {});
		const display = { destroy: vi.fn(options => destroyed.push(options)) };
		const pooledSprite = { destroy: vi.fn(options => destroyed.push(options)) };
		const backgroundSprite = { parent: null, destroy: vi.fn(options => destroyed.push(options)) };
		scene.layers.streets.addChild(display);
		scene.referenceImageRenderer = { clear: vi.fn() };
		scene.backgroundAreaRenderer = { backgroundAreas: new Map([[{}, backgroundSprite]]) };
		scene.edificioRenderer = { etiquetasEdificios: new Map([[{}, display]]) };
		scene.uiRenderer = { etiquetas: new Map([[{}, [display]]]), contadores: new Map([["counter", display]]) };
		scene.conexionRenderer = { lastGeometry: new Map([[{}, []]]) };
		scene.carroRenderer = { lastVehicleState: new Map([["car", 1]]), spritePool: [pooledSprite] };
		scene.calleSprites.set({}, display);
		scene.carroSprites.set("car", display);
		scene.edificioSprites.set({}, display);
		scene.conexionGraphics.set({}, display);
		scene.verticeSprites.set("vertex", display);
		scene.backgroundRendered = scene.verticesRendered = scene.conexionesRendered = true;

		scene.clearAll();

		expect(display.destroy).toHaveBeenCalledWith({ children: true, texture: false, baseTexture: false });
		expect(destroyed).toHaveLength(3); // Layer object, generated background texture and pooled sprite.
		expect(pooledSprite.destroy).toHaveBeenCalledWith({ children: true, texture: false, baseTexture: false });
		expect(backgroundSprite.destroy).toHaveBeenCalledWith({ children: true, texture: true, baseTexture: true });
		expect(scene.layers.streets.children).toHaveLength(0);
		expect(scene.backgroundAreaRenderer.backgroundAreas.size).toBe(0);
		expect(scene.edificioRenderer.etiquetasEdificios.size).toBe(0);
		expect(scene.uiRenderer.etiquetas.size).toBe(0);
		expect(scene.uiRenderer.contadores.size).toBe(0);
		expect(scene.conexionRenderer.lastGeometry.size).toBe(0);
		expect(scene.carroRenderer.lastVehicleState.size).toBe(0);
		expect(scene.carroRenderer.spritePool).toHaveLength(0);
		expect(scene.calleSprites.size + scene.carroSprites.size + scene.edificioSprites.size + scene.conexionGraphics.size + scene.verticeSprites.size).toBe(0);
		expect(scene.backgroundRendered).toBe(false);
		expect(scene.verticesRendered).toBe(false);
		expect(scene.conexionesRendered).toBe(false);
	});
});
