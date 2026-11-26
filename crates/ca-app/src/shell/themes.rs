//! Native theme exchange is isolated from drawing and simulation state.
use super::{Preferences, Severity, Shell};
use crate::themes::Theme;
use crossbeam_channel::{TryRecvError, bounded};
use eframe::egui;
use std::io;

impl Shell {
    pub fn themes(&self) -> &[Theme] {
        &self.themes
    }

    pub(super) fn theme_ui(&mut self, ui: &mut egui::Ui, prefs: &mut Preferences) {
        let name = self
            .themes
            .iter()
            .find(|theme| theme.id == prefs.theme)
            .map(|theme| theme.name.as_str())
            .unwrap_or("Default");
        egui::ComboBox::from_label(self.tr("theme.label", &[]))
            .selected_text(name)
            .show_ui(ui, |ui| {
                for theme in &self.themes {
                    ui.selectable_value(&mut prefs.theme, theme.id.clone(), &theme.name);
                }
            });
        ui.small(self.tr("theme.description", &[]));
        let mut import = false;
        let mut export = false;
        ui.add_enabled_ui(self.theme_job.is_none(), |ui| {
            import = ui.button(self.tr("theme.import", &[])).clicked();
            export = ui.button(self.tr("theme.export", &[])).clicked();
        });
        if import || export {
            let title = self.tr(
                if import {
                    "theme.import"
                } else {
                    "theme.export"
                },
                &[],
            );
            let directory = self
                .path
                .as_ref()
                .and_then(|path| path.parent())
                .map(|p| p.join("themes"));
            let themes = self.themes.clone();
            let selected = prefs.theme.clone();
            let dark = prefs.dark_mode;
            let repaint = ui.ctx().clone();
            let (sender, receiver) = bounded(1);
            match std::thread::Builder::new()
                .name("fluvi-theme-file".into())
                .spawn(move || {
                    let result = (|| {
                        let dialog = rfd::FileDialog::new()
                            .set_title(title)
                            .add_filter("JSON", &["json"]);
                        if import {
                            let Some(path) = dialog.pick_file() else {
                                return Ok(None);
                            };
                            let theme = Theme::read(&path)?;
                            let directory = directory.ok_or_else(|| {
                                io::Error::new(
                                    io::ErrorKind::NotFound,
                                    "User config directory unavailable",
                                )
                            })?;
                            crate::themes::install(&theme, &directory, &themes)?;
                            Ok(Some(theme))
                        } else {
                            let theme = themes
                                .iter()
                                .find(|theme| theme.id == selected)
                                .unwrap_or(&themes[0]);
                            if let Some(path) = dialog
                                .set_file_name(format!("{}.json", theme.id))
                                .save_file()
                            {
                                std::fs::write(path, theme.export_bytes(dark)?)?;
                            }
                            Ok(None)
                        }
                    })();
                    let _ = sender.try_send(result);
                    repaint.request_repaint();
                }) {
                Ok(_) => self.theme_job = Some(receiver),
                Err(error) => self.theme_error(&error),
            }
        }
    }

    pub(super) fn poll_theme_job(&mut self) {
        let Some(receiver) = &self.theme_job else {
            return;
        };
        let result = match receiver.try_recv() {
            Ok(result) => result,
            Err(TryRecvError::Empty) => return,
            Err(TryRecvError::Disconnected) => Err(io::Error::other("Theme worker stopped")),
        };
        self.theme_job = None;
        match result {
            Ok(Some(theme)) => {
                let mut prefs = self.preferences().clone();
                prefs.theme = theme.id.clone();
                self.themes.push(theme);
                let _ = self.set_preferences(prefs);
            }
            Ok(None) => {}
            Err(error) => self.theme_error(&error),
        }
    }

    fn theme_error(&mut self, error: &io::Error) {
        self.notify(
            Severity::Error,
            self.tr("theme.error", &[("reason", &error.to_string())]),
        );
    }
}
