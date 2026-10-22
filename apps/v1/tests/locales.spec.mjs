import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import i18next from "i18next"
import { describe, expect, it } from "vitest"
import {
	buildLocaleCatalogs,
	readLocaleCatalogs,
	renderAnalyzerMessages,
	analyzerMessagesPath,
} from "../scripts/build-locales.mjs"
import {
	collectHtmlMessageKeys,
	flattenCatalog,
	validateCatalogParity,
	validateNonJsInventory,
	validateRepositoryLocales,
} from "../scripts/validate-locales.mjs"

const require = createRequire(import.meta.url)
const v1Root = new URL("../", import.meta.url)

async function createInstance(resources, language, fallbackLng = "es") {
	const instance = i18next.createInstance()
	await instance.init({
		resources,
		lng: language,
		fallbackLng,
		supportedLngs: ["es", "en"],
		ns: ["translation"],
		defaultNS: "translation",
		initAsync: false,
		returnNull: false,
		interpolation: { escapeValue: false },
	})
	return instance
}

describe("repository locale catalogs", () => {
	it("keeps Spanish and English keys, placeholders, and plural forms aligned", async () => {
		expect(await validateRepositoryLocales()).toEqual([])
	})

	it("rejects a missing production key and a mismatched placeholder", async () => {
		const catalogs = await readLocaleCatalogs()
		const broken = structuredClone(catalogs)
		delete broken.en.translation.streetInspector.name
		expect(validateCatalogParity(broken)).toContain(
			'en: missing key "streetInspector.name"',
		)

		const mismatched = structuredClone(catalogs)
		mismatched.en.translation.streetInspector.laneDirection =
			"Lane {{lane}}"
		expect(
			validateCatalogParity(mismatched).some((error) =>
				error.includes('"streetInspector.laneDirection" has placeholders'),
			),
		).toBe(true)
	})

	it("keeps the generated browser bundle in sync with the JSON catalogs", async () => {
		await expect(buildLocaleCatalogs({ check: true })).resolves.toMatchObject({
			changed: false,
		})
	})

	it("inventories every HTML-owned key that extraction cannot discover", async () => {
		const [catalogs, html, inventory] = await Promise.all([
			readLocaleCatalogs(),
			readFile(new URL("index.html", v1Root), "utf8"),
			JSON.parse(
				await readFile(
					new URL("src/locales/non-js-keys.json", v1Root),
					"utf8",
				),
			),
		])
		expect(
			validateNonJsInventory({
				inventory,
				htmlKeys: collectHtmlMessageKeys(html),
				catalogs,
			}),
		).toEqual([])
	})

	it("ships the generated Python analyzer catalog with aligned messages", async () => {
		const catalogs = await readLocaleCatalogs()
		expect(await readFile(analyzerMessagesPath(), "utf8")).toBe(
			renderAnalyzerMessages(catalogs),
		)
		const generated = JSON.parse(
			await readFile(analyzerMessagesPath(), "utf8"),
		)
		expect(Object.keys(generated).sort()).toEqual(["en", "es"])
		const spanish = flattenCatalog(catalogs.es.translation)
		const english = flattenCatalog(catalogs.en.translation)
		const pythonKeys = [...spanish]
			.filter(([key]) => key.startsWith("analyzer.python."))
			.map(([key]) => key)
		expect(Object.keys(generated.es).sort()).toEqual(pythonKeys.sort())
		expect(Object.keys(generated.en).sort()).toEqual(pythonKeys.sort())
		for (const key of pythonKeys) {
			expect(english.has(key)).toBe(true)
			expect(generated.es[key]).toBe(spanish.get(key))
			expect(generated.en[key]).toBe(english.get(key))
		}
		const inventory = JSON.parse(
			await readFile(
				new URL("src/locales/non-js-keys.json", v1Root),
				"utf8",
			),
		)
		expect([...inventory.python].sort()).toEqual(pythonKeys.sort())
	})

	it("falls back to readable Spanish when an English key is missing", async () => {
		const catalogs = structuredClone(await readLocaleCatalogs())
		delete catalogs.en.translation.streetInspector.name
		const instance = await createInstance(catalogs, "en")
		expect(instance.t("streetInspector.name")).toBe("Nombre")
	})

	it("resolves Spanish and English plurals from the shared call pattern", async () => {
		const catalogs = await readLocaleCatalogs()
		const spanish = await createInstance(catalogs, "es")
		const english = await createInstance(catalogs, "en")
		expect(
			spanish.t("streetInspector.laneDirectionsCount", { count: 1 }),
		).toBe("Sentido por carril: 1 carril")
		expect(
			spanish.t("streetInspector.laneDirectionsCount", { count: 2 }),
		).toBe("Sentido por carril: 2 carriles")
		expect(
			english.t("streetInspector.laneDirectionsCount", { count: 1 }),
		).toBe("Direction per lane: 1 lane")
		expect(
			english.t("streetInspector.laneDirectionsCount", { count: 2 }),
		).toBe("Direction per lane: 2 lanes")
	})

	it("distributes the pinned browser build and catalogs with the static app", async () => {
		const packagePath = require.resolve("i18next/package.json")
		const packageJson = JSON.parse(await readFile(packagePath, "utf8"))
		const versionFile = await readFile(
			new URL("src/libs/i18next/VERSION", v1Root),
			"utf8",
		)
		expect(versionFile).toContain(`i18next ${packageJson.version}`)

		const vendored = await readFile(
			new URL("src/libs/i18next/i18next.min.js", v1Root),
		)
		const installed = await readFile(
			join(dirname(packagePath), "dist/umd/i18next.min.js"),
		)
		expect(vendored.equals(installed)).toBe(true)

		const catalogs = await readFile(
			new URL("src/locales/catalogs.js", v1Root),
			"utf8",
		)
		expect(catalogs).toContain("window.FLUVI_LOCALE_RESOURCES")
		expect(catalogs).toContain('"translation"')
	})

	it("loads localization before body content and application messages", async () => {
		const html = await readFile(new URL("index.html", v1Root), "utf8")
		const i18nextIndex = html.indexOf("src/libs/i18next/i18next.min.js")
		const catalogsIndex = html.indexOf("src/locales/catalogs.js")
		const i18nIndex = html.indexOf("src/js/ui/i18n.js")
		const headEnd = html.indexOf("</head>")
		const loadingIndex = html.indexOf("src/js/ui/loadingSystem.js")
		expect(i18nextIndex).toBeGreaterThan(-1)
		expect(catalogsIndex).toBeGreaterThan(i18nextIndex)
		expect(i18nIndex).toBeGreaterThan(catalogsIndex)
		expect(i18nIndex).toBeLessThan(headEnd)
		expect(loadingIndex).toBeGreaterThan(i18nIndex)
		expect(html).toContain('<html lang="es">')
	})
})
