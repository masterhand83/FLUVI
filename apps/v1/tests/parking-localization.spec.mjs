/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: one focused browser workflow drives both parking surfaces. */
import { describe, expect, it } from "vitest"
import { openSimulator } from "./helpers/simulator.mjs"

const ROAD_A = 'Parking <b> & "A"'
const ROAD_B = 'Parking <b> & "B"'
const BUILDING = 'Depot <b> & "A"'
const OTHER_BUILDING = 'Depot <b> & "B"'

const hideLoadingScreen = (page) =>
	page.evaluate(() => {
		window.hideLoadingScreen?.()
		document.getElementById("loadingScreen").style.display = "none"
	})

const clearToasts = (page) =>
	page.evaluate(() => {
		for (const toast of document.querySelectorAll(".toast")) toast.remove()
	})

const setSidebar = (page, open) =>
	page.evaluate((open) => {
		const sidebar = document.getElementById("sidebar")
		if (sidebar.classList.contains("hidden") === open) {
			document
				.getElementById(open ? "sidebarToggleFloat" : "sidebarToggle")
				.click()
		}
	}, open)

const waitForToast = async (page) => {
	await page.waitForFunction(
		() => document.querySelectorAll(".toast").length > 0,
		{ timeout: 5000, polling: 100 },
	)
	await new Promise((resolve) => setTimeout(resolve, 250))
	return page.$$eval(".toast", (elements) => {
		const toast = elements.at(-1)
		return {
			header: toast.querySelector(".toast-header").className,
			title: toast.querySelector(".toast-header strong").textContent,
			body: toast.querySelector(".toast-body").textContent,
			markup: toast.querySelectorAll(".toast-body *").length,
		}
	})
}

const edit = (page, selector, value) =>
	page.$eval(
		selector,
		(element, next) => {
			element.value = String(next)
			element.dispatchEvent(
				new Event(element.tagName === "SELECT" ? "change" : "input", {
					bubbles: true,
				}),
			)
		},
		value,
	)

