use std::time::Instant;

use anyhow::Context;
use ca_analysis::{Statistics, Worker, spawn_worker};
use ca_gpu::{Brush, Grid, PopulationSample, Simulation};
use crossbeam_channel::{Receiver, Sender, TryRecvError, TrySendError, bounded};
use eframe::egui;
use egui_plot::{Line, Plot, PlotPoint};

use crate::render::{Event, GRID_SIZE, INITIAL_SEED, Paint, PaintCallback, Progress, Resources};

const HISTORY_GENERATIONS: u64 = 1024;

pub struct Report {
    pub progress: Progress,
    pub population: Option<PopulationSample>,
    pub readbacks: u64,
    pub analysis_results: u64,
    pub adapter: String,
    pub error: Option<String>,
}

pub struct App {
    events: Receiver<Event>,
    commands: Sender<Paint>,
    callback: egui::PaintCallback,
    worker: Option<Worker>,
    report_tx: Sender<Report>,
    progress: Progress,
    population: Option<PopulationSample>,
    readbacks: u64,
    analysis_results: u64,
    statistics: Option<Statistics>,
    points: Vec<PlotPoint>,
    adapter: String,
    error: Option<String>,
    playing: bool,
    rate: f64,
    radius: u32,
    seed: u64,
    epoch: u64,
    step_ticket: u64,
    profiler: bool,
    smoke_frames: Option<u64>,
    last_ui: Instant,
    fps: f64,
    rate_started: Instant,
    rate_generation: u64,
    actual_rate: f64,
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
        let grid = Grid::seeded(GRID_SIZE, GRID_SIZE, INITIAL_SEED)?;
        let sim = Simulation::new(&render.device, &grid, render.target_format);
        let (tx, events) = bounded(512);
        let (commands, requests) = bounded(2);
        // This setup-only lock is required by eframe. Frame work uses owned resources.
        render
            .renderer
            .write()
            .callback_resources
            .insert(Resources::new(sim, tx, requests));
        let now = Instant::now();
        Ok(Self {
            events,
            commands,
            callback: egui_wgpu::Callback::new_paint_callback(egui::Rect::NOTHING, PaintCallback),
            worker: Some(spawn_worker()?),
            report_tx,
            progress: Progress::default(),
            population: None,
            readbacks: 0,
            analysis_results: 0,
            statistics: None,
            points: Vec::with_capacity(HISTORY_GENERATIONS as usize + 1),
            adapter,
            error: None,
            playing: true,
            rate: 60.0,
            radius: 4,
            seed: INITIAL_SEED,
            epoch: 0,
            step_ticket: 0,
            profiler: false,
            smoke_frames,
            last_ui: now,
            fps: 0.0,
            rate_started: now,
            rate_generation: 0,
            actual_rate: 0.0,
        })
    }

    fn handle_messages(&mut self) {
        puffin::profile_scope!("analysis message handling");
        while let Ok(event) = self.events.try_recv() {
            match event {
                Event::Progress(progress) => self.progress = progress,
                Event::Population(sample) if sample.epoch == self.epoch => {
                    self.readbacks += 1;
                    if self
                        .population
                        .is_some_and(|last| sample.generation < last.generation)
                    {
                        continue;
                    }
                    self.population = Some(sample);
                    let cutoff = sample.generation.saturating_sub(HISTORY_GENERATIONS - 1) as f64;
                    self.points
                        .retain(|p| p.x >= cutoff && p.x < sample.generation as f64);
                    self.points.push(PlotPoint::new(
                        sample.generation as f64,
                        f64::from(sample.population),
                    ));
                    if let Some(worker) = &self.worker
                        && let Err(TrySendError::Disconnected(_)) = worker.input.try_send(sample)
                    {
                        self.error = Some("analysis worker stopped unexpectedly".into());
                    }
                }
                Event::Population(_) => {}
                Event::Error(error) => self.error = Some(error),
            }
        }
        self.receive_statistics();
    }

    fn receive_statistics(&mut self) {
        if let Some(worker) = &self.worker {
            loop {
                match worker.output.try_recv() {
                    Ok(result) if result.sample.epoch == self.epoch => {
                        self.analysis_results += 1;
                        self.statistics = Some(result);
                    }
                    Ok(_) => {}
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        self.error = Some("analysis worker output disconnected".into());
                        break;
                    }
                }
            }
        }
    }

    fn reset(&mut self, new_seed: bool) {
        if new_seed {
            self.seed = self.seed.wrapping_add(1);
        }
        self.epoch += 1;
        self.population = None;
        self.statistics = None;
        self.points.clear();
    }

    fn controls(&mut self, ctx: &egui::Context) {
        egui::SidePanel::left("controls")
            .resizable(false)
            .default_width(190.0)
            .show(ctx, |ui| {
                ui.heading("CA Lab");
                ui.label("Conway · 512 × 512 · torus");
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
                    if ui.button("Reset").clicked() {
                        self.reset(false);
                    }
                    if ui.button("Randomize").clicked() {
                        self.reset(true);
                    }
                    ui.add(egui::Slider::new(&mut self.rate, 1.0..=240.0).text("gen/s"));
                    ui.add(egui::Slider::new(&mut self.radius, 1..=32).text("radius"));
                });
                ui.separator();
                ui.label("Left drag: paint\nRight drag: erase\nF12: profiler");
                ui.label(format!("Seed: {}", self.seed));
            });
    }

    fn chart(&self, ctx: &egui::Context) {
        egui::TopBottomPanel::bottom("population")
            .resizable(false)
            .exact_height(170.0)
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.label(format!(
                        "Population: {}",
                        self.population.map_or(0, |s| s.population)
                    ));
                    if let Some(stats) = self.statistics {
                        ui.label(format!("Mean: {:.2}", stats.mean.unwrap_or_default()));
                        match stats.std {
                            Some(std) => {
                                ui.label(format!("Std: {std:.2}"));
                            }
                            None => {
                                ui.label("Std: —");
                            }
                        }
                        ui.label(format!(
                            "{} samples / last 64 generations",
                            stats.observations
                        ));
                    }
                });
                Plot::new("population history")
                    .height(133.0)
                    .allow_zoom(false)
                    .allow_drag(false)
                    .allow_scroll(false)
                    .allow_boxed_zoom(false)
                    .include_y(0.0)
                    .show(ui, |plot| {
                        plot.line(Line::new("Live cells", self.points.as_slice()))
                    });
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
            // Puffin itself uses synchronization; it is disabled in normal operation.
            puffin::GlobalProfiler::lock().new_frame();
        }
        self.handle_messages();
        if self.error.is_some() || self.smoke_frames.is_some_and(|n| self.progress.frames >= n) {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            return;
        }
        let now = Instant::now();
        let dt = now.duration_since(self.last_ui).as_secs_f64();
        self.last_ui = now;
        if dt > 0.0 {
            self.fps = self.fps * 0.9 + 0.1 / dt;
        }
        let rate_elapsed = now.duration_since(self.rate_started).as_secs_f64();
        if rate_elapsed >= 0.5 {
            self.actual_rate =
                (self.progress.total_generations - self.rate_generation) as f64 / rate_elapsed;
            self.rate_generation = self.progress.total_generations;
            self.rate_started = now;
        }
        {
            puffin::profile_scope!("UI layout");
            egui::TopBottomPanel::bottom("status").show(ctx, |ui| {
                ui.label(format!(
                    "UI {:.0} FPS  |  {:.1} gen/s  |  Generation {}  |  {}",
                    self.fps, self.actual_rate, self.progress.generation, self.adapter
                ));
            });
            self.controls(ctx);
            self.chart(ctx);
            egui::CentralPanel::default().show(ctx, |ui| {
                let available = ui.available_rect_before_wrap();
                let side = available.width().min(available.height()).max(1.0);
                let rect = egui::Rect::from_center_size(available.center(), egui::vec2(side, side));
                let response = ui.allocate_rect(rect, egui::Sense::click_and_drag());
                let brush = response
                    .interact_pointer_pos()
                    .filter(|p| rect.contains(*p))
                    .and_then(|p| {
                        ctx.input(|i| {
                            let value = if i.pointer.secondary_down() {
                                0
                            } else if i.pointer.primary_down() {
                                1
                            } else {
                                return None;
                            };
                            Some(Brush {
                                center: [
                                    (((p.x - rect.left()) / side * GRID_SIZE as f32) as i32)
                                        .clamp(0, GRID_SIZE as i32 - 1),
                                    (((p.y - rect.top()) / side * GRID_SIZE as f32) as i32)
                                        .clamp(0, GRID_SIZE as i32 - 1),
                                ],
                                radius: self.radius,
                                value,
                            })
                        })
                    });
                let _ = self.commands.try_send(Paint {
                    playing: self.playing,
                    rate: self.rate,
                    epoch: self.epoch,
                    seed: self.seed,
                    step_ticket: self.step_ticket,
                    brush,
                });
                let mut callback = self.callback.clone();
                callback.rect = rect;
                ui.painter().add(callback);
            });
            if self.profiler {
                self.profiler = puffin_egui::profiler_window(ctx);
            }
        }
        ctx.request_repaint();
    }

    fn on_exit(&mut self) {
        self.handle_messages();
        if let Some(Worker {
            input,
            output,
            join,
        }) = self.worker.take()
        {
            drop(input);
            match join.join() {
                Ok(Ok(())) => {}
                Ok(Err(error)) => self.error = Some(error.to_string()),
                Err(_) => self.error = Some("analysis worker panicked".into()),
            }
            while let Ok(result) = output.try_recv() {
                if result.sample.epoch == self.epoch {
                    self.analysis_results += 1;
                }
            }
        }
        let _ = self.report_tx.try_send(Report {
            progress: self.progress,
            population: self.population,
            readbacks: self.readbacks,
            analysis_results: self.analysis_results,
            adapter: self.adapter.clone(),
            error: self.error.take(),
        });
    }
}
