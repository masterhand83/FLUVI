/**
 * i18n.js - Shared Spanish/English localization interface for the classic-script app.
 *
 * Startup contract:
 * - index.html loads the vendored i18next, the generated catalogs, then this file in
 *   the document head, before body markup and before every application script.
 * - The saved preference is read synchronously and the document language is set
 *   before user-facing text is evaluated.
 * - DOM translations run on DOMContentLoaded and can be re-applied explicitly.
 */
(() => {
	const SUPPORTED_LANGUAGES = Object.freeze(
		Array.isArray(window.FLUVI_SUPPORTED_LANGUAGES)
			? window.FLUVI_SUPPORTED_LANGUAGES.filter(
					(language) => language === "es" || language === "en",
				)
			: ["es", "en"],
	);
	const FALLBACK_LANGUAGE =
		window.FLUVI_FALLBACK_LANGUAGE === "en" ? "en" : "es";
	const STORAGE_KEY = "fluvi.interfaceLanguage";
	const DEFAULT_LANGUAGE = "es";
	const resources = window.FLUVI_LOCALE_RESOURCES || {
		es: { translation: {} },
		en: { translation: {} },
	};
	const engine = window.i18next;

	const isSupportedLanguage = (language) =>
		SUPPORTED_LANGUAGES.includes(language);

	function readLanguagePreference() {
		try {
			const saved = window.localStorage.getItem(STORAGE_KEY);
			return isSupportedLanguage(saved) ? saved : null;
		} catch {
			return null;
		}
	}

	function saveLanguagePreference(language) {
		if (!isSupportedLanguage(language)) {
			return { saved: false, reason: "invalid" };
		}
		try {
			window.localStorage.setItem(STORAGE_KEY, language);
			if (window.localStorage.getItem(STORAGE_KEY) !== language) {
				return { saved: false, reason: "storage" };
			}
			return { saved: true, reason: "saved" };
		} catch {
			return { saved: false, reason: "storage" };
		}
	}

	const activeLanguage = readLanguagePreference() || DEFAULT_LANGUAGE;

	if (engine && typeof engine.init === "function") {
		engine.init({
			resources,
			lng: activeLanguage,
			fallbackLng: FALLBACK_LANGUAGE,
			supportedLngs: [...SUPPORTED_LANGUAGES],
			load: "currentOnly",
			ns: ["translation"],
			defaultNS: "translation",
			initAsync: false,
			returnNull: false,
			saveMissing: false,
			interpolation: { escapeValue: false },
		});
	}

	document.documentElement.lang = activeLanguage;
	document.documentElement.setAttribute(
		"data-active-language",
		activeLanguage,
	);

	function translate(key, options = {}) {
		if (engine && typeof engine.t === "function") {
			const translated = engine.t(key, options);
			return typeof translated === "string" ? translated : key;
		}
		return key;
	}

	function translateEscaped(key, options = {}) {
		if (engine && typeof engine.t === "function") {
			const translated = engine.t(key, {
				...options,
				interpolation: {
					...(options.interpolation || {}),
					escapeValue: true,
				},
			});
			return typeof translated === "string" ? translated : key;
		}
		return key;
	}

	function applyTextPreservingChildren(element, text) {
		if (!element) return;
		const elementChildren = [...element.children];
		if (elementChildren.length === 0) {
			element.textContent = text;
			return;
		}
		const textNodes = [...element.childNodes].filter(
			(node) => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim(),
		);
		if (textNodes.length > 0) {
			textNodes[0].nodeValue = text;
			for (const extra of textNodes.slice(1)) extra.remove();
			return;
		}
		const textNode = document.createTextNode(text);
		element.append(textNode);
	}

	function attributePairs(raw) {
		const pairs = [];
		for (const entry of String(raw || "").split(";")) {
			const trimmed = entry.trim();
			if (!trimmed) continue;
			const separator = trimmed.indexOf(":");
			if (separator <= 0) continue;
			pairs.push({
				attribute: trimmed.slice(0, separator).trim(),
				key: trimmed.slice(separator + 1).trim(),
			});
		}
		return pairs;
	}

	function translateElement(element) {
		if (!element) return;
		const textKey = element.getAttribute?.("data-i18n");
		if (textKey) {
			applyTextPreservingChildren(element, translate(textKey));
		}
		const attributes = element.getAttribute?.("data-i18n-attr");
		if (attributes) {
			for (const pair of attributePairs(attributes)) {
				element.setAttribute(pair.attribute, translate(pair.key));
				if (pair.attribute === "data-bs-title") refreshTooltip(element);
			}
		}
	}

	function translateDocument(root = document) {
		const scope = root?.querySelectorAll ? root : document;
		if (scope === document) {
			translateElement(document.documentElement);
			translateElement(document.body);
		}
		for (const element of scope.querySelectorAll("[data-i18n]")) {
			translateElement(element);
		}
		for (const element of scope.querySelectorAll("[data-i18n-attr]")) {
			translateElement(element);
		}
	}

	function setText(element, key, options) {
		if (!element) return;
		applyTextPreservingChildren(element, translate(key, options));
	}

	function setAttribute(element, attribute, key, options) {
		if (!element) return;
		element.setAttribute(attribute, translate(key, options));
		if (attribute === "data-bs-title") refreshTooltip(element);
	}

	function refreshTooltip(element) {
		const bootstrapApi = window.bootstrap;
		if (!bootstrapApi?.Tooltip || !element) return;
		const instance = bootstrapApi.Tooltip.getInstance(element);
		const title = element.getAttribute("data-bs-title");
		if (instance && title) {
			instance.setContent({ ".tooltip-inner": title });
		}
	}

	function showLanguageNotice(notice, state, text) {
		if (!notice) return;
		notice.classList.toggle("text-warning", state === "storage-error" || state === "invalid");
		notice.classList.toggle("text-success", state === "saved");
		notice.dataset.state = state;
		notice.textContent = text;
	}

	function applyLanguageSelection(language, notice) {
		if (!isSupportedLanguage(language)) {
			showLanguageNotice(
				notice,
				"invalid",
				translate("settings.language.invalid"),
			);
			return;
		}
		const result = saveLanguagePreference(language);
		const state = result.saved
			? "saved"
			: result.reason === "invalid"
				? "invalid"
				: "storage-error";
		const key =
			state === "saved"
				? "settings.language.savedNotice"
				: state === "invalid"
					? "settings.language.invalid"
					: "settings.language.storageError";
		showLanguageNotice(notice, state, translate(key));
	}

	function initializeLanguageSelector() {
		const select = document.getElementById("languagePreference");
		const notice = document.getElementById("languagePreferenceNotice");
		if (!select) return;
		const saved = readLanguagePreference();
		select.value = saved || activeLanguage;
		select.addEventListener("change", () => {
			applyLanguageSelection(select.value, notice);
		});
	}

	window.fluviI18n = Object.freeze({
		activeLanguage,
		fallbackLanguage: FALLBACK_LANGUAGE,
		supportedLanguages: SUPPORTED_LANGUAGES,
		storageKey: STORAGE_KEY,
		isSupportedLanguage,
		readLanguagePreference,
		saveLanguagePreference,
		t: translate,
		tEscaped: translateEscaped,
		translateDocument,
		translateElement,
		setText,
		setAttribute,
		refreshTooltip,
	});
	window.tr = translate;

	const startDomIntegration = () => {
		translateDocument(document);
		initializeLanguageSelector();
	};
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", startDomIntegration, {
			once: true,
		});
	} else {
		startDomIntegration();
	}
})();