const copy = {
	en: {
		inspector: {
			title: "Functional parking",
			toggle: "Functional parking",
			capacity: "Capacity",
			help: "Lane and cell: numbered from 1. Complete every pair to apply the connections.",
			addPair: "Add pair (maximum 10)",
			probabilities: "Hourly probabilities (%)",
			streetPlaceholder: "Select a street",
			streetLabel: "Entrance: street",
			lane: "Lane",
			cell: "Cell",
			removePair: "Remove pair",
			pair: "Pair 1",
			decorative: "Decorative building.",
			incomplete: "Not active: complete one valid entrance and exit per pair.",
			active: (occupied, capacity) =>
				`Active: ${occupied} / ${capacity} vehicles.`,
			probabilityInput: "Entrance, 00:00",
			probabilityError:
				"Entrance at 00:00: enter a probability between 0 and 100%.",
			capacityError: (minimum) =>
				`Capacity must be a positive integer and at least ${minimum} (current occupancy).`,
		},
		validation: {
			entranceStreetRequired:
				"Select an existing street for the entrance.",
			exitStreetRequired: "Select an existing street for the exit.",
			entranceEndpointInvalid: (street) =>
				`Check the entrance lane and cell on «${street}»: they must be integers inside the street.`,
			exitEndpointInvalid: (street) =>
				`Check the exit lane and cell on «${street}»: they must be integers inside the street.`,
			duplicateEndpoint:
				"Each entrance and exit must use a different cell.",
			endpointOwned: (lane, cell, street) =>
				`Cell ${cell} in lane ${lane} on «${street}» already belongs to another parking lot. Choose another cell.`,
			invalidConfiguration: (reason) =>
				`Parking cannot be configured: ${reason}`,
		},
		legacy: {
			title: "🅿️ Parking Settings",
			toggle: "Works as parking",
			capacity: "Maximum vehicle capacity:",
			connections: "Connections (Entrances/Exits):",
			importantLabel: "⚠️ Important:",
			importantBody:
				"Connections must come in pairs (1 entrance → 1 exit). Maximum 10 pairs.",
			overlapHelp:
				"The entrance and exit CANNOT use the same cell in the same lane.",
			addPair: "➕ Add Pair (Entrance + Exit)",
			probabilities: "Hourly Entrance/Exit Probabilities:",
			scheduleLabel: "⏰ Settings:",
			scheduleBody:
				"Adjust the probabilities for every hour of the day (0-23). Values range from 0% to 100%.",
			presets: ["Normal", "Office", "Shopping center"],
			entrancePercent: "🟢 Entrance (%)",
			exitPercent: "🔵 Exit (%)",
			pair: "Pair 1",
			removePair: "✖️ Remove",
			entrance: "🟢 ENTRANCE",
			exit: "🔵 EXIT",
			streetPlaceholder: "Street...",
			lanePlaceholder: "Lane (1-N)",
			cellPlaceholder: "Cell (1-N)",
			laneHintPlaceholder: "Lane 1 to N",
			cellHintPlaceholder: "Cell 1 to N",
			laneHint: "Lane 1 to 2",
			cellHint: "Cell 1 to 8",
			hour: "Hour 0:00",
			probabilityInput: "Entrance, 00:00",
			streetOption: (name) => `${name} (2 lanes, 8 cells)`,
			overlapError:
				"⚠️ Error: The entrance and exit cannot use the same cell in the same lane.",
			maxPairs: "A maximum of 10 connection pairs is allowed.",
		},
	},
	es: {
		inspector: {
			title: "Estacionamiento funcional",
			toggle: "Estacionamiento funcional",
			capacity: "Capacidad",
			help: "Carril y celda: numeración desde 1. Completa todos los pares para aplicar las conexiones.",
			addPair: "Añadir par (máximo 10)",
			probabilities: "Probabilidades por hora (%)",
			streetPlaceholder: "Selecciona una calle",
			streetLabel: "Entrada: calle",
			lane: "Carril",
			cell: "Celda",
			removePair: "Eliminar par",
			pair: "Par 1",
			decorative: "Edificio decorativo.",
			incomplete:
				"Sin activar: completa una entrada y una salida válidas por par.",
			active: (occupied, capacity) =>
				`Activo: ${occupied} / ${capacity} vehículos.`,
			probabilityInput: "Entrada, 00:00",
			probabilityError:
				"Entrada a las 00:00: introduce una probabilidad entre 0 y 100 %.",
			capacityError: (minimum) =>
				`La capacidad debe ser un entero positivo y al menos ${minimum} (ocupación actual).`,
		},
		validation: {
			entranceStreetRequired:
				"Selecciona una calle existente para la entrada.",
			exitStreetRequired: "Selecciona una calle existente para la salida.",
			entranceEndpointInvalid: (street) =>
				`Revisa el carril y la celda de la entrada en «${street}»: deben ser enteros dentro de la calle.`,
			exitEndpointInvalid: (street) =>
				`Revisa el carril y la celda de la salida en «${street}»: deben ser enteros dentro de la calle.`,
			duplicateEndpoint:
				"Cada entrada y salida debe usar una celda diferente.",
			endpointOwned: (lane, cell, street) =>
				`La celda ${cell} del carril ${lane} en «${street}» ya pertenece a otro estacionamiento. Elige otra celda.`,
			invalidConfiguration: (reason) =>
				`No se puede configurar el estacionamiento: ${reason}`,
		},
		legacy: {
			title: "🅿️ Configuración de Estacionamiento",
			toggle: "Funciona como estacionamiento",
			capacity: "Capacidad máxima de vehículos:",
			connections: "Conexiones (Entradas/Salidas):",
			importantLabel: "⚠️ Importante:",
			importantBody:
				"Las conexiones deben venir en pares (1 entrada → 1 salida). Máximo 10 pares.",
			overlapHelp:
				"La entrada y salida NO pueden estar en la misma celda del mismo carril.",
			addPair: "➕ Agregar Par (Entrada + Salida)",
			probabilities: "Probabilidades de Entrada/Salida por Hora:",
			scheduleLabel: "⏰ Configuración:",
			scheduleBody:
				"Ajusta las probabilidades para cada hora del día (0-23). Los valores van de 0% a 100%.",
			presets: ["Normal", "Oficina", "Centro Comercial"],
			entrancePercent: "🟢 Entrada (%)",
			exitPercent: "🔵 Salida (%)",
			pair: "Par 1",
			removePair: "✖️ Eliminar",
			entrance: "🟢 ENTRADA",
			exit: "🔵 SALIDA",
			streetPlaceholder: "Calle...",
			lanePlaceholder: "Carril (1-N)",
			cellPlaceholder: "Posición (1-N)",
			laneHintPlaceholder: "Carril 1 a N",
			cellHintPlaceholder: "Posición 1 a N",
			laneHint: "Carril 1 a 2",
			cellHint: "Posición 1 a 8",
			hour: "Hora 0:00",
			probabilityInput: "Entrada, 00:00",
			streetOption: (name) => `${name} (2 carriles, 8 celdas)`,
			overlapError:
				"⚠️ Error: La entrada y salida no pueden estar en la misma celda del mismo carril.",
			maxPairs: "Máximo 10 pares de conexiones permitidos.",
		},
	},
}

