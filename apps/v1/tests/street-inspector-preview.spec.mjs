import { describe, expect, it } from "vitest";
import { openSimulator } from "./helpers/simulator.mjs";

describe("street inspector dimension preview", () => {
	for (const usePixi of [false, true]) {
		it(`keeps a non-mutating visible proposal in ${usePixi ? "Pixi" : "Canvas"}`, async () => {
			const sim = await openSimulator({ seed: 19, usePixi, freezeFrames: false });
			try {
				const observed = await sim.page.evaluate(() => {
					const street = window.calles.find(item => window.streetBezier?.isBezier(item) && window.streetBezier.validate(item).valid) || window.calles.find(item => item.tamano > 1);
					window.calleSeleccionada = street;
					for (const id of ["selectCalle", "selectCalleEditor"]) {
						const select = document.getElementById(id);
						select.value = String(window.calles.indexOf(street));
						select.dispatchEvent(new Event("change", { bubbles: true }));
					}
					const input = document.getElementById("streetInspectorCells");
					const oldSize = street.tamano;
					input.focus(); input.value = String(oldSize - 1); input.dispatchEvent(new Event("input", { bubbles: true }));
					const overlay = document.querySelector(".street-inspector-preview-overlay");
					const ctx = overlay?.getContext("2d");
					const pixels = ctx?.getImageData(0, 0, overlay.width, overlay.height).data || [];
					return { oldSize, actual: street.tamano, summary: document.getElementById("streetInspectorDependentSummary").textContent,
						visible: [...pixels].some((value, index) => index % 4 === 3 && value > 0), hasOverlay: !!overlay };
				});
				expect(observed.hasOverlay).toBe(true);
				expect(observed.visible).toBe(true);
				expect(observed.actual).toBe(observed.oldSize);
				expect(observed.summary).toContain("Conexiones:");
				await sim.page.keyboard.press("Escape");
				await sim.page.$eval("#streetInspectorCells", input => input.blur());
				expect(await sim.page.$eval(".street-inspector-preview-overlay", node => !!node).catch(() => false)).toBe(false);
				expect(await sim.page.$eval("#streetInspectorDependentSummary", node => node.hidden)).toBe(true);
			} finally { await sim.close(); }
		});
	}
});
