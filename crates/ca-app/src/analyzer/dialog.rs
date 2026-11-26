use super::{Analysis, Session};
use crate::shell::{Language, Shell};
use crossbeam_channel::Receiver;
use egui::{self, TextureHandle};
use std::io::{Cursor, Write};

/// Dialog state is separate from the headless analyzer and its worker.
#[derive(Default)]
pub struct AnalyzerDialog {
    pub session: Session,
    tab: usize,
    textures: Vec<TextureHandle>,
    save: Option<Receiver<Result<(), String>>>,
    save_error: bool,
    language: Option<Language>,
    revision: u64,
}
impl AnalyzerDialog {
    pub fn open(&mut self) {
        self.session.open();
    }
    pub fn close(&mut self) {
        self.session.close();
        self.textures.clear();
        // Keep the single-save guard until its native dialog/write finishes.
        self.save_error = false;
    }
    pub fn show(&mut self, ctx: &egui::Context, shell: &Shell) {
        if !self.session.is_open() {
            return;
        }
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            self.close();
            return;
        }
        self.session.poll();
        let language = shell.preferences().language;
        // Numeric results remain valid after a language switch. Text/plots are
        // refreshed below without changing the loaded data or its identifiers.
        self.session.set_language(language);
        if self.language != Some(language) || self.revision != self.session.revision() {
            self.textures.clear();
            self.language = Some(language);
            self.revision = self.session.revision();
        }
        if let Some(save) = &self.save {
            match save.try_recv() {
                Ok(result) => {
                    self.save_error = result.is_err();
                    self.save = None;
                }
                Err(crossbeam_channel::TryRecvError::Disconnected) => {
                    self.save_error = true;
                    self.save = None;
                }
                Err(crossbeam_channel::TryRecvError::Empty) => {}
            }
        }
        let mut open = true;
        let mut load = false;
        let mut save = None;
        egui::Window::new(shell.tr("analyzer.title", &[]))
            .id(egui::Id::new("metrics-analyzer"))
            .open(&mut open)
            .default_size([1000., 720.])
            .vscroll(true)
            .show(ctx, |ui| {
                if ui.button(shell.tr("analyzer.open", &[])).clicked() {
                    load = true;
                }
                if self.session.is_busy() {
                    ui.spinner();
                    ui.label(shell.tr("analyzer.busy", &[]));
                }
                if let Some(key) = self.session.error_key() {
                    ui.colored_label(egui::Color32::RED, shell.tr(key, &[]));
                }
                if self.save_error {
                    ui.colored_label(egui::Color32::RED, shell.tr("analyzer.error.io", &[]));
                }
                if let Some(analysis) = self.session.analysis() {
                    ui.horizontal_wrapped(|ui| {
                        for (i, key) in [
                            "analyzer.results",
                            "analyzer.temporal",
                            "analyzer.fundamental",
                            "analyzer.distributions",
                        ]
                        .iter()
                        .enumerate()
                        {
                            ui.selectable_value(&mut self.tab, i, shell.tr(key, &[]));
                        }
                    });
                    if self.tab == 0 {
                        results(ui, analysis, shell);
                    } else {
                        if self.textures.is_empty() {
                            for plot in &analysis.plots {
                                self.textures.push(ctx.load_texture(
                                    plot.file_name,
                                    plot.image.clone(),
                                    egui::TextureOptions::LINEAR,
                                ));
                            }
                        }
                        if let Some(texture) = self.textures.get(self.tab - 1) {
                            ui.add(egui::Image::new(texture).fit_to_exact_size(egui::vec2(
                                ui.available_width(),
                                ui.available_width() * texture.size_vec2().y
                                    / texture.size_vec2().x,
                            )));
                        }
                    }
                    ui.horizontal(|ui| {
                        if ui
                            .add_enabled(
                                self.tab > 0 && self.save.is_none(),
                                egui::Button::new(shell.tr("analyzer.save", &[])),
                            )
                            .clicked()
                        {
                            save = Some(Some(self.tab - 1));
                        }
                        if ui
                            .add_enabled(
                                self.save.is_none(),
                                egui::Button::new(shell.tr("analyzer.saveAll", &[])),
                            )
                            .clicked()
                        {
                            save = Some(None);
                        }
                    });
                }
            });
        if !open {
            self.close();
            return;
        }
        if load {
            self.textures.clear();
            self.save_error = false;
            self.session
                .pick_file(shell.tr("analyzer.open", &[]), language);
        }
        if let Some(index) = save
            && let Some(analysis) = self.session.analysis()
        {
            let files = analysis
                .plots
                .iter()
                .enumerate()
                .filter(|(i, _)| index.is_none_or(|index| index == *i))
                .map(|(_, p)| (p.file_name, p.png.clone()))
                .collect();
            self.save = save_files(
                files,
                index.is_none(),
                shell.tr("analyzer.save", &[]),
                ctx.clone(),
            )
            .ok();
            self.save_error = self.save.is_none();
        }
        if self.session.is_busy() || self.save.is_some() {
            ctx.request_repaint_after(std::time::Duration::from_millis(30));
        }
    }
}

