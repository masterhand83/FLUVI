import { defineConfig, mergeConfig } from "vitest/config"
import baseConfig from "./vitest.config.js"

// The full run keeps the serial browser suite but skips the specs that have
// repeatedly timed out on Pixi startup or transient static-server connections.
// Run them explicitly with `pnpm --filter v1 test:quarantine` (or by file path)
// when changing map labels, building appearance, or export timestamps.
const quarantinedSpecs = [
	"tests/map-labels.spec.mjs",
	"tests/building-localization.spec.mjs",
	"tests/export-timestamps.spec.mjs",
]

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			exclude: [
				"**/node_modules/**",
				"**/dist/**",
				"tests/baseline/**",
				"tests/smoke/**",
				...quarantinedSpecs,
			],
		},
	}),
)
