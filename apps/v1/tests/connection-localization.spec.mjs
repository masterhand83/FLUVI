/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: the focused browser scenario mirrors one complete user workflow. */
import { describe, expect, it } from "vitest";
import { openSimulator } from "./helpers/simulator.mjs";

const hideLoadingScreen = (page) =>
	page.evaluate(() => {
		document.getElementById("loadingScreen").style.display = "none";
	});

const openAccordion = async (page, target) => {
	await page.$eval(target, (element) => {
		window.bootstrap.Collapse.getOrCreateInstance(element).show();
	});
	await page.waitForSelector(`${target}.show`, { visible: true });
	await new Promise((resolve) => setTimeout(resolve, 400));
};

const clearToasts = (page) =>
	page.evaluate(() => {
		for (const toast of document.querySelectorAll(".toast")) toast.remove();
	});

const waitForToast = async (page) => {
	await page.waitForFunction(
		() => document.querySelectorAll(".toast").length > 0,
		{ timeout: 5000, polling: 100 },
	);
	await new Promise((resolve) => setTimeout(resolve, 250));
	return page.$$eval(".toast", (elements) => {
		const toast = elements.at(-1);
		return {
			header: toast.querySelector(".toast-header").className,
			title: toast.querySelector(".toast-header strong").textContent,
			body: toast.querySelector(".toast-body").textContent,
			markup: toast.querySelectorAll(".toast-body *").length,
		};
	});
};

const fill = (page, selector, value) =>
	page.$eval(
		selector,
		(element, next) => {
			element.value = String(next);
			element.dispatchEvent(new Event("input", { bubbles: true }));
			element.dispatchEvent(new Event("change", { bubbles: true }));
		},
		value,
	);

const makeStreet = (page, { name, x, y, lanes = 2, size = 16 }) =>
	page.evaluate(
		({ name, x, y, lanes, size }) => {
			const canvas = document.getElementById("simuladorCanvas");
			const camera = window.pixiApp?.cameraController;
			const point = camera
				? camera.screenToWorld(canvas.width * x, canvas.height * y)
				: {
						x: (canvas.width * x - window.offsetX) / window.escala,
						y: (canvas.height * y - window.offsetY) / window.escala,
					};
			const street = window.crearCalle(
				name,
				size,
				window.TIPOS.CONEXION,
				point.x,
				point.y,
				0,
				0,
				lanes,
				0,
			);
			window.pixiApp?.sceneManager?.renderAll();
			window.renderizarCanvas?.();
			return { id: street.id, name: street.nombre };
		},
		{ name, x, y, lanes, size },
	);

const clickCell = async (page, streetId, lane, cell) => {
	const point = await page.evaluate(
		({ streetId, lane, cell }) => {
			const street = window.calles.find((item) => item.id === streetId);
			if (!street) throw new Error(`street ${streetId} disappeared`);
			const canvas = document.getElementById("simuladorCanvas");
			const rect = canvas.getBoundingClientRect();
			const world = window.obtenerCoordenadasGlobalesCelda(street, lane, cell);
			const camera = window.pixiApp?.cameraController;
			const screen = camera
				? camera.worldToScreen(world.x, world.y)
				: {
						x: world.x * window.escala + window.offsetX,
						y: world.y * window.escala + window.offsetY,
					};
			return {
				x:
					rect.left +
					(screen.x * rect.width) /
						(camera ? window.pixiApp.app.screen.width : canvas.width),
				y:
					rect.top +
					(screen.y * rect.height) /
						(camera ? window.pixiApp.app.screen.height : canvas.height),
			};
		},
		{ streetId, lane, cell },
	);
	await page.evaluate(({ x, y }) => {
		document.getElementById("simuladorCanvas").dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				button: 0,
				clientX: x,
				clientY: y,
			}),
		);
	}, point);
};

const connectionCount = (page) => page.evaluate(() => window.conexiones.length);

const modelSnapshot = (page) =>
	page.evaluate(() => ({
		streets: window.calles.map((street) => ({
			nombre: street.nombre,
			tipo: street.tipo,
			carriles: street.carriles,
			tamano: street.tamano,
			laneDirections: [...street.laneDirections],
		})),
		connections: window.conexiones.map((link) => ({
			source: link.origen.nombre,
			destination: link.destino.nombre,
			type: link.tipo,
			sourceLane: link.carrilOrigen,
			sourceCell: link.posOrigen,
			destinationLane: link.carrilDestino,
			destinationCell: link.posDestino,
			chance: link.probabilidadTransferencia,
		})),
	}));

const openDraft = async (page, sourceId, destinationId, type = "LINEAL") => {
	const hidden = await page.$eval("#linkDraftPanel", (panel) => panel.hidden);
	if (hidden) await page.click("#createLinkButton");
	await page.waitForFunction(
		() => document.getElementById("linkDraftPanel")?.hidden === false,
	);
	await page.select("#linkSourceStreet", sourceId);
	await page.select("#linkDestinationStreet", destinationId);
	await page.select("#linkTypeSelect", type);
	await page.waitForFunction(
		(expected) => document.getElementById("linkTypeSelect")?.value === expected,
		{},
		type,
	);
	await page.waitForSelector(
		type === "LINEAL"
			? '[data-testid="link-lineal-summary"]'
			: '#linkMappingRows [data-testid="link-mapping-row"]',
	);
};

const closeDraft = async (page) => {
	await page.click("#linkCancelButton");
	await page.waitForFunction(
		() => document.getElementById("linkDraftPanel").hidden,
	);
};

const setRow = (page, index, key, value) =>
	page.$eval(
		`#linkMappingRows [data-testid="link-mapping-row"]:nth-child(${index + 1}) [data-testid="${key}"]`,
		(element, next) => {
			element.value = String(next);
			element.dispatchEvent(new Event("input", { bubbles: true }));
			element.dispatchEvent(new Event("change", { bubbles: true }));
		},
		value,
	);

const readRows = (page) =>
	page.$$eval('#linkMappingRows [data-testid="link-mapping-row"]', (rows) =>
		rows.map((row) =>
			Object.fromEntries(
				[
					"source-lane",
					"source-cell",
					"destination-lane",
					"destination-cell",
					"chance",
				].map((key) => [
					key,
					row.querySelector(`[data-testid="${key}"]`)?.value ?? null,
				]),
			),
		),
	);

