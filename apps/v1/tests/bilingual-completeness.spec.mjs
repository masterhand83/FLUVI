import { describe, expect, it } from "vitest"
import { readLocaleCatalogs } from "../scripts/build-locales.mjs"
import { flattenCatalog } from "../scripts/validate-locales.mjs"
import { openSimulator, openStaticDocument } from "./helpers/simulator.mjs"

const hideLoadingScreen = (page) =>
	page.evaluate(() => {
		window.hideLoadingScreen?.()
		document.getElementById("loadingScreen").style.display = "none"
	})

const IGNORED_STATIC_TAGS = [
	"SCRIPT",
	"STYLE",
	"NOSCRIPT",
	"TEMPLATE",
	"KBD",
	"CODE",
	"PRE",
]

// Approved untranslated exceptions. These are proper names, technical
// identifiers, the illustrative machine-format sample, and source-only values
// that application scripts replace before the interface is shown. They are
// intentionally not catalog keys; residual Spanish interface prose is not.
const STATIC_TEXT_EXCEPTIONS = new Set([
	"X:",
	"Y:",
	"Z",
	"FLUVI",
	"JSON",
	"Connor Urbano Mendoza",
	"soyconnor@outlook.com",
	"Luis Gael Molina Figueroa",
	"luisgaelmf@gmail.com",
	"Denisse Márquez Morales",
	"denissemarquez2704@gmail.com",
	"Juárez Martínez Genaro",
	"Maldonado Castillo Idalia",
	"Instituto Politécnico Nacional (IPN)",
	"Escuela Superior de Cómputo (ESCOM)",
	"Artificial Life Robotics (ALIROB)",
	"Español",
	"English",
])

const RUNTIME_TEXT_SELECTORS = [
	"#tiempoActualDisplay",
	"#previewTiempoSeleccionado",
	"#infoSimulatedDateTime",
	"#infoTimePerFrame",
	"#statusPanel",
	".reference-image-unavailable",
	".reference-image-frame",
]

const staticAudit = (page) =>
	page.evaluate(
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one static pass covers text and designated attributes for the audit.
		({ ignoredTags, exceptions, runtimeSelectors }) => {
			const ignoredTagSet = new Set(ignoredTags)
			const exceptionSet = new Set(exceptions)
			const runtimeSelector = runtimeSelectors.join(",")
			const pathOf = (element) => {
				const parts = []
				let node = element
				while (node && node.nodeType === 1 && parts.length < 4) {
					let part = node.tagName.toLowerCase()
					if (node.id) part += `#${node.id}`
					else if (node.classList.length) {
						part += `.${[...node.classList].slice(0, 2).join(".")}`
					}
					parts.unshift(part)
					node = node.parentElement
				}
				return parts.join(" > ")
			}
			const excluded = (element) =>
				!element ||
				ignoredTagSet.has(element.tagName) ||
				Boolean(element.closest(runtimeSelector)) ||
				Boolean(
					element.closest(
						"script, style, noscript, template, #loadingScreen, .visually-hidden",
					),
				)
			const ownsTextNode = (node) => {
				const owner = node.parentElement?.closest("[data-i18n]")
				return Boolean(owner && [...owner.childNodes].includes(node))
			}
			const translatedAttributes = (element) =>
				new Set(
					(element.getAttribute("data-i18n-attr") ?? "")
						.split(";")
						.map((pair) => pair.split(":")[0].trim())
						.filter(Boolean),
				)
			let scannedTexts = 0
			const texts = []
			const walker = document.createTreeWalker(
				document.body,
				NodeFilter.SHOW_TEXT,
			)
			let node = walker.nextNode()
			while (node) {
				const value = node.textContent.replace(/\s+/g, " ").trim()
				if (value && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(value)) {
					scannedTexts++
					const parent = node.parentElement
					if (
						parent &&
						!excluded(parent) &&
						!ownsTextNode(node) &&
						!exceptionSet.has(value)
					) {
						texts.push({ text: value, path: pathOf(parent) })
					}
				}
				node = walker.nextNode()
			}

			let scannedAttributes = 0
			const attributes = []
			for (const name of [
				"title",
				"aria-label",
				"placeholder",
				"alt",
				"data-bs-title",
				"aria-description",
			]) {
				for (const element of document.querySelectorAll(`[${name}]`)) {
					const value = (element.getAttribute(name) ?? "")
						.replace(/\s+/g, " ")
						.trim()
					if (!value || !/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(value)) {
						continue
					}
					scannedAttributes++
					if (
						!translatedAttributes(element).has(name) &&
						!ignoredTagSet.has(element.tagName) &&
						!element.closest(
							"script, style, noscript, template, #loadingScreen, .visually-hidden",
						)
					) {
						attributes.push({
							attribute: name,
							text: value,
							path: pathOf(element),
						})
					}
				}
			}
			return { scannedTexts, scannedAttributes, texts, attributes }
		},
		{
			ignoredTags: IGNORED_STATIC_TAGS,
			exceptions: [...STATIC_TEXT_EXCEPTIONS],
			runtimeSelectors: RUNTIME_TEXT_SELECTORS,
		},
	)

