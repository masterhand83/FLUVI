import { readFileSync, readdirSync } from "node:fs"
import { defineConfig, mergeConfig } from "vitest/config"
import baseConfig from "./vitest.config.js"

const testsDirectory = new URL("./tests/", import.meta.url)
const browserSpecsToKeep = new Set([
	"localization.spec.mjs",
	"metrics-localization.spec.mjs",
	"analizador-localization.spec.mjs",
])
const pythonCompatibilitySpecs = ["tests/analizador-python-localization.spec.mjs"]

// `pnpm test` uses this config by default. Fast mode keeps every unit check
// plus the core startup, current metrics, and analyzer localization browser
// specs, and skips every other spec that imports the Puppeteer harness. The
// Python analyzer compatibility spec is also skipped because it needs the
// pandas/matplotlib toolchain; run it through `test:quarantine`. Run other
// focused specs directly when changing their feature. `test:full` runs the
// serial browser suite (minus the quarantined flaky/Python specs) with
// i18next status.
const slowBrowserSpecs = readdirSync(testsDirectory)
	.filter((file) => file.endsWith(".spec.mjs"))
	.filter((file) => !browserSpecsToKeep.has(file))
	.filter((file) =>
		readFileSync(new URL(file, testsDirectory), "utf8").includes(
			"openSimulator",
		),
	)
	.map((file) => `tests/${file}`)

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			exclude: [
				"**/node_modules/**",
				"**/dist/**",
				"tests/baseline/**",
				"tests/smoke/**",
				...slowBrowserSpecs,
				...pythonCompatibilitySpecs,
			],
		},
	}),
)
