import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

function setup() {
	const tooltip = { textContent: "", style: {} };
	const document = new EventEmitter();
	document.getElementById = () => tooltip;
	document.addEventListener = document.on.bind(document);
	document.removeEventListener = document.off.bind(document);
	const window = {};
	runInNewContext(
		readFileSync(new URL("../src/js/renderer/renderers/EdificioRenderer.js", import.meta.url), "utf8"),
		{ window, document, console },
	);
	const buildings = new Map();
	const renderer = new window.EdificioRenderer({ edificioSprites: buildings }, {});
	return { renderer, tooltip, document, buildings };
}

describe("building tooltip", () => {
	it("hides the tooltip and releases its listener when the hovered building is removed", () => {
		const { renderer, tooltip, document, buildings } = setup();
		const sprite = { alpha: 1, destroy() {} };
		const building = { label: "ciclovía" };
		buildings.set(building, sprite);

		renderer.onEdificioHover(building, sprite);
		expect(tooltip.textContent).toBe("ciclovía");
		expect(tooltip.style.display).toBe("block");
		expect(document.listenerCount("mousemove")).toBe(1);

		renderer.removeEdificioSprite(building);
		expect(tooltip.style.display).toBe("none");
		expect(tooltip.textContent).toBe("");
		expect(document.listenerCount("mousemove")).toBe(0);
		expect(sprite.alpha).toBe(1);
	});

	it("clears the hovered building's tooltip on a full scene reset", () => {
		const { renderer, tooltip, document } = setup();
		const sprite = { alpha: 1 };
		renderer.onEdificioHover({ label: "ciclovía" }, sprite);

		renderer.clearTooltip();
		expect(tooltip.style.display).toBe("none");
		expect(document.listenerCount("mousemove")).toBe(0);
		expect(renderer.tooltipSprite).toBe(null);
	});

	it("keeps one tooltip owner on repeated entry and ignores late exits", () => {
		const { renderer, tooltip, document } = setup();
		const first = { alpha: 1 };
		const second = { alpha: 1 };

		renderer.onEdificioHover({ label: "ciclovía" }, first);
		renderer.onEdificioHover({ label: "ciclovía" }, first);
		expect(document.listenerCount("mousemove")).toBe(1);

		renderer.onEdificioHover({ label: "Biblioteca" }, second);
		renderer.onEdificioOut({ label: "ciclovía" }, first);
		expect(tooltip.textContent).toBe("Biblioteca");
		expect(tooltip.style.display).toBe("block");
		expect(document.listenerCount("mousemove")).toBe(1);

		renderer.onEdificioOut({ label: "Biblioteca" }, second);
		expect(tooltip.style.display).toBe("none");
		expect(document.listenerCount("mousemove")).toBe(0);
	});
});