async function ready(sim, usePixi) {
	if (usePixi) {
		await sim.page.waitForFunction(
			() => Boolean(window.pixiApp?.sceneManager?.edificioRenderer),
			{ timeout: 60000, polling: 100 },
		)
	}
	await hideLoadingScreen(sim.page)
	await sim.page.evaluate(() => {
		window.confirm = () => true
		window.alert = () => {}
	})
}

async function fixture(page) {
	await page.evaluate(() =>
		document.getElementById("btnNuevaSimulacion").click(),
	)
	await page.waitForFunction(
		() => window.edificios.length === 0 && window.calles.length === 0,
		{ timeout: 5000 },
	)
	await page.evaluate(
		({ roadA, roadB, building, otherBuilding }) => {
			const canvas = document.getElementById("simuladorCanvas")
			const screen = window.USE_PIXI ? window.pixiApp.app.screen : canvas
			const center = window.USE_PIXI
				? window.pixiApp.cameraController.screenToWorld(
						screen.width * 0.62,
						screen.height * 0.42,
					)
				: {
						x: (screen.width * 0.62 - window.offsetX) / window.escala,
						y: (screen.height * 0.42 - window.offsetY) / window.escala,
					}
			window.streetEditPause?.()
			window.crearCalle(
				roadA,
				8,
				window.TIPOS.CONEXION,
				center.x - 180,
				center.y + 170,
				0,
				0,
				2,
			)
			window.crearCalle(
				roadB,
				8,
				window.TIPOS.CONEXION,
				center.x + 40,
				center.y + 170,
				0,
				0,
				2,
			)
			window.actualizarSelectores?.()
			window.agregarEdificio(building, center.x, center.y, 120, 80, 0)
			window.agregarEdificio(
				otherBuilding,
				center.x,
				center.y - 140,
				90,
				60,
				0,
			)
			window.pixiApp?.sceneManager?.renderAll?.()
			const selector = document.getElementById("selectEdificio")
			selector.value = "0"
			selector.dispatchEvent(new Event("change", { bubbles: true }))
			window.edificioSeleccionado = window.edificios[0]
			window.buildingInspector.show(window.edificios[0])
			window.renderizarCanvas?.()
		},
		{
			roadA: ROAD_A,
			roadB: ROAD_B,
			building: BUILDING,
			otherBuilding: OTHER_BUILDING,
		},
	)
	await page.waitForSelector("#buildingInspectorParkingToggle", {
		visible: true,
		timeout: 5000,
	})
}

async function state(page, index = 0) {
	return page.evaluate((index) => {
		const building = window.edificios[index]
		const owned = window.calles.flatMap((road) =>
			[...(road.conexionesEstacionamiento || new Map())]
				.filter(([, connection]) => connection.edificio === building)
				.map(([key, connection]) => ({
					road: road.nombre,
					key,
					type: connection.tipo,
				})),
		)
		return {
			label: building.label,
			functional:
				window.edificioTieneConexionesEstacionamientoFuncionales(building),
			enabled: building.esEstacionamiento === true,
			connections: (building.conexiones || []).map((connection) => ({
				tipo: connection.tipo,
				calleId: connection.calleId,
				carril: connection.carril,
				indice: connection.indice,
			})),
			owned,
			capacity: building.capacidadMaxima,
			occupancy: building.vehiculosActuales || 0,
			entry: building.probabilidadesEntrada,
			exit: building.probabilidadesSalida,
			selected: window.edificioSeleccionado === building,
			streets: window.calles.map((road) => road.nombre),
		}
	}, index)
}

const structure = (snapshot) => ({
	functional: snapshot.functional,
	enabled: snapshot.enabled,
	connections: snapshot.connections,
	owned: snapshot.owned,
	capacity: snapshot.capacity,
	occupancy: snapshot.occupancy,
	entry: snapshot.entry,
	exit: snapshot.exit,
	label: snapshot.label,
	streets: snapshot.streets,
})

