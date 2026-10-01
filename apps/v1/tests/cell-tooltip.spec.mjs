import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

function setup() {
	const tooltip = { textContent: "", style: {} };
	const stage = new EventEmitter();
	const document = new EventEmitter();
	document.getElementById = () => tooltip;
	document.addEventListener = document.on.bind(document);
	document.removeEventListener = document.off.bind(document);
	const window = {
		cellDetectionEnabled: true, celda_tamano: 5, offsetX: 0, offsetY: 0, escala: 1,
		obtenerCoordenadasGlobalesCelda: (street, lane, index) => ({ x: street.x + index * 5 + 2.5, y: 2.5 }),
		obtenerCoordenadasGlobalesCeldaConCurva: (street, lane, index) => ({ x: street.x + index * 5 + 2.5, y: 102.5 }),
	};
	runInNewContext(readFileSync(new URL("../src/js/renderer/renderers/CalleRenderer.js", import.meta.url), "utf8"), { window, document, performance: { now: () => 100 }, console });
	const roads = new window.CalleRenderer({ app: { stage } }, {});
	const street = { nombre: "Main", x: 0, carriles: 1, tamano: 3 };
	const move = (x, y = 2.5) => stage.emit("pointermove", { data: { global: { x, y } } });
	return { roads, street, stage, tooltip, move, window, document };
}

describe("street cell tooltip", () => {
	it("shows physical cell zero and follows every move without stale throttled content", () => {
		const { roads, street, move, tooltip } = setup();
		roads.onCalleHover(street, {});
		move(2.5);
		expect(tooltip.textContent).toBe("Main : 0");
		move(7.5);
		expect(tooltip.textContent).toBe("Main : 1");
	});

	it("does not retain a previous cell when two moves happen at the same time", () => {
		const { roads, street, move, tooltip } = setup();
		roads.onCalleHover(street, {});
		move(2.5);
		move(12.5);
		expect(tooltip.textContent).toBe("Main : 2");
	});

	it("positions and populates the tooltip on entry, using viewport coordinates", () => {
		const { roads, street, tooltip, window } = setup();
		window.offsetX = 10;
		window.offsetY = 20;
		window.escala = 2;
		roads.onCalleHover(street, {}, { data: { global: { x: 15, y: 25 }, originalEvent: { clientX: 315, clientY: 125 } } });
		expect(tooltip.textContent).toBe("Main : 0");
		expect(tooltip.style).toMatchObject({ left: "330px", top: "140px" });
	});

	it("cleans up repeated name-only hover listeners and reads detection changes on reentry", () => {
		const { roads, street, stage, document, tooltip, window, move } = setup();
		const container = {};
		window.cellDetectionEnabled = false;
		roads.onCalleHover(street, container);
		roads.onCalleHover(street, container);
		expect(document.listenerCount("mousemove")).toBe(1);
		window.cellDetectionEnabled = true;
		roads.onCalleHover(street, container);
		expect(document.listenerCount("mousemove")).toBe(0);
		move(2.5);
		expect(tooltip.textContent).toBe("Main : 0");
		roads.onCalleOut(street, container);
		expect(stage.listenerCount("pointermove")).toBe(0);
	});

	it.each([{ esCurva: true, vertices: [] , bezierControls: [] }, { esCurva: true, vertices: [{ indiceCelda: 1 }] }, { geometryType: "roundabout" }])("finds cells on curved geometry %j", (geometry) => {
		const { roads, street, move, tooltip } = setup();
		Object.assign(street, geometry);
		roads.onCalleHover(street, {});
		move(7.5, 102.5);
		expect(tooltip.textContent).toBe("Main : 1");
	});

	it("keeps one hover writer on repeated entry and ignores late exits from the previous road", () => {
		const { roads, street, stage, move, tooltip } = setup();
		const first = {}, second = {};
		roads.onCalleHover(street, first);
		roads.onCalleHover(street, first);
		expect(stage.listenerCount("pointermove")).toBe(1);
		roads.onCalleHover({ ...street, nombre: "Next", x: 20 }, second);
		roads.onCalleOut(street, first);
		move(22.5);
		expect(tooltip.textContent).toBe("Next : 0");
		expect(tooltip.style.display).toBe("block");
		roads.onCalleOut(street, second);
		expect(stage.listenerCount("pointermove")).toBe(0);
		expect(tooltip.style.display).toBe("none");
	});

	it("releases the tooltip listener when a hovered road is replaced or deleted", () => {
		const { roads, street, stage, tooltip } = setup();
		const container = { destroy() {} };
		roads.scene.calleSprites = new Map([[street, container]]);
		roads.onCalleHover(street, container);
		roads.removeCalleSprite(street);
		expect(stage.listenerCount("pointermove")).toBe(0);
		expect(tooltip.style.display).toBe("none");
	});
});
