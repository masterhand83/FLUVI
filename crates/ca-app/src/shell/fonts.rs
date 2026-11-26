//! System discovery and font reads run on workers, never in map paint or input.
use super::{Preferences, Severity, Shell};
use crossbeam_channel::{Receiver, TryRecvError, bounded};
use eframe::egui;
use std::sync::{
    Arc, OnceLock,
    atomic::{AtomicU64, Ordering},
};

const LABEL_FAMILY: &str = "fluvi-map-labels";
const CONTEXT_KEY: &str = "fluvi-font-revision";

struct SystemFonts {
    database: fontdb::Database,
    names: Vec<String>,
}

impl SystemFonts {
    fn discover() -> Self {
        let mut database = fontdb::Database::new();
        database.load_system_fonts();
        let mut names: Vec<_> = database
            .faces()
            .flat_map(|face| face.families.iter().map(|(name, _)| name.clone()))
            .collect();
        names.sort();
        names.dedup();
        names.sort_by_cached_key(|name| name.to_lowercase());
        Self { database, names }
    }

    fn read(&self, name: &str) -> Option<egui::FontData> {
        let id = self.database.query(&fontdb::Query {
            families: &[fontdb::Family::Name(name)],
            ..Default::default()
        })?;
        self.database.with_face_data(id, |bytes, index| {
            if bytes.len() > 32 * 1024 * 1024
                || ab_glyph::FontRef::try_from_slice_and_index(bytes, index).is_err()
            {
                return None;
            }
            let mut data = egui::FontData::from_owned(bytes.to_vec());
            data.index = index;
            Some(data)
        })?
    }
}

fn definitions(
    system: &SystemFonts,
    selected: &[String; 2],
) -> (egui::FontDefinitions, Vec<String>) {
    let mut definitions = default_definitions();
    let mut failed = vec![];
    for (slot, name) in selected.iter().enumerate() {
        if name.is_empty() {
            continue;
        }
        if let Some(data) = system.read(name) {
            let key = format!("fluvi-selected-{slot}");
            definitions.font_data.insert(key.clone(), Arc::new(data));
            let family = if slot == 0 {
                egui::FontFamily::Proportional
            } else {
                egui::FontFamily::Name(LABEL_FAMILY.into())
            };
            definitions
                .families
                .get_mut(&family)
                .unwrap()
                .insert(0, key);
        } else {
            failed.push(name.clone());
        }
    }
    (definitions, failed)
}

fn default_definitions() -> egui::FontDefinitions {
    let mut definitions = egui::FontDefinitions::default();
    // Copy the original fallback list before inserting the chosen UI font.
    definitions.families.insert(
        egui::FontFamily::Name(LABEL_FAMILY.into()),
        definitions.families[&egui::FontFamily::Proportional].clone(),
    );
    definitions
}

fn revision() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

struct Loaded {
    system: Arc<SystemFonts>,
    definitions: egui::FontDefinitions,
    failed: Vec<String>,
}

pub(super) struct Fonts {
    system: Option<Arc<SystemFonts>>,
    job: Option<Receiver<Loaded>>,
    requested: Option<[String; 2]>,
    definitions: egui::FontDefinitions,
    revision: u64,
    search: [String; 2],
}

impl Default for Fonts {
    fn default() -> Self {
        Self {
            system: None,
            job: None,
            requested: None,
            definitions: default_definitions(),
            revision: revision(),
            search: Default::default(),
        }
    }
}

impl Fonts {
    fn update(&mut self, ctx: &egui::Context, prefs: &Preferences) -> Vec<String> {
        let selected = [prefs.ui_font.as_str(), prefs.label_font.as_str()];
        let mut failed = vec![];
        if let Some(job) = &self.job {
            match job.try_recv() {
                Ok(loaded) => {
                    self.system = Some(loaded.system);
                    self.job = None;
                    if self
                        .requested
                        .as_ref()
                        .map(|names| names.each_ref().map(String::as_str))
                        == Some(selected)
                    {
                        self.definitions = loaded.definitions;
                        self.revision = revision();
                        failed = loaded.failed;
                    }
                }
                Err(TryRecvError::Disconnected) => {
                    self.job = None;
                    failed.push(
                        selected
                            .into_iter()
                            .filter(|s| !s.is_empty())
                            .collect::<Vec<_>>()
                            .join(", "),
                    );
                }
                Err(TryRecvError::Empty) => {}
            }
        }
        if self.job.is_none()
            && self
                .requested
                .as_ref()
                .map(|names| names.each_ref().map(String::as_str))
                != Some(selected)
        {
            let selected = selected.map(str::to_owned);
            self.requested = Some(selected.clone());
            let (sender, receiver) = bounded(1);
            let repaint = ctx.clone();
            match std::thread::Builder::new()
                .name("fluvi-fonts".into())
                .spawn(move || {
                    static SYSTEM: OnceLock<Arc<SystemFonts>> = OnceLock::new();
                    let system = SYSTEM
                        .get_or_init(|| Arc::new(SystemFonts::discover()))
                        .clone();
                    let (definitions, failed) = definitions(&system, &selected);
                    let _ = sender.try_send(Loaded {
                        system,
                        definitions,
                        failed,
                    });
                    repaint.request_repaint();
                }) {
                Ok(_) => self.job = Some(receiver),
                Err(error) => failed.push(error.to_string()),
            }
        }
        failed
    }

