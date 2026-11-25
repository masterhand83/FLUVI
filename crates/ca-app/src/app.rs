use anyhow::Context;
use ca_gpu::{TrafficDisplay, TrafficScene};
use crossbeam_channel::{Receiver, Sender, TryRecvError, bounded};
use eframe::egui;

use crate::render::{
    Commands, Edit, Event, Paint, PaintCallback, Progress, Requests, Resources, command_channel,
};
use ca_app::map::MapInteraction;
use ca_app::map_files::{self, FileResult};
use ca_app::map_session::{MapSession, ResetPhase};
use ca_app::shell::{Shell, config_path};
use ca_app::transport::TransportControls;
use ca_core::map_json::MapDocument;

pub struct Report {
    pub progress: Progress,
    pub adapter: String,
    pub error: Option<String>,
}

struct Startup {
    render: egui_wgpu::RenderState,
    events: Sender<Event>,
    requests: Requests,
    ready: Option<Receiver<(TrafficScene, TrafficDisplay)>>,
}

pub struct App {
    events: Receiver<Event>,
    commands: Commands,
    callback: egui::PaintCallback,
    background_callback: egui::PaintCallback,
    map: Option<MapInteraction>,
    report_tx: Sender<Report>,
    progress: Progress,
    adapter: String,
    error: Option<String>,
    playing: bool,
    rate: f64,
    step_ticket: u64,
    profiler: bool,
    smoke_frames: Option<u64>,
    shell: Shell,
    startup: Option<Startup>,
    transport: TransportControls,
    connections: Option<ca_app::connections::ConnectionOverlays>,
    session: Option<MapSession<App>>,
    file_job: Option<Receiver<FileResult>>,
    new_confirmation: Option<Receiver<bool>>,
    background: ca_app::background::Background,
    map_shift: [f32; 2],
}

impl App {
    pub fn new(
        cc: &eframe::CreationContext<'_>,
        smoke_frames: Option<u64>,
        report_tx: Sender<Report>,
    ) -> anyhow::Result<Self> {
        let render = cc
            .wgpu_render_state
            .as_ref()
            .context("wgpu renderer is required")?;
        let info = render.adapter.get_info();
        tracing::info!(?info, surface_format = ?render.target_format, "CA Lab GPU");
        let adapter = format!("{} ({:?})", info.name, info.backend);
        let (tx, events) = bounded(2);
        let (commands, requests) = command_channel();
        let mut session = MapSession::new(MapDocument::campus());
        session.register_reset(ResetPhase::Pause, |app: &mut Self| app.playing = false);
        session.register_reset(ResetPhase::Tools, |app| {
            app.map = None;
            if let Some(connections) = &mut app.connections {
                connections.set_arrows(Vec::new());
            }
        });
        session.register_reset(ResetPhase::Features, |app| {
            app.transport = TransportControls::default();
            app.step_ticket = 0;
            app.progress = Progress {
                frames: app.progress.frames,
                ..Default::default()
            };
        });
        Ok(Self {
            events,
            commands,
            callback: egui_wgpu::Callback::new_paint_callback(egui::Rect::NOTHING, PaintCallback),
            background_callback: egui_wgpu::Callback::new_paint_callback(
                egui::Rect::NOTHING,
                crate::render::BackgroundCallback,
            ),
            map: None,
            report_tx,
            progress: Progress::default(),
            adapter,
            error: None,
            playing: true,
            rate: 10.0,
            step_ticket: 0,
            profiler: false,
            smoke_frames,
            shell: Shell::load(config_path()),
            transport: TransportControls::default(),
            connections: None,
            session: Some(session),
            file_job: None,
            new_confirmation: None,
            background: ca_app::background::Background::new(&[], [0.0; 2]),
            map_shift: [0.0; 2],
            startup: Some(Startup {
                render: render.clone(),
                events: tx,
                requests,
                ready: None,
            }),
        })
    }