describe("bilingual completeness gates", () => {
	it("annotates every static interface string and designated attribute outside the approved exceptions", async () => {
		const document = await openStaticDocument()
		try {
			const audit = await staticAudit(document.page)
			expect(audit.scannedTexts).toBeGreaterThan(300)
			expect(audit.scannedAttributes).toBeGreaterThan(50)
			expect(audit.texts).toEqual([])
			expect(audit.attributes).toEqual([])
		} finally {
			await document.close()
		}
	})

	it("keeps the English session free of the Spanish strings that used to escape static translation", async () => {
		const simulator = await openSimulator({ languagePreference: "en" })
		try {
			const { page } = simulator
			await hideLoadingScreen(page)
			await page.evaluate(() => {
				for (const button of document.querySelectorAll(
					".accordion-button.collapsed",
				)) {
					button.click()
				}
				window.calleSeleccionada = window.calles[0]
				const selector = document.getElementById("selectCalle")
				selector.value = "0"
				selector.dispatchEvent(new Event("change", { bubbles: true }))
				window.edificioSeleccionado = window.edificios[0]
				window.buildingInspector?.show(window.edificios[0])
				window.editorCalles.modoEdicion = true
				window.calleSeleccionada =
					window.calles.find((calle) => calle.vertices?.length) ??
					window.calles[0]
			})
			await page.keyboard.press("z")
			await page.waitForSelector("#vertexEditModeBadge", { visible: true })

			const audit = await page.evaluate(() => {
				const attributes = []
				for (const name of [
					"title",
					"aria-label",
					"placeholder",
					"alt",
					"data-bs-title",
				]) {
					for (const element of document.querySelectorAll(`[${name}]`)) {
						attributes.push(element.getAttribute(name) ?? "")
					}
				}
				const badge = document.getElementById("vertexEditModeBadge")
				return {
					lang: document.documentElement.lang,
					text: document.body.innerText.replace(/\s+/g, " "),
					attributes: attributes.join("\n"),
					badge: badge?.textContent.replace(/\s+/g, " ").trim(),
				}
			})

			const forbiddenSpanish = [
				"Cómo usar",
				"Crea calles y edificios",
				"Usa el modo edición para posicionarlos",
				"Guarda tu mapa como archivo JSON",
				"Carga mapas guardados anteriormente",
				"Ninguno",
				"Solo este día (",
				"Modo Edición de Vértices",
				"Arrastra los vértices para crear curvas",
				"Presiona Z para desactivar",
				"Cambios guardados correctamente",
			]
			expect(audit.lang).toBe("en")
			expect(audit.badge).toContain("Vertex Edit Mode")
			expect(audit.badge).toContain("Drag vertices to create curves")
			expect(audit.badge).toContain("Press Z to disable")
			for (const phrase of forbiddenSpanish) {
				expect(audit.text, phrase).not.toContain(phrase)
				expect(audit.attributes, phrase).not.toContain(phrase)
			}
			expect(simulator.pageErrors).toEqual([])
			expect(simulator.consoleErrors).toEqual([])
		} finally {
			await simulator.close()
		}
	})

	it("keeps all four notification severities translated in both languages", async () => {
		const catalogs = await readLocaleCatalogs()
		for (const language of ["es", "en"]) {
			const messages = flattenCatalog(catalogs[language].translation)
			const simulator = await openSimulator({
				languagePreference: language,
			})
			try {
				const { page } = simulator
				await hideLoadingScreen(page)
				await page.evaluate(() => {
					window.fluviNotify.success(
						"notifications.simulation.changesAppliedLaneChange",
						{ name: "Main street", laneChange: 12 },
						60000,
					)
					window.fluviNotify.error(
						"notifications.streetSelection.required",
						undefined,
						60000,
					)
					window.fluviNotify.warning(
						"notifications.simulation.generationRange",
						undefined,
						60000,
					)
					window.fluviNotify.info("loading.status.ready", undefined, 60000)
				})
				await page.waitForFunction(
					() => document.querySelectorAll(".toast").length >= 4,
					{ timeout: 5000 },
				)
				const toasts = await page.$$eval(".toast", (elements) =>
					elements.map((element) => ({
						header: element.querySelector(".toast-header").className,
						title: element.querySelector(".toast-header strong").textContent,
						body: element.querySelector(".toast-body").textContent,
						close: element
							.querySelector('[data-bs-dismiss="toast"]')
							.getAttribute("aria-label"),
					})),
				)
				expect(toasts).toHaveLength(4)
				expect(toasts.map((toast) => toast.header)).toEqual([
					"toast-header bg-success text-white",
					"toast-header bg-danger text-white",
					"toast-header bg-warning text-dark",
					"toast-header bg-info text-white",
				])
				expect(toasts.map((toast) => toast.title)).toEqual(
					["success", "error", "warning", "info"].map(
						(severity, index) =>
							`${["✅", "❌", "⚠️", "ℹ️"][index]}${messages.get(
								`notifications.title.${severity}`,
							)}`,
					),
				)
				expect(toasts.every((toast) => toast.close === messages.get("common.close"))).toBe(
					true,
				)
				expect(toasts[1].body).not.toMatch(/^notifications\./)
			} finally {
				await simulator.close()
			}
		}
	}, 180000)
})