fn results(ui: &mut egui::Ui, analysis: &Analysis, shell: &Shell) {
    for (key, label) in [
        ("estadisticas", "analyzer.statistics"),
        ("analisis_dias", "analyzer.days"),
        ("correlaciones", "analyzer.correlations"),
        ("capacidad", "analyzer.capacity"),
        ("eventos_criticos", "analyzer.events"),
        ("clustering", "analyzer.clustering"),
        ("temporal", "analyzer.trends"),
    ] {
        egui::CollapsingHeader::new(shell.tr(label, &[]))
            .id_salt(key)
            .show(ui, |ui| {
                show_value(ui, &analysis.report.results[key], key);
            });
    }
}
fn show_value(ui: &mut egui::Ui, value: &serde_json::Value, id: &str) {
    if let (Some(columns), Some(rows)) = (value["columns"].as_array(), value["rows"].as_array()) {
        egui::ScrollArea::both()
            .id_salt(id)
            .max_height(320.)
            .show_rows(ui, 22., rows.len() + 1, |ui, range| {
                egui::Grid::new(id)
                    .striped(true)
                    .min_row_height(22.)
                    .show(ui, |ui| {
                        for row in range {
                            if row == 0 {
                                for column in columns {
                                    ui.strong(column.as_str().unwrap_or(""));
                                }
                            } else {
                                for cell in rows[row - 1].as_array().unwrap() {
                                    ui.label(
                                        cell.as_str()
                                            .map(str::to_owned)
                                            .unwrap_or_else(|| cell.to_string()),
                                    );
                                }
                            }
                            ui.end_row();
                        }
                    });
            });
    } else if let Some(object) = value.as_object() {
        for (key, value) in object {
            ui.strong(key);
            show_value(ui, value, &format!("{id}/{key}"));
        }
    } else {
        ui.monospace(serde_json::to_string_pretty(value).unwrap_or_default());
    }
}
fn save_files(
    files: Vec<(&'static str, Vec<u8>)>,
    zip: bool,
    title: String,
    ctx: egui::Context,
) -> std::io::Result<Receiver<Result<(), String>>> {
    let (tx, rx) = crossbeam_channel::bounded(1);
    std::thread::Builder::new()
        .name("fluvi-analysis-save".into())
        .spawn(move || {
            let result = (|| {
                let (name, bytes, extension) = if zip {
                    let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
                    for (name, bytes) in files {
                        archive
                            .start_file(name, zip::write::SimpleFileOptions::default())
                            .map_err(|e| e.to_string())?;
                        archive.write_all(&bytes).map_err(|e| e.to_string())?;
                    }
                    (
                        "analisis_metricas.zip",
                        archive.finish().map_err(|e| e.to_string())?.into_inner(),
                        "zip",
                    )
                } else {
                    let (name, bytes) = files.into_iter().next().ok_or("no plot")?;
                    (name, bytes, "png")
                };
                if let Some(path) = rfd::FileDialog::new()
                    .set_title(title)
                    .set_file_name(name)
                    .add_filter(extension, &[extension])
                    .save_file()
                {
                    std::fs::write(path, bytes).map_err(|e| e.to_string())?;
                }
                Ok(())
            })();
            let _ = tx.try_send(result);
            ctx.request_repaint();
        })?;
    Ok(rx)
}
