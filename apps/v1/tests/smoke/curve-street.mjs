import assert from "node:assert/strict";
import { openSimulator } from "../helpers/simulator.mjs";

const CONTROL_HANDLE =
	".street-control-handle, .street-endpoint-handle[data-kind^='control']";

async function createAndSelectStraightStreet(page) {
	await page.evaluate(() => {
		const canvas = document.getElementById("simuladorCanvas");
		const rect = canvas.getBoundingClientRect();
		const camera = window.USE_PIXI ? window.pixiApp?.cameraController : null;
		const screen = { x: rect.width * 0.58, y: rect.height * 0.72 };
		const position = camera
			? camera.screenToWorld(screen.x, screen.y)
			: {
					x:
						((screen.x * canvas.width) / rect.width - window.offsetX) /
						window.escala,
					y:
						((screen.y * canvas.height) / rect.height - window.offsetY) /
						window.escala,
				};
		const street = window.crearCalle(
			"Curve smoke Calle",
			24,
			window.TIPOS.CONEXION,
			position.x,
			position.y,
			0,
			0,
			1,
			0.02,
		);
		const index = window.calles.indexOf(street);
		for (const id of ["selectCalle", "selectCalleEditor"]) {
			const selector = document.getElementById(id);
			selector.add(new Option(street.nombre, index));
		}
		const selector = document.getElementById("selectCalle");
		selector.value = String(index);
		selector.dispatchEvent(new Event("change", { bubbles: true }));
		window.calleSeleccionada = street;
		window.pixiApp?.sceneManager?.renderAll();
		window.renderizarCanvas?.();
	});
	await page.waitForFunction(
		() =>
			window.calleSeleccionada?.nombre === "Curve smoke Calle" &&
			!document.getElementById("streetInspector")?.hidden,
	);
}

async function controlCenter(page, index = 0) {
	return page.$$eval(
		CONTROL_HANDLE,
		(handles, target) => {
			const controls = handles.filter(
				(handle) =>
					handle.classList.contains("street-control-handle") ||
					handle.dataset.kind?.startsWith("control"),
			);
			const element = controls[target];
			if (!element) throw new Error(`Control handle ${target} is not rendered`);
			const box = element.getBoundingClientRect();
			return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		},
		index,
	);
}

async function endpointCenter(page, kind) {
	return page.$eval(
		`.street-endpoint-handle[data-kind='${kind}']`,
		(element) => {
			const box = element.getBoundingClientRect();
			return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		},
	);
}

async function controlCount(page) {
	return page.$$eval(
		CONTROL_HANDLE,
		(handles) =>
			handles.filter((handle) => {
				const box = handle.getBoundingClientRect();
				return (
					box.width > 0 &&
					box.height > 0 &&
					getComputedStyle(handle).visibility !== "hidden"
				);
			}).length,
	);
}

async function projectWorld(page, point) {
	return page.evaluate((world) => {
		const canvas = document.getElementById("simuladorCanvas");
		const rect = canvas.getBoundingClientRect();
		const camera = window.USE_PIXI ? window.pixiApp?.cameraController : null;
		if (camera) {
			const screen = camera.worldToScreen(world.x, world.y);
			const dimensions = window.pixiApp.app?.screen;
			return {
				x:
					rect.left +
					(screen.x * rect.width) / (dimensions?.width || rect.width),
				y:
					rect.top +
					(screen.y * rect.height) / (dimensions?.height || rect.height),
			};
		}
		return {
			x:
				rect.left +
				((world.x * window.escala + window.offsetX) * rect.width) /
					canvas.width,
			y:
				rect.top +
				((world.y * window.escala + window.offsetY) * rect.height) /
					canvas.height,
		};
	}, point);
}

async function dragTo(page, from, to) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 8 });
}

async function setNumber(page, selector, value) {
	await page.$eval(
		selector,
		(input, next) => {
			input.focus();
			input.value = String(next);
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
			input.blur();
		},
		value,
	);
}

async function geometrySignature(page) {
	return page.evaluate(() => {
		const street = window.calleSeleccionada;
		return {
			x: street.x,
			y: street.y,
			angle: street.angulo,
			cells: street.tamano,
			spacing: window.celda_tamano,
			endX: street.endX,
			endY: street.endY,
			controls: street.bezierControls.map((point) => ({ ...point })),
		};
	});
}