async function parkingText(page, selector) {
	return page.$eval(selector, (element) => element.textContent.trim())
}

async function pairLabel(page, question) {
	return page.$eval(
		`#buildingInspectorParkingPairs ${question}`,
		(element) => element.textContent.trim(),
	)
}

async function enableInspector(page) {
	await page.click("#buildingInspectorParkingToggle")
	await page.waitForSelector("#buildingInspectorParkingConfig", {
		visible: true,
	})
}

async function setPair(page, type, road, lane, cell) {
	const title = type === "entrada" ? "Entrada" : "Salida"
	await edit(
		page,
		`#buildingInspectorParkingPair0${title}Road`,
		road,
	)
	await edit(
		page,
		`#buildingInspectorParkingPair0${title}Lane`,
		lane,
	)
	await edit(
		page,
		`#buildingInspectorParkingPair0${title}Cell`,
		cell,
	)
}

async function openLegacy(page) {
	await page.evaluate(() => window.mostrarDialogoNuevoEdificio())
	await page.waitForSelector("#modalNuevoEdificio.show", { visible: true })
	await new Promise((resolve) => setTimeout(resolve, 600))
}

async function closeLegacy(page) {
	await page.$eval(
		"#modalNuevoEdificio [data-bs-dismiss='modal']",
		(button) => button.click(),
	)
	await page.waitForSelector("#modalNuevoEdificio", { hidden: true })
	await page.waitForFunction(() => !document.querySelector(".modal-backdrop"), {
		polling: 100,
	})
}

async function legacyLabels(page) {
	return page.evaluate(() => ({
		title: document
			.querySelector(
				'#modalNuevoEdificio h6[data-i18n="parking.legacy.title"]',
			)
			.textContent.trim(),
		toggle: document
			.querySelector('label[for="checkEstacionamiento"]')
			.textContent.trim(),
		capacity: document
			.querySelector('label[for="inputCapacidad"]')
			.textContent.trim(),
		connections: [...document.querySelectorAll("#modalNuevoEdificio .form-label")]
			.map((element) => element.textContent.trim())
			.find((text) => /Conexi|Connect/i.test(text)),
		importantLabel: document.querySelector(
			"#modalNuevoEdificio .alert-info strong",
		).textContent.trim(),
		importantBody: document.querySelector(
			"#modalNuevoEdificio .alert-info span",
		).textContent.trim(),
		overlapHelp: document.querySelector(
			"#modalNuevoEdificio .alert-info small",
		).textContent.trim(),
		addPair: document
			.querySelector("#modalNuevoEdificio .btn-primary[onclick*='agregarParConexion']")
			.textContent.trim(),
		probabilities: [...document.querySelectorAll("#modalNuevoEdificio .form-label")]
			.map((element) => element.textContent.trim())
			.find((text) => /Probabilidades|Probabilities/i.test(text)),
		scheduleLabel: document.querySelector(
			"#modalNuevoEdificio .alert-warning strong",
		).textContent.trim(),
		scheduleBody: document.querySelector(
			"#modalNuevoEdificio .alert-warning span",
		).textContent.trim(),
		presets: [
			...document.querySelectorAll(
				"#modalNuevoEdificio .btn-group button[onclick*='aplicarPerfilHorario']",
			),
		].map((element) => element.textContent.trim()),
		entrancePercent: document
			.querySelector("#modalNuevoEdificio [id='slidersProbEntrada']")
			.previousElementSibling.textContent.trim(),
		exitPercent: document
			.querySelector("#modalNuevoEdificio [id='slidersProbSalida']")
			.previousElementSibling.textContent.trim(),
	}))
}