    fn handle_messages(&mut self) {
        while let Ok(event) = self.events.try_recv() {
            match event {
                Event::Progress(progress) => self.progress = progress,
            }
        }
    }

    fn initialize(&mut self, ctx: &egui::Context, mut startup: Startup) -> anyhow::Result<()> {
        if let Some(ready) = &startup.ready {
            match ready.try_recv() {
                Ok((scene, display)) => {
                    self.connections = Some(ca_app::connections::ConnectionOverlays::new(
                        scene.connection_arrows(),
                    ));
                    let [width, height] = scene.extent();
                    self.map = Some(MapInteraction::new(
                        [width as f32, height as f32],
                        &scene.geometry(),
                        scene.street_names(),
                    ));
                    self.map_shift = scene.shift();
                    let document = self.session.as_ref().expect("session").document();
                    self.map
                        .as_mut()
                        .expect("map")
                        .configure(document, self.map_shift);
                    self.background =
                        ca_app::background::Background::new(document.zones(), self.map_shift);
                    // Setup-only framework lock; frame work uses owned resources.
                    startup
                        .render
                        .renderer
                        .write()
                        .callback_resources
                        .insert(Resources::new(
                            scene,
                            display,
                            startup.events,
                            startup.requests,
                            startup.render.target_format,
                        ));
                    self.shell.loading(ctx, 1.0, "loading.status.ready");
                    return Ok(());
                }
                Err(TryRecvError::Empty) => {
                    self.shell.loading(ctx, 0.4, "loading.status.engine");
                }
                Err(TryRecvError::Disconnected) => {
                    anyhow::bail!("GPU resource initialization worker stopped")
                }
            }
        } else {
            self.shell.loading(ctx, 0.1, "loading.status.initializing");
            let (sender, ready) = bounded(1);
            let device = startup.render.device.clone();
            let format = startup.render.target_format;
            let repaint = ctx.clone();
            std::thread::Builder::new()
                .name("fluvi-gpu-startup".into())
                .spawn(move || {
                    let scene = TrafficScene::from_document(&MapDocument::campus());
                    let display = TrafficDisplay::new(&device, &scene, format);
                    let _ = sender.try_send((scene, display));
                    repaint.request_repaint();
                })
                .context("could not start GPU resource initialization")?;
            startup.ready = Some(ready);
        }
        self.startup = Some(startup);
        Ok(())
    }

    fn controls(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("controls").show(ctx, |ui| {
            ui.horizontal_wrapped(|ui| {
                let name = self.session.as_ref().expect("session").document().name();
                ui.label(if name.is_empty() {
                    self.shell.tr("mapFiles.untitled", &[])
                } else {
                    name.to_owned()
                });
                let ready = self.smoke_frames.is_none()
                    && self.file_job.is_none()
                    && self.new_confirmation.is_none();
                ui.add_enabled_ui(ready, |ui| {
                    if ui.button(self.shell.tr("mapFiles.open", &[])).clicked() {
                        self.start_file(false, ctx);
                    }
                    if ui.button(self.shell.tr("mapFiles.save", &[])).clicked() {
                        self.start_file(true, ctx);
                    }
                    if ui.button(self.shell.tr("mapFiles.new", &[])).clicked() {
                        self.new_confirmation = Some(self.shell.confirm(
                            self.shell.tr("mapFiles.new", &[]),
                            self.shell.tr("mapFiles.newConfirm", &[]),
                        ));
                    }
                });
                ui.add_enabled_ui(self.smoke_frames.is_none(), |ui| {
                    if ui
                        .button(self.shell.tr(
                            if self.playing {
                                "simulation.pause"
                            } else {
                                "simulation.resume"
                            },
                            &[],
                        ))
                        .clicked()
                    {
                        self.playing = !self.playing;
                    }
                    if ui
                        .add_enabled(
                            !self.playing,
                            egui::Button::new(self.shell.tr("simulation.step", &[])),
                        )
                        .clicked()
                    {
                        self.step_ticket += 1;
                    }
                    ui.add(
                        egui::Slider::new(&mut self.rate, 1.0..=60.0)
                            .text(self.shell.tr("simulation.speed", &[])),
                    );
                });
                let mut action = None;
                if let Some(connections) = &mut self.connections {
                    connections.show_toggle(ui, &self.shell);
                }
                ui.add_enabled_ui(self.smoke_frames.is_none(), |ui| {
                    action = self.transport.show(ui, &self.shell);
                });
                if let Some(action) = action
                    && !self.commands.edit(Edit::Vehicles(action))
                {
                    self.shell.notify(
                        ca_app::shell::Severity::Warning,
                        self.shell.tr("shell.cellEditBusy", &[]),
                    );
                }
                ui.label(self.shell.tr("shell.profiler", &[]))
                    .on_hover_text(self.shell.tr("shell.legend", &[]));
            });
        });
    }