const clickRowPick = async (page, index, endpoint) => {
	const buttons = await page.$$(
		`#linkMappingRows [data-testid="link-mapping-row"] [data-testid="link-pick-${endpoint}"]`,
	);
	expect(buttons[index]).toBeTruthy();
	await buttons[index].click();
};

const closeLegacyModal = async (page, modalId) => {
	await new Promise((resolve) => setTimeout(resolve, 400));
	await page.evaluate((id) => {
		const modal = window.bootstrap.Modal.getOrCreateInstance(
			document.getElementById(id),
		);
		modal.hide();
	}, modalId);
	await page.waitForSelector(`#${modalId}`, { hidden: true });
	await page.waitForFunction(() => !document.querySelector(".modal-backdrop"), {
		polling: 100,
	});
};

const ensureSidebar = (page) =>
	page.evaluate(() => {
		const sidebar = document.getElementById("sidebar");
		if (sidebar.classList.contains("hidden")) {
			document.getElementById("sidebarToggleFloat").click();
		}
	});

const copy = {
	en: {
		addButton: "🔗 Add Connection",
		addTooltip:
			"Create a street connection between two streets for traffic flow",
		cancel: "Cancel",
		createLink: "🔗 Create connection",
		createSuccess:
			"Probabilistic connection created successfully. The simulation can now use the new street connection.",
		deleted: "Street connection deleted successfully.",
		draftStatusChooseDestination:
			"Origin: Source. Choose another street as the destination.",
		draftStatusChooseSource: "Choose the source street on the map.",
		draftStatusEdit: "Edit the mapping and save the changes.",
		draftStatusEditLineal: "Review the fixed mapping and save the changes.",
		draftStatusNeedsCells:
			"Choose source and destination cells on the map or type their indexes before saving.",
		draftStatusReview: "Review the mappings before saving.",
		draftStatusSameStreet: "The destination must be a different street.",
		duplicate: "An identical directed mapping already exists.",
		edit: "Edit",
		incomplete:
			"Complete the connection streets, lanes, and cells before saving.",
		internalPositionHelp:
			"Position on the destination street where the merge begins",
		invalidMapping:
			"A mapping is out of range, has an incompatible direction, or has an invalid probability.",
		laneOption: "Lane 2",
		legacyCreate: "✓ Create Connection",
		legacyTypeProbabilistic: "🟣 Probabilistic",
		legacyUpdate: "✓ Save Changes",
		linealSummary:
			"Fixed mapping: lane 1: last cell at source (15) → lane 1, first cell at destination (0); lane 2: last cell at source (15) → lane 2, first cell at destination (0).",
		listDelete: "Delete",
		listEdit: "Edit",
		listHeader: "📌 Street connections for: Source",
		listNoMatches: "No street connections found",
		listSearchLabel: "Search street connections",
		listSearchPlaceholder: "Search street connections...",
		listShow: "📋 View Existing Connections",
		listShowTooltip: "Show or hide the list of all created street connections",
		listTitle: "🔗 Connection Management",
		noMappings: "Add at least one mapping.",
		notFound: "Street connection not found",
		panelLabel: "Review street connection",
		panelSave: "Save connection",
		panelType: "Connection type",
		panelSource: "Source",
		panelDestination: "Destination",
		pickApplied:
			"Mapping 2: destination picked on the map (lane 1, cell 7). Review the fields before saving.",
		pickInstruction:
			"Mapping 1: choose a destination cell in “Destination”. Escape cancels.",
		pickWrongStreet:
			"Mapping 1: wrong street. Choose a destination cell in “Destination”.",
		rowChance: "Probability (%)",
		rowConnectLane: "Connect this lane",
		rowDestinationCell: "Destination cell",
		rowDestinationLane: "Destination lane",
		rowRemoveExit: "Remove exit",
		rowSourceCell: "Source cell",
		rowSourceLane: "Source lane",
		sameStreet: "The source and destination streets cannot be the same.",
		sourceStreetError: "Select a valid source street.",
		types: ["Linear", "Incorporation", "Probabilistic"],
		unmatched: "Source lane 3 has no mapping",
		updateSuccess: "Street connection updated successfully.",
		warningIncompatible:
			"This street connection is incompatible with the direction of its lanes. Adjust its positions.",
	},
	es: {
		addButton: "🔗 Agregar Conexión",
		addTooltip: "Crear una conexión entre calles para el flujo de tráfico",
		cancel: "Cancelar",
		createLink: "🔗 Crear conexión",
		createSuccess:
			"Conexión Probabilística creada correctamente. La simulación ya puede usar la nueva conexión.",
		deleted: "Conexión eliminada correctamente.",
		draftStatusChooseDestination:
			"Origen: Fuente. Elige otra calle como destino.",
		draftStatusChooseSource: "Elige la calle de origen en el mapa.",
		draftStatusEdit: "Edita la correspondencia y guarda los cambios.",
		draftStatusEditLineal:
			"Revisa la correspondencia fija y guarda los cambios.",
		draftStatusNeedsCells:
			"Elige celdas de origen y destino en el mapa o escribe sus índices antes de guardar.",
		draftStatusReview: "Revisa las correspondencias antes de guardar.",
		draftStatusSameStreet: "El destino debe ser una calle distinta.",
		duplicate: "Ya existe una correspondencia dirigida idéntica.",
		edit: "Editar",
		incomplete:
			"Completa las calles, los carriles y las celdas de la conexión antes de guardar.",
		internalPositionHelp:
			"Posición en la calle destino donde comienza la incorporación",
		invalidMapping:
			"Hay una correspondencia fuera de rango, con dirección incompatible o con una probabilidad inválida.",
		laneOption: "Carril 2",
		legacyCreate: "✓ Crear conexión",
		legacyTypeProbabilistic: "🟣 Probabilística",
		legacyUpdate: "✓ Guardar cambios",
		linealSummary:
			"Correspondencia fija: carril 1: última celda de origen (15) → carril 1, primera celda de destino (0); carril 2: última celda de origen (15) → carril 2, primera celda de destino (0).",
		listDelete: "Eliminar",
		listEdit: "Editar",
		listHeader: "📌 Conexiones de: Source",
		listNoMatches: "No se encontraron conexiones",
		listSearchLabel: "Buscar conexiones",
		listSearchPlaceholder: "Buscar conexiones...",
		listShow: "📋 Ver Conexiones Existentes",
		listShowTooltip:
			"Mostrar/ocultar la lista de todas las conexiones entre calles creadas",
		listTitle: "🔗 Gestión de Conexiones",
		noMappings: "Añade al menos una correspondencia.",
		notFound: "Conexión no encontrada",
		panelLabel: "Revisar conexión entre calles",
		panelSave: "Guardar conexión",
		panelType: "Tipo de conexión",
		panelSource: "Origen",
		panelDestination: "Destino",
		pickApplied:
			"Correspondencia 2: destino elegido en el mapa (carril 1, celda 7). Revisa los campos antes de guardar.",
		pickInstruction:
			"Correspondencia 1: elige una celda de destino en «Destination». Escape cancela.",
		pickWrongStreet:
			"Correspondencia 1: calle incorrecta. Elige una celda de destino en «Destination».",
		rowChance: "Probabilidad (%)",
		rowConnectLane: "Conectar este carril",
		rowDestinationCell: "Celda destino",
		rowDestinationLane: "Carril destino",
		rowRemoveExit: "Eliminar salida",
		rowSourceCell: "Celda origen",
		rowSourceLane: "Carril origen",
		sameStreet: "La calle de origen y la de destino no pueden ser la misma.",
		sourceStreetError: "Selecciona una calle de origen válida.",
		types: ["Lineal", "Incorporación", "Probabilística"],
		unmatched: "Carril origen 3 sin correspondencia",
		updateSuccess: "Conexión actualizada correctamente.",
		warningIncompatible:
			"Esta conexión es incompatible con el sentido de sus carriles. Ajusta sus posiciones.",
	},
};

