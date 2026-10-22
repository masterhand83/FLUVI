import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const analyzerPath = fileURLToPath(
	new URL("../src/python/analizador.py", import.meta.url),
)
const helperPath = fileURLToPath(
	new URL("./helpers/analyze_language.py", import.meta.url),
)
const legacyCsvPath = fileURLToPath(
	new URL("./fixtures/legacy-metrics.csv", import.meta.url),
)
const legacyJsonPath = fileURLToPath(
	new URL("./fixtures/legacy-metrics.json", import.meta.url),
)

function pythonCommand() {
	const direct = spawnSync(
		"python3",
		["-c", "import pandas, numpy, matplotlib, scipy, sklearn"],
		{ encoding: "utf8" },
	)
	if (direct.status === 0) return { command: "python3", args: [] }

	const uv = spawnSync("uv", ["--version"], { encoding: "utf8" })
	if (uv.status === 0) {
		return {
			command: "uv",
			args: [
				"run",
				"--quiet",
				"--with",
				"pandas",
				"--with",
				"numpy",
				"--with",
				"matplotlib",
				"--with",
				"scipy",
				"--with",
				"scikit-learn",
				"python",
			],
		}
	}
	throw new Error(
		"The Python analyzer test requires python3 with pandas/numpy/matplotlib/scipy/scikit-learn, or uv.",
	)
}

function analyzeBothLanguages() {
	const { command, args } = pythonCommand()
	const result = spawnSync(
		command,
		[
			...args,
			helperPath,
			"--analizador",
			analyzerPath,
			"--legacy-csv",
			legacyCsvPath,
			"--legacy-json",
			legacyJsonPath,
		],
		{
			encoding: "utf8",
			env: {
				...process.env,
				MPLBACKEND: "Agg",
				PYTHONDONTWRITEBYTECODE: "1",
			},
			timeout: 180000,
		},
	)
	if (result.status !== 0) {
		throw new Error(
			`Python analyzer language check failed:\n${result.stderr || result.stdout}`,
		)
	}
	return JSON.parse(result.stdout)
}

const parsed = analyzeBothLanguages()

const joined = (summary) => summary.presentation.join("\n")

describe("Python analyzer language support", () => {
	it("keeps numerical results and internal contracts identical across languages", () => {
		for (const kind of ["csv", "json"]) {
			const spanish = parsed[kind].es
			const english = parsed[kind].en
			const defaultLanguage = parsed[kind].default

			expect(spanish.rows).toBeGreaterThan(0)
			expect(english.rows).toBe(spanish.rows)
			expect(defaultLanguage.rows).toBe(spanish.rows)
			expect(english.columns).toEqual(spanish.columns)
			expect(defaultLanguage.columns).toEqual(spanish.columns)
			expect(english.resultKeys).toEqual(spanish.resultKeys)
			expect(defaultLanguage.resultKeys).toEqual(spanish.resultKeys)

			expect(english.numeric).toEqual(spanish.numeric)
			expect(defaultLanguage.numeric).toEqual(spanish.numeric)
			expect(spanish.numeric.data.Densidad).toEqual(
				kind === "csv" ? [12.34, 13, 13.5] : [10.5, 11.25],
			)
			expect(spanish.columns).toEqual(
				expect.arrayContaining([
					"Marca_Tiempo",
					"Densidad",
					"Flujo",
					"Generacion",
					"Velocidad",
					"Entropia",
				]),
			)
		}
	})

	it("renders Spanish by default and translated plot presentation on request", () => {
		const spanish = joined(parsed.csv.es)
		const english = joined(parsed.csv.en)
		const defaultLanguage = joined(parsed.csv.default)

		expect(spanish).toContain("Análisis Temporal de Métricas de Tráfico")
		expect(spanish).toContain("Densidad vs Tiempo")
		expect(spanish).toContain("Día de la Semana")
		expect(spanish).toContain("Lunes")
		expect(spanish).toContain("Sub-utilizado")
		expect(spanish).toContain("Escala Dinámica")

		expect(english).toContain("Temporal Analysis of Traffic Metrics")
		expect(english).toContain("Density vs Time")
		expect(english).toContain("Day of the Week")
		expect(english).toContain("Monday")
		expect(english).toContain("Underused")
		expect(english).toContain("Dynamic Scale")

		expect(english).not.toContain("Análisis Temporal")
		expect(english).not.toContain("Densidad vs Tiempo")
		expect(english).not.toContain("Lunes")
		expect(english).not.toContain("Sub-utilizado")
		expect(spanish).not.toContain("Temporal Analysis")
		expect(spanish).not.toContain("Density vs Time")
		expect(spanish).not.toContain("Monday")
		expect(spanish).not.toContain("Underused")

		expect(defaultLanguage).toBe(spanish)
		expect(english).not.toContain("{{max}}")
		expect(spanish).not.toContain("{{max}}")
		expect(parsed.wrapperDefaults).toEqual({
			analizar_csv_web: "es",
			analizar_json_web: "es",
			analizar_archivo_web: "es",
		})
	})

	it("localizes user-visible Python errors while preserving their meaning", () => {
		expect(parsed.errors.missingMetrics.es).toBe(
			"El archivo JSON debe contener una clave 'metrics' con los datos.",
		)
		expect(parsed.errors.missingMetrics.en).toBe(
			"The JSON file must contain a 'metrics' key with the data.",
		)
		expect(parsed.errors.missingMetrics.default).toBe(
			parsed.errors.missingMetrics.es,
		)

		expect(parsed.errors.missingKey.es).toContain("'speed'")
		expect(parsed.errors.missingKey.es).toContain("Clave requerida")
		expect(parsed.errors.missingKey.en).toContain("'speed'")
		expect(parsed.errors.missingKey.en).toContain("Required key")
		expect(parsed.errors.missingKey.es).not.toContain("Required key")
		expect(parsed.errors.missingKey.en).not.toContain("Clave requerida")

		expect(parsed.errors.invalidJson.es).toContain(
			"No se pudo leer el archivo JSON",
		)
		expect(parsed.errors.invalidJson.en).toContain(
			"The JSON file could not be read",
		)
		expect(parsed.errors.invalidJson.es).not.toContain(
			"The JSON file could not be read",
		)
		expect(parsed.errors.invalidJson.en).not.toContain(
			"No se pudo leer el archivo JSON",
		)

		expect(parsed.errors.readFailed.es).toContain(
			"No se pudieron leer los datos de métricas",
		)
		expect(parsed.errors.readFailed.en).toContain(
			"The metrics data could not be read",
		)
		expect(parsed.errors.readFailed.default).toBe(
			parsed.errors.readFailed.es,
		)
	}, 180000)
})
