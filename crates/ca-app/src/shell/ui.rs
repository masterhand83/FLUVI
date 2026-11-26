use super::{Language, Shell};
use eframe::egui;
use std::time::Duration;

impl Shell {
    pub fn sidebar(&mut self, ctx: &egui::Context) {
        self.sidebar_with(ctx, |_, _, _| {});
    }

    pub fn sidebar_with(
        &mut self,
        ctx: &egui::Context,
        mut section_ui: impl FnMut(&str, &mut egui::Ui, &Shell),
    ) {
        let mut prefs = self.preferences().clone();
        if prefs.sidebar_visible {
            egui::SidePanel::left("shell-sidebar")
                .default_width(270.0)
                .width_range(230.0..=400.0)
                .show(ctx, |ui| {
                    ui.heading(self.tr("sidebar.title", &[]));
                    if ui
                        .button(self.tr("sidebar.sidebarToggle.hide", &[]))
                        .clicked()
                    {
                        prefs.sidebar_visible = false;
                    }
                    let sections = [
                        "about",
                        "tools",
                        "constructor",
                        "streetSettings",
                        "scenarios",
                        "metrics",
                        "customization",
                    ];
                    egui::ScrollArea::vertical()
                        .auto_shrink([false, false])
                        .max_height((ui.available_height() - 260.0).max(60.0))
                        .show(ui, |ui| {
                            for (index, section) in sections.iter().enumerate() {
                                let arrow = if prefs.panels_open[index] {
                                    "▼"
                                } else {
                                    "▶"
                                };
                                let title = self.tr(&format!("sidebar.heading.{section}"), &[]);
                                if ui.button(format!("{arrow} {title}")).clicked() {
                                    prefs.panels_open[index] = !prefs.panels_open[index];
                                }
                                if prefs.panels_open[index] && index == 0 {
                                    ui.label(self.tr("about.projectDescription", &[]));
                                    if ui.button(self.tr("about.aboutButton", &[])).clicked() {
                                        self.help = Some(false);
                                    }
                                    if ui.button(self.tr("about.guideButton", &[])).clicked() {
                                        self.help = Some(true);
                                    }
                                }
                                if prefs.panels_open[index] {
                                    section_ui(section, ui, self);
                                }
                                ui.separator();
                            }
                        });
                    ui.separator();
                    ui.heading(self.tr("sidebar.heading.settings", &[]));
                    egui::ComboBox::from_label(self.tr("settings.language.label", &[]))
                        .selected_text(match prefs.language {
                            Language::Spanish => "Español",
                            Language::English => "English",
                        })
                        .show_ui(ui, |ui| {
                            ui.selectable_value(&mut prefs.language, Language::Spanish, "Español");
                            ui.selectable_value(&mut prefs.language, Language::English, "English");
                        });
                    ui.small(self.tr("settings.language.description", &[]));
                    ui.checkbox(
                        &mut prefs.cell_detection,
                        self.tr("settings.cellDetection.label", &[]),
                    );
                    ui.checkbox(&mut prefs.dark_mode, self.tr("settings.darkMode.dark", &[]));
                    if ui.button(self.tr("graphics.advanced", &[])).clicked() {
                        self.advanced_settings = true;
                    }
                });
        } else {
            egui::TopBottomPanel::top("shell-show-sidebar").show(ctx, |ui| {
                if ui
                    .button(self.tr("sidebar.sidebarToggle.show", &[]))
                    .clicked()
                {
                    prefs.sidebar_visible = true;
                }
            });
        }
        if prefs != *self.preferences() {
            // The API reports a failed save with a localized error toast.
            let _ = self.set_preferences(prefs);
        }
        self.apply_theme(ctx);
    }

    fn apply_theme(&self, ctx: &egui::Context) {
        ctx.set_visuals(if self.preferences().dark_mode {
            egui::Visuals::dark()
        } else {
            egui::Visuals::light()
        });
    }