const readPanel = (page) =>
	page.evaluate(() => {
		const panel = document.getElementById("linkDraftPanel");
		return {
			label: panel.getAttribute("aria-label"),
			status: document.getElementById("linkDraftStatus").textContent.trim(),
			source: document
				.querySelector('label[for="linkSourceStreet"]')
				.textContent.trim(),
			destination: document
				.querySelector('label[for="linkDestinationStreet"]')
				.textContent.trim(),
			reverse: document
				.getElementById("linkDirectionReverse")
				.textContent.trim(),
			type: document
				.querySelector('label[for="linkTypeSelect"]')
				.textContent.trim(),
			typeOptions: [...document.querySelectorAll("#linkTypeSelect option")].map(
				(option) => option.textContent.trim(),
			),
			typeValues: [...document.querySelectorAll("#linkTypeSelect option")].map(
				(option) => option.value,
			),
			save: document.getElementById("linkSaveButton").textContent.trim(),
			cancel: document.getElementById("linkCancelButton").textContent.trim(),
			addExit: document.getElementById("linkAddExit").textContent.trim(),
			rowLabels: [
				...document.querySelectorAll(
					'#linkMappingRows [data-testid="link-mapping-row"]:first-child label',
				),
			].map((label) => label.textContent.trim()),
		};
	});

