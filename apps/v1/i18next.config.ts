import { defineConfig } from "i18next-cli"

export default defineConfig({
	locales: ["es", "en"],
	extract: {
		input: ["src/js/**/*.js"],
		ignore: [
			"src/libs/**",
			"src/bootstrap-5.0.2-dist/**",
		],
		output: "src/locales/{{language}}/{{namespace}}.json",
		functions: [
			"tr",
			"fluviI18n.t",
			"analyzerText",
			"metricText",
			"heatmapText",
			"imageText",
			"fluviNotify.success",
			"fluviNotify.error",
			"fluviNotify.warning",
			"fluviNotify.info",
		],
		defaultNS: "translation",
		primaryLanguage: "es",
		secondaryLanguages: ["en"],
		removeUnusedKeys: false,
		extractFromComments: false,
		sort: true,
		indentation: 2,
	},
})