    pub fn overlays(&mut self, ctx: &egui::Context) {
        self.notices
            .retain(|notice| notice.created.elapsed() < Duration::from_secs(8));
        if !self.notices.is_empty() {
            egui::Area::new("shell-toasts".into())
                .anchor(egui::Align2::RIGHT_TOP, [-12.0, 12.0])
                .order(egui::Order::Foreground)
                .show(ctx, |ui| {
                    ui.set_max_width(350.0);
                    let mut dismiss = None;
                    for (index, notice) in self.notices().enumerate() {
                        egui::Frame::popup(ui.style()).show(ui, |ui| {
                            ui.horizontal(|ui| {
                                ui.strong(self.tr(notice.severity.title_key(), &[]));
                                if ui.small_button("×").clicked() {
                                    dismiss = Some(index);
                                }
                            });
                            // egui labels treat content as plain text, not HTML or Markdown.
                            ui.label(&notice.message);
                        });
                    }
                    if let Some(index) = dismiss {
                        self.notices.remove(index);
                    }
                });
            ctx.request_repaint_after(Duration::from_millis(250));
        }
        if let Some(confirmation) = self.confirmation() {
            let mut answer = None;
            let modal = egui::Modal::new("shell-confirmation".into()).show(ctx, |ui| {
                ui.set_max_width(460.0);
                ui.heading(&confirmation.title);
                ui.label(&confirmation.message);
                ui.horizontal(|ui| {
                    if ui.button(self.tr("common.cancel", &[])).clicked() {
                        answer = Some(false);
                    }
                    if ui.button(self.tr("common.confirm", &[])).clicked() {
                        answer = Some(true);
                    }
                });
            });
            if modal.should_close() {
                answer = Some(false);
            }
            if let Some(answer) = answer {
                self.resolve_confirmation(answer);
            }
        } else if self.advanced_settings {
            let mut prefs = self.preferences().clone();
            let mut close = false;
            let modal = egui::Modal::new("advanced-settings".into()).show(ctx, |ui| {
                ui.set_width(420.);
                ui.heading(self.tr("graphics.advanced", &[]));
                egui::CollapsingHeader::new(self.tr("graphics.section", &[]))
                    .default_open(true)
                    .show(ui, |ui| {
                        ui.strong(self.tr("graphics.exportQuality", &[]));
                        for quality in crate::graphics::ExportQuality::ALL {
                            ui.radio_value(
                                &mut prefs.export_quality,
                                quality,
                                self.tr(quality.key(), &[]),
                            );
                        }
                        ui.small(self.tr("graphics.description", &[]));
                    });
                close = ui.button(self.tr("common.close", &[])).clicked();
            });
            if prefs != *self.preferences() {
                let _ = self.set_preferences(prefs);
            }
            if close || modal.should_close() {
                self.advanced_settings = false;
            }
        } else if let Some(instructions) = self.help {
            let mut close = false;
            let modal = egui::Modal::new("shell-help".into()).show(ctx, |ui| {
                ui.set_max_width(460.0);
                ui.heading(self.tr(
                    if instructions {
                        "shell.instructions"
                    } else {
                        "aboutModal.title"
                    },
                    &[],
                ));
                ui.label(self.tr(
                    if instructions {
                        "shell.instructionsBody"
                    } else {
                        "about.projectDescription"
                    },
                    &[],
                ));
                if !instructions {
                    ui.label(format!("FLUVI {}", env!("CARGO_PKG_VERSION")));
                }
                if ui.button(self.tr("common.close", &[])).clicked() {
                    close = true;
                }
            });
            if close || modal.should_close() {
                self.help = None;
            }
        }
    }

    pub fn loading(&mut self, ctx: &egui::Context, progress: f32, status_key: &str) {
        self.apply_theme(ctx);
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.vertical_centered(|ui| {
                ui.add_space(ui.available_height() * 0.35);
                ui.heading(self.tr("loading.title", &[]));
                ui.label(self.tr(status_key, &[]));
                ui.add(egui::ProgressBar::new(progress.clamp(0.0, 1.0)).show_percentage());
            });
        });
        self.overlays(ctx);
    }
}
