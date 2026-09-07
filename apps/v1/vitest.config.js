import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		include: ["tests/**/*.spec.{js,mjs}"],
		testTimeout: 180000,
		hookTimeout: 180000,
		fileParallelism: false,
	},
})
