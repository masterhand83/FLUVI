mod fonts;
mod help;
mod i18n;
mod preferences;
mod themes;
mod ui;

pub use fonts::label_font;
pub use i18n::{Language, Translator};
pub use preferences::Preferences;
pub use preferences::config_path;

use crossbeam_channel::{Receiver, Sender, bounded};
use std::{collections::VecDeque, io, path::PathBuf, time::Instant};

#[derive(Clone, Copy)]
pub enum Severity {
    Success,
    Error,
    Warning,
    Info,
}

impl Severity {
    pub fn title_key(self) -> &'static str {
        match self {
            Self::Success => "notifications.title.success",
            Self::Error => "notifications.title.error",
            Self::Warning => "notifications.title.warning",
            Self::Info => "notifications.title.info",
        }
    }
}

pub struct Notice {
    pub severity: Severity,
    pub message: String,
    created: Instant,
}

pub struct Confirmation {
    pub title: String,
    pub message: String,
    answer: Sender<bool>,
}

/// Shared UI service. It owns no simulation state or render resources.
pub struct Shell {
    translator: Translator,
    preferences: Preferences,
    path: Option<PathBuf>,
    notices: VecDeque<Notice>,
    confirmations: VecDeque<Confirmation>,
    help: Option<bool>,
    advanced_settings: bool,
    themes: Vec<crate::themes::Theme>,
    theme_job: Option<Receiver<io::Result<Option<crate::themes::Theme>>>>,
    fonts: fonts::Fonts,
}

impl Shell {
    pub fn load(path: Option<PathBuf>) -> Self {
        let (mut preferences, warning) = path
            .as_ref()
            .map(|path| Preferences::load(path))
            .unwrap_or((Preferences::default(), true));
        let (themes, mut theme_warning) = path
            .as_ref()
            .and_then(|path| path.parent())
            .map(|parent| crate::themes::load_directory(&parent.join("themes")))
            .unwrap_or_else(|| (crate::themes::builtins(), false));
        if !themes.iter().any(|theme| theme.id == preferences.theme) {
            preferences.theme = "default".into();
            theme_warning = true;
        }
        let mut shell = Self {
            translator: Translator::new(preferences.language),
            preferences,
            path,
            notices: VecDeque::new(),
            confirmations: VecDeque::new(),
            help: None,
            advanced_settings: false,
            themes,
            theme_job: None,
            fonts: Default::default(),
        };
        if warning {
            shell.notify(Severity::Warning, shell.tr("shell.preferencesWarning", &[]));
        }
        if theme_warning {
            shell.notify(Severity::Warning, shell.tr("theme.loadWarning", &[]));
        }
        shell
    }

    pub fn preferences(&self) -> &Preferences {
        &self.preferences
    }

    pub fn translator(&self) -> &Translator {
        &self.translator
    }

    pub fn tr(&self, key: &str, params: &[(&str, &str)]) -> String {
        self.translator.tr(key, params)
    }

