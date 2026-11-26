//! Scenario library and native exchange. Disk access is run by a bounded worker.
use crate::shell::Shell;
use ca_core::scenario_json::Scenario;
use crossbeam_channel::{Receiver, bounded};
use eframe::egui;
use std::{
    io::{self, Read},
    path::{Path, PathBuf},
};

const MAX_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Clone)]
pub struct ScenarioLibrary {
    path: PathBuf,
    entries: Vec<Scenario>,
}

fn read(path: &Path) -> io::Result<String> {
    let mut text = String::new();
    std::fs::File::open(path)?
        .take(MAX_BYTES + 1)
        .read_to_string(&mut text)?;
    if text.len() as u64 > MAX_BYTES {
        return Err(io::Error::other("scenario file too large"));
    }
    Ok(text)
}

impl ScenarioLibrary {
    pub fn open(path: &Path) -> io::Result<Self> {
        let values: Vec<serde_json::Value> = match read(path) {
            Ok(text) => serde_json::from_str(&text)?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error),
        };
        let entries = values
            .into_iter()
            .map(|v| Scenario::from_value(v).map_err(io::Error::other))
            .collect::<io::Result<Vec<_>>>()?;
        Ok(Self {
            path: path.to_owned(),
            entries,
        })
    }
    pub fn entries(&self) -> &[Scenario] {
        &self.entries
    }
    fn replace(&mut self, entries: Vec<Scenario>) -> io::Result<()> {
        let bytes =
            serde_json::to_vec_pretty(&entries.iter().map(Scenario::to_value).collect::<Vec<_>>())?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(io::Error::other("scenario library too large"));
        }
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temporary = self
            .path
            .with_extension(format!("{}.tmp", std::process::id()));
        std::fs::write(&temporary, bytes)?;
        std::fs::rename(temporary, &self.path)?;
        self.entries = entries;
        Ok(())
    }
    pub fn save(&mut self, scenario: Scenario) -> io::Result<()> {
        let mut entries = self.entries.clone();
        entries.retain(|entry| entry.id() != scenario.id());
        entries.push(scenario);
        self.replace(entries)
    }
    pub fn delete(&mut self, id: &str) -> io::Result<()> {
        self.replace(
            self.entries
                .iter()
                .filter(|entry| entry.id() != id)
                .cloned()
                .collect(),
        )
    }
}

pub fn data_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Application Support"));
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")));
    base.map(|base| base.join("fluvi/scenarios.json"))
}

pub enum LibraryAction {
    Retry,
    Save(String),
    Load(Scenario),
    Import,
    Export(Scenario),
    Delete(String),
}

pub enum LibraryResult {
    Stored(ScenarioLibrary),
    Imported(Scenario),
    Exported,
    Cancelled,
    Failed(&'static str),
}

#[derive(Default)]
pub struct ScenarioExchange {
    pub open: bool,
    pub capturing: bool,
    library: Option<ScenarioLibrary>,
    started: bool,
    name: String,
    job: Option<Receiver<LibraryResult>>,
}

impl ScenarioExchange {
    pub fn busy(&self) -> bool {
        self.job.is_some() || self.capturing
    }

    fn worker(
        &mut self,
        ctx: &egui::Context,
        work: impl FnOnce() -> LibraryResult + Send + 'static,
    ) {
        let (tx, rx) = bounded(1);
        let repaint = ctx.clone();
        match std::thread::Builder::new()
            .name("fluvi-scenario-file".into())
            .spawn(move || {
                let _ = tx.try_send(work());
                repaint.request_repaint();
            }) {
            Ok(_) => self.job = Some(rx),
            Err(_) => {
                let (tx, rx) = bounded(1);
                let _ = tx.try_send(LibraryResult::Failed("scenarios.fileError"));
                self.job = Some(rx);
            }
        }
    }

    pub fn poll(&mut self, ctx: &egui::Context) -> Option<LibraryResult> {
        if !self.started {
            self.started = true;
            self.worker(ctx, || {
                data_path()
                    .ok_or_else(|| io::Error::other("no app data directory"))
                    .and_then(|path| ScenarioLibrary::open(&path))
                    .map(LibraryResult::Stored)
                    .unwrap_or(LibraryResult::Failed("scenarios.fileError"))
            });
        }
        let result = match self.job.as_ref()?.try_recv() {
            Ok(result) => result,
            Err(crossbeam_channel::TryRecvError::Empty) => return None,
            Err(_) => LibraryResult::Failed("scenarios.fileError"),
        };
        self.job = None;
        if let LibraryResult::Stored(library) = result {
            self.library = Some(library);
            None
        } else {
            Some(result)
        }
    }

