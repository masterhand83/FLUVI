use anyhow::Context;
use ca_gpu::{TrafficDisplay, TrafficScene};
use crossbeam_channel::{Receiver, Sender, bounded};
use eframe::egui;

use crate::render::{Event, Paint, PaintCallback, Progress, Resources};

pub struct Report {
    pub progress: Progress,
    pub adapter: String,
    pub error: Option<String>,
}

pub struct App {
    events: Receiver<Event>,
    commands: Sender<Paint>,
    callback: egui::PaintCallback,
    view_aspect: f32,
    report_tx: Sender<Report>,
    progress: Progress,
    adapter: String,
    error: Option<String>,
    playing: bool,
    rate: f64,
    step_ticket: u64,
    profiler: bool,
    smoke_frames: Option<u64>,
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
        let scene = TrafficScene::demo();
        let [width, height] = scene.extent();
        let view_aspect = width as f32 / height as f32;
        let display = TrafficDisplay::new(&render.device, &scene, render.target_format);
        let (tx, events) = bounded(2);
        let (commands, requests) = bounded(2);
        // Setup-only framework lock. Mutable frame work uses owned resources.
        render
            .renderer
            .write()
            .callback_resources
            .insert(Resources::new(scene, display, tx, requests));
        Ok(Self {
            events,
            commands,
            callback: egui_wgpu::Callback::new_paint_callback(egui::Rect::NOTHING, PaintCallback),
            view_aspect,
            report_tx,
            progress: Progress::default(),
            adapter,
            error: None,
            playing: true,
            rate: 10.0,
            step_ticket: 0,
            profiler: false,
            smoke_frames,
        })
    }

    fn handle_messages(&mut self) {
        while let Ok(event) = self.events.try_recv() {
            match event {
                Event::Progress(progress) => self.progress = progress,
            }
        }
    }

    fn controls(&mut self, ctx: &egui::Context) {
        egui::SidePanel::left("controls")
            .resizable(false)
            .default_width(190.0)
            .show(ctx, |ui| {
                ui.heading("Traffic CA");
                ui.label("Fixed demo network");
                ui.separator();
                ui.add_enabled_ui(self.smoke_frames.is_none(), |ui| {
                    if ui
                        .button(if self.playing { "Pause" } else { "Play" })
                        .clicked()
                    {
                        self.playing = !self.playing;
                    }
                    if ui
                        .add_enabled(!self.playing, egui::Button::new("Step"))
                        .clicked()
                    {
                        self.step_ticket += 1;
                    }
                    ui.add(egui::Slider::new(&mut self.rate, 1.0..=60.0).text("ticks/s"));
                });
                ui.separator();
                ui.label("Top: Generador\nMiddle: Conexion\nBottom: Devorador");
                ui.label("Each pair: → then ←");
                ui.label("White / black: special cell 7");
                ui.label("F12: profiler");
            });
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
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
        egui::TopBottomPanel::bottom("status").show(ctx, |ui| {
            ui.label(format!(
                "Generation {}  |  Vehicles {}  |  Simulation {:.1} FPS  |  {}",
                self.progress.generation,
                self.progress.population,
                if self.playing { self.progress.fps } else { 0.0 },
                self.adapter,
            ));
        });
        egui::CentralPanel::default().show(ctx, |ui| {
            let available = ui.available_rect_before_wrap();
            let width = available
                .width()
                .min(available.height() * self.view_aspect)
                .max(1.0);
            let rect = egui::Rect::from_center_size(
                available.center(),
                egui::vec2(width, width / self.view_aspect),
            );
            ui.allocate_rect(rect, egui::Sense::hover());
            let _ = self.commands.try_send(Paint {
                playing: self.playing,
                rate: self.rate,
                step_ticket: self.step_ticket,
            });
            let mut callback = self.callback.clone();
            callback.rect = rect;
            ui.painter().add(callback);
        });
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