    fn start_file(&mut self, save: bool, ctx: &egui::Context) {
        let text = save.then(|| self.session.as_ref().expect("session").document().to_json());
        match map_files::start(
            text,
            self.shell.tr(
                if save {
                    "mapFiles.save"
                } else {
                    "mapFiles.open"
                },
                &[],
            ),
            ctx.clone(),
        ) {
            Ok(job) => self.file_job = Some(job),
            Err(_) => self.shell.notify(
                ca_app::shell::Severity::Error,
                self.shell.tr("mapFiles.dialogError", &[]),
            ),
        }
    }

    fn replace_map(&mut self, document: MapDocument) {
        let scene = TrafficScene::from_document(&document);
        let mut map = MapInteraction::new(
            scene.extent().map(|v| v as f32),
            &scene.geometry(),
            scene.street_names(),
        );
        let shift = scene.shift();
        map.configure(&document, shift);
        let background = ca_app::background::Background::new(document.zones(), shift);
        let arrows = scene.connection_arrows();
        if !self.commands.replace(scene) {
            self.shell.notify(
                ca_app::shell::Severity::Warning,
                self.shell.tr("shell.cellEditBusy", &[]),
            );
            return;
        }
        let mut session = self.session.take().expect("session");
        session.replace(true, document, self);
        self.session = Some(session);
        self.map = Some(map);
        self.map_shift = shift;
        self.background = background;
        if let Some(connections) = &mut self.connections {
            connections.set_arrows(arrows);
        } else {
            self.connections = Some(ca_app::connections::ConnectionOverlays::new(arrows));
        }
    }