    pub fn set_preferences(&mut self, preferences: Preferences) -> io::Result<()> {
        if !self
            .themes
            .iter()
            .any(|theme| theme.id == preferences.theme)
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Unknown UI theme",
            ));
        }
        let result = self
            .path
            .as_ref()
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::NotFound, "user config directory unavailable")
            })
            .and_then(|path| preferences.save(path));
        if let Err(error) = result {
            self.notify(
                Severity::Error,
                self.tr("shell.saveError", &[("reason", &error.to_string())]),
            );
            return Err(error);
        }
        let changed_language = preferences.language != self.preferences.language;
        self.preferences = preferences;
        if changed_language {
            self.notify(
                Severity::Info,
                self.tr("settings.language.savedNotice", &[]),
            );
        }
        Ok(())
    }

    pub fn notify(&mut self, severity: Severity, message: impl Into<String>) {
        if self.notices.len() == 8 {
            self.notices.pop_front();
        }
        self.notices.push_back(Notice {
            severity,
            message: message.into(),
            created: Instant::now(),
        });
    }

    pub fn notices(&self) -> impl DoubleEndedIterator<Item = &Notice> {
        self.notices.iter()
    }

    /// Non-blocking: callers poll the returned receiver in their update loop.
    /// Overload declines safely instead of growing the queue without a limit.
    pub fn confirm(
        &mut self,
        title: impl Into<String>,
        message: impl Into<String>,
    ) -> Receiver<bool> {
        let (answer, receiver) = bounded(1);
        if self.confirmations.len() == 8 {
            let _ = answer.try_send(false);
        } else {
            self.confirmations.push_back(Confirmation {
                title: title.into(),
                message: message.into(),
                answer,
            });
        }
        receiver
    }

    pub fn confirmation(&self) -> Option<&Confirmation> {
        self.confirmations.front()
    }

    pub fn resolve_confirmation(&mut self, accepted: bool) {
        if let Some(confirmation) = self.confirmations.pop_front() {
            let _ = confirmation.answer.try_send(accepted);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidebar_and_help_do_not_render_missing_glyphs() {
        fn check(
            ctx: &eframe::egui::Context,
            shape: &eframe::egui::Shape,
            missing: &mut std::collections::BTreeSet<char>,
        ) {
            match shape {
                eframe::egui::Shape::Text(text) => {
                    for section in &text.galley.job.sections {
                        let content = &text.galley.job.text[section.byte_range.clone()];
                        for character in content.chars().filter(|c| !c.is_whitespace()) {
                            if !ctx.fonts_mut(|fonts| {
                                fonts.has_glyph(&section.format.font_id, character)
                            }) {
                                missing.insert(character);
                            }
                        }
                    }
                }
                eframe::egui::Shape::Vec(shapes) => {
                    for shape in shapes {
                        check(ctx, shape, missing);
                    }
                }
                _ => {}
            }
        }
        let mut missing = std::collections::BTreeSet::new();
        for language in [Language::English, Language::Spanish] {
            let mut shell = Shell::load(None);
            shell.translator = Translator::new(language);
            let ctx = eframe::egui::Context::default();
            frame(&mut shell, &ctx, vec![]);
            for help in [None, Some(false), Some(true)] {
                shell.help = help;
                let output = frame(&mut shell, &ctx, vec![]);
                for shape in output.shapes {
                    check(&ctx, &shape.shape, &mut missing);
                }
            }
        }
        assert!(missing.is_empty(), "Missing UI glyphs: {missing:?}");
    }

    #[test]
    fn customization_dropdown_switches_and_saves_the_ui_theme() {
        let path =
            std::env::temp_dir().join(format!("fluvi-theme-dropdown-{}.json", std::process::id()));
        Preferences {
            language: Language::English,
            panels_open: [false, false, false, false, false, false, true],
            ..Default::default()
        }
        .save(&path)
        .unwrap();
        let mut shell = Shell::load(Some(path.clone()));
        let ctx = eframe::egui::Context::default();
        frame(&mut shell, &ctx, vec![]);
        let output = frame(&mut shell, &ctx, vec![]);
        assert!(text_rect(&output, "Theme").is_some());
        click(&mut shell, &ctx, text_rect(&output, "Default").unwrap());
        let output = frame(&mut shell, &ctx, vec![]);
        click(&mut shell, &ctx, text_rect(&output, "Nord").unwrap());
        assert_eq!(shell.preferences().theme, "nord");
        assert_eq!(
            ctx.style().visuals.panel_fill,
            eframe::egui::Color32::from_rgb(46, 52, 64)
        );
        assert_eq!(Shell::load(Some(path.clone())).preferences().theme, "nord");
        std::fs::remove_file(path).unwrap();
    }

    fn frame(
        shell: &mut Shell,
        ctx: &eframe::egui::Context,
        events: Vec<eframe::egui::Event>,
    ) -> eframe::egui::FullOutput {
        ctx.run(
            eframe::egui::RawInput {
                screen_rect: Some(eframe::egui::Rect::from_min_size(
                    eframe::egui::Pos2::ZERO,
                    eframe::egui::vec2(1100.0, 850.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                shell.sidebar(ctx);
                shell.overlays(ctx);
            },
        )
    }

    fn text_rect(output: &eframe::egui::FullOutput, text: &str) -> Option<eframe::egui::Rect> {
        fn find(shape: &eframe::egui::epaint::Shape, text: &str) -> Option<eframe::egui::Rect> {
            match shape {
                eframe::egui::epaint::Shape::Text(shape)
                    if shape.galley.job.text.contains(text) =>
                {
                    Some(shape.visual_bounding_rect())
                }
                eframe::egui::epaint::Shape::Vec(shapes) => {
                    shapes.iter().find_map(|shape| find(shape, text))
                }
                _ => None,
            }
        }
        output
            .shapes
            .iter()
            .find_map(|shape| find(&shape.shape, text))
    }

    fn click(shell: &mut Shell, ctx: &eframe::egui::Context, rect: eframe::egui::Rect) {
        use eframe::egui::{Event, Modifiers, PointerButton};
        for pressed in [true, false] {
            frame(
                shell,
                ctx,
                vec![
                    Event::PointerMoved(rect.center()),
                    Event::PointerButton {
                        pos: rect.center(),
                        button: PointerButton::Primary,
                        pressed,
                        modifiers: Modifiers::default(),
                    },
                ],
            );
        }
    }

    #[test]
    fn full_help_buttons_open_their_documents_and_close_without_changing_preferences() {
        for language in [Language::English, Language::Spanish] {
            for guide in [false, true] {
                let mut shell = Shell::load(None);
                shell.translator = Translator::new(language);
                let original = shell.preferences().clone();
                let ctx = eframe::egui::Context::default();
                frame(&mut shell, &ctx, vec![]);
                let output = frame(&mut shell, &ctx, vec![]);
                let key = if guide {
                    "about.guideButton"
                } else {
                    "about.aboutButton"
                };
                let button = text_rect(&output, &shell.tr(key, &[])).unwrap();
                click(&mut shell, &ctx, button);
                assert_eq!(shell.help, Some(guide));
                frame(&mut shell, &ctx, vec![]);
                let output = frame(&mut shell, &ctx, vec![]);
                let expected = match (language, guide) {
                    (Language::English, false) => "Introduction",
                    (Language::Spanish, false) => "Introducción",
                    (Language::English, true) => "Basic Controls",
                    (Language::Spanish, true) => "Controles Básicos",
                };
                assert!(text_rect(&output, expected).is_some(), "{expected}");
                let close = text_rect(&output, &shell.tr("common.close", &[])).unwrap();
                assert!(close.bottom() <= 850.0);
                click(&mut shell, &ctx, close);
                assert_eq!(shell.help, None);
                assert_eq!(shell.preferences(), &original);
            }
        }
    }

    #[test]
    fn sidebar_clicks_persist_and_confirmation_buttons_are_translated() {
        let path = std::env::temp_dir().join(format!("fluvi-shell-{}-ui.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut shell = Shell::load(Some(path.clone()));
        let ctx = eframe::egui::Context::default();
        frame(&mut shell, &ctx, vec![]);
        let output = frame(&mut shell, &ctx, vec![]);
        let section = text_rect(&output, "Constructor de Mapas").unwrap();
        click(&mut shell, &ctx, section);
        assert!(Shell::load(Some(path.clone())).preferences().panels_open[2]);
        let output = frame(&mut shell, &ctx, vec![]);
        let hide = text_rect(&output, "Ocultar panel de control").unwrap();
        click(&mut shell, &ctx, hide);
        assert!(
            !Shell::load(Some(path.clone()))
                .preferences()
                .sidebar_visible
        );
        let answer = shell.confirm("Eliminar", "<b>mapa</b>");
        frame(&mut shell, &ctx, vec![]);
        let output = frame(&mut shell, &ctx, vec![]);
        assert!(text_rect(&output, "<b>mapa</b>").is_some());
        assert!(text_rect(&output, "Cancelar").is_some());
        click(&mut shell, &ctx, text_rect(&output, "Confirmar").unwrap());
        assert!(answer.try_recv().unwrap());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn cell_detection_toggle_survives_restart() {
        let path =
            std::env::temp_dir().join(format!("fluvi-shell-{}-detection.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut shell = Shell::load(Some(path.clone()));
        assert!(!shell.preferences().cell_detection);
        let ctx = eframe::egui::Context::default();
        frame(&mut shell, &ctx, vec![]);
        let output = frame(&mut shell, &ctx, vec![]);
        let toggle = text_rect(&output, &shell.tr("settings.cellDetection.label", &[])).unwrap();
        click(&mut shell, &ctx, toggle);
        assert!(shell.preferences().cell_detection);
        assert!(Shell::load(Some(path.clone())).preferences().cell_detection);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn language_change_is_saved_but_session_translation_stays_fixed() {
        let path =
            std::env::temp_dir().join(format!("fluvi-shell-{}-language.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut shell = Shell::load(Some(path.clone()));
        let mut prefs = shell.preferences().clone();
        prefs.language = Language::English;
        shell.set_preferences(prefs).unwrap();
        assert_eq!(shell.tr("common.cancel", &[]), "Cancelar");
        assert_eq!(
            shell.notices().next().unwrap().message,
            "El idioma seleccionado se aplicará la próxima vez que inicies FLUVI."
        );
        let restarted = Shell::load(Some(path.clone()));
        assert_eq!(restarted.tr("common.cancel", &[]), "Cancel");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn corrupt_preferences_warn_and_failed_saves_keep_the_session_usable() {
        let path =
            std::env::temp_dir().join(format!("fluvi-shell-{}-invalid.json", std::process::id()));
        std::fs::write(&path, "not JSON").unwrap();
        let shell = Shell::load(Some(path.clone()));
        assert_eq!(shell.preferences(), &Preferences::default());
        assert_eq!(
            shell.notices().next().unwrap().message,
            "No se pudieron leer algunas preferencias. Se usaron los valores predeterminados."
        );
        // A file cannot be the parent directory of the config file.
        let mut shell = Shell::load(Some(path.join("preferences.json")));
        let mut changed = shell.preferences().clone();
        changed.language = Language::English;
        assert!(shell.set_preferences(changed).is_err());
        assert_eq!(shell.preferences().language, Language::Spanish);
        assert_eq!(shell.tr("common.confirm", &[]), "Confirmar");
        assert!(matches!(
            shell.notices().last().unwrap().severity,
            Severity::Error
        ));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn loading_screen_shows_localized_status_and_progress() {
        let mut shell = Shell::load(None);
        let ctx = eframe::egui::Context::default();
        let _ = ctx.run(Default::default(), |ctx| {
            shell.loading(ctx, 0.1, "loading.status.initializing");
        });
        let output = ctx.run(Default::default(), |ctx| {
            shell.loading(ctx, 0.4, "loading.status.engine");
        });
        assert!(text_rect(&output, "Cargando simulación...").is_some());
        assert!(text_rect(&output, "Inicializando motor gráfico...").is_some());
        assert!(text_rect(&output, "40%").is_some());
        assert!(text_rect(&output, "No se pudieron leer algunas preferencias.").is_some());
    }

    #[test]
    fn shared_feedback_keeps_user_names_literal_and_returns_confirmation_result() {
        let mut shell = Shell::load(None);
        shell.notify(Severity::Success, "<script>{{name}}</script>");
        let notice = shell.notices().last().unwrap();
        assert_eq!(notice.message, "<script>{{name}}</script>");
        assert_eq!(shell.tr(notice.severity.title_key(), &[]), "Éxito");
        for (severity, title) in [
            (Severity::Error, "Error"),
            (Severity::Warning, "Advertencia"),
            (Severity::Info, "Información"),
        ] {
            shell.notify(severity, "plain text");
            assert_eq!(shell.tr(severity.title_key(), &[]), title);
        }
        let answer = shell.confirm("Delete?", "<b>My map</b>");
        assert!(answer.try_recv().is_err());
        assert_eq!(shell.confirmation().unwrap().message, "<b>My map</b>");
        shell.resolve_confirmation(true);
        assert!(answer.try_recv().unwrap());
        let answer = shell.confirm("Delete?", "Other map");
        shell.resolve_confirmation(false);
        assert!(!answer.try_recv().unwrap());
    }

    #[test]
    fn preferences_survive_restart_and_corruption_is_recoverable() {
        let path = std::env::temp_dir().join(format!(
            "fluvi-shell-{}-preferences.json",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let (mut prefs, warning) = Preferences::load(&path);
        assert!(!warning);
        assert_eq!(prefs.language, Language::Spanish);
        assert!(prefs.sidebar_visible);
        prefs.language = Language::English;
        prefs.sidebar_visible = false;
        prefs.panels_open[2] = true;
        prefs.cell_detection = false;
        prefs.dark_mode = true;
        prefs.save(&path).unwrap();
        let (restored, warning) = Preferences::load(&path);
        assert!(!warning);
        assert_eq!(restored, prefs);
        std::fs::write(
            &path,
            r#"{"language":"xx","dark_mode":3,"sidebar_visible":false}"#,
        )
        .unwrap();
        let (partial, warning) = Preferences::load(&path);
        assert!(warning);
        assert_eq!(partial.language, Language::Spanish);
        assert!(!partial.dark_mode);
        assert!(!partial.sidebar_visible);
        std::fs::write(&path, "{broken").unwrap();
        let (restored, warning) = Preferences::load(&path);
        assert!(warning);
        assert_eq!(restored, Preferences::default());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn catalogs_reject_missing_keys_placeholders_and_plural_forms() {
        use std::collections::BTreeMap;
        let es: BTreeMap<String, String> = serde_json::from_str(include_str!("es.json")).unwrap();
        let en: BTreeMap<String, String> = serde_json::from_str(include_str!("en.json")).unwrap();
        assert!(i18n::validate_catalogs(&es, &en).is_ok());
        for key in ["common.cancel", "shell.vehicles_many"] {
            let mut broken = en.clone();
            broken.remove(key);
            assert!(i18n::validate_catalogs(&es, &broken).is_err());
        }
        let mut broken = en.clone();
        broken.insert("notifications.map.saved".into(), "Saved {{other}}".into());
        assert!(i18n::validate_catalogs(&es, &broken).is_err());
        broken = en.clone();
        broken.insert("extra".into(), "Only in English".into());
        assert!(i18n::validate_catalogs(&es, &broken).is_err());
    }

    #[test]
    fn translations_keep_data_and_select_plural_forms() {
        let es = Translator::new(Language::Spanish);
        let en = Translator::new(Language::English);
        assert_eq!(es.tr("common.cancel", &[]), "Cancelar");
        assert_eq!(en.tr("common.cancel", &[]), "Cancel");
        assert_eq!(en.tr("shell.vehicles", &[("count", "1")]), "1 vehicle");
        assert_eq!(es.tr("shell.vehicles", &[("count", "2")]), "2 vehículos");
        assert_eq!(
            es.tr("shell.vehicles", &[("count", "1000000")]),
            "1000000 vehículos"
        );
        assert_eq!(
            en.tr("notifications.map.saved", &[("name", "<b>generador</b>")]),
            "Simulation \"<b>generador</b>\" saved successfully as JSON."
        );
        assert_eq!(Language::from_preference("invalid"), Language::Spanish);
        assert_eq!(
            en.tr(
                "notifications.map.saved",
                &[("name", "{{reason}}"), ("reason", "changed")]
            ),
            "Simulation \"{{reason}}\" saved successfully as JSON."
        );
    }

    #[test]
    fn plural_selection_accepts_signed_and_fractional_numbers() {
        let es = Translator::new(Language::Spanish);
        assert_eq!(es.tr("shell.vehicles", &[("count", "1.0")]), "1.0 vehículo");
        assert_eq!(es.tr("shell.vehicles", &[("count", "-1")]), "-1 vehículo");
        assert_eq!(
            es.tr("shell.vehicles", &[("count", "1.5")]),
            "1.5 vehículos"
        );
    }
}