    pub fn store(&mut self, scenario: Scenario, ctx: &egui::Context) {
        let Some(mut library) = self.library.clone() else {
            return;
        };
        self.worker(ctx, move || match library.save(scenario) {
            Ok(()) => LibraryResult::Stored(library),
            Err(_) => LibraryResult::Failed("scenarios.fileError"),
        });
    }

    pub fn file_action(&mut self, action: LibraryAction, ctx: &egui::Context, shell: &Shell) {
        let title = shell.tr("scenarios.library", &[]);
        match action {
            LibraryAction::Retry => {
                self.started = false;
                ctx.request_repaint();
            }
            LibraryAction::Import => self.worker(ctx, move || {
                let Some(path) = rfd::FileDialog::new()
                    .set_title(title)
                    .add_filter("JSON", &["json"])
                    .pick_file()
                else {
                    return LibraryResult::Cancelled;
                };
                read(&path)
                    .ok()
                    .and_then(|text| Scenario::parse(&text).ok())
                    .map(LibraryResult::Imported)
                    .unwrap_or(LibraryResult::Failed("scenarios.invalidFile"))
            }),
            LibraryAction::Export(scenario) => self.worker(ctx, move || {
                let Some(path) = rfd::FileDialog::new()
                    .set_title(title)
                    .add_filter("JSON", &["json"])
                    .set_file_name("scenario.json")
                    .save_file()
                else {
                    return LibraryResult::Cancelled;
                };
                match std::fs::write(path, scenario.to_json()) {
                    Ok(()) => LibraryResult::Exported,
                    Err(_) => LibraryResult::Failed("scenarios.fileError"),
                }
            }),
            LibraryAction::Delete(id) => {
                let Some(mut library) = self.library.clone() else {
                    return;
                };
                self.worker(ctx, move || match library.delete(&id) {
                    Ok(()) => LibraryResult::Stored(library),
                    Err(_) => LibraryResult::Failed("scenarios.fileError"),
                });
            }
            _ => {}
        }
    }

    pub fn show(
        &mut self,
        ctx: &egui::Context,
        shell: &Shell,
        enabled: bool,
    ) -> Option<LibraryAction> {
        let mut action = None;
        let ready = enabled && !self.busy() && self.library.is_some();
        let retry = enabled && !self.busy() && self.library.is_none();
        egui::Window::new(shell.tr("scenarios.library", &[]))
            .open(&mut self.open)
            .show(ctx, |ui| {
                if retry {
                    ui.label(shell.tr("scenarios.fileError", &[]));
                    if ui.button(shell.tr("scenarios.retry", &[])).clicked() {
                        action = Some(LibraryAction::Retry);
                    }
                }
                ui.add_enabled_ui(ready, |ui| {
                    ui.label(shell.tr("scenarios.name", &[]));
                    ui.text_edit_singleline(&mut self.name);
                    if ui
                        .add_enabled(
                            !self.name.trim().is_empty(),
                            egui::Button::new(shell.tr("scenarios.save", &[])),
                        )
                        .clicked()
                    {
                        action = Some(LibraryAction::Save(self.name.trim().to_owned()));
                    }
                    if ui.button(shell.tr("scenarios.import", &[])).clicked() {
                        action = Some(LibraryAction::Import);
                    }
                    egui::ScrollArea::vertical()
                        .max_height(350.)
                        .show(ui, |ui| {
                            if let Some(library) = &self.library {
                                for entry in library.entries() {
                                    ui.push_id(entry.id(), |ui| {
                                        ui.label(entry.name());
                                        ui.horizontal(|ui| {
                                            if ui.button(shell.tr("scenarios.load", &[])).clicked()
                                            {
                                                action = Some(LibraryAction::Load(entry.clone()));
                                            }
                                            if ui
                                                .button(shell.tr("scenarios.export", &[]))
                                                .clicked()
                                            {
                                                action = Some(LibraryAction::Export(entry.clone()));
                                            }
                                            if ui
                                                .button(shell.tr("scenarios.delete", &[]))
                                                .clicked()
                                            {
                                                action = Some(LibraryAction::Delete(
                                                    entry.id().to_owned(),
                                                ));
                                            }
                                        });
                                    });
                                }
                            }
                        });
                });
            });
        action
    }
}