    pub(super) fn apply(&self, ctx: &egui::Context) {
        let key = egui::Id::new(CONTEXT_KEY);
        let changed = ctx.data_mut(|data| {
            if data.get_temp::<u64>(key) == Some(self.revision) {
                false
            } else {
                data.insert_temp(key, self.revision);
                true
            }
        });
        if changed {
            ctx.set_fonts(self.definitions.clone());
            ctx.request_repaint();
        }
    }
}

/// Map labels have their own family; callers without a shell retain egui defaults.
pub fn label_font(ctx: &egui::Context, size: f32) -> egui::FontId {
    let family = egui::FontFamily::Name(LABEL_FAMILY.into());
    let registered = ctx.fonts_mut(|fonts| fonts.definitions().families.contains_key(&family));
    egui::FontId::new(
        size,
        if registered {
            family
        } else {
            egui::FontFamily::Proportional
        },
    )
}

impl Shell {
    pub fn update_fonts(&mut self, ctx: &egui::Context) {
        for name in self.fonts.update(ctx, &self.preferences) {
            self.notify(
                Severity::Warning,
                self.tr("fonts.unavailable", &[("name", &name)]),
            );
        }
        self.fonts.apply(ctx);
    }

    pub(super) fn font_ui(&mut self, ui: &mut egui::Ui, prefs: &mut Preferences) {
        ui.strong(self.tr("fonts.title", &[]));
        let default = self.tr("fonts.default", &[]);
        let search_hint = self.tr("fonts.search", &[]);
        let labels = [self.tr("fonts.ui", &[]), self.tr("fonts.labels", &[])];
        if self.fonts.system.is_none() {
            ui.small(self.tr("fonts.loading", &[]));
        }
        for (slot, selected) in [&mut prefs.ui_font, &mut prefs.label_font]
            .into_iter()
            .enumerate()
        {
            ui.label(&labels[slot]);
            egui::ComboBox::from_id_salt(("system-font", slot))
                .close_behavior(egui::PopupCloseBehavior::CloseOnClickOutside)
                .selected_text(if selected.is_empty() {
                    default.as_str()
                } else {
                    selected.as_str()
                })
                .show_ui(ui, |ui| {
                    ui.add(
                        egui::TextEdit::singleline(&mut self.fonts.search[slot])
                            .hint_text(&search_hint),
                    );
                    if ui
                        .selectable_value(selected, String::new(), &default)
                        .clicked()
                    {
                        ui.close();
                    }
                    if let Some(system) = &self.fonts.system {
                        let query = self.fonts.search[slot].to_lowercase();
                        for name in &system.names {
                            if name.to_lowercase().contains(&query)
                                && ui.selectable_value(selected, name.clone(), name).clicked()
                            {
                                ui.close();
                            }
                        }
                    }
                })
                .response
                .on_hover_text(&labels[slot]);
        }
        ui.small(self.tr("fonts.description", &[]));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> SystemFonts {
        let mut database = fontdb::Database::new();
        let defaults = egui::FontDefinitions::default();
        database.load_font_data(defaults.font_data["Hack"].font.to_vec());
        SystemFonts {
            database,
            names: vec!["Hack".into()],
        }
    }

    #[test]
    fn ui_and_map_fonts_are_independent_and_keep_bundled_fallbacks() {
        let system = fixture();
        for slot in [0, 1] {
            let mut selected = [String::new(), String::new()];
            selected[slot] = "Hack".into();
            let (fonts, failed) = definitions(&system, &selected);
            assert!(failed.is_empty());
            let ui = &fonts.families[&egui::FontFamily::Proportional];
            let labels = &fonts.families[&egui::FontFamily::Name(LABEL_FAMILY.into())];
            let defaults = egui::FontDefinitions::default();
            let fallback = &defaults.families[&egui::FontFamily::Proportional];
            let (chosen, unchanged) = if slot == 0 {
                (ui, labels)
            } else {
                (labels, ui)
            };
            assert_eq!(&chosen[1..], fallback);
            assert_eq!(unchanged, fallback);
            assert_eq!(
                fonts.font_data[&chosen[0]].font,
                defaults.font_data["Hack"].font
            );
            assert_eq!(
                fonts.families[&egui::FontFamily::Monospace],
                defaults.families[&egui::FontFamily::Monospace]
            );
        }
    }

    #[test]
    fn unavailable_font_keeps_defaults_and_reports_its_name() {
        let (fonts, failed) =
            definitions(&fixture(), &["No such font 319028".into(), String::new()]);
        assert_eq!(failed, ["No such font 319028"]);
        assert_eq!(fonts, default_definitions());
    }

    #[test]
    fn selected_font_renders_and_default_can_be_restored_in_the_same_context() {
        let system = fixture();
        let (definitions, _) = definitions(&system, &["Hack".into(), "Hack".into()]);
        let ctx = egui::Context::default();
        let mut state = Fonts {
            definitions,
            ..Default::default()
        };
        for selected in [true, false] {
            if !selected {
                state.definitions = default_definitions();
                state.revision = revision();
            }
            state.apply(&ctx);
            let output = ctx.run(Default::default(), |ctx| {
                egui::CentralPanel::default().show(ctx, |ui| {
                    ui.label("UI: Áreas académicas");
                    let family = label_font(ctx, 18.);
                    assert_eq!(family.family, egui::FontFamily::Name(LABEL_FAMILY.into()));
                    ui.label(egui::RichText::new("Map: ESCOM").font(family));
                    ctx.fonts_mut(|fonts| {
                        let current = fonts.definitions();
                        assert_eq!(current.font_data.contains_key("fluvi-selected-0"), selected);
                        assert_eq!(current.font_data.contains_key("fluvi-selected-1"), selected);
                    });
                });
            });
            assert!(!output.shapes.is_empty());
        }
    }

    #[test]
    fn stale_worker_result_cannot_replace_newer_choices() {
        let ctx = egui::Context::default();
        let (sender, receiver) = bounded(1);
        let mut state = Fonts {
            job: Some(receiver),
            requested: Some(["Old UI".into(), String::new()]),
            ..Default::default()
        };
        let original_revision = state.revision;
        assert!(
            sender
                .try_send(Loaded {
                    system: Arc::new(fixture()),
                    definitions: definitions(&fixture(), &["Hack".into(), String::new()]).0,
                    failed: vec![],
                })
                .is_ok()
        );
        let prefs = Preferences {
            ui_font: "New UI".into(),
            ..Default::default()
        };
        assert!(state.update(&ctx, &prefs).is_empty());
        assert_eq!(state.revision, original_revision);
        assert_eq!(state.definitions, default_definitions());
        assert_eq!(state.requested.unwrap()[0], "New UI");
    }

    #[test]
    fn customization_lists_system_fonts_and_saves_the_selected_ui_font() {
        fn text(output: &egui::FullOutput, expected: &str) -> egui::Rect {
            output
                .shapes
                .iter()
                .find_map(|shape| match &shape.shape {
                    egui::Shape::Text(text) if text.galley.text() == expected => {
                        Some(text.visual_bounding_rect())
                    }
                    _ => None,
                })
                .unwrap_or_else(|| panic!("missing {expected}"))
        }
        fn frame(
            shell: &mut Shell,
            ctx: &egui::Context,
            events: Vec<egui::Event>,
        ) -> egui::FullOutput {
            ctx.run(
                egui::RawInput {
                    screen_rect: Some(egui::Rect::from_min_size(
                        egui::Pos2::ZERO,
                        egui::vec2(1100., 1200.),
                    )),
                    events,
                    ..Default::default()
                },
                |ctx| shell.sidebar(ctx),
            )
        }
        fn click(shell: &mut Shell, ctx: &egui::Context, point: egui::Pos2) {
            for pressed in [true, false] {
                frame(
                    shell,
                    ctx,
                    vec![
                        egui::Event::PointerMoved(point),
                        egui::Event::PointerButton {
                            pos: point,
                            button: egui::PointerButton::Primary,
                            pressed,
                            modifiers: Default::default(),
                        },
                    ],
                );
            }
        }
        let path =
            std::env::temp_dir().join(format!("fluvi-font-picker-{}.json", std::process::id()));
        Preferences {
            language: super::super::Language::English,
            panels_open: [false, false, false, false, false, false, true],
            ..Default::default()
        }
        .save(&path)
        .unwrap();
        let mut shell = Shell::load(Some(path.clone()));
        shell.fonts = Fonts {
            system: Some(Arc::new(fixture())),
            requested: Some([String::new(), String::new()]),
            ..Default::default()
        };
        let ctx = egui::Context::default();
        frame(&mut shell, &ctx, vec![]);
        let output = frame(&mut shell, &ctx, vec![]);
        text(&output, "UI font");
        text(&output, "Map label font");
        click(&mut shell, &ctx, text(&output, "Bundled default").center());
        let output = frame(&mut shell, &ctx, vec![]);
        click(
            &mut shell,
            &ctx,
            text(&output, "Search installed fonts").center(),
        );
        let output = frame(&mut shell, &ctx, vec![egui::Event::Text("ha".into())]);
        assert_eq!(
            shell.fonts.search[0], "ha",
            "font search must keep keyboard focus"
        );
        text(&output, "Hack");
        click(&mut shell, &ctx, text(&output, "Hack").center());
        let output = frame(&mut shell, &ctx, vec![]);
        assert!(!output.shapes.iter().any(|shape| matches!(
            &shape.shape, egui::Shape::Text(text) if text.galley.text() == "Search installed fonts"
        )), "selecting a font must close the dropdown");
        assert_eq!(shell.preferences().ui_font, "Hack");
        assert_eq!(shell.preferences().label_font, "");
        let (saved, warning) = Preferences::load(&path);
        assert!(!warning);
        assert_eq!(saved.ui_font, "Hack");
        std::fs::remove_file(path).unwrap();
    }
}