async function findFoldedControlPosition(page, index = 0) {
	return page.evaluate((controlIndex) => {
		const street = window.calleSeleccionada;
		const spacing = window.celda_tamano;
		const left = Math.min(street.x, street.endX) - street.tamano * spacing;
		const right = Math.max(street.x, street.endX) + street.tamano * spacing;
		const top = Math.min(street.y, street.endY) - street.tamano * spacing;
		const bottom = Math.max(street.y, street.endY) + street.tamano * spacing;
		for (let yi = 0; yi <= 8; yi++) {
			for (let xi = 0; xi <= 8; xi++) {
				const candidate = {
					x: left + ((right - left) * xi) / 8,
					y: top + ((bottom - top) * yi) / 8,
				};
				const proposed = {
					...street,
					bezierControls: street.bezierControls.map((point) => ({ ...point })),
				};
				proposed.bezierControls[controlIndex] = candidate;
				if (
					window.streetBezier.validate(proposed).reason ===
					"folded-lane-overlap"
				)
					return candidate;
			}
		}
		return null;
	}, index);
}

async function model(page) {
	return page.evaluate(() => {
		const street = window.calleSeleccionada;
		const validation = window.streetBezier.validate(street);
		const cells = Array.from({ length: street.tamano }, (_, i) =>
			window.obtenerCoordenadasGlobalesCeldaConCurva(street, 0, i),
		);
		return {
			curved: street.esCurva,
			controls: street.bezierControls.map((point) => ({ ...point })),
			start: { x: street.x, y: street.y },
			end: { x: street.endX, y: street.endY },
			cellCount: street.tamano,
			spacing: window.celda_tamano,
			cells,
			validation,
		};
	});
}

function assertArcAligned(state, label) {
	assert.equal(
		state.validation.valid,
		true,
		`${label}: Bezier path validates (${state.validation.reason})`,
	);
	assert.equal(
		state.validation.cells,
		state.cellCount,
		`${label}: arc resampling keeps the requested cell count`,
	);
	assert.ok(
		Math.abs(state.validation.length / state.spacing - state.cellCount) <= 0.5,
		`${label}: arc length quantizes to nearest cell (${state.validation.length})`,
	);
	assert.equal(
		state.cells.length,
		state.cellCount,
		`${label}: curved cell coordinates are complete`,
	);
	for (let i = 1; i < state.cells.length; i++) {
		const distance = Math.hypot(
			state.cells[i].x - state.cells[i - 1].x,
			state.cells[i].y - state.cells[i - 1].y,
		);
		assert.ok(
			Math.abs(distance - state.spacing) < 1.5,
			`${label}: arc cell ${i} spacing ${distance} is aligned to ${state.spacing}`,
		);
	}
}

function close(actual, expected, label, tolerance = 0.02) {
	assert.ok(
		Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
		`${label}: expected ${expected} ±${tolerance}, got ${actual}`,
	);
}

