import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = (name) => readFileSync(new URL(`../src/js/renderer/renderers/${name}.js`, import.meta.url), "utf8");

function setup() {
	const layer = { addChild: vi.fn((sprite) => { sprite.parent = layer; }), removeChild: vi.fn() };
	class Sprite {
		anchor = { set: vi.fn() };
		destroy = vi.fn();
	}
	const window = { celda_tamano: 5, isPaused: true, estadoEscenarios: { celdasBloqueadas: new Map() } };
	const context = { window, PIXI: { Sprite }, CoordinateConverter: { degreesToRadians: (degrees) => degrees * Math.PI / 180 }, console };
	runInNewContext(source("CarroRenderer"), context);
	runInNewContext(source("CalleRenderer"), context);
	const scene = { carroSprites: new Map(), getLayer: () => layer };
	const assets = { getTexture: vi.fn((name) => name) };
	const cars = new window.CarroRenderer(scene, assets);
	scene.carroRenderer = cars;
	const street = { nombre: "Main", id: "main", x: 10, y: 20, angulo: 0, carriles: 1, tamano: 2, arreglo: [[0, 0]] };
	window.calles = [street];
	return { window, scene, cars, street, assets, roads: new window.CalleRenderer(scene, assets) };
}

describe("Pixi single-cell edits", () => {
	it("creates, replaces and removes one sprite while keeping incremental tracking synchronized", () => {
		const { cars, scene, street, assets, window } = setup();
		const full = vi.spyOn(cars, "updateCalleVehiculosFull");
		const incremental = vi.spyOn(cars, "updateCalleVehiculosIncremental");
		street.arreglo[0][0] = 2;
		cars.updateCell(street, 0, 0);
		const first = scene.carroSprites.get("Main_0_0");
		expect(first).toMatchObject({ texture: "carro2", x: 12.5, y: 22.5 });
		expect(cars.lastVehicleState.get("Main_0_0")).toBe(2);
		expect(cars.updateCounter).toBe(0);
		cars.updateAll(window.calles);
		expect(incremental).toHaveBeenCalledOnce();
		expect(scene.carroSprites.get("Main_0_0")).toBe(first);
		street.arreglo[0][0] = 7;
		window.estadoEscenarios.celdasBloqueadas.set("main:0:0", { texture: "inundacion" });
		cars.updateCell(street, 0, 0);
		expect(scene.carroSprites.get("Main_0_0").texture).toBe("inundacion");
		expect(assets.getTexture).toHaveBeenCalledWith("inundacion");
		street.arreglo[0][0] = 0;
		cars.updateCell(street, 0, 0);
		expect(scene.carroSprites.has("Main_0_0")).toBe(false);
		expect(cars.lastVehicleState.get("Main_0_0")).toBe(0);
		cars.updateAll(window.calles);
		expect(scene.carroSprites.size).toBe(0);
		expect(full).not.toHaveBeenCalled();
	});

	it("updates only the clicked cell, including a no-manager toggle and scenario paint", () => {
		const { window, scene, cars, street, roads } = setup();
		const single = vi.spyOn(cars, "updateCell");
		const all = vi.spyOn(cars, "updateAll");
		window.offsetX = 0;
		window.offsetY = 0;
		window.escala = 1;
		window.encontrarCeldaMasCercana = () => ({ calle: street, carril: 0, indice: 1 });
		window.clickActionManager = { executeAction: ({ calle, carril, indice }) => {
			calle.arreglo[carril][indice] = 3;
			return true;
		} };
		const event = { stopPropagation: vi.fn(), data: { global: { x: 17, y: 22 }, originalEvent: { ctrlKey: false, metaKey: false } } };
		roads.onCalleClick(street, event);
		expect(single).toHaveBeenCalledWith(street, 0, 1);
		expect(scene.carroSprites.get("Main_0_1").texture).toBe("carro3");
		window.clickActionManager = null;
		roads.onCalleClick(street, event);
		expect(scene.carroSprites.has("Main_0_1")).toBe(false);
		window.estadoEscenarios.tipoEscenarioActivo = "inundacion";
		roads.paintMode = "paint";
		roads.paintCell(street, event);
		expect(single).toHaveBeenCalledTimes(3);
		expect(scene.carroSprites.get("Main_0_1").texture).toBe("inundacion");
		expect(all).not.toHaveBeenCalled();
	});

	it("dispatches a selected-street body tap to the same cell update without pausing", () => {
		const { window, street } = setup();
		street.tamano = 10;
		street.arreglo[0] = Array(10).fill(0);
		const listeners = new Map();
		const canvas = { width: 100, height: 100, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
		const document = {
			getElementById: () => canvas,
			addEventListener: (type, handler) => listeners.set(type, handler),
		};
		const updateCell = vi.fn();
		window.USE_PIXI = true;
		window.escala = 1;
		window.offsetX = 0;
		window.offsetY = 0;
		window.calleSeleccionada = street;
		window.pixiApp = { sceneManager: { carroRenderer: { updateCell } } };
		window.encontrarCeldaMasCercana = () => ({ calle: street, carril: 0, indice: 1 });
		window.clickActionManager = { executeAction: vi.fn(() => true) };
		window.streetEditPause = vi.fn();
		window.addEventListener = vi.fn();
		const uiSource = readFileSync(new URL("../src/js/ui/editStreetGeometry.js", import.meta.url), "utf8");
		runInNewContext(uiSource, { window, document, requestAnimationFrame: vi.fn(), console });
		const event = { button: 0, clientX: 35, clientY: 22, pointerId: 1, target: canvas, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
		listeners.get("pointerdown")(event);
		expect(window.streetGeometryEditor.gesture?.kind).toBe("body");
		window.streetGeometryEditor.finishGesture();
		expect(window.clickActionManager.executeAction).toHaveBeenCalledOnce();
		expect(updateCell).toHaveBeenCalledWith(street, 0, 1);
		expect(window.streetEditPause).not.toHaveBeenCalled();
	});
});
