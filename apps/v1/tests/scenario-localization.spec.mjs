import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openSimulator } from "./helpers/simulator.mjs";

const catalogs = {
	es: JSON.parse(
		readFileSync(
			new URL("../src/locales/es/translation.json", import.meta.url),
			"utf8",
		),
	),
	en: JSON.parse(
		readFileSync(
			new URL("../src/locales/en/translation.json", import.meta.url),
			"utf8",
		),
	),
};

function catalogValue(language, key) {
	return key
		.split(".")
		.reduce(
			(value, part) => (value == null ? undefined : value[part]),
			catalogs[language],
		);
}

function interpolate(template, params = {}) {
	return String(template).replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (match, name) =>
		name in params ? String(params[name]) : match,
	);
}

function message(language, key, params = {}) {
	let value = catalogValue(language, key);
	if (value === undefined && "count" in params) {
		value = catalogValue(
			language,
			`${key}_${params.count === 1 ? "one" : "other"}`,
		);
	}
	if (value === undefined) throw new Error(`Missing ${language} key: ${key}`);
	return interpolate(value, params);
}

function hasKeyDeep(value, key) {
	if (!value || typeof value !== "object") return false;
	if (!Array.isArray(value) && Object.hasOwn(value, key)) return true;
	return Object.values(value).some((entry) => hasKeyDeep(entry, key));
}

const hideLoadingScreen = (page) =>
	page.evaluate(() => {
		window.hideLoadingScreen?.();
		document.getElementById("loadingScreen").style.display = "none";
		window.inicializarEscenarios?.();
		window.inicializarGestionEscenarios?.();
	});

const clearToasts = (page) =>
	page.evaluate(() => {
		for (const toast of document.querySelectorAll(".toast")) toast.remove();
	});