for (const usePixi of [false, true]) {
	const sim = await openSimulator({ seed: 83, usePixi, freezeFrames: false });
	const { page } = sim;
	try {
		if (usePixi)
			await page.waitForFunction(() => !!window.pixiApp?.cameraController, {
				timeout: 30000,
			});
		await page.evaluate(() => window.hideLoadingScreen?.());
		await page.waitForFunction(() => document.getElementById("loadingScreen")?.style.display === "none");
		await page.waitForFunction(
			() => typeof window.drawStreetTool?.isActive === "function",
		);
		if (await page.evaluate(() => window.drawStreetTool.isActive())) {
			await page.click("#drawStreetButton");
			await page.waitForFunction(
				() => window.drawStreetTool?.isActive?.() === false,
			);
		}
		await createAndSelectStraightStreet(page);
		const initial = await page.evaluate(() => ({
			curved: Boolean(window.calleSeleccionada.esCurva),
			links: window.conexiones.length,
			streetCount: window.calles.length,
		}));
		assert.equal(
			initial.curved,
			false,
			"fixture begins as an ordinary straight street",
		);

		await page.click("#streetInspectorAddControl");
		await page.click("#streetInspectorChooseBezier");
		await page.waitForFunction(
			() =>
				window.calleSeleccionada?.esCurva === true &&
				window.calleSeleccionada.bezierControls?.length >= 1,
			{ timeout: 5000 },
		);
		await page.waitForFunction(
			() =>
				Array.from(
					document.querySelectorAll(
						".street-endpoint-handle[data-kind^='control']",
					),
				).some(
					(handle) =>
						!handle.hidden && handle.getBoundingClientRect().width > 0,
				),
			{ timeout: 5000 },
		);
		assert.equal(
			await controlCount(page),
			1,
			"Add control converts straight street and creates the first control",
		);
		await page.click("#streetInspectorAddControl");
		await page.click("#streetInspectorChooseBezier");
		await page.waitForFunction(
			() => window.calleSeleccionada?.bezierControls?.length === 2,
		);
		assert.equal(
			await controlCount(page),
			2,
			"Add control adds another editable control",
		);

		let state = await model(page);
		assertArcAligned(state, "two-control curve");
		assert.deepEqual(
			await page.evaluate(() => ({
				links: window.conexiones.length,
				streets: window.calles.length,
			})),
			{ links: initial.links, streets: initial.streetCount },
			"curving a street creates no crossing links or extra streets",
		);

		// Inspector translations move the complete curve without changing its shape.
		const beforeTranslation = await geometrySignature(page);
		const exactX = beforeTranslation.x + 23.75;
		await setNumber(page, "#streetInspectorX", exactX);
		const translated = await geometrySignature(page);
		assert.equal(translated.x, exactX, "inspector commits exact street X");
		close(
			translated.endX - beforeTranslation.endX,
			23.75,
			"X translation moves endpoint",
		);
		close(
			translated.controls[0].x - beforeTranslation.controls[0].x,
			23.75,
			"X translation moves control",
		);
		const exactY = translated.y - 18.5;
		await setNumber(page, "#streetInspectorY", exactY);
		const translatedAgain = await geometrySignature(page);
		assert.equal(translatedAgain.y, exactY, "inspector commits exact street Y");
		close(
			translatedAgain.endY - translated.endY,
			-18.5,
			"Y translation moves endpoint",
		);
		close(
			translatedAgain.controls[1].y - translated.controls[1].y,
			-18.5,
			"Y translation moves control",
		);

		const beforeRotation = translatedAgain;
		const angle = beforeRotation.angle + 7.25;
		await setNumber(page, "#streetInspectorAngle", angle);
		const rotated = await geometrySignature(page);
		assert.equal(rotated.angle, angle, "inspector commits exact angle");
		assert.deepEqual(
			{ x: rotated.x, y: rotated.y },
			{ x: beforeRotation.x, y: beforeRotation.y },
			"angle change keeps street start fixed",
		);
		const radians = (-7.25 * Math.PI) / 180;
		const rotateAroundStart = (point) => ({
			x:
				beforeRotation.x +
				(point.x - beforeRotation.x) * Math.cos(radians) -
				(point.y - beforeRotation.y) * Math.sin(radians),
			y:
				beforeRotation.y +
				(point.x - beforeRotation.x) * Math.sin(radians) +
				(point.y - beforeRotation.y) * Math.cos(radians),
		});
		const expectedRotatedEnd = rotateAroundStart({
			x: beforeRotation.endX,
			y: beforeRotation.endY,
		});
		close(rotated.endX, expectedRotatedEnd.x, "angle rotates endpoint X");
		close(rotated.endY, expectedRotatedEnd.y, "angle rotates endpoint Y");
		const beforeScale = await geometrySignature(page);
		const scaledCellCount = beforeScale.cells + 3;
		await setNumber(page, "#streetInspectorCells", scaledCellCount);
		const scaled = await geometrySignature(page);
		assert.equal(
			scaled.cells,
			scaledCellCount,
			"inspector commits exact curve cell count",
		);
		const factor = scaledCellCount / beforeScale.cells;
		close(
			scaled.endX - scaled.x,
			(beforeScale.endX - beforeScale.x) * factor,
			"cell scaling scales endpoint X",
			0.1,
		);
		close(
			scaled.endY - scaled.y,
			(beforeScale.endY - beforeScale.y) * factor,
			"cell scaling scales endpoint Y",
			0.1,
		);
		close(
			scaled.controls[0].x - scaled.x,
			(beforeScale.controls[0].x - beforeScale.x) * factor,
			"cell scaling scales control X",
			0.1,
		);
		assert.equal(
			await page.evaluate(() => window.calleSeleccionada.arreglo[0].length),
			scaledCellCount,
			"cell-count scaling resizes the indexed lane array",
		);
		state = await model(page);
		assertArcAligned(state, "inspector-scaled curve");

		// Select the first control by its rendered handle; the inspector fields follow selection.
		const firstHandle = await controlCenter(page);
		await page.mouse.click(firstHandle.x, firstHandle.y);
		await page.waitForFunction(
			() =>
				window.streetInspector?.getSelectedControlIndex?.() === 0 ||
				document.activeElement?.id === "streetInspectorControlX",
		);
		const controlBeforeDrag = state.controls[0];
		await page.mouse.move(firstHandle.x, firstHandle.y);
		await page.mouse.down();
		await page.mouse.move(firstHandle.x + 34, firstHandle.y - 26, { steps: 6 });
		await page.mouse.up();
		await page.waitForFunction(
			(previous) => {
				const control = window.calleSeleccionada?.bezierControls?.[0];
				return (
					control && (control.x !== previous.x || control.y !== previous.y)
				);
			},
			{},
			controlBeforeDrag,
		);
		state = await model(page);
		assertArcAligned(state, "dragged control curve");
		assert.notDeepEqual(
			state.controls[0],
			controlBeforeDrag,
			"dragging selected control changes its world coordinates",
		);

		const exact = {
			x: state.controls[0].x + 11.25,
			y: state.controls[0].y - 7.5,
		};
		await page.$eval(
			"#streetInspectorControlX",
			(input, value) => {
				input.value = String(value);
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new Event("change", { bubbles: true }));
			},
			exact.x,
		);
		await page.$eval(
			"#streetInspectorControlY",
			(input, value) => {
				input.value = String(value);
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new Event("change", { bubbles: true }));
			},
			exact.y,
		);
		await page.waitForFunction(
			([x, y]) => {
				const control = window.calleSeleccionada?.bezierControls?.[0];
				return control?.x === x && control?.y === y;
			},
			{},
			[exact.x, exact.y],
		);
		assert.deepEqual(
			(await model(page)).controls[0],
			exact,
			"inspector commits exact X/Y coordinates",
		);

		const beforeInvalid = (await model(page)).controls[0];
		await page.$eval("#streetInspectorControlX", (input) => {
			input.value = "invalid";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
		});
		assert.deepEqual(
			(await model(page)).controls[0],
			beforeInvalid,
			"invalid control field rolls geometry back",
		);
		assert.notEqual(
			await page.$eval("#streetInspectorError", (element) =>
				element.textContent.trim(),
			),
			"",
			"invalid control field explains the rollback",
		);

		await page.click("#streetInspectorDeleteControl");
		await page.waitForFunction(
			() => window.calleSeleccionada?.bezierControls?.length === 1,
		);
		assert.equal(
			await controlCount(page),
			1,
			"delete removes the selected control only",
		);
		state = await model(page);
		assertArcAligned(state, "curve after deleting selected control");
		assert.deepEqual(
			await page.evaluate(() => ({
				links: window.conexiones.length,
				streets: window.calles.length,
			})),
			{ links: initial.links, streets: initial.streetCount },
			"editing curve does not add crossing links",
		);

		// Moving the curve endpoint scales every control from the fixed start.
		const beforeEndpointDrag = await geometrySignature(page);
		const endpointHandle = await endpointCenter(page, "end");
		const endpointTargetWorld = {
			x: beforeEndpointDrag.endX + beforeEndpointDrag.spacing * 2,
			y: beforeEndpointDrag.endY + beforeEndpointDrag.spacing,
		};
		const endpointTarget = await projectWorld(page, endpointTargetWorld);
		await dragTo(page, endpointHandle, endpointTarget);
		await page.mouse.up();
		const afterEndpointDrag = await geometrySignature(page);
		assert.deepEqual(
			{ x: afterEndpointDrag.x, y: afterEndpointDrag.y },
			{ x: beforeEndpointDrag.x, y: beforeEndpointDrag.y },
			"endpoint drag keeps the opposite endpoint fixed",
		);
		const proportionalScale =
			Math.hypot(
				endpointTargetWorld.x - beforeEndpointDrag.x,
				endpointTargetWorld.y - beforeEndpointDrag.y,
			) /
			Math.hypot(
				beforeEndpointDrag.endX - beforeEndpointDrag.x,
				beforeEndpointDrag.endY - beforeEndpointDrag.y,
			);
		for (let i = 0; i < beforeEndpointDrag.controls.length; i++) {
			close(
				afterEndpointDrag.controls[i].x,
				beforeEndpointDrag.x +
					(beforeEndpointDrag.controls[i].x - beforeEndpointDrag.x) *
						proportionalScale,
				`endpoint drag proportionally scales control ${i} X`,
				1.5,
			);
			close(
				afterEndpointDrag.controls[i].y,
				beforeEndpointDrag.y +
					(beforeEndpointDrag.controls[i].y - beforeEndpointDrag.y) *
						proportionalScale,
				`endpoint drag proportionally scales control ${i} Y`,
				1.5,
			);
		}
		state = await model(page);
		assertArcAligned(state, "proportionally resized endpoint curve");

		// A too-short endpoint drag must show an invalid preview and restore the committed geometry.
		const beforeShortDrag = await geometrySignature(page);
		const shortHandle = await endpointCenter(page, "end");
		const shortTarget = await projectWorld(page, {
			x: beforeShortDrag.x + beforeShortDrag.spacing * 0.1,
			y: beforeShortDrag.y,
		});
		await dragTo(page, shortHandle, shortTarget);
		await page.waitForFunction(() =>
			document
				.getElementById("simuladorCanvas")
				?.classList.contains("street-geometry-invalid"),
		);
		assert.match(
			await page.$eval(
				"#streetInspectorError",
				(element) => element.textContent,
			),
			/too-short|inválida/i,
			"too-short map preview explains why it is invalid",
		);
		await page.mouse.up();
		await page.waitForFunction(() => !window.streetGeometryEditor?.gesture);
		assert.deepEqual(
			await geometrySignature(page),
			beforeShortDrag,
			"too-short endpoint drag rolls back on release",
		);
		assert.equal(
			await page.$eval("#simuladorCanvas", (canvas) =>
				canvas.classList.contains("street-geometry-invalid"),
			),
			false,
			"invalid preview styling clears after rollback",
		);

		// Search only candidate coordinates; the actual change still occurs by dragging the map handle.
		await page.click("#streetInspectorAddControl");
		await page.click("#streetInspectorChooseBezier");
		await page.waitForFunction(
			() => window.calleSeleccionada?.bezierControls?.length === 2,
		);
		const foldedPosition = await findFoldedControlPosition(page, 0);
		assert.ok(
			foldedPosition,
			"fixture has a folded-lane candidate reachable by control drag",
		);
		const foldedHandle = await controlCenter(page, 0);
		const foldedTarget = await projectWorld(page, foldedPosition);
		const beforeFoldedDrag = await geometrySignature(page);
		await dragTo(page, foldedHandle, foldedTarget);
		await page.waitForFunction(() =>
			document
				.getElementById("simuladorCanvas")
				?.classList.contains("street-geometry-invalid"),
		);
		assert.match(
			await page.$eval(
				"#streetInspectorError",
				(element) => element.textContent,
			),
			/folded-lane-overlap|inválida/i,
			"folded map preview is reported as invalid",
		);
		await page.mouse.up();
		await page.waitForFunction(() => !window.streetGeometryEditor?.gesture);
		assert.deepEqual(
			await geometrySignature(page),
			beforeFoldedDrag,
			"folded control drag rolls back on release",
		);

		// A true geometric crossing does not synthesize a traffic connection.
		const beforeCrossing = await page.evaluate(() => ({
			links: window.conexiones.length,
			streets: window.calles.length,
		}));
		const crossing = await page.evaluate(() => {
			const curve = window.calleSeleccionada;
			const point = window.streetBezier.point(curve, 0.5);
			const before = window.streetBezier.point(curve, 0.49);
			const after = window.streetBezier.point(curve, 0.51);
			const dx = after.x - before.x;
			const dy = after.y - before.y;
			const length = Math.hypot(dx, dy) || 1;
			const nx = -dy / length;
			const ny = dx / length;
			const halfLength = 8 * window.celda_tamano;
			const angle = (Math.atan2(-ny, nx) * 180) / Math.PI;
			const street = window.crearCalle(
				"Curve smoke crossing",
				16,
				window.TIPOS.CONEXION,
				point.x - nx * halfLength,
				point.y - ny * halfLength,
				angle,
				0,
				1,
				0.02,
			);
			return { x: point.x, y: point.y, crossing: street };
		});
		assert.equal(crossing.crossing.nombre, "Curve smoke crossing");
		assert.deepEqual(
			await page.evaluate(() => ({
				links: window.conexiones.length,
				streets: window.calles.length,
			})),
			{ links: beforeCrossing.links, streets: beforeCrossing.streets + 1 },
			"crossing streets do not create automatic links",
		);

		// Save via the real button, intercepting only the browser download, then load that JSON.
		await page.evaluate(() => {
			window.prompt = () => "Curve smoke roundtrip";
			window.alert = () => {};
			window.confirm = () => true;
			window.__originalCreateObjectURL = URL.createObjectURL.bind(URL);
			URL.createObjectURL = (blob) => {
				window.__curveJsonPromise = blob.text();
				return "blob:curve-smoke";
			};
			URL.revokeObjectURL = () => {};
			HTMLAnchorElement.prototype.click = () => {};
		});
		await page.$eval("#btnGuardarSimulacion", (button) => button.click());
		await page.waitForFunction(() => !!window.__curveJsonPromise);
		const saved = await page.evaluate(async () =>
			JSON.parse(await window.__curveJsonPromise),
		);
		const savedCurve = saved.calles.find(
			(street) => street.nombre === "Curve smoke Calle",
		);
		assert.ok(
			savedCurve?.bezierGeometry,
			"saved JSON marks the Bezier street geometry",
		);
		assert.deepEqual(
			savedCurve.bezierControls,
			(await geometrySignature(page)).controls,
			"saved JSON preserves world-space controls",
		);
		const savedCurveGeometry = {
			endX: savedCurve.endX,
			endY: savedCurve.endY,
			controls: savedCurve.bezierControls,
			cells: savedCurve.tamano,
		};
		await page.evaluate((json) => {
			const input = document.getElementById("inputCargarSimulacion");
			const transfer = new DataTransfer();
			transfer.items.add(
				new File([JSON.stringify(json)], "curve-smoke.json", {
					type: "application/json",
				}),
			);
			input.files = transfer.files;
			input.dispatchEvent(new Event("change", { bubbles: true }));
		}, saved);
		await page.waitForFunction(
			() =>
				window.calles?.some(
					(street) =>
						street.nombre === "Curve smoke Calle" &&
						street.bezierGeometry &&
						street.bezierControls?.length === 2,
				),
			{ timeout: 15000 },
		);
		const restoredCurve = await page.evaluate(() => {
			const street = window.calles.find(
				(item) => item.nombre === "Curve smoke Calle",
			);
			return {
				endX: street.endX,
				endY: street.endY,
				controls: street.bezierControls,
				cells: street.tamano,
			};
		});
		assert.deepEqual(
			restoredCurve,
			savedCurveGeometry,
			"JSON load restores endpoint, controls and cell count",
		);
		await page.waitForFunction(
			(expected) => window.conexiones.length === expected,
			{ timeout: 15000 },
			saved.conexiones.length,
		);
		assert.deepEqual(
			await page.evaluate(() => ({ links: window.conexiones.length })),
			{ links: saved.conexiones.length },
			"JSON roundtrip restores only explicit links, not geometric crossings",
		);
		// A street with no Bezier controls can have literal, independently movable corners.
		await page.evaluate(() => {
			const original = window.calles.find((street) => street.nombre === "Curve smoke Calle");
			const street = window.crearCalle("Anchor smoke Calle", 30, window.TIPOS.CONEXION,
				original.x, original.y + 150, 0, 0, 1, 0.02);
			const index = window.calles.indexOf(street);
			for (const id of ["selectCalle", "selectCalleEditor"])
				document.getElementById(id).add(new Option(street.nombre, index));
			const selector = document.getElementById("selectCalle");
			selector.value = String(index);
			window.calleSeleccionada = street;
			selector.dispatchEvent(new Event("change", { bubbles: true }));
			window.pixiApp?.sceneManager?.renderAll();
			window.renderizarCanvas?.();
		});
		await page.waitForFunction(() => document.querySelector("#streetInspectorName")?.value === "Anchor smoke Calle");
		await page.click("#streetInspectorAddControl");
		await page.click("#streetInspectorChooseAnchor");
		await page.waitForFunction(() => window.calleSeleccionada?.bezierSegments?.length === 2);
		await page.$$eval("#streetInspectorBezierControls .street-inspector-section", (buttons) => buttons.at(-1).click());
		await page.click("#streetInspectorAddControl");
		await page.click("#streetInspectorChooseAnchor");
		await page.waitForFunction(() => window.calleSeleccionada?.bezierSegments?.length === 3);
		await page.click("#streetInspectorAddControl");
		await page.click("#streetInspectorCancelAdd");
		assert.equal(await page.evaluate(() => window.calleSeleccionada.bezierSegments.length), 3,
			"canceling the add choice leaves anchors unchanged");
		let anchored = await page.evaluate(() => {
			const street = window.calleSeleccionada;
			return { sections: street.bezierSegments, valid: window.streetBezier.validate(street).valid };
		});
		assert.equal(anchored.valid, true, "straight street converts to valid anchored geometry");
		assert.ok(anchored.sections.every((section) => section.controls.length === 0), "anchor-only sections remain straight");
		const first = await endpointCenter(page, "start");
		assert.ok(first.x > 0, "street remains visible after conversion");
		const anchorHandle = await page.$eval(".street-endpoint-handle[data-kind='anchor:0']", (element) => {
			const box = element.getBoundingClientRect();
			return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		});
		await dragTo(page, anchorHandle, { x: anchorHandle.x, y: anchorHandle.y - 22 });
		await page.mouse.up();
		anchored = await page.evaluate(() => {
			const street = window.calleSeleccionada;
			return { sections: street.bezierSegments, valid: window.streetBezier.validate(street).valid,
				cell: window.encontrarCeldaMasCercana?.(street.bezierSegments[0].end.x, street.bezierSegments[0].end.y)?.calle === street };
		});
		assert.equal(anchored.valid, true, "dragged anchor produces valid sharp-turn geometry");
		assert.equal(anchored.cell, true, "cell hit-testing follows the new corner");
		assert.equal(anchored.sections[0].controls.length, 0, "corner does not require Bezier controls");
		await page.evaluate(() => { window.__curveJsonPromise = null; });
		await page.$eval("#btnGuardarSimulacion", (button) => button.click());
		await page.waitForFunction(() => !!window.__curveJsonPromise);
		const anchoredSave = await page.evaluate(async () => JSON.parse(await window.__curveJsonPromise));
		const anchoredStreet = anchoredSave.calles.find((street) => street.nombre === "Anchor smoke Calle");
		assert.deepEqual(anchoredStreet.bezierSegments, anchored.sections, "JSON saves anchors and sections");
		await page.evaluate((json) => {
			const input = document.getElementById("inputCargarSimulacion");
			const transfer = new DataTransfer();
			transfer.items.add(new File([JSON.stringify(json)], "anchor-smoke.json", { type: "application/json" }));
			input.files = transfer.files;
			input.dispatchEvent(new Event("change", { bubbles: true }));
		}, anchoredSave);
		await page.waitForFunction(() => window.calles?.some((street) => street.nombre === "Anchor smoke Calle" && street.bezierSegments?.length === 3), { timeout: 15000 });
		assert.deepEqual(await page.evaluate(() => window.calles.find((street) => street.nombre === "Anchor smoke Calle").bezierSegments),
			anchored.sections, "JSON restores movable corners in both renderers");
		await page.evaluate(() => {
			const index = window.calles.findIndex((street) => street.nombre === "Anchor smoke Calle");
			const selector = document.getElementById("selectCalle");
			selector.value = String(index);
			window.calleSeleccionada = window.calles[index];
			selector.dispatchEvent(new Event("change", { bubbles: true }));
		});
		await page.waitForFunction(() => document.querySelector("#streetInspectorName")?.value === "Anchor smoke Calle");
		await page.click("[aria-label='Eliminar ancla fija 1']");
		await page.waitForFunction(() => window.calleSeleccionada?.bezierSegments?.length === 2);
		assert.ok(await page.evaluate(() => window.calleSeleccionada.bezierSegments.every((section) => section.controls.length === 0)),
			"deleting a sharp-turn anchor joins straight legs without introducing a curve control");
		console.log(
			`✅ UI Bezier controls and sharp anchors, invalid drag rollback, JSON and crossings (${usePixi ? "Pixi" : "Canvas"})`,
		);
	} finally {
		await sim.close();
	}
}
