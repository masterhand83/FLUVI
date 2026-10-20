import { defineConfig } from "i18next-cli"

export default defineConfig({
	locales: ["es", "en"],
	extract: {
		input: ["src/js/**/*.js"],
		ignore: [
			// The shared interface forwards dynamic keys to i18next; its literals are
			// catalog lookups, not user-facing calls to extract.
			"src/js/ui/i18n.js",
			"src/libs/**",
			"src/bootstrap-5.0.2-dist/**",
		],
		output: "src/locales/{{language}}/{{namespace}}.json",
		functions: [
			"tr",
			"fluviI18n.t",
			"fluviNotify.success",
			"fluviNotify.error",
			"fluviNotify.warning",
			"fluviNotify.info",
			"fluviNotify.confirm",
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