const runParkingWorkflow = async ({ page, language, usePixi }) => {
	const labels = copy[language]
	await ready({ page }, usePixi)
	await clearToasts(page)
	await fixture(page)

	const inspector = {
		title: await page.$eval("#buildingInspectorParking", (element) =>
			element.getAttribute("aria-label"),
		),
		toggle: await page.$eval("#buildingInspectorParking label", (element) =>
			element.textContent.trim(),
		),
		capacity: await page.$eval(
			'#buildingInspectorParking label[data-i18n="parking.inspector.capacity"]',
			(element) => element.textContent.trim(),
		),
		help: await parkingText(
			page,
			'#buildingInspectorParking [data-i18n="parking.inspector.help"]',
		),
		addPair: await parkingText(page, "#buildingInspectorParkingAddPair"),
		probabilities: await parkingText(
			page,
			"#buildingInspectorParkingConfig summary",
		),
	}
	expect(inspector).toEqual({
		title: labels.inspector.title,
		toggle: labels.inspector.toggle,
		capacity: labels.inspector.capacity,
		help: labels.inspector.help,
		addPair: labels.inspector.addPair,
		probabilities: labels.inspector.probabilities,
	})
	expect(await parkingText(page, "#buildingInspectorParkingStatus")).toBe(
		labels.inspector.decorative,
	)

	await enableInspector(page)
	expect(await parkingText(page, "#buildingInspectorParkingStatus")).toBe(
		labels.inspector.incomplete,
	)
	expect(await parkingText(page, "#buildingInspectorParkingError")).toBe(
		labels.validation.entranceStreetRequired,
	)
	expect((await state(page)).owned).toEqual([])

	const pair = {
		legend: await pairLabel(page, "legend"),
		streetLabel: await page.$eval(
			'#buildingInspectorParkingPairs label[class="street-inspector-field"]',
			(element) => element.firstChild.textContent.trim(),
		),
		streetPlaceholder: await page.$eval(
			"#buildingInspectorParkingPair0EntradaRoad option",
			(element) => element.textContent,
		),
		lane: await page.$eval(
			'#buildingInspectorParkingPair0EntradaLane',
			(element) => element.closest("label").textContent.trim(),
		),
		cell: await page.$eval(
			'#buildingInspectorParkingPair0EntradaCell',
			(element) => element.closest("label").textContent.trim(),
		),
		removePair: await parkingText(
			page,
			"#buildingInspectorParkingPair0Remove",
		),
		probabilityInput: await page.$eval(
			"#buildingInspectorParkingEntrada0",
			(element) => element.getAttribute("aria-label"),
		),
	}
	expect(pair).toEqual({
		legend: labels.inspector.pair,
		streetLabel: labels.inspector.streetLabel,
		streetPlaceholder: labels.inspector.streetPlaceholder,
		lane: labels.inspector.lane,
		cell: labels.inspector.cell,
		removePair: labels.inspector.removePair,
		probabilityInput: labels.inspector.probabilityInput,
	})

	await setPair(page, "entrada", ROAD_A, 1, 99)
	expect(await parkingText(page, "#buildingInspectorParkingError")).toBe(
		labels.validation.entranceEndpointInvalid(ROAD_A),
	)
	expect((await state(page)).owned).toEqual([])

	await setPair(page, "entrada", ROAD_A, 1, 2)
	await setPair(page, "salida", ROAD_A, 1, 5)
	let snapshot = await state(page)
	expect(snapshot).toMatchObject({
		functional: true,
		enabled: true,
		capacity: 50,
		occupancy: 0,
	})
	expect(snapshot.owned).toEqual([
		{ road: ROAD_A, key: "0-1", type: "entrada" },
		{ road: ROAD_A, key: "0-4", type: "salida" },
	])
	expect(await parkingText(page, "#buildingInspectorParkingStatus")).toBe(
		labels.inspector.active(0, 50),
	)
	const valid = structure(snapshot)

	await setPair(page, "salida", ROAD_A, 1, 2)
	expect(await parkingText(page, "#buildingInspectorParkingError")).toBe(
		labels.validation.duplicateEndpoint,
	)
	expect(structure(await state(page))).toEqual(valid)
	await setPair(page, "salida", ROAD_A, 1, 5)
	expect((await state(page)).functional).toBe(true)

	await page.evaluate(
		(roadB) => {
			const other = window.edificios[1]
			const road = window.calles.find((street) => street.nombre === roadB)
			window.configurarEstacionamiento(
				other,
				[
					{
						tipo: "entrada",
						calleId: road.id,
						carril: 0,
						indice: 1,
					},
					{
						tipo: "salida",
						calleId: road.id,
						carril: 0,
						indice: 2,
					},
				],
				10,
			)
		},
		ROAD_B,
	)
	await setPair(page, "entrada", ROAD_B, 1, 2)
	expect(await parkingText(page, "#buildingInspectorParkingError")).toBe(
		labels.validation.endpointOwned(0, 1, ROAD_B),
	)
	expect(structure(await state(page))).toEqual(valid)
	await setPair(page, "entrada", ROAD_A, 1, 2)
	expect((await state(page)).functional).toBe(true)

	await page.evaluate(() => {
		window.edificios[0].vehiculosActuales = 4
	})
	await edit(page, "#buildingInspectorParkingCapacity", 3)
	expect(await parkingText(page, "#buildingInspectorParkingError")).toBe(
		labels.inspector.capacityError(4),
	)
	expect(await page.$eval("#buildingInspectorParkingCapacity", (element) =>
		element.getAttribute("aria-invalid"),
	)).toBe("true")
	expect((await state(page)).capacity).toBe(50)
	await edit(page, "#buildingInspectorParkingCapacity", 12)
	expect((await state(page)).capacity).toBe(12)

	await edit(page, "#buildingInspectorParkingEntrada0", 150)
	expect(await parkingText(page, "#buildingInspectorParkingError")).toBe(
		labels.inspector.probabilityError,
	)
	expect((await state(page)).entry[0]).toBe(0.3)
	await edit(page, "#buildingInspectorParkingEntrada0", 75)
	expect((await state(page)).entry[0]).toBe(0.75)

	const counters = await page.evaluate(() => {
		window.mostrarContadores = true
		window.pixiApp?.sceneManager?.renderContadores?.()
		const counters = window.pixiApp?.sceneManager?.uiRenderer?.contadores
		return {
			pixi: counters
				? [...counters.values()].flatMap((container) =>
						container.children
							.filter((child) => typeof child.text === "string")
							.map((child) => child.text),
					)
				: [],
			building: window.edificios[0].label,
			streets: window.calles.map((road) => road.nombre),
		}
	})
	if (usePixi) expect(counters.pixi).toContain("(4/12)")
	expect(counters.building).toBe(BUILDING)
	expect(counters.streets).toEqual([ROAD_A, ROAD_B])

	await page.click("#buildingInspectorParkingToggle")
	expect(await parkingText(page, "#buildingInspectorParkingStatus")).toBe(
		labels.inspector.decorative,
	)
	const disabled = await state(page)
	expect(disabled).toMatchObject({
		functional: false,
		enabled: false,
		connections: [],
		owned: [],
		occupancy: 0,
	})

	// Legacy modal: translated controls, overlap validation, creation, rejected edit.
	await clearToasts(page)
	await openLegacy(page)
	expect(await legacyLabels(page)).toEqual({
		title: labels.legacy.title,
		toggle: labels.legacy.toggle,
		capacity: labels.legacy.capacity,
		connections: labels.legacy.connections,
		importantLabel: labels.legacy.importantLabel,
		importantBody: labels.legacy.importantBody,
		overlapHelp: labels.legacy.overlapHelp,
		addPair: labels.legacy.addPair,
		probabilities: labels.legacy.probabilities,
		scheduleLabel: labels.legacy.scheduleLabel,
		scheduleBody: labels.legacy.scheduleBody,
		presets: labels.legacy.presets,
		entrancePercent: labels.legacy.entrancePercent,
		exitPercent: labels.legacy.exitPercent,
	})
	await page.click("#checkEstacionamiento")
	await page.waitForSelector("#configEstacionamiento", { visible: true })
	await page.evaluate(() => window.agregarParConexion())
	await page.waitForSelector("#par_1_entrada_calle", { visible: true })
	const generated = await page.evaluate((roadB) => {
		const entranceOption = document.querySelector(
			"#par_1_entrada_calle option[value]:not([value=''])",
		)
		return {
			pair: document.querySelector("#par_1 strong").textContent.trim(),
			remove: document
				.querySelector("#par_1 button.btn-danger")
				.textContent.trim(),
			entrance: document
				.querySelector("#par_1 .bg-success label")
				.textContent.trim(),
			exit: document
				.querySelector("#par_1 .bg-primary label")
				.textContent.trim(),
			streetPlaceholder: document.querySelector(
				"#par_1_entrada_calle option[value='']",
			).textContent,
			lanePlaceholder: document.getElementById(
				"par_1_entrada_carril",
			).getAttribute("placeholder"),
			cellPlaceholder: document.getElementById(
				"par_1_entrada_indice",
			).getAttribute("placeholder"),
			laneHint: document.getElementById(
				"par_1_entrada_carril_hint",
			).textContent,
			cellHint: document.getElementById(
				"par_1_entrada_indice_hint",
			).textContent,
			hour: document.querySelector(
				"#slidersProbEntrada label",
			).textContent.trim(),
			probabilityInput: document
				.getElementById("probEntrada_0")
				.getAttribute("aria-label"),
			option: entranceOption?.textContent,
			roadB,
		}
	}, ROAD_B)
	expect(generated).toMatchObject({
		pair: labels.legacy.pair,
		remove: labels.legacy.removePair,
		entrance: labels.legacy.entrance,
		exit: labels.legacy.exit,
		streetPlaceholder: labels.legacy.streetPlaceholder,
		lanePlaceholder: labels.legacy.lanePlaceholder,
		cellPlaceholder: labels.legacy.cellPlaceholder,
		laneHint: labels.legacy.laneHintPlaceholder,
		cellHint: labels.legacy.cellHintPlaceholder,
		hour: labels.legacy.hour,
		probabilityInput: labels.legacy.probabilityInput,
	})
	expect(generated.option).toBe(labels.legacy.streetOption(ROAD_A))

	await edit(page, "#par_1_entrada_calle", ROAD_B)
	expect(
		await page.$eval("#par_1_entrada_carril_hint", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.legacy.laneHint)
	expect(
		await page.$eval("#par_1_entrada_indice_hint", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.legacy.cellHint)
	await edit(page, "#par_1_entrada_carril", 1)
	await edit(page, "#par_1_entrada_indice", 4)
	await edit(page, "#par_1_salida_calle", ROAD_B)
	await edit(page, "#par_1_salida_carril", 1)
	await edit(page, "#par_1_salida_indice", 4)
	expect(
		await page.$eval("#par_1_traslape_error", (element) =>
			element.textContent.trim(),
		),
	).toBe(labels.legacy.overlapError)
	await edit(page, "#par_1_salida_indice", 6)
	expect(await page.$("#par_1_traslape_error")).toBe(null)

	await edit(page, "#inputNombreEdificio", 'Legacy <b> & "P"')
	await edit(page, "#inputXEdificio", 120)
	await edit(page, "#inputYEdificio", 120)
	await edit(page, "#inputWidthEdificio", 70)
	await edit(page, "#inputHeightEdificio", 45)
	await edit(page, "#inputCapacidad", 20)
	await page.click("#btnConfirmarNuevoEdificio")
	await page.waitForFunction(
		() => window.edificios.length === 3 &&
			window.edificioTieneConexionesEstacionamientoFuncionales(
				window.edificios[2],
			),
		{ timeout: 10000 },
	)
	await closeLegacy(page)
	const legacySnapshot = structure(await state(page, 2))
	expect(legacySnapshot).toMatchObject({
		functional: true,
		enabled: true,
		capacity: 20,
		label: 'Legacy <b> & "P"',
	})
	expect(legacySnapshot.owned).toEqual([
		{ road: ROAD_B, key: "0-3", type: "entrada" },
		{ road: ROAD_B, key: "0-5", type: "salida" },
	])

	await clearToasts(page)
	await page.evaluate(() => {
		window.edificioSeleccionado = window.edificios[2]
		window.editarEdificioSeleccionado()
	})
	await page.waitForSelector("#modalNuevoEdificio.show", { visible: true })
	await new Promise((resolve) => setTimeout(resolve, 600))
	await edit(page, "#par_1_salida_indice", 99)
	await page.click("#btnConfirmarNuevoEdificio")
	let toast = await waitForToast(page)
	expect(toast.header).toContain("bg-danger")
	expect(toast.title).toContain(language === "en" ? "Error" : "Error")
	expect(toast.body).toBe(
		labels.validation.invalidConfiguration(
			labels.validation.exitEndpointInvalid(ROAD_B),
		),
	)
	expect(toast.markup).toBe(0)
	expect(structure(await state(page, 2))).toEqual(legacySnapshot)

	// Legacy add-pair guard keeps its translated warning severity.
	await clearToasts(page)
	await page.evaluate(() => {
		for (let index = 0; index < 10; index++) window.agregarParConexion()
	})
	toast = await waitForToast(page)
	expect(toast.header).toContain("bg-warning")
	expect(toast.body).toBe(labels.legacy.maxPairs)
	expect(toast.markup).toBe(0)
	await closeLegacy(page)

	return { valid, disabled: structure(disabled), legacy: legacySnapshot }
}

describe("functional parking localization", () => {
	for (const usePixi of [false, true]) {
		it(`configures and rejects parking in Spanish and English with ${usePixi ? "Pixi" : "Canvas"}`, async () => {
			const snapshots = []
			for (const language of ["es", "en"]) {
				const simulator = await openSimulator({
					usePixi,
					languagePreference: language,
					freezeFrames: true,
				})
				try {
					const { page } = simulator
					await page.setViewport({ width: 1440, height: 900 })
					snapshots.push(
						await runParkingWorkflow({ page, language, usePixi }),
					)
					expect(simulator.pageErrors).toEqual([])
				} finally {
					await simulator.close()
				}
			}
			expect(snapshots[1]).toEqual(snapshots[0])
		}, 240000)
	}
})

describe("parking controls at mobile sizes and in both themes", () => {
	it("keeps translated inspector and legacy parking controls reachable", async () => {
		const simulator = await openSimulator({ languagePreference: "en" })
		try {
			const { page } = simulator
			await page.setViewport({ width: 390, height: 844 })
			await ready(simulator, false)
			await fixture(page)
			await setSidebar(page, false)
			await new Promise((resolve) => setTimeout(resolve, 300))
			await enableInspector(page)
			await setPair(page, "entrada", ROAD_A, 1, 2)
			await setPair(page, "salida", ROAD_A, 1, 5)
			await edit(page, "#buildingInspectorParkingCapacity", 10)
			expect(await parkingText(page, "#buildingInspectorParkingStatus")).toBe(
				"Active: 0 / 10 vehicles.",
			)

			for (const theme of ["light", "dark"]) {
				if (theme === "dark") {
					await setSidebar(page, true)
					await page.$eval("#switchModoOscuro", (element) => element.click())
					await page.waitForFunction(
						() => document.body.classList.contains("dark-mode"),
						{ polling: 100 },
					)
					await setSidebar(page, false)
				}
				await new Promise((resolve) => setTimeout(resolve, 300))
				const inspector = await page.$eval(
					"#buildingInspector",
					(element) => {
						const rect = element.getBoundingClientRect()
						const styles = getComputedStyle(element)
						return {
							fits:
								rect.left >= -1 &&
								rect.top >= -1 &&
								rect.right <= window.innerWidth + 1 &&
								rect.bottom <= window.innerHeight + 1,
							scroll: element.scrollWidth - element.clientWidth,
							readable:
								styles.color !== "rgba(0, 0, 0, 0)" &&
								styles.display !== "none",
							toggle: document
								.getElementById("buildingInspectorParkingToggle")
								.closest("label")
								.textContent.trim(),
							capacity: document
								.getElementById("buildingInspectorParkingCapacity")
								.closest("label")
								.textContent.trim(),
							status: document
								.getElementById("buildingInspectorParkingStatus")
								.textContent.trim(),
						}
					},
				)
				expect(inspector.fits).toBe(true)
				expect(inspector.scroll).toBeLessThanOrEqual(1)
				expect(inspector.readable).toBe(true)
				expect(inspector.toggle).toBe("Functional parking")
				expect(inspector.capacity).toBe("Capacity")
				expect(inspector.status).toBe("Active: 0 / 10 vehicles.")

				await openLegacy(page)
				const modal = await page.evaluate(() => {
					const dialog = document
						.querySelector("#modalNuevoEdificio .modal-dialog")
						.getBoundingClientRect()
					const body = document.querySelector(
						"#modalNuevoEdificio .modal-body",
					)
					const title = document.querySelector(
						'#modalNuevoEdificio h6[data-i18n="parking.legacy.title"]',
					)
					const styles = getComputedStyle(title)
					return {
						fits:
							dialog.left >= -1 &&
							dialog.top >= -1 &&
							dialog.right <= window.innerWidth + 1 &&
							dialog.bottom <= window.innerHeight + 1,
						overflow: body.scrollWidth - body.clientWidth,
						readable:
							styles.color !== "rgba(0, 0, 0, 0)" &&
							styles.display !== "none",
						title: title.textContent.trim(),
						toggle: document
							.querySelector('label[for="checkEstacionamiento"]')
							.textContent.trim(),
					}
				})
				expect(modal.fits).toBe(true)
				expect(modal.overflow).toBeLessThanOrEqual(1)
				expect(modal.readable).toBe(true)
				expect(modal.title).toBe("🅿️ Parking Settings")
				expect(modal.toggle).toBe("Works as parking")
				await closeLegacy(page)
				const overflow = await page.evaluate(
					() => document.documentElement.scrollWidth - window.innerWidth,
				)
				expect(overflow).toBeLessThanOrEqual(1)
			}
			expect(simulator.pageErrors).toEqual([])
		} finally {
			await simulator.close()
		}
	}, 120000)
})
