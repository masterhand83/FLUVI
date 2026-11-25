use anyhow::Context;
use ca_gpu::{TrafficDisplay, TrafficScene};
use crossbeam_channel::{Receiver, Sender, TryRecvError, bounded};
use eframe::egui;

use crate::render::{
    Commands, Edit, Event, Paint, PaintCallback, Progress, Requests, Resources, command_channel,
};
use ca_app::map::MapInteraction;
use ca_app::shell::{Shell, config_path};
use ca_app::transport::TransportControls;

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
        Ok(Self {
            events,
            commands,
            callback: egui_wgpu::Callback::new_paint_callback(egui::Rect::NOTHING, PaintCallback),
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
                    let [width, height] = scene.extent();
                    self.map = Some(MapInteraction::new(
                        [width as f32, height as f32],
                        &scene.geometry(),
                        scene.street_names(),
                    ));
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
                    let scene = TrafficScene::demo();
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
                ui.label(self.shell.tr("shell.demo", &[]));
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
            ui.painter().add(callback);
            map.paint_preview(ui.painter());
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