const runConnectionWorkflow = async ({ page, language }) => {
	const labels = copy[language];
	await hideLoadingScreen(page);
	await clearToasts(page);
	await openAccordion(page, "#collapseMapDrawingTools");
	await page.evaluate(() => window.streetEditPause());

	const source = await makeStreet(page, {
		name: "Source",
		x: 0.2,
		y: 0.2,
		lanes: 3,
	});
	const destination = await makeStreet(page, {
		name: "Destination",
		x: 0.7,
		y: 0.2,
		lanes: 2,
	});
	const reversed = await makeStreet(page, {
		name: "Reversed destination",
		x: 0.7,
		y: 0.6,
		lanes: 2,
	});
	const safeSource = await makeStreet(page, {
		name: '<b>Main</b> & "A"',
		x: 0.25,
		y: 0.8,
		lanes: 2,
	});
	const safeDestination = await makeStreet(page, {
		name: "Safe destination",
		x: 0.7,
		y: 0.8,
		lanes: 2,
	});
	const legacySource = await makeStreet(page, {
		name: "Legacy source",
		x: 0.2,
		y: 0.5,
		lanes: 2,
	});
	const legacyTarget = await makeStreet(page, {
		name: "Legacy target",
		x: 0.5,
		y: 0.5,
		lanes: 2,
	});
	await page.evaluate(
		({ id }) => {
			const street = window.calles.find((item) => item.id === id);
			street.laneDirections = [-1, 1];
			window.cellGeometryIndex?.invalidate(street);
		},
		{ id: reversed.id },
	);

	const initial = await connectionCount(page);
	const tools = await page.evaluate(() => ({
		create: document.getElementById("createLinkButton").textContent.trim(),
		add: document.getElementById("btnAgregarConexion").textContent.trim(),
		addTooltip: document
			.getElementById("btnAgregarConexion")
			.getAttribute("data-bs-title"),
	}));
	expect(tools).toEqual({
		create: labels.createLink,
		add: labels.addButton,
		addTooltip: labels.addTooltip,
	});

	// Panel entry, source selection, correction, and Lineal fixed review.
	await page.click("#createLinkButton");
	await page.waitForFunction(
		() => document.getElementById("linkDraftPanel").hidden === false,
	);
	let panel = await readPanel(page);
	expect(panel.label).toBe(labels.panelLabel);
	expect(panel.status).toBe(labels.draftStatusChooseSource);
	expect(panel.source).toBe(labels.panelSource);
	expect(panel.destination).toBe(labels.panelDestination);
	expect(panel.type).toBe(labels.panelType);
	expect(panel.typeOptions).toEqual(labels.types);
	expect(panel.typeValues).toEqual([
		"LINEAL",
		"INCORPORACION",
		"PROBABILISTICA",
	]);
	expect(panel.save).toBe(labels.panelSave);
	expect(panel.cancel).toBe(labels.cancel);
	expect(panel.addExit).toBe(
		language === "en" ? "＋ Add exit" : "＋ Añadir salida",
	);

	await page.select("#linkSourceStreet", safeSource.id);
	expect(
		await page.$eval("#linkDraftStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(
		language === "en"
			? 'Source: <b>Main</b> & "A". Choose another street as the destination.'
			: 'Origen: <b>Main</b> & "A". Elige otra calle como destino.',
	);
	await page.select("#linkDestinationStreet", safeSource.id);
	expect(
		await page.$eval("#linkDraftStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.draftStatusSameStreet);
	await page.select("#linkDestinationStreet", safeDestination.id);
	expect(
		await page.$eval("#linkDraftStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.draftStatusReview);
	await closeDraft(page);

	await openDraft(page, source.id, destination.id, "LINEAL");
	const linealSummary = await page.$eval(
		'[data-testid="link-lineal-summary"]',
		(element) => element.textContent.trim(),
	);
	expect(linealSummary).toBe(labels.linealSummary);
	expect(
		await page.$eval('[data-testid="link-unmatched-lane"]', (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.unmatched);
	await page.click("#linkSaveButton");
	await page.waitForFunction(
		(count) => window.conexiones.length === count + 2,
		{},
		initial,
	);

	// Saved-link list, localized search, safe names, and edit reopening.
	await page.$eval("#btnMostrarListaConexiones", (button) => button.click());
	await page.waitForFunction(
		() =>
			getComputedStyle(document.getElementById("listaConexionesContainer"))
				.display !== "none",
	);
	const list = await page.evaluate(() => ({
		title: document
			.querySelector('h6[data-i18n="streetConnection.list.title"]')
			.textContent.trim(),
		show: document
			.getElementById("btnMostrarListaConexiones")
			.textContent.trim(),
		showTooltip: document
			.getElementById("btnMostrarListaConexiones")
			.getAttribute("data-bs-title"),
		searchPlaceholder: document
			.getElementById("linkSearchInput")
			.getAttribute("placeholder"),
		searchLabel: document
			.getElementById("linkSearchInput")
			.getAttribute("aria-label"),
		editTitle: document
			.querySelector('#listaConexiones button[onclick^="editarConexion"]')
			?.getAttribute("title"),
		editLabel: document
			.querySelector('#listaConexiones button[onclick^="editarConexion"]')
			?.getAttribute("aria-label"),
		deleteTitle: document
			.querySelector('#listaConexiones button[onclick^="eliminarConexion"]')
			?.getAttribute("title"),
	}));
	expect(list.title).toBe(labels.listTitle);
	expect(list.show).toBe(
		language === "en" ? "🔼 Hide Connections" : "🔼 Ocultar Conexiones",
	);
	expect(list.showTooltip).toBe(labels.listShowTooltip);
	expect(list.searchPlaceholder).toBe(labels.listSearchPlaceholder);
	expect(list.searchLabel).toBe(labels.listSearchLabel);
	expect(list.editTitle).toBe(labels.listEdit);
	expect(list.editLabel).toBe(labels.listEdit);
	expect(list.deleteTitle).toBe(labels.listDelete);

	await page.$eval("#linkSearchInput", (input) => {
		input.value = "no-such-street";
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	expect(
		await page.$eval("#listaConexiones .list-group-item", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.listNoMatches);
	await page.$eval("#linkSearchInput", (input) => {
		input.value = "";
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});

	const linealEditIndex = await page.evaluate(
		({ sourceId, destinationId }) =>
			window.conexiones.findIndex(
				(link) =>
					link.origen.id === sourceId &&
					link.destino.id === destinationId &&
					link.tipo === window.TIPOS_CONEXION.LINEAL,
			),
		{ sourceId: source.id, destinationId: destination.id },
	);
	await page.evaluate((index) => {
		const button = [
			...document.querySelectorAll(
				'#listaConexiones button[onclick^="editarConexion"]',
			),
		].find((element) => element.getAttribute("onclick").includes(`(${index})`));
		button.click();
	}, linealEditIndex);
	await page.waitForFunction(
		() => document.getElementById("linkDraftPanel").hidden === false,
	);
	expect(
		await page.$eval("#linkDraftStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.draftStatusEditLineal);
	await closeDraft(page);
	expect(await connectionCount(page)).toBe(initial + 2);

	// Incorporation rows, per-lane enablement, and incomplete-draft validation.
	await openDraft(page, source.id, reversed.id, "INCORPORACION");
	panel = await readPanel(page);
	expect(panel.rowLabels).toEqual([
		labels.rowConnectLane,
		labels.rowSourceLane,
		labels.rowDestinationLane,
		labels.rowDestinationCell,
	]);
	let rows = await readRows(page);
	expect(rows).toHaveLength(3);
	expect(rows.map((row) => Number(row["source-lane"]))).toEqual([0, 1, 2]);
	expect(
		await page.$$eval(
			'#linkMappingRows [data-testid="link-fixed-source-cell"]',
			(elements) => elements.map((element) => element.textContent.trim()),
		),
	).toEqual(
		language === "en"
			? [
					"Source cell: last exit of lane 1 (15)",
					"Source cell: last exit of lane 2 (15)",
					"Source cell: last exit of lane 3 (15)",
				]
			: [
					"Celda origen: última salida del carril 1 (15)",
					"Celda origen: última salida del carril 2 (15)",
					"Celda origen: última salida del carril 3 (15)",
				],
	);
	const laneToggle = (index) =>
		`#linkMappingRows [data-testid="link-mapping-row"]:nth-child(${index + 1}) [data-testid="link-lane-enabled"]`;
	for (const index of [0, 1, 2]) await page.click(laneToggle(index));
	await page.click("#linkSaveButton");
	expect(await connectionCount(page)).toBe(initial + 2);
	expect(
		await page.$eval("#linkDraftMessage", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.noMappings);
	await page.click(laneToggle(0));
	await page.click(laneToggle(1));
	await page.click("#linkSaveButton");
	await page.waitForFunction(
		(count) => window.conexiones.length === count + 4,
		{},
		initial,
	);

	// Probabilistic correction, incomplete cells, map picking, and duplicate validation.
	await openDraft(page, source.id, destination.id, "PROBABILISTICA");
	panel = await readPanel(page);
	expect(panel.rowLabels).toEqual([
		labels.rowSourceLane,
		labels.rowSourceCell,
		labels.rowDestinationLane,
		labels.rowDestinationCell,
		labels.rowChance,
	]);
	expect(
		await page.$eval(
			'#linkMappingRows [data-testid="link-mapping-row"] [data-testid="link-pick-source"]',
			(element) => element.getAttribute("aria-label"),
		),
	).toBe(
		language === "en"
			? "Choose source on the map for mapping 1"
			: "Elegir origen en el mapa para la correspondencia 1",
	);
	await setRow(page, 0, "chance", 150);
	await page.click("#linkSaveButton");
	expect(await connectionCount(page)).toBe(initial + 4);
	expect(
		await page.$eval("#linkDraftMessage", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.invalidMapping);
	await setRow(page, 0, "destination-cell", "");
	await page.click("#linkSaveButton");
	expect(
		await page.$eval("#linkDraftMessage", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.incomplete);
	await setRow(page, 0, "chance", 50);
	await setRow(page, 0, "destination-lane", 1);
	await setRow(page, 0, "destination-cell", 5);
	await page.click("#linkAddExit");
	await page.waitForFunction(
		() =>
			document.querySelectorAll(
				'#linkMappingRows [data-testid="link-mapping-row"]',
			).length === 2,
	);
	expect(
		await page.$eval(
			'#linkMappingRows [data-testid="link-mapping-row"]:nth-child(2) [data-testid="link-pick-destination"]',
			(element) => element.getAttribute("aria-label"),
		),
	).toBe(
		language === "en"
			? "Choose destination on the map for mapping 2"
			: "Elegir destino en el mapa para la correspondencia 2",
	);

	await clickRowPick(page, 1, "destination");
	expect(
		await page.$eval("#linkMapPickStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(
		language === "en"
			? "Mapping 2: choose a destination cell in “Destination”. Escape cancels."
			: "Correspondencia 2: elige una celda de destino en «Destination». Escape cancela.",
	);
	await clickCell(page, source.id, 0, 4);
	expect(
		await page.$eval("#linkMapPickStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(
		language === "en"
			? "Mapping 2: wrong street. Choose a destination cell in “Destination”."
			: "Correspondencia 2: calle incorrecta. Elige una celda de destino en «Destination».",
	);
	await clickCell(page, destination.id, 1, 7);
	expect(
		await page.$eval("#linkMapPickStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.pickApplied);
	rows = await readRows(page);
	expect([
		Number(rows[1]["destination-lane"]),
		Number(rows[1]["destination-cell"]),
	]).toEqual([1, 7]);
	await page.click("#linkSaveButton");
	await page.waitForFunction(
		(count) => window.conexiones.length === count + 6,
		{},
		initial,
	);

	await openDraft(page, source.id, destination.id, "PROBABILISTICA");
	await setRow(page, 0, "chance", 50);
	await setRow(page, 0, "destination-lane", 1);
	await setRow(page, 0, "destination-cell", 5);
	await page.click("#linkSaveButton");
	expect(await connectionCount(page)).toBe(initial + 6);
	expect(
		await page.$eval("#linkDraftMessage", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.duplicate);
	await closeDraft(page);

	// Incompatible direction and missing cells in a draft.
	await openDraft(page, source.id, reversed.id, "PROBABILISTICA");
	await setRow(page, 0, "destination-cell", 0);
	await page.click("#linkSaveButton");
	expect(
		await page.$eval("#linkDraftMessage", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.invalidMapping);
	await closeDraft(page);

	// Reopen a saved probabilistic mapping, change it, then cancel another edit.
	const probabilisticIndex = await page.evaluate(
		({ sourceId, destinationId }) =>
			window.conexiones.findIndex(
				(link) =>
					link.origen.id === sourceId &&
					link.destino.id === destinationId &&
					link.tipo === window.TIPOS_CONEXION.PROBABILISTICA &&
					Math.round(link.probabilidadTransferencia * 100) === 50,
			),
		{ sourceId: source.id, destinationId: destination.id },
	);
	await page.evaluate(
		(index) => window.createLinkTool.edit(window.conexiones[index]),
		probabilisticIndex,
	);
	await page.waitForFunction(
		() => document.getElementById("linkDraftPanel").hidden === false,
	);
	expect(
		await page.$eval("#linkDraftStatus", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.draftStatusEdit);
	expect(
		await page.$eval(
			'#linkMappingRows [data-testid="link-mapping-row"] [data-testid="chance"]',
			(element) => element.value,
		),
	).toBe("50");
	await setRow(page, 0, "destination-cell", 6);
	await page.click("#linkSaveButton");
	await page.waitForFunction(
		() => document.getElementById("linkDraftPanel").hidden,
	);
	expect(await connectionCount(page)).toBe(initial + 6);
	expect(
		await page.evaluate(
			(index) => window.conexiones[index].posDestino,
			probabilisticIndex,
		),
	).toBe(6);
	await page.evaluate(
		(index) => window.createLinkTool.edit(window.conexiones[index]),
		probabilisticIndex,
	);
	await page.waitForFunction(
		() => document.getElementById("linkDraftPanel").hidden === false,
	);
	await setRow(page, 0, "destination-cell", 8);
	await closeDraft(page);
	expect(
		await page.evaluate(
			(index) => window.conexiones[index].posDestino,
			probabilisticIndex,
		),
	).toBe(6);

	// Legacy creation modal: static labels, endpoint validation, type-specific
	// controls, incomplete exits, and a successful typed creation.
	await clearToasts(page);
	await page.evaluate(() => window.mostrarDialogoNuevaConexion());
	await page.waitForSelector("#modalNuevaConexion.show", { visible: true });
	await new Promise((resolve) => setTimeout(resolve, 500));
	const legacy = await page.evaluate(() => ({
		title: document
			.getElementById("modalNuevaConexionLabel")
			.textContent.trim(),
		origin: document
			.querySelector('label[for="selectCalleOrigen"]')
			.textContent.trim(),
		destination: document
			.querySelector('label[for="selectCalleDestino"]')
			.textContent.trim(),
		type: document
			.querySelector('label[for="selectTipoConexion"]')
			.textContent.trim(),
		types: [...document.querySelectorAll("#selectTipoConexion option")].map(
			(option) => option.textContent.trim(),
		),
		create: document
			.getElementById("btnConfirmarNuevaConexion")
			.textContent.trim(),
		cancel: document
			.querySelector("#modalNuevaConexion .modal-footer .btn-secondary")
			.textContent.trim(),
		createTooltip: document
			.getElementById("btnConfirmarNuevaConexion")
			.getAttribute("data-bs-title"),
		cancelTooltip: document
			.querySelector("#modalNuevaConexion .modal-footer .btn-secondary")
			.getAttribute("data-bs-title"),
	}));
	expect(legacy.title).toBe(
		language === "en" ? "🔗 Add New Connection" : "🔗 Agregar Nueva Conexión",
	);
	expect(legacy.origin).toBe(
		language === "en" ? "Source street:" : "Calle origen:",
	);
	expect(legacy.destination).toBe(
		language === "en" ? "Destination street:" : "Calle destino:",
	);
	expect(legacy.type).toBe(
		language === "en" ? "Connection type:" : "Tipo de conexión:",
	);
	expect(legacy.types[0]).toBe(
		language === "en" ? "🟢 Linear (1 to 1)" : "🟢 Lineal (1 a 1)",
	);
	expect(legacy.types[2]).toBe(labels.legacyTypeProbabilistic);
	expect(legacy.create).toBe(labels.legacyCreate);
	expect(legacy.cancel).toBe(labels.cancel);
	expect(legacy.createTooltip.length).toBeGreaterThan(10);
	expect(legacy.cancelTooltip.length).toBeGreaterThan(10);

	await page.click("#btnConfirmarNuevaConexion");
	let toast = await waitForToast(page);
	expect(toast.header).toContain("bg-danger");
	expect(toast.body).toBe(labels.sourceStreetError);
	expect(toast.markup).toBe(0);

	const legacyIndexes = await page.evaluate(
		({ sourceId, targetId }) => {
			const source = window.calles.findIndex(
				(street) => street.id === sourceId,
			);
			const target = window.calles.findIndex(
				(street) => street.id === targetId,
			);
			return { source, target };
		},
		{ sourceId: legacySource.id, targetId: legacyTarget.id },
	);
	await page.select("#selectCalleOrigen", String(legacyIndexes.source));
	await page.select("#selectCalleDestino", String(legacyIndexes.source));
	await page.click("#btnConfirmarNuevaConexion");
	toast = await waitForToast(page);
	expect(toast.header).toContain("bg-danger");
	expect(toast.body).toBe(labels.sameStreet);

	await page.select("#selectCalleDestino", String(legacyIndexes.target));
	await page.select("#selectTipoConexion", "PROBABILISTICA");
	await page.waitForFunction(
		() =>
			document.querySelectorAll(
				"#contenedorDistribucionesProbabilisticas .accordion-item",
			).length === 2,
	);
	const legacyProbabilistic = await page.evaluate(() => ({
		heading: document
			.querySelector(
				"#contenedorDistribucionesProbabilisticas .form-label.fw-bold",
			)
			.textContent.trim(),
		exitTitles: [
			...document.querySelectorAll(
				"#contenedorDistribucionesProbabilisticas .accordion-button",
			),
		].map((button) => button.textContent.trim()),
		laneOptions: [
			...document.querySelectorAll("#carrilDestinoSalida0 option"),
		].map((option) => option.textContent.trim()),
		labels: [
			...document.querySelectorAll(
				"#contenedorDistribucionesProbabilisticas .accordion-item:first-child .form-label.small",
			),
		].map((label) => label.textContent.trim()),
		important: document
			.querySelector(
				"#contenedorDistribucionesProbabilisticas .alert-warning strong",
			)
			.textContent.trim(),
	}));
	expect(legacyProbabilistic.heading).toContain(
		language === "en" ? "Exit Configuration" : "Configuración de salidas",
	);
	expect(legacyProbabilistic.heading).toContain(
		language === "en" ? "2 lanes available" : "2 carriles disponibles",
	);
	expect(legacyProbabilistic.exitTitles).toEqual(
		language === "en"
			? ["🎯 Exit 1", "🎯 Exit 2"]
			: ["🎯 Salida 1", "🎯 Salida 2"],
	);
	expect(legacyProbabilistic.laneOptions).toEqual([
		language === "en" ? "Lane 1" : "Carril 1",
		language === "en" ? "Lane 2" : "Carril 2",
	]);
	expect(legacyProbabilistic.labels).toEqual([
		labels.rowDestinationLane,
		labels.rowChance,
		language === "en" ? "Source position (cell)" : "Posición origen (celda)",
		language === "en"
			? "Destination position (cell)"
			: "Posición destino (celda)",
	]);
	expect(legacyProbabilistic.important).toBe(
		language === "en" ? "⚠️ Important:" : "⚠️ Importante:",
	);

	await fill(page, "#probSalida0", 0);
	await fill(page, "#probSalida1", 0);
	await page.click("#btnConfirmarNuevaConexion");
	toast = await waitForToast(page);
	expect(toast.header).toContain("bg-danger");
	expect(toast.body).toBe(
		language === "en"
			? "Configure at least one exit with a probability greater than 0%."
			: "Debes configurar al menos una salida con una probabilidad mayor a 0 %.",
	);

	await fill(page, "#probSalida0", 60);
	await fill(page, "#probSalida1", 40);
	const beforeLegacy = await connectionCount(page);
	await page.click("#btnConfirmarNuevaConexion");
	toast = await waitForToast(page);
	expect(toast.header).toContain("bg-success");
	expect(toast.body).toBe(labels.createSuccess);
	expect(toast.markup).toBe(0);
	await page.waitForSelector("#modalNuevaConexion", { hidden: true });
	await page.waitForFunction(() => !document.querySelector(".modal-backdrop"), {
		polling: 100,
	});
	await page.waitForFunction(
		(count) => window.conexiones.length === count + 2,
		{},
		beforeLegacy,
	);
	const createdLegacy = await page.evaluate(() =>
		window.conexiones.slice(-2).map((link) => ({
			type: link.tipo,
			sourceLane: link.carrilOrigen,
			destinationLane: link.carrilDestino,
			chance: link.probabilidadTransferencia,
		})),
	);
	expect(createdLegacy.map((link) => link.type)).toEqual([
		"probabilistica",
		"probabilistica",
	]);
	expect(
		createdLegacy.map((link) => [link.destinationLane, link.chance]),
	).toEqual([
		[0, 0.6],
		[1, 0.4],
	]);

	// Legacy edit: labels, dynamic review, invalid probability, and success.
	const legacyEditIndex = await page.evaluate(
		({ sourceId, targetId }) =>
			window.conexiones.findIndex(
				(link) =>
					link.origen.id === sourceId &&
					link.destino.id === targetId &&
					link.tipo === window.TIPOS_CONEXION.PROBABILISTICA,
			),
		{ sourceId: legacySource.id, targetId: legacyTarget.id },
	);
	await page.evaluate((index) => window.editarConexion(index), legacyEditIndex);
	await page.waitForSelector("#modalEditarConexion.show", { visible: true });
	const legacyEdit = await page.evaluate(() => ({
		title: document
			.getElementById("modalEditarConexionLabel")
			.textContent.trim(),
		connection: document
			.querySelector("#modalEditarConexion .alert strong")
			.textContent.trim(),
		update: document
			.getElementById("btnConfirmarEditarConexion")
			.textContent.trim(),
		updateTooltip: document
			.getElementById("btnConfirmarEditarConexion")
			.getAttribute("data-bs-title"),
		info: document.getElementById("editConexionInfo").textContent.trim(),
		editIndividual: document
			.querySelector("#editContenedorDistribucionesProbabilisticas .alert")
			.textContent.trim(),
	}));
	expect(legacyEdit.title).toBe(
		language === "en" ? "✏️ Edit Connection" : "✏️ Editar Conexión",
	);
	expect(legacyEdit.connection).toBe(
		language === "en" ? "Street connection:" : "Conexión:",
	);
	expect(legacyEdit.update).toBe(labels.legacyUpdate);
	expect(legacyEdit.updateTooltip.length).toBeGreaterThan(10);
	expect(legacyEdit.info).toContain("Legacy source");
	expect(legacyEdit.editIndividual).toContain(
		language === "en"
			? "Editing individual connection"
			: "Editando conexión individual",
	);
	await fill(page, "#editProbSalidaUnica", 150);
	await page.click("#btnConfirmarEditarConexion");
	toast = await waitForToast(page);
	expect(toast.header).toContain("bg-danger");
	expect(toast.body).toBe(
		language === "en"
			? "The probability must be between 0 and 100%."
			: "La probabilidad debe estar entre 0 y 100 %.",
	);
	await fill(page, "#editProbSalidaUnica", 40);
	await page.click("#btnConfirmarEditarConexion");
	toast = await waitForToast(page);
	expect(toast.header).toContain("bg-success");
	expect(toast.body).toBe(labels.updateSuccess);
	await page.waitForSelector("#modalEditarConexion", { hidden: true });
	await page.waitForFunction(() => !document.querySelector(".modal-backdrop"), {
		polling: 100,
	});
	expect(
		await page.evaluate(
			(index) => window.conexiones[index].probabilidadTransferencia,
			legacyEditIndex,
		),
	).toBe(0.4);

	// Legacy delete confirmation and success toast.
	const beforeDelete = await connectionCount(page);
	await page.evaluate((index) => {
		window.__connectionConfirmation = null;
		window.confirm = (message) => {
			window.__connectionConfirmation = message;
			return false;
		};
		window.eliminarConexion(index);
	}, legacyEditIndex);
	expect(await page.evaluate(() => window.__connectionConfirmation)).toBe(
		language === "en"
			? "Delete the street connection between “Legacy source” and “Legacy target”?"
			: "¿Eliminar la conexión entre «Legacy source» y «Legacy target»?",
	);
	expect(await connectionCount(page)).toBe(beforeDelete);
	await page.evaluate(() => {
		window.confirm = () => true;
	});
	await page.evaluate(
		(index) => window.eliminarConexion(index),
		legacyEditIndex,
	);
	toast = await waitForToast(page);
	expect(toast.header).toContain("bg-success");
	expect(toast.body).toBe(labels.deleted);
	expect(await connectionCount(page)).toBe(beforeDelete - 1);

	// Warning severity: an incompatible legacy edit is rejected and rolled back.
	await page.evaluate(
		({ sourceId, destinationId }) => {
			const source = window.calles.find((street) => street.id === sourceId);
			const destination = window.calles.find(
				(street) => street.id === destinationId,
			);
			const link = new window.ConexionCA(
				source,
				destination,
				0,
				0,
				0,
				0,
				1,
				window.TIPOS_CONEXION.PROBABILISTICA,
			);
			window.conexiones.push(link);
			window.registrarConexiones([link]);
			return link;
		},
		{ sourceId: reversed.id, destinationId: source.id },
	);
	const warningIndex = await page.evaluate(() => window.conexiones.length - 1);
	await page.evaluate((index) => window.editarConexion(index), warningIndex);
	await page.waitForSelector("#modalEditarConexion.show", { visible: true });
	await fill(page, "#editPosOrigenSalidaUnica", 16);
	await page.click("#btnConfirmarEditarConexion");
	toast = await waitForToast(page);
	expect(toast.header).toContain("bg-warning");
	expect(toast.body).toBe(labels.warningIncompatible);
	expect(
		await page.evaluate(
			(index) => window.conexiones[index].posOrigen,
			warningIndex,
		),
	).toBe(0);
	await closeLegacyModal(page, "modalEditarConexion");

	// Duplicate validation with safe HTML-significant street names.
	await clearToasts(page);
	const beforeSafe = await connectionCount(page);
	await openDraft(page, safeSource.id, safeDestination.id, "LINEAL");
	await page.click("#linkSaveButton");
	await page.waitForFunction(
		(count) => window.conexiones.length === count + 2,
		{},
		beforeSafe,
	);
	await page.evaluate(() =>
		window.actualizarListaConexiones(window.calleSeleccionada),
	);
	const safeListItem = await page.evaluate((name) => {
		const item = [
			...document.querySelectorAll("#listaConexiones .list-group-item-action"),
		].find((element) => element.textContent.includes(name));
		return {
			found: Boolean(item),
			literal: item?.textContent.includes(name),
			markup: item?.querySelectorAll("b").length ?? 0,
		};
	}, safeSource.name);
	expect(safeListItem).toEqual({ found: true, literal: true, markup: 0 });
	const safeIndexes = await page.evaluate(
		({ sourceName, destinationName }) => ({
			sourceIndex: window.calles.findIndex(
				(street) => street.nombre === sourceName,
			),
			destinationIndex: window.calles.findIndex(
				(street) => street.nombre === destinationName,
			),
		}),
		{ sourceName: safeSource.name, destinationName: safeDestination.name },
	);
	expect(safeIndexes.sourceIndex).toBeGreaterThan(-1);
	await page.evaluate(() => window.mostrarDialogoNuevaConexion());
	await page.waitForSelector("#modalNuevaConexion.show", { visible: true });
	await page.select("#selectCalleOrigen", String(safeIndexes.sourceIndex));
	await page.select(
		"#selectCalleDestino",
		String(safeIndexes.destinationIndex),
	);
	await page.select("#selectTipoConexion", "LINEAL");
	await page.click("#btnConfirmarNuevaConexion");
	toast = await waitForToast(page);
	expect(toast.header).toContain("bg-danger");
	expect(toast.body).toContain(safeSource.name);
	expect(toast.body).toContain(safeDestination.name);
	expect(toast.markup).toBe(0);
	await closeLegacyModal(page, "modalNuevaConexion");

	// Desktop dark theme keeps the translated draft panel and saved-link list readable.
	await page.$eval("#switchModoOscuro", (element) => element.click());
	await page.waitForFunction(
		() => document.body.classList.contains("dark-mode"),
		{ polling: 100 },
	);
	await openAccordion(page, "#collapseMapDrawingTools");
	await openDraft(page, source.id, destination.id, "LINEAL");
	const darkPanel = await page.evaluate(() => {
		const panel = document.getElementById("linkDraftPanel");
		const rect = panel.getBoundingClientRect();
		const style = getComputedStyle(panel);
		return {
			fits:
				rect.left >= -1 &&
				rect.right <= window.innerWidth + 1 &&
				rect.top >= -1 &&
				rect.bottom <= window.innerHeight + 1,
			readable:
				style.color !== "rgba(0, 0, 0, 0)" &&
				style.color !== style.backgroundColor,
			save: document.getElementById("linkSaveButton").textContent.trim(),
			listTitle: document
				.querySelector('h6[data-i18n="streetConnection.list.title"]')
				.textContent.trim(),
		};
	});
	expect(darkPanel.fits).toBe(true);
	expect(darkPanel.readable).toBe(true);
	expect(darkPanel.save).toBe(labels.panelSave);
	expect(darkPanel.listTitle).toBe(labels.listTitle);
	await closeDraft(page);

	const snapshot = await modelSnapshot(page);
	expect(snapshot.connections.length).toBe(beforeSafe + 2);
	return snapshot;
};

describe("street connection drafting and editing localization", () => {
	for (const usePixi of [false, true]) {
		it(`drafts, edits, validates, and deletes street connections identically in Spanish and English with ${usePixi ? "Pixi" : "Canvas"}`, async () => {
			const snapshots = [];
			for (const language of ["es", "en"]) {
				const simulator = await openSimulator({
					usePixi,
					languagePreference: language,
					freezeFrames: true,
				});
				try {
					const { page } = simulator;
					if (usePixi) {
						await page.waitForFunction(
							() => Boolean(window.pixiApp?.sceneManager),
							{ timeout: 60000, polling: 100 },
						);
					}
					snapshots.push(await runConnectionWorkflow({ page, language }));
					expect(simulator.pageErrors).toEqual([]);
				} finally {
					await simulator.close();
				}
			}
			expect(snapshots[1]).toEqual(snapshots[0]);
		}, 180000);
	}
});

describe("street connection controls at mobile sizes and in both themes", () => {
	it("keeps translated drafting, list, and legacy connection controls reachable", async () => {
		const simulator = await openSimulator({ languagePreference: "en" });
		try {
			const { page } = simulator;
			await page.setViewport({ width: 390, height: 844 });
			await hideLoadingScreen(page);
			await page.evaluate(() => window.streetEditPause());
			const street = await makeStreet(page, {
				name: "Mobile source",
				x: 0.5,
				y: 0.5,
				lanes: 2,
			});
			const target = await makeStreet(page, {
				name: "Mobile target",
				x: 0.5,
				y: 0.8,
				lanes: 2,
			});

			for (const theme of ["light", "dark"]) {
				await new Promise((resolve) => setTimeout(resolve, 400));
				await ensureSidebar(page);
				if (theme === "dark") {
					await page.$eval("#switchModoOscuro", (element) => element.click());
					await page.waitForFunction(
						() => document.body.classList.contains("dark-mode"),
						{ polling: 100 },
					);
				}
				const fits = (selectors) =>
					page.evaluate((selectors) => {
						const elements = selectors.map((selector) =>
							document.querySelector(selector),
						);
						return {
							fit: elements.every((element) => {
								if (!element) return false;
								const rect = element.getBoundingClientRect();
								const style = getComputedStyle(element);
								return (
									style.display !== "none" &&
									style.visibility !== "hidden" &&
									rect.width > 0 &&
									rect.height > 0 &&
									rect.left >= -1 &&
									rect.right <= window.innerWidth + 1
								);
							}),
							overflow:
								document.documentElement.scrollWidth - window.innerWidth,
						};
					}, selectors);

				await openAccordion(page, "#collapseMapDrawingTools");
				let controls = await fits(["#createLinkButton"]);
				expect(controls.fit).toBe(true);
				expect(controls.overflow).toBeLessThanOrEqual(1);

				await openAccordion(page, "#collapseConstructor");
				controls = await fits([
					"#btnAgregarConexion",
					"#btnMostrarListaConexiones",
				]);
				expect(controls.fit).toBe(true);
				expect(controls.overflow).toBeLessThanOrEqual(1);

				await openAccordion(page, "#collapseMapDrawingTools");
				await openDraft(page, street.id, target.id, "PROBABILISTICA");
				const draft = await page.evaluate(() => {
					const panel = document
						.getElementById("linkDraftPanel")
						.getBoundingClientRect();
					return {
						fits:
							panel.left >= -1 &&
							panel.top >= -1 &&
							panel.right <= window.innerWidth + 1 &&
							panel.bottom <= window.innerHeight + 1,
						status: document
							.getElementById("linkDraftStatus")
							.textContent.trim(),
						save: document.getElementById("linkSaveButton").textContent.trim(),
					};
				});
				expect(draft.fits).toBe(true);
				expect(draft.save).toBe("Save connection");
				expect(draft.status).toBe("Review the mappings before saving.");
				await closeDraft(page);
				await ensureSidebar(page);

				await page.evaluate(() => window.mostrarDialogoNuevaConexion());
				await page.waitForSelector("#modalNuevaConexion.show", {
					visible: true,
				});
				await new Promise((resolve) => setTimeout(resolve, 500));
				const legacyModal = await page.evaluate(() => {
					const dialog = document
						.querySelector("#modalNuevaConexion .modal-dialog")
						.getBoundingClientRect();
					const body = document.querySelector(
						"#modalNuevaConexion .modal-body",
					);
					return {
						fits:
							dialog.left >= -1 &&
							dialog.top >= -1 &&
							dialog.right <= window.innerWidth + 1 &&
							dialog.bottom <= window.innerHeight + 1,
						overflow: body.scrollWidth - body.clientWidth,
						title: document
							.getElementById("modalNuevaConexionLabel")
							.textContent.trim(),
					};
				});
				expect(legacyModal.fits).toBe(true);
				expect(legacyModal.overflow).toBeLessThanOrEqual(1);
				expect(legacyModal.title).toBe("🔗 Add New Connection");
				await closeLegacyModal(page, "modalNuevaConexion");
			}
		} finally {
			await simulator.close();
		}
	}, 120000);
});
