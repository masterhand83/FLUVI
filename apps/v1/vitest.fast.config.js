import { readFileSync, readdirSync } from "node:fs"
import { defineConfig, mergeConfig } from "vitest/config"
import baseConfig from "./vitest.config.js"

const testsDirectory = new URL("./tests/", import.meta.url)
const browserSpecsToKeep = new Set([
	"connection-localization.spec.mjs",
	"localization.spec.mjs",
	"street-localization.spec.mjs",
])

// The full suite intentionally exercises the real browser and takes several
// minutes. Fast mode keeps unit checks and the focused localization browser
// spec, and skips every other spec that imports the Puppeteer harness.
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
			],
		},
	}),
)