    fn map_files(&mut self, ctx: &egui::Context) {
        if self.file_job.is_none()
            && self.new_confirmation.is_none()
            && self.smoke_frames.is_none()
            && ctx.input_mut(|i| i.consume_key(egui::Modifiers::COMMAND, egui::Key::S))
        {
            self.start_file(true, ctx);
        }
        if let Some(job) = &self.file_job {
            let result = match job.try_recv() {
                Ok(result) => Some(result),
                Err(TryRecvError::Empty) => None,
                Err(TryRecvError::Disconnected) => Some(FileResult::Failed("mapFiles.dialogError")),
            };
            if let Some(result) = result {
                self.file_job = None;
                match result {
                    FileResult::Opened(map) => self.replace_map(map),
                    FileResult::Saved => self.shell.notify(
                        ca_app::shell::Severity::Success,
                        self.shell.tr("mapFiles.saved", &[]),
                    ),
                    FileResult::Failed(key) => self
                        .shell
                        .notify(ca_app::shell::Severity::Error, self.shell.tr(key, &[])),
                    FileResult::Cancelled => {}
                }
            }
        }
        if let Some(answer) = &self.new_confirmation {
            match answer.try_recv() {
                Ok(accepted) => {
                    self.new_confirmation = None;
                    if accepted {
                        self.replace_map(MapDocument::empty());
                    }
                }
                Err(TryRecvError::Disconnected) => self.new_confirmation = None,
                Err(TryRecvError::Empty) => {}
            }
        }
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if let Some(startup) = self.startup.take() {
            if let Err(error) = self.initialize(ctx, startup) {
                self.error = Some(error.to_string());
            }
            ctx.request_repaint();
            return;
        }
        if ctx.input(|i| i.key_pressed(egui::Key::F12)) {
            self.profiler = !self.profiler;
        }
        puffin::set_scopes_on(self.profiler);
        if self.profiler {
            puffin::GlobalProfiler::lock().new_frame();
        }
        self.handle_messages();
        self.map_files(ctx);
        if self.error.is_some() || self.smoke_frames.is_some_and(|n| self.progress.frames >= n) {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            return;
        }
        self.controls(ctx);
        self.shell.sidebar(ctx);
        egui::TopBottomPanel::bottom("status").show(ctx, |ui| {
            ui.label(format!(
                "{} {}  |  {}  |  {} {:.1}  |  {}",
                self.shell.tr("simulation.info.generation", &[]),
                self.progress.generation,
                self.shell.tr(
                    "shell.vehicles",
                    &[("count", &self.progress.population.to_string())]
                ),
                self.shell.tr("simulation.info.fps", &[]),
                if self.playing { self.progress.fps } else { 0.0 },
                self.adapter,
            ));
        });
        egui::CentralPanel::default().show(ctx, |ui| {
            let map = self
                .map
                .as_mut()
                .expect("map installed with render resources")
                .show(ui, self.shell.preferences().cell_detection);
            if map.vertex_mode {
                self.playing = false;
            }
            if let Some(edit) = map.vertex_edit {
                if self.commands.edit(Edit::Vertex(edit)) {
                    let session = self.session.as_mut().expect("session");
                    session.set_vertex_offset(edit.street, edit.vertex, edit.offset);
                    let document = session.document();
                    let geometry = self
                        .map
                        .as_mut()
                        .expect("map")
                        .configure(document, self.map_shift);
                    let arrows = document.model().connection_arrows(&geometry.streets);
                    if let Some(connections) = &mut self.connections {
                        connections.set_arrows(arrows);
                    }
                } else {
                    self.shell.notify(
                        ca_app::shell::Severity::Warning,
                        self.shell.tr("shell.cellEditBusy", &[]),
                    );
                }
            }
            let request = Paint {
                playing: self.playing,
                rate: self.rate,
                step_ticket: self.step_ticket,
                view: map.view,
                generation_override: self.transport.generation_override(),
            };
            if !self.commands.send(request, map.clicked) {
                self.shell.notify(
                    ca_app::shell::Severity::Warning,
                    self.shell.tr("shell.cellEditBusy", &[]),
                );
            }
            let mut callback = self.callback.clone();
            callback.rect = map.rect;
            ui.painter()
                .rect_filled(map.rect, 0.0, egui::Color32::from_rgb(5, 6, 10));
            let mut background_callback = self.background_callback.clone();
            background_callback.rect = map.rect;
            ui.painter().add(background_callback);
            self.background.paint(ui.painter(), map.view, map.rect);
            ui.painter().add(callback);
            if let Some(connections) = &self.connections {
                connections.paint(ui.painter(), map.view, map.rect);
            }
            map.paint_preview(ui.painter());
            self.map
                .as_ref()
                .expect("map")
                .paint_vertices(ui.painter(), map.rect);
            if map.vertex_mode {
                ui.painter().text(
                    map.rect.left_top() + egui::vec2(12.0, 12.0),
                    egui::Align2::LEFT_TOP,
                    self.shell.tr("vertices.mode", &[]),
                    egui::FontId::proportional(16.0),
                    egui::Color32::YELLOW,
                );
            }
        });
        self.shell.overlays(ctx);
        if self.profiler {
            self.profiler = puffin_egui::profiler_window(ctx);
        }
        ctx.request_repaint();
    }

    fn on_exit(&mut self) {
        self.handle_messages();
        let _ = self.report_tx.try_send(Report {
            progress: self.progress,
            adapter: self.adapter.clone(),
            error: self.error.take(),
        });
    }
}