const waitForToast = async (page) => {
	await page.waitForFunction(
		() => document.querySelectorAll(".toast").length > 0,
		{ timeout: 5000, polling: 100 },
	);
	await new Promise((resolve) => setTimeout(resolve, 200));
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

const openAccordion = async (page, target) => {
	const expanded = await page.$eval(
		`[data-bs-target="${target}"]`,
		(button) => button.getAttribute("aria-expanded") === "true",
	);
	if (!expanded) {
		await page.$eval(`[data-bs-target="${target}"]`, (button) =>
			button.click(),
		);
		await page.waitForSelector(`${target}.show`, { visible: true });
	}
};

const activateLanguage = async (page, language) => {
	await page.waitForFunction(
		(active) => document.documentElement.lang === active,
		{ polling: 100 },
		language,
	);
	await page.evaluate(() => window.fluviI18n.translateDocument());
};

async function newSimulation(page) {
	await page.evaluate(() => {
		window.confirm = () => true;
		document.getElementById("btnNuevaSimulacion").click();
	});
	await page.waitForFunction(() => window.calles.length === 0, {
		polling: 100,
		timeout: 10000,
	});
}

async function createScenarioStreet(page, name, lanes = 2) {
	await page.evaluate(
		({ name, lanes }) => {
			window.streetEditPause?.();
			window.crearCalle(
				name,
				8,
				window.TIPOS.CONEXION,
				120,
				120,
				0,
				0,
				lanes,
				0,
			);
			window.actualizarSelectores?.();
			window.cellGeometryIndex?.invalidate?.();
			window.pixiApp?.sceneManager?.renderAll?.();
			window.renderizarCanvas?.();
		},
		{ name, lanes },
	);
}

async function setRain(page, probability, { active = false } = {}) {
	await page.evaluate(
		({ probability, active }) => {
			const input = document.getElementById("probabilidadLluvia");
			input.value = String(probability);
			input.dispatchEvent(new Event("input", { bubbles: true }));
			const toggle = document.getElementById("toggleLluviaAleatoria");
			if (toggle.checked !== active) toggle.click();
		},
		{ probability, active },
	);
}

async function applyDisruptions(page, streetName) {
	await page.evaluate((streetName) => {
		const street = window.calles.find((entry) => entry.nombre === streetName);
		const put = (lane, cell, tipo, texture) => {
			street.arreglo[lane][cell] = 7;
			window.estadoEscenarios.celdasBloqueadas.set(
				`${street.id || street.nombre}:${lane}:${cell}`,
				texture ? { tipo, texture } : { tipo },
			);
		};
		put(0, 2, "inundacion", "inundacion");
		put(1, 5, "obstaculo", "bache");
		put(0, 4, "bloqueo");
		window.pixiApp?.sceneManager?.carroRenderer?.updateAll(window.calles);
		window.renderizarCanvas?.();
	}, streetName);
}

async function saveScenario(page, name, description) {
	await page.evaluate(() => {
		window.__scenarioBlob = null;
		window.__scenarioCreateObjectURL = URL.createObjectURL;
		URL.createObjectURL = (blob) => {
			window.__scenarioBlob = blob.text();
			return "blob:scenario-localization";
		};
		document.getElementById("btnGuardarEscenario").click();
	});
	await page.waitForSelector(".modal.show", { visible: true });
	await page.waitForFunction(
		() => {
			const element = document.querySelector(".modal.show");
			const instance = element
				? window.bootstrap.Modal.getInstance(element)
				: null;
			return instance && !instance._isTransitioning;
		},
		{ polling: 50 },
	);
	await page.evaluate(
		({ name, description }) => {
			const nameInput = document.getElementById("inputNombreEscenario");
			nameInput.value = name;
			nameInput.dispatchEvent(new Event("input", { bubbles: true }));
			document.getElementById("inputDescripcionEscenario").value = description;
			document.getElementById("btnConfirmarGuardarEscenario").click();
		},
		{ name, description },
	);
	await page.waitForSelector(".modal.show", { hidden: true });
	await page.waitForFunction(
		() =>
			!document.querySelector(".modal-backdrop") &&
			!document.body.classList.contains("modal-open"),
		{ polling: 100, timeout: 5000 },
	);
	return page.evaluate(async () => {
		const saved = await window.__scenarioBlob;
		URL.createObjectURL = window.__scenarioCreateObjectURL;
		return saved;
	});
}

async function importScenario(
	page,
	json,
	{ expectSuccess = true, filename = "scenario-round-trip.json" } = {},
) {
	await clearToasts(page);
	await page.evaluate(() => {
		window.escenarioActualCargado = null;
	});
	await page.evaluate(
		({ json, filename }) => {
			const input = document.getElementById("inputCargarJSON");
			const transfer = new DataTransfer();
			transfer.items.add(
				new File([json], filename, {
					type: "application/json",
				}),
			);
			input.files = transfer.files;
			input.dispatchEvent(new Event("change", { bubbles: true }));
		},
		{ json, filename },
	);
	if (expectSuccess) {
		await page.waitForFunction(() => window.escenarioActualCargado !== null, {
			polling: 100,
			timeout: 10000,
		});
	}
	return waitForToast(page);
}

async function scenarioState(page) {
	return page.evaluate(() => {
		const values = window.calles[0]?.arreglo?.map((lane) => [...lane]);
		return {
			language: document.documentElement.lang,
			name: document.getElementById("escenarioActualNombre").textContent,
			infoVisible:
				getComputedStyle(document.getElementById("escenarioActualInfo"))
					.display !== "none",
			date: document.getElementById("escenarioActualFecha").textContent,
			rainProbability: document.getElementById("probabilidadLluvia").value,
			rainActive: document.getElementById("toggleLluviaAleatoria").checked,
			streetName: window.calles[0]?.nombre,
			values,
			cells: window
				.exportarBloqueos()
				.map(({ key, tipo, texture }) => ({
					key,
					tipo,
					texture: texture ?? null,
				}))
				.sort((left, right) => left.key.localeCompare(right.key)),
		};
	});
}

function scenarioPayload(json) {
	const saved = JSON.parse(json);
	return {
		...saved,
		celdasBloqueadas: [...saved.celdasBloqueadas].sort((left, right) =>
			`${left.calleNombre}:${left.carril}:${left.indice}`.localeCompare(
				`${right.calleNombre}:${right.carril}:${right.indice}`,
			),
		),
	};
}

async function catalogWiring(page, language) {
	await activateLanguage(page, language);
	return page.evaluate(() => {
		const directText = (element) =>
			[...element.childNodes]
				.filter((node) => node.nodeType === Node.TEXT_NODE)
				.map((node) => node.nodeValue)
				.join("")
				.trim();
		const texts = [
			...document.querySelectorAll('[data-i18n^="scenarios."]'),
		].map((element) => ({
			key: element.getAttribute("data-i18n"),
			text: directText(element),
		}));
		const attributes = [
			...document.querySelectorAll("[data-i18n-attr]"),
		].flatMap((element) =>
			element
				.getAttribute("data-i18n-attr")
				.split(";")
				.map((pair) => pair.trim())
				.filter(Boolean)
				.map((pair) => {
					const separator = pair.indexOf(":");
					const attribute = pair.slice(0, separator).trim();
					return {
						key: pair.slice(separator + 1).trim(),
						attribute,
						value: element.getAttribute(attribute),
					};
				})
				.filter((entry) => entry.key.startsWith("scenarios.")),
		);
		return {
			texts,
			attributes,
			language: document.documentElement.lang,
			paintModes: [
				"paintModeIndicator",
				"paintModeIndicatorInundacion",
				"paintModeIndicatorObstaculo",
			].map((id) => {
				const element = document.getElementById(id);
				return {
					id,
					role: element.getAttribute("role"),
					live: element.getAttribute("aria-live"),
				};
			}),
			obstacleOptions: [
				...document.getElementById("selectorEmojiObstaculo").options,
			].map((option) => ({
				value: option.value,
				text: option.textContent,
			})),
			rainOutput: document.getElementById("probabilidadLluviaValor")
				.textContent,
		};
	});
}

function baseScenarioContent(page) {
	return page.evaluate(() => {
		const originalStreets = window.calles.splice(0, window.calles.length);
		const originalConnections = window.conexiones.splice(
			0,
			window.conexiones.length,
		);
		try {
			window.crearCalle(
				'Base <b> & "Street"',
				8,
				window.TIPOS.CONEXION,
				0,
				0,
				0,
				0,
				3,
				0,
			);
			const flood = window.generarEscenarioInundacionMasiva();
			const potholes = window.generarEscenarioBachesAleatorios();
			return {
				flood: {
					id: flood.id,
					name: flood.nombre,
					description: flood.descripcion,
					base: flood.esEscenarioBase,
				},
				potholes: {
					id: potholes.id,
					name: potholes.nombre,
					description: potholes.descripcion,
					base: potholes.esEscenarioBase,
				},
			};
		} finally {
			window.estadoEscenarios.celdasBloqueadas.clear();
			window.calles.splice(0, window.calles.length, ...originalStreets);
			window.conexiones.splice(
				0,
				window.conexiones.length,
				...originalConnections,
			);
			window.cellGeometryIndex?.clear?.();
			window.pixiApp?.sceneManager?.renderAll?.();
			window.renderizarCanvas?.();
		}
	});
}

describe.each([
	["Canvas", false],
	["Pixi", true],
])("scenario localization in %s mode", (_mode, usePixi) => {
	it("translates every scenario control, instruction, and accessible description in Spanish and English", async () => {
		for (const language of ["es", "en"]) {
			const simulator = await openSimulator({
				usePixi,
				languagePreference: language,
			});
			try {
				const { page } = simulator;
				if (usePixi) {
					await page.waitForFunction(
						() => Boolean(window.pixiApp?.sceneManager),
						{ timeout: 60000, polling: 100 },
					);
				}
				await hideLoadingScreen(page);
				await openAccordion(page, "#collapseEscenarios");

				const wiring = await catalogWiring(page, language);
				expect(wiring.language).toBe(language);
				expect(wiring.texts.length).toBeGreaterThan(0);
				for (const entry of wiring.texts) {
					expect(entry.text, `${language}: ${entry.key}`).toBe(
						catalogValue(language, entry.key),
					);
				}
				expect(wiring.attributes.length).toBeGreaterThan(0);
				for (const entry of wiring.attributes) {
					expect(
						entry.value,
						`${language}: ${entry.key} (${entry.attribute})`,
					).toBe(catalogValue(language, entry.key));
				}
				expect(wiring.paintModes).toEqual(
					[
						"paintModeIndicator",
						"paintModeIndicatorInundacion",
						"paintModeIndicatorObstaculo",
					].map((id) => ({ id, role: "status", live: "polite" })),
				);
				expect(wiring.obstacleOptions).toEqual([
					{
						value: "bache",
						text: catalogValue(
							language,
							"scenarios.cards.obstacle.types.pothole",
						),
					},
					{
						value: "trabajador",
						text: catalogValue(
							language,
							"scenarios.cards.obstacle.types.construction",
						),
					},
					{
						value: "arbol",
						text: catalogValue(
							language,
							"scenarios.cards.obstacle.types.fallenTree",
						),
					},
				]);
				expect(wiring.rainOutput).toBe("10%");

				const bases = await baseScenarioContent(page);
				expect(bases).toEqual({
					flood: {
						id: "base_inundacion_masiva",
						name: catalogValue(language, "scenarios.base.floodName"),
						description: catalogValue(
							language,
							"scenarios.base.floodDescription",
						),
						base: true,
					},
					potholes: {
						id: "base_baches_aleatorios",
						name: catalogValue(language, "scenarios.base.potholesName"),
						description: catalogValue(
							language,
							"scenarios.base.potholesDescription",
						),
						base: true,
					},
				});
				expect(simulator.pageErrors).toEqual([]);
			} finally {
				await simulator.close();
			}
		}
	}, 180000);

	it("round-trips scenario content between Spanish and English without a language field", async () => {
		const streetName = 'Escenario <b> & "Ruta"';
		const nameSpanish = 'Escenario <b> & "Lluvia"';
		const descriptionSpanish = 'Descripción <b> & "Lluvia"';
		const nameEnglish = 'Exchange scenario <b> & "EN"';
		const descriptionEnglish = 'Description <b> & "EN"';
		let savedSpanish;
		let spanishSnapshot;
		let spanishPayload;

		const spanish = await openSimulator({
			usePixi,
			languagePreference: "es",
		});
		try {
			const { page } = spanish;
			if (usePixi) {
				await page.waitForFunction(
					() => Boolean(window.pixiApp?.sceneManager),
					{ timeout: 60000, polling: 100 },
				);
			}
			await hideLoadingScreen(page);
			await newSimulation(page);
			await createScenarioStreet(page, streetName);
			await applyDisruptions(page, streetName);
			await setRain(page, 41, { active: true });

			await clearToasts(page);
			savedSpanish = await saveScenario(page, nameSpanish, descriptionSpanish);
			let toast = await waitForToast(page);
			expect(toast.header).toContain("bg-success");
			expect(toast.body).toBe(
				message("es", "scenarios.notifications.saved", {
					name: nameSpanish,
				}),
			);
			expect(toast.markup).toBe(0);

			const saved = scenarioPayload(savedSpanish);
			expect(saved).toMatchObject({
				version: "1.0",
				nombre: nameSpanish,
				descripcion: descriptionSpanish,
				lluviaAleatoria: { probabilidad: 41 },
				callesConfig: [
					{
						id: streetName,
						nombre: streetName,
						tamano: 8,
						carriles: 2,
					},
				],
				estadisticas: {
					totalBloqueos: 1,
					totalInundaciones: 1,
					totalObstaculos: 1,
				},
			});
			expect(saved.celdasBloqueadas).toEqual([
				{
					calleNombre: streetName,
					calleId: streetName,
					carril: 0,
					indice: 2,
					tipo: "inundacion",
					texture: "inundacion",
				},
				{
					calleNombre: streetName,
					calleId: streetName,
					carril: 0,
					indice: 4,
					tipo: "bloqueo",
					texture: null,
				},
				{
					calleNombre: streetName,
					calleId: streetName,
					carril: 1,
					indice: 5,
					tipo: "obstaculo",
					texture: "bache",
				},
			]);
			for (const key of [
				"language",
				"idioma",
				"locale",
				"localization",
				"interfaceLanguage",
			]) {
				expect(hasKeyDeep(saved, key), key).toBe(false);
			}
			spanishSnapshot = await scenarioState(page);
			spanishPayload = saved;
			// Saving downloads the scenario; it does not mark it as loaded.
			expect(spanishSnapshot).toMatchObject({
				language: "es",
				infoVisible: false,
				rainProbability: "41",
				rainActive: true,
				streetName,
			});

			// Clear-all confirmation is translated, cancelling preserves the
			// disruptions, and an empty clear reports a warning.
			await clearToasts(page);
			await page.evaluate(() =>
				document.getElementById("btnLimpiarTodosBloqueos").click(),
			);
			await page.waitForSelector(".modal.show", { visible: true });
			await page.waitForFunction(
				() => {
					const element = document.querySelector(".modal.show");
					const instance = element
						? window.bootstrap.Modal.getInstance(element)
						: null;
					return instance && !instance._isTransitioning;
				},
				{ polling: 50 },
			);
			const confirmation = await page.evaluate(() => {
				const element = document.querySelector(".modal.show");
				return {
					title: element.querySelector(".modal-title").textContent.trim(),
					body: element.querySelector(".modal-body").textContent.trim(),
					buttons: [...element.querySelectorAll(".modal-footer .btn")].map(
						(button) => ({
							text: button.textContent.trim(),
							className: button.className,
						}),
					),
				};
			});
			expect(confirmation).toEqual({
				title: catalogValue("es", "scenarios.clear.title"),
				body: message("es", "scenarios.alerts.clearQuestion", {
					count: 3,
				}),
				buttons: [
					{
						text: catalogValue("es", "common.cancel"),
						className: "btn btn-secondary",
					},
					{
						text: catalogValue("es", "scenarios.clear.confirmButton"),
						className: "btn btn-danger",
					},
				],
			});
			await page.$eval(".modal.show .modal-footer .btn-secondary", (element) =>
				element.click(),
			);
			await page.waitForSelector(".modal.show", { hidden: true });
			await page.waitForFunction(
				() =>
					!document.querySelector(".modal-backdrop") &&
					!document.body.classList.contains("modal-open"),
				{ polling: 100, timeout: 5000 },
			);
			expect(await page.evaluate(() => window.exportarBloqueos().length)).toBe(
				3,
			);
			expect(await page.$$eval(".toast", (elements) => elements.length)).toBe(
				0,
			);

			await page.evaluate(() =>
				document.getElementById("btnLimpiarTodosBloqueos").click(),
			);
			await page.waitForSelector(".modal.show", { visible: true });
			await page.waitForFunction(
				() => {
					const element = document.querySelector(".modal.show");
					const instance = element
						? window.bootstrap.Modal.getInstance(element)
						: null;
					return instance && !instance._isTransitioning;
				},
				{ polling: 50 },
			);
			await page.$eval(".modal.show .modal-footer .btn-danger", (element) =>
				element.click(),
			);
			await page.waitForSelector(".modal.show", { hidden: true });
			await page.waitForFunction(
				() =>
					!document.querySelector(".modal-backdrop") &&
					!document.body.classList.contains("modal-open"),
				{ polling: 100, timeout: 5000 },
			);
			toast = await waitForToast(page);
			expect(toast.header).toContain("bg-success");
			expect(toast.body).toBe(message("es", "scenarios.notifications.cleared"));
			expect(toast.markup).toBe(0);
			expect(await page.evaluate(() => window.exportarBloqueos().length)).toBe(
				0,
			);

			await clearToasts(page);
			await page.evaluate(() =>
				document.getElementById("btnLimpiarTodosBloqueos").click(),
			);
			toast = await waitForToast(page);
			expect(toast.header).toContain("bg-warning");
			expect(toast.body).toBe(
				message("es", "scenarios.notifications.nothingToClear"),
			);
			expect(toast.markup).toBe(0);
		} finally {
			await spanish.close();
		}

		const english = await openSimulator({
			usePixi,
			languagePreference: "en",
		});
		try {
			const { page } = english;
			if (usePixi) {
				await page.waitForFunction(
					() => Boolean(window.pixiApp?.sceneManager),
					{ timeout: 60000, polling: 100 },
				);
			}
			await hideLoadingScreen(page);
			await newSimulation(page);
			await createScenarioStreet(page, streetName);
			await setRain(page, 90, { active: true });

			const toast = await importScenario(page, savedSpanish);
			expect(toast.header).toContain("bg-success");
			expect(toast.body).toBe(
				message("en", "scenarios.notifications.loadedFromFile", {
					name: nameSpanish,
					count: 3,
				}),
			);
			expect(toast.markup).toBe(0);

			const imported = await scenarioState(page);
			expect(imported).toMatchObject({
				language: "en",
				name: nameSpanish,
				infoVisible: true,
				rainProbability: "41",
				rainActive: false,
				streetName,
			});
			expect(imported.date).not.toBe("-");
			expect(imported.values[0][2]).toBe(7);
			expect(imported.values[0][4]).toBe(7);
			expect(imported.values[1][5]).toBe(7);
			expect(imported.cells).toEqual([
				{
					key: `${streetName}:0:2`,
					tipo: "inundacion",
					texture: "inundacion",
				},
				{
					key: `${streetName}:0:4`,
					tipo: "bloqueo",
					texture: null,
				},
				{
					key: `${streetName}:1:5`,
					tipo: "obstaculo",
					texture: "bache",
				},
			]);

			const invalid = JSON.parse(savedSpanish);
			invalid.callesConfig[0].id = "Missing street";
			invalid.callesConfig[0].nombre = "Missing street";
			const validationToast = await importScenario(
				page,
				JSON.stringify(invalid),
				{ expectSuccess: false },
			);
			expect(validationToast.header).toContain("bg-danger");
			expect(validationToast.body).toBe(
				message("en", "scenarios.validation.cannotLoad", {
					errors: `• ${message("en", "scenarios.validation.missingStreet", {
						name: "Missing street",
					})}`,
				}),
			);
			expect(validationToast.markup).toBe(0);
			expect(await page.evaluate(() => window.exportarBloqueos().length)).toBe(
				3,
			);

			const formatToast = await importScenario(page, "{}", {
				expectSuccess: false,
				filename: "invalid-scenario.json",
			});
			expect(formatToast.header).toContain("bg-danger");
			expect(formatToast.body).toBe(
				message("en", "scenarios.validation.invalidFormat"),
			);
			expect(formatToast.markup).toBe(0);

			if (usePixi) {
				const textures = await page.evaluate(() => {
					const renderer = window.pixiApp.sceneManager.carroRenderer;
					return [...renderer.scene.carroSprites.values()].map((sprite) =>
						sprite.texture === renderer.assets.getTexture("inundacion")
							? "inundacion"
							: sprite.texture === renderer.assets.getTexture("bache")
								? "bache"
								: null,
					);
				});
				expect(textures).toContain("inundacion");
				expect(textures).toContain("bache");
			} else {
				const images = await page.evaluate(() => {
					const context = document
						.getElementById("simuladorCanvas")
						.getContext("2d");
					const originalDrawImage = context.drawImage;
					const drawn = [];
					context.drawImage = function (image, ...args) {
						if (image?.src) drawn.push(image.src);
						return originalDrawImage.call(this, image, ...args);
					};
					try {
						window.renderizarCanvas();
						return drawn;
					} finally {
						context.drawImage = originalDrawImage;
					}
				});
				expect(images.some((src) => src.endsWith("/Inundacion.png"))).toBe(
					true,
				);
			}

			const savedEnglish = await saveScenario(
				page,
				nameEnglish,
				descriptionEnglish,
			);
			const englishPayload = scenarioPayload(savedEnglish);
			expect(englishPayload).toMatchObject({
				version: spanishPayload.version,
				callesConfig: spanishPayload.callesConfig,
				lluviaAleatoria: spanishPayload.lluviaAleatoria,
				celdasBloqueadas: spanishPayload.celdasBloqueadas,
				estadisticas: spanishPayload.estadisticas,
				nombre: nameEnglish,
				descripcion: descriptionEnglish,
			});
			for (const key of [
				"language",
				"idioma",
				"locale",
				"localization",
				"interfaceLanguage",
			]) {
				expect(hasKeyDeep(englishPayload, key), key).toBe(false);
			}

			const returned = await openSimulator({
				usePixi,
				languagePreference: "es",
			});
			try {
				const returnedPage = returned.page;
				if (usePixi) {
					await returnedPage.waitForFunction(
						() => Boolean(window.pixiApp?.sceneManager),
						{ timeout: 60000, polling: 100 },
					);
				}
				await hideLoadingScreen(returnedPage);
				await newSimulation(returnedPage);
				await createScenarioStreet(returnedPage, streetName);
				await importScenario(returnedPage, savedEnglish);
				const returnedState = await scenarioState(returnedPage);
				expect(returnedState).toMatchObject({
					language: "es",
					name: nameEnglish,
					infoVisible: true,
					rainProbability: "41",
					rainActive: false,
					streetName,
				});
				expect(returnedState.values).toEqual(spanishSnapshot.values);
				expect(returnedState.cells).toEqual(spanishSnapshot.cells);
				expect(returned.pageErrors).toEqual([]);
			} finally {
				await returned.close();
			}
			expect(english.pageErrors).toEqual([]);
		} finally {
			await english.close();
		}
	}, 240000);

	if (usePixi) {
		it("paints representative disruptions with translated paint mode controls", async () => {
			const simulator = await openSimulator({
				usePixi,
				languagePreference: "en",
				freezeFrames: false,
			});
			try {
				const { page } = simulator;
				if (usePixi) {
					await page.waitForFunction(
						() => Boolean(window.pixiApp?.sceneManager),
						{ timeout: 60000, polling: 100 },
					);
				}
				await hideLoadingScreen(page);
				await newSimulation(page);
				await createScenarioStreet(page, "Paint street", 2);
				const painted = await page.evaluate(() => {
					if (!window.isPaused)
						document.getElementById("btnPauseResume").click();
					const street = window.calles[0];
					const paint = (mode, lane, cell) => {
						const toggle = document.getElementById(
							mode === "inundacion" ? "toggleInundacion" : "toggleObstaculo",
						);
						if (!toggle.checked) toggle.click();
						const renderer = window.pixiApp?.sceneManager?.calleRenderer;
						const coordinates = window.obtenerCoordenadasGlobalesCelda(
							street,
							lane,
							cell,
						);
						renderer.paintMode = "paint";
						renderer.paintCell(street, {
							data: {
								global: {
									x: coordinates.x * window.escala + window.offsetX,
									y: coordinates.y * window.escala + window.offsetY,
								},
							},
						});
						renderer.paintMode = null;
						toggle.click();
						return {
							value: street.arreglo[lane][cell],
							metadata: window.estadoEscenarios.celdasBloqueadas.get(
								`${street.id || street.nombre}:${lane}:${cell}`,
							),
						};
					};
					const flood = paint("inundacion", 0, 1);
					const obstacle = paint("obstaculo", 1, 3);
					document.getElementById("selectorEmojiObstaculo").value = "bache";
					const renderer = window.pixiApp?.sceneManager?.calleRenderer;
					const spriteTextures = [
						...window.pixiApp.sceneManager.carroRenderer.scene.carroSprites.values(),
					].map((sprite) => sprite.texture);
					return {
						flood,
						obstacle,
						hasFloodTexture: spriteTextures.includes(
							window.pixiApp.sceneManager.carroRenderer.assets.getTexture(
								"inundacion",
							),
						),
						hasPotholeTexture: spriteTextures.includes(
							window.pixiApp.sceneManager.carroRenderer.assets.getTexture(
								"bache",
							),
						),
						indicators: [
							"paintModeIndicator",
							"paintModeIndicatorInundacion",
							"paintModeIndicatorObstaculo",
						].map((id) => ({
							id,
							text: document
								.querySelector(`#${id} .paint-mode-badge`)
								.textContent.trim(),
							display: getComputedStyle(document.getElementById(id)).display,
						})),
					};
				});
				expect(painted.flood).toEqual({
					value: 7,
					metadata: { tipo: "inundacion", texture: "inundacion" },
				});
				expect(painted.obstacle).toEqual({
					value: 7,
					metadata: { tipo: "obstaculo", texture: "bache" },
				});
				expect(painted.hasFloodTexture).toBe(true);
				expect(painted.hasPotholeTexture).toBe(true);
				expect(painted.indicators).toEqual([
					{
						id: "paintModeIndicator",
						text: catalogValue("en", "scenarios.cards.block.badge"),
						display: "none",
					},
					{
						id: "paintModeIndicatorInundacion",
						text: catalogValue("en", "scenarios.cards.flood.badge"),
						display: "none",
					},
					{
						id: "paintModeIndicatorObstaculo",
						text: catalogValue("en", "scenarios.cards.obstacle.badge"),
						display: "none",
					},
				]);
				expect(simulator.pageErrors).toEqual([]);
			} finally {
				await simulator.close();
			}
		}, 120000);
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one reachability sweep covers every viewport/theme combination.
	it("keeps scenario controls and dialogs reachable in Spanish and English at mobile and desktop sizes in both themes", async () => {
		for (const language of ["es", "en"]) {
			const simulator = await openSimulator({
				usePixi,
				languagePreference: language,
			});
			try {
				const { page } = simulator;
				if (usePixi) {
					await page.waitForFunction(
						() => Boolean(window.pixiApp?.sceneManager),
						{ timeout: 60000, polling: 100 },
					);
				}
				await hideLoadingScreen(page);
				for (const viewport of [
					{ width: 390, height: 844 },
					{ width: 1440, height: 900 },
				]) {
					await page.setViewport(viewport);
					for (const theme of ["light", "dark"]) {
						if (theme === "dark") {
							await page.click("#switchModoOscuro");
							await page.waitForFunction(
								() => document.body.classList.contains("dark-mode"),
								{ polling: 100 },
							);
						} else if (
							await page.evaluate(() =>
								document.body.classList.contains("dark-mode"),
							)
						) {
							await page.click("#switchModoOscuro");
							await page.waitForFunction(
								() => !document.body.classList.contains("dark-mode"),
								{ polling: 100 },
							);
						}
						await openAccordion(page, "#collapseEscenarios");
						await page.evaluate(() => {
							document.getElementById("toggleInundacion").click();
						});
						const layout = await page.evaluate(() => {
							const selectors = [
								"#toggleBloqueoCarril",
								"#toggleInundacion",
								"#toggleLluviaAleatoria",
								"#probabilidadLluvia",
								"#toggleObstaculo",
								"#btnLimpiarTodosBloqueos",
								"#btnEscenarioInundacionMasiva",
								"#btnEscenarioBachesAleatorios",
								"#btnGuardarEscenario",
								"#btnCargarEscenario",
								"#paintModeIndicatorInundacion",
							];
							return {
								fitting: selectors.map((selector) => {
									const element = document.querySelector(selector);
									const rect = element.getBoundingClientRect();
									const style = getComputedStyle(element);
									return {
										selector,
										fit:
											style.display !== "none" &&
											style.visibility !== "hidden" &&
											rect.width > 0 &&
											rect.height > 0 &&
											rect.left >= -1 &&
											rect.right <= window.innerWidth + 1,
									};
								}),
								overflow:
									document.documentElement.scrollWidth - window.innerWidth,
								labels: {
									block: document
										.querySelector('[data-i18n="scenarios.cards.block.toggle"]')
										.textContent.trim(),
									floodBadge: document
										.querySelector(
											"#paintModeIndicatorInundacion .paint-mode-badge",
										)
										.textContent.trim(),
								},
							};
						});
						expect(
							layout.fitting.every((entry) => entry.fit),
							JSON.stringify(layout.fitting),
						).toBe(true);
						expect(layout.overflow).toBeLessThanOrEqual(1);
						expect(layout.labels).toEqual({
							block: catalogValue(language, "scenarios.cards.block.toggle"),
							floodBadge: catalogValue(language, "scenarios.cards.flood.badge"),
						});
						await page.evaluate(() => {
							document.getElementById("toggleInundacion").click();
							document.getElementById("toggleObstaculo").click();
						});
						const obstacleLayout = await page.evaluate(() => {
							const element = document.getElementById("selectorEmojiObstaculo");
							const rect = element.getBoundingClientRect();
							const style = getComputedStyle(element);
							return {
								fit:
									style.display !== "none" &&
									style.visibility !== "hidden" &&
									rect.width > 0 &&
									rect.height > 0 &&
									rect.left >= -1 &&
									rect.right <= window.innerWidth + 1,
								badge: document
									.querySelector(
										"#paintModeIndicatorObstaculo .paint-mode-badge",
									)
									.textContent.trim(),
								option:
									element.options[element.selectedIndex].textContent.trim(),
							};
						});
						expect(obstacleLayout).toEqual({
							fit: true,
							badge: catalogValue(language, "scenarios.cards.obstacle.badge"),
							option: catalogValue(
								language,
								"scenarios.cards.obstacle.types.pothole",
							),
						});
						await page.evaluate(() => {
							document.getElementById("toggleObstaculo").click();
						});

						for (const button of [
							"btnGuardarEscenario",
							"btnCargarEscenario",
						]) {
							await page.$eval(`#${button}`, (element) => element.click());
							await page.waitForSelector(".modal.show", {
								visible: true,
							});
							await page.waitForFunction(
								() => {
									const element = document.querySelector(".modal.show");
									const instance = element
										? window.bootstrap.Modal.getInstance(element)
										: null;
									return instance && !instance._isTransitioning;
								},
								{ polling: 50 },
							);
							const modal = await page.evaluate(() => {
								const element = document.querySelector(".modal.show");
								const rect = element.getBoundingClientRect();
								return {
									title: element
										.querySelector(".modal-title")
										.textContent.trim(),
									fits:
										rect.width > 0 &&
										rect.height > 0 &&
										rect.left >= -1 &&
										rect.right <= window.innerWidth + 1,
									overflow:
										document.documentElement.scrollWidth - window.innerWidth,
								};
							});
							expect(modal.fits).toBe(true);
							expect(modal.overflow).toBeLessThanOrEqual(1);
							expect(modal.title).toBe(
								catalogValue(
									language,
									button === "btnGuardarEscenario"
										? "scenarios.saveModal.title"
										: "scenarios.loadModal.title",
								),
							);
							await page.$eval(
								".modal.show .modal-footer .btn-secondary",
								(element) => element.click(),
							);
							await page.waitForSelector(".modal.show", {
								hidden: true,
							});
							await page.waitForFunction(
								() =>
									!document.querySelector(".modal-backdrop") &&
									!document.body.classList.contains("modal-open"),
								{ polling: 100, timeout: 5000 },
							);
						}
					}
				}
				expect(simulator.pageErrors).toEqual([]);
			} finally {
				await simulator.close();
			}
		}
	}, 240000);
});

describe("scenario browser list", () => {
	it("lists and deletes legacy browser scenarios with translated, safe controls", async () => {
		const simulator = await openSimulator({
			languagePreference: "en",
		});
		try {
			const { page } = simulator;
			await hideLoadingScreen(page);
			const name = 'Legacy <b> & "Rain"';
			await page.evaluate((name) => {
				localStorage.setItem(
					"escenariosGuardados",
					JSON.stringify([
						{
							id: "legacy-1",
							nombre: name,
							descripcion: "Saved <i> earlier",
							fechaCreacion: "2026-01-02T03:04:05.000Z",
							estadisticas: {
								totalBloqueos: 2,
								totalInundaciones: 1,
								totalObstaculos: 3,
							},
						},
					]),
				);
			}, name);
			await page.evaluate(() =>
				document.getElementById("btnCargarEscenario").click(),
			);
			await page.waitForSelector(".modal.show", { visible: true });
			await page.waitForFunction(
				() => {
					const element = document.querySelector(".modal.show");
					const instance = element
						? window.bootstrap.Modal.getInstance(element)
						: null;
					return instance && !instance._isTransitioning;
				},
				{ polling: 50 },
			);
			const list = await page.evaluate(() => {
				const item = document.querySelector(
					"#listaEscenariosGuardados .list-group-item",
				);
				return {
					name: item.querySelector("h6").textContent,
					description: item.querySelector("p").textContent,
					markup: item.querySelectorAll("h6 *, p *").length,
					date: item.querySelector("small").textContent,
					badges: [...item.querySelectorAll(".badge")].map(
						(badge) => badge.textContent,
					),
					buttons: [...item.querySelectorAll("button")].map(
						(button) => button.textContent,
					),
					emptyDisplay: getComputedStyle(
						document.getElementById("noEscenariosMessage"),
					).display,
				};
			});
			expect(list).toMatchObject({
				name,
				description: "Saved <i> earlier",
				markup: 0,
				badges: [
					message("en", "scenarios.list.blocks", { count: 2 }),
					message("en", "scenarios.list.floods", { count: 1 }),
					message("en", "scenarios.list.obstacles", { count: 3 }),
				],
				buttons: [
					catalogValue("en", "scenarios.list.load"),
					catalogValue("en", "scenarios.list.delete"),
				],
				emptyDisplay: "none",
			});
			expect(list.date).toContain(
				message("en", "scenarios.list.elements", { count: 6 }),
			);
			expect(list.date.startsWith("📅 ")).toBe(true);

			await page.$eval(
				"#listaEscenariosGuardados .btn-outline-danger",
				(element) => element.click(),
			);
			await page.waitForSelector('[id^="modal-confirm-"].show', {
				visible: true,
			});
			await page.waitForFunction(
				() => {
					const element = document.querySelector('[id^="modal-confirm-"].show');
					const instance = element
						? window.bootstrap.Modal.getInstance(element)
						: null;
					return instance && !instance._isTransitioning;
				},
				{ polling: 50 },
			);
			const confirmation = await page.evaluate(() => {
				const element = document.querySelector('[id^="modal-confirm-"].show');
				return {
					title: element.querySelector(".modal-title").textContent.trim(),
					body: element.querySelector(".modal-body").textContent.trim(),
				};
			});
			expect(confirmation).toEqual({
				title: catalogValue("en", "scenarios.list.deleteTitle"),
				body: message("en", "scenarios.list.deleteQuestion", { name }),
			});
			await page.$eval(
				'[id^="modal-confirm-"].show .modal-footer .btn-secondary',
				(element) => element.click(),
			);
			await page.waitForFunction(
				() => !document.querySelector('[id^="modal-confirm-"]'),
				{ polling: 100, timeout: 5000 },
			);
			expect(
				await page.$$eval(
					"#listaEscenariosGuardados .list-group-item",
					(elements) => elements.length,
				),
			).toBe(1);

			await page.$eval(
				"#listaEscenariosGuardados .btn-outline-danger",
				(element) => element.click(),
			);
			await page.waitForSelector('[id^="modal-confirm-"].show', {
				visible: true,
			});
			await page.waitForFunction(
				() => {
					const element = document.querySelector('[id^="modal-confirm-"].show');
					const instance = element
						? window.bootstrap.Modal.getInstance(element)
						: null;
					return instance && !instance._isTransitioning;
				},
				{ polling: 50 },
			);
			await page.$eval(
				'[id^="modal-confirm-"].show .modal-footer .btn-danger',
				(element) => element.click(),
			);
			await page.waitForFunction(
				() => !document.querySelector('[id^="modal-confirm-"]'),
				{ polling: 100, timeout: 5000 },
			);
			const toast = await waitForToast(page);
			expect(toast.header).toContain("bg-success");
			expect(toast.body).toBe(
				message("en", "scenarios.list.deleted", { name }),
			);
			expect(toast.markup).toBe(0);
			expect(
				await page.evaluate(() => localStorage.getItem("escenariosGuardados")),
			).toBe("[]");
			expect(
				await page.$$eval(
					"#listaEscenariosGuardados .list-group-item",
					(elements) => elements.length,
				),
			).toBe(0);
			expect(
				await page.$eval(
					"#noEscenariosMessage",
					(element) => getComputedStyle(element).display,
				),
			).toBe("block");
			expect(simulator.pageErrors).toEqual([]);
		} finally {
			await simulator.close();
		}
	}, 60000);
});
