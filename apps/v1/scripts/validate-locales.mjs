import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildLocaleCatalogs, readLocaleCatalogs } from "./build-locales.mjs"

export const NON_JS_INVENTORY_PATH = fileURLToPath(
	new URL("../src/locales/non-js-keys.json", import.meta.url),
)
export const INDEX_HTML_PATH = fileURLToPath(
	new URL("../index.html", import.meta.url),
)

const PLACEHOLDER_PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g
const PLURAL_SUFFIX_PATTERN = /_(zero|one|two|few|many|other)$/

export function flattenCatalog(catalog, prefix = []) {
	const entries = new Map()
	for (const [key, value] of Object.entries(catalog ?? {})) {
		const path = [...prefix, key]
		if (value && typeof value === "object" && !Array.isArray(value)) {
			for (const [nestedKey, nestedValue] of flattenCatalog(value, path)) {
				entries.set(nestedKey, nestedValue)
			}
		} else {
			entries.set(path.join("."), value)
		}
	}
	return entries
}

export function interpolatedNames(value) {
	const names = new Set()
	for (const match of String(value).matchAll(PLACEHOLDER_PATTERN)) {
		names.add(match[1])
	}
	return names
}

function sameSet(left, right) {
	if (left.size !== right.size) return false
	for (const value of left) if (!right.has(value)) return false
	return true
}

function pluralBase(key) {
	const match = key.match(PLURAL_SUFFIX_PATTERN)
	return match ? key.slice(0, -match[0].length) : null
}

function flattenCatalogs(catalogs) {
	return new Map(
		Object.entries(catalogs).map(([language, namespaces]) => [
			language,
			flattenCatalog(namespaces.translation),
		]),
	)
}

function validateKeyParity(flattened) {
	const errors = []
	const [primary, ...others] = [...flattened.keys()]
	const primaryKeys = flattened.get(primary)
	const baseKey = (key) => pluralBase(key) ?? key
	const primaryBases = new Set([...primaryKeys.keys()].map(baseKey))
	for (const language of others) {
		const keys = flattened.get(language)
		const bases = new Set([...keys.keys()].map(baseKey))
		for (const base of primaryBases) {
			if (!bases.has(base)) errors.push(`${language}: missing key "${base}"`)
		}
		for (const base of bases) {
			if (!primaryBases.has(base)) {
				errors.push(`${primary}: missing key "${base}" (present in ${language})`)
			}
		}
	}
	return errors
}

function validateCatalogValues(entries, language) {
	const errors = []
	for (const [key, value] of entries) {
		if (typeof value !== "string" || value.trim() === "") {
			errors.push(`${language}: "${key}" must be a non-empty string`)
		}
		if (value === key) {
			errors.push(`${language}: "${key}" still contains its key as placeholder text`)
		}
	}
	return errors
}

function validatePluralForms(entries, language) {
	const errors = []
	const pluralBases = new Map()
	for (const key of entries.keys()) {
		const base = pluralBase(key)
		if (!base) continue
		if (!pluralBases.has(base)) pluralBases.set(base, new Set())
		pluralBases.get(base).add(key.slice(key.lastIndexOf("_") + 1))
	}
	for (const [base, forms] of pluralBases) {
		for (const required of ["one", "other"]) {
			if (!forms.has(required)) {
				errors.push(`${language}: plural "${base}" is missing its _${required} form`)
			}
		}
	}
	return errors
}

function validatePlaceholderParity(flattened) {
	const errors = []
	const [primary, ...others] = [...flattened.keys()]
	const primaryKeys = flattened.get(primary)
	for (const language of others) {
		for (const [key, value] of flattened.get(language)) {
			const primaryValue = primaryKeys.get(key)
			if (typeof primaryValue !== "string" || typeof value !== "string") continue
			const expected = interpolatedNames(primaryValue)
			const actual = interpolatedNames(value)
			if (!sameSet(expected, actual)) {
				errors.push(
					`${language}: "${key}" has placeholders {${[...actual].join(", ")}} but ${primary} uses {${[...expected].join(", ")}}`,
				)
			}
		}
	}
	return errors
}

export function validateCatalogParity(catalogs) {
	const flattened = flattenCatalogs(catalogs)
	return [
		...validateKeyParity(flattened),
		...[...flattened].flatMap(([language, entries]) => [
			...validateCatalogValues(entries, language),
			...validatePluralForms(entries, language),
		]),
		...validatePlaceholderParity(flattened),
	]
}

export function collectHtmlMessageKeys(html) {
	const keys = new Set()
	for (const match of html.matchAll(/\bdata-i18n="([^"]+)"/g)) {
		keys.add(match[1])
	}
	for (const match of html.matchAll(/\bdata-i18n-attr="([^"]+)"/g)) {
		for (const pair of match[1].split(";")) {
			const trimmed = pair.trim()
			if (!trimmed) continue
			const separator = trimmed.indexOf(":")
			if (separator <= 0) {
				throw new Error(`Invalid data-i18n-attr entry: ${trimmed}`)
			}
			keys.add(trimmed.slice(separator + 1).trim())
		}
	}
	return keys
}

export function validateNonJsInventory({ inventory, htmlKeys, catalogs }) {
	const errors = []
	const flattened = new Map(
		Object.entries(catalogs).map(([language, namespaces]) => [
			language,
			flattenCatalog(namespaces.translation),
		]),
	)
	const inventoryKeys = new Set([
		...(inventory.html ?? []),
		...(inventory.python ?? []),
	])
	for (const key of htmlKeys) {
		if (!inventoryKeys.has(key)) {
			errors.push(`HTML key "${key}" is not listed in src/locales/non-js-keys.json`)
		}
	}
	for (const key of inventory.html ?? []) {
		if (!htmlKeys.has(key)) {
			errors.push(
				`Inventory HTML key "${key}" is no longer used by index.html; update the inventory`,
			)
		}
	}
	for (const key of inventoryKeys) {
		for (const [language, entries] of flattened) {
			if (!entries.has(key)) {
				errors.push(`${language}: inventory key "${key}" is missing from the catalog`)
			}
		}
	}
	return errors
}

export async function validateRepositoryLocales() {
	const catalogs = await readLocaleCatalogs()
	const [html, inventoryRaw] = await Promise.all([
		readFile(INDEX_HTML_PATH, "utf8"),
		readFile(NON_JS_INVENTORY_PATH, "utf8"),
	])
	let inventory
	try {
		inventory = JSON.parse(inventoryRaw)
	} catch (error) {
		return [`Invalid JSON in ${NON_JS_INVENTORY_PATH}: ${error.message}`]
	}
	return [
		...validateCatalogParity(catalogs),
		...validateNonJsInventory({
			inventory,
			htmlKeys: collectHtmlMessageKeys(html),
			catalogs,
		}),
	]
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		await buildLocaleCatalogs({ check: true })
		const errors = await validateRepositoryLocales()
		if (errors.length > 0) {
			console.error(errors.map((error) => `- ${error}`).join("\n"))
			process.exitCode = 1
		} else {
			console.log("Locale catalogs and non-JavaScript key inventory are valid")
		}
	} catch (error) {
		console.error(error.message)
		process.exitCode = 1
	}
}
