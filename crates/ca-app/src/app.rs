use anyhow::Context;
use ca_gpu::{TrafficDisplay, TrafficScene};
use crossbeam_channel::{Receiver, Sender, TryRecvError, bounded};
use eframe::egui;

use crate::render::{
    Commands, Edit, Event, Paint, PaintCallback, Progress, Requests, Resources, command_channel,
};
use ca_app::map::{CellPickMode, MapInteraction};
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
    labels: ca_app::labels::Labels,
    minimap: ca_app::minimap::Minimap,
    reference: ca_app::reference_images::Editor,
    capture_job: Option<ca_app::capture::SaveJob>,
    metric_export_job: Option<ca_app::metric_exports::SaveJob>,
    metric_export_dialog: ca_app::metric_exports::ExportDialog,
    analyzer: ca_app::analyzer::AnalyzerDialog,
    vehicle_heat: bool,
    heatmap: ca_app::heatmap::HeatmapDialog,
    next_heatmap: std::time::Instant,
    metrics: ca_app::metrics::MetricsPanel,
    scenario_exchange: ca_app::scenario_library::ScenarioExchange,
    scenarios: ca_app::scenarios::ScenarioControls,
    parking_pending: Option<ca_app::parking_form::ParkingRequest>,
    buildings: ca_app::buildings::BuildingEditor,
    time: ca_core::virtual_time::VirtualTime,
    time_dialogs: ca_app::time::TimeDialogs,
    time_labels: ca_app::time::TimeLabels,
    events: Receiver<Event>,
    commands: Commands,
    callback: egui::PaintCallback,
    background_callback: egui::PaintCallback,
    building_callbacks: Vec<egui::PaintCallback>,
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
    inspector: ca_app::inspector::StreetInspector,
    edit_pause: ca_app::inspector::EditPause,
    bulk_editor: ca_app::bulk_editor::BulkEditor,
    street_dialog: ca_app::street_dialog::StreetDialog,
    connection_draft: ca_app::connection_draft::ConnectionDraft,
    saved_connections: ca_app::connections::SavedConnections,
}

impl App {
    fn apply_reference_edit(&mut self) {
        let Some(image) = self.reference.pending() else {
            return;
        };
        if MapDocument::validate_reference_image(image.as_ref()).is_err() {
            self.reference.committed();
            self.shell.notify(
                ca_app::shell::Severity::Error,
                self.shell.tr("reference.invalidPlacement", &[]),
            );
            return;
        }
        let image = image.clone();
        if self.commands.edit(Edit::Reference(image.clone())) {
            self.session
                .as_mut()
                .expect("session")
                .set_reference_image(image)
                .expect("validated reference edit");
            self.reference.committed();
        }
    }

    fn start_metric_export(
        &mut self,
        ctx: &egui::Context,
        kind: ca_app::metric_exports::Kind,
        options: ca_app::metric_exports::ImageOptions,
    ) {
        if self.metric_export_job.is_some() {
            return;
        }
        let viewport = if matches!(kind, ca_app::metric_exports::Kind::Complete) {
            self.map
                .as_ref()
                .and_then(|map| map.camera())
                .map(|camera| {
                    let view = camera.view();
                    let end = std::array::from_fn(|i| view.origin[i] + view.span[i]);
                    let pixels = camera
                        .world_to_screen(end)
                        .map(|size| (size * ctx.pixels_per_point()).round().max(1.) as u32);
                    (view, pixels)
                })
        } else {
            None
        };
        let job = ca_app::metric_exports::start_save(
            kind,
            options,
            self.shell.tr(kind.key(), &[]),
            ctx.clone(),
        )
        .ok()
        .and_then(|(snapshot, job)| {
            self.commands
                .export_metrics(snapshot, viewport)
                .then_some(job)
        });
        if let Some(job) = job {
            self.metric_export_job = Some(job);
        } else {
            self.shell.notify(
                ca_app::shell::Severity::Error,
                self.shell.tr("metrics.export.failed", &[]),
            );
        }
    }

    fn select_metric_streets(&mut self, included: Vec<bool>) {
        if self.commands.edit(Edit::MetricStreets(included.clone())) {
            self.metrics.accept_selection(included);
        } else {
            self.shell.notify(
                ca_app::shell::Severity::Warning,
                self.shell.tr("shell.cellEditBusy", &[]),
            );
        }
    }

    fn scenario_library(&mut self, ctx: &egui::Context) {
        use crate::render::ScenarioResult;
        use ca_app::scenario_library::{LibraryAction, LibraryResult};
        if let Some(result) = self.scenario_exchange.poll(ctx) {
            match result {
                LibraryResult::Imported(scenario) => {
                    match scenario.validate(self.session.as_ref().expect("session").document()) {
                        Ok(()) => self.scenario_exchange.store(scenario, ctx),
                        Err(error) => self.shell.notify(
                            ca_app::shell::Severity::Error,
                            self.shell.tr(error.translation_key(), &[]),
                        ),
                    }
                }
                LibraryResult::Failed(key) => self
                    .shell
                    .notify(ca_app::shell::Severity::Error, self.shell.tr(key, &[])),
                LibraryResult::Exported => self.shell.notify(
                    ca_app::shell::Severity::Success,
                    self.shell.tr("scenarios.exported", &[]),
                ),
                _ => {}
            }
        }
        for result in self.commands.scenario_results() {
            self.scenario_exchange.capturing = false;
            match result {
                ScenarioResult::Captured(Ok(scenario)) => {
                    self.scenario_exchange.store(scenario, ctx)
                }
                ScenarioResult::Loaded(Ok(scenario)) => {
                    self.scenarios.loaded(&scenario);
                    self.map.as_mut().expect("map").set_painting(false);
                    self.session
                        .as_mut()
                        .expect("session")
                        .set_rain_probability(scenario.probability());
                }
                ScenarioResult::Captured(Err(error)) | ScenarioResult::Loaded(Err(error)) => {
                    self.shell.notify(
                        ca_app::shell::Severity::Error,
                        self.shell.tr(error.translation_key(), &[]),
                    )
                }
            }
        }
        let ready = self.file_job.is_none()
            && self.new_confirmation.is_none()
            && self
                .session
                .as_ref()
                .expect("session")
                .document()
                .editing_street()
                .is_none()
            && self.map.is_some();
        let Some(action) = self.scenario_exchange.show(ctx, &self.shell, ready) else {
            return;
        };
        let accepted = match action {
            LibraryAction::Save(name) => {
                let id = format!(
                    "{}-{}",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_nanos()
                );
                self.commands.edit(Edit::CaptureScenario(name, id))
            }
            LibraryAction::Load(scenario) => {
                match scenario.validate(self.session.as_ref().expect("session").document()) {
                    Ok(()) => self.commands.edit(Edit::LoadScenario(Box::new(scenario))),
                    Err(error) => {
                        self.shell.notify(
                            ca_app::shell::Severity::Error,
                            self.shell.tr(error.translation_key(), &[]),
                        );
                        return;
                    }
                }
            }
            action => {
                self.scenario_exchange.file_action(action, ctx, &self.shell);
                return;
            }
        };
        if accepted {
            self.scenario_exchange.capturing = true;
        } else {
            self.shell.notify(
                ca_app::shell::Severity::Warning,
                self.shell.tr("shell.cellEditBusy", &[]),
            );
        }
    }

    fn scenario_command(&mut self, command: ca_app::scenarios::ScenarioCommand) -> bool {
        use ca_app::scenarios::ScenarioCommand;
        if command == ScenarioCommand::Library {
            self.scenario_exchange.open = true;
            return true;
        }
        if !matches!(
            command,
            ScenarioCommand::Rain(..) | ScenarioCommand::Mode(None)
        ) {
            if self
                .session
                .as_ref()
                .expect("session")
                .document()
                .editing_street()
                .is_some()
                && !self.edit_streets(ca_core::streets::StreetEdit::CancelSession)
            {
                self.scenarios.mode = None;
                return false;
            }
            self.buildings.cancel();
            self.buildings.select(None);
            self.connection_draft.cancel();
            self.street_dialog.close();
            self.inspector = Default::default();
            let map = self.map.as_mut().expect("map");
            map.finish_edits();
            map.clear_bulk();
            map.select(None);
            map.set_cell_picking(None);
        }
        let accepted = match command {
            ScenarioCommand::Library => unreachable!(),
            ScenarioCommand::Mode(mode) => {
                self.map.as_mut().expect("map").set_painting(mode.is_some());
                true
            }
            ScenarioCommand::Rain(active, probability) => {
                self.commands.edit(Edit::Rain(active, probability))
            }
            ScenarioCommand::Action(action) => self.commands.edit(Edit::Scenario(action)),
        };
        if !accepted {
            self.shell.notify(
                ca_app::shell::Severity::Warning,
                self.shell.tr("shell.cellEditBusy", &[]),
            );
        }
        accepted
    }

    fn edit_buildings(&mut self, mut edit: ca_core::buildings::BuildingEdit) {
        if let ca_core::buildings::BuildingEdit::Create(building) = &mut edit
            && building.label.trim().is_empty()
        {
            building.label = self.shell.tr("buildings.defaultName", &[]);
        }
        if let Err(error) = self
            .session
            .as_ref()
            .expect("session")
            .document()
            .validate_building_edit(&edit)
        {
            self.shell.notify(
                ca_app::shell::Severity::Warning,
                self.shell.tr(&error.translation_key(), &[]),
            );
            return;
        }
        if !self.commands.edit(Edit::Building(edit.clone())) {
            self.shell.notify(
                ca_app::shell::Severity::Warning,
                self.shell.tr("shell.cellEditBusy", &[]),
            );
            return;
        }
        let deleted = match &edit {
            ca_core::buildings::BuildingEdit::Delete(index) => Some(*index),
            _ => None,
        };
        match self.session.as_mut().expect("session").edit_buildings(edit) {
            Ok(index) => {
                if let Some(deleted) = deleted {
                    self.buildings.parking_building_deleted(deleted);
                }
                self.buildings.select(index);
                self.buildings.refresh_render();
                self.map.as_mut().expect("map").configure(
                    self.session.as_ref().expect("session").document(),
                    self.map_shift,
                );
                self.edit_pause.begin(&mut self.playing);
            }
            Err(error) => self.shell.notify(
                ca_app::shell::Severity::Warning,
                self.shell.tr(&error.translation_key(), &[]),
            ),
        }
    }

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
            app.reference = Default::default();
            app.buildings = Default::default();
            app.building_callbacks.clear();
            app.time_dialogs = Default::default();
            app.map = None;
            app.inspector = Default::default();
            app.edit_pause = Default::default();
            app.bulk_editor = Default::default();
            app.street_dialog = Default::default();
            app.connection_draft.cancel();
            app.saved_connections = Default::default();
            if let Some(connections) = &mut app.connections {
                connections.set_arrows(Vec::new());
            }
        });
        session.register_reset(ResetPhase::Features, |app| {
            app.labels.invalidate_geometry();
            app.minimap.invalidate_geometry();
            app.heatmap = Default::default();
            app.metrics = Default::default();
            app.metric_export_dialog = Default::default();
            app.scenarios = Default::default();
            app.transport = TransportControls::default();
            app.step_ticket = 0;
            app.progress = Progress {
                frames: app.progress.frames,
                ..Default::default()
            };
        });
        session.register_scenario_reset(|app| {
            app.metrics.receive(ca_app::metrics::Packet::Reset);
            app.metric_export_dialog = Default::default();
            app.buildings.reset_parking_occupancy();
            app.progress.generation = 0;
            app.progress.population = 0;
            app.progress.fps = 0.0;
        });
        let time = session.document().time().clone();
        Ok(Self {
            labels: Default::default(),
            minimap: Default::default(),
            reference: Default::default(),
            capture_job: None,
            metric_export_job: None,
            metric_export_dialog: Default::default(),
            analyzer: Default::default(),
            vehicle_heat: false,
            heatmap: Default::default(),
            next_heatmap: std::time::Instant::now(),
            metrics: Default::default(),
            scenario_exchange: Default::default(),
            scenarios: Default::default(),
            parking_pending: None,
            buildings: Default::default(),
            time,
            time_dialogs: Default::default(),
            time_labels: Default::default(),
            events,
            commands,
            callback: egui_wgpu::Callback::new_paint_callback(egui::Rect::NOTHING, PaintCallback),
            building_callbacks: Vec::new(),
            background_callback: egui_wgpu::Callback::new_paint_callback(
                egui::Rect::NOTHING,
                crate::render::BackgroundCallback::Zones,
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
            inspector: Default::default(),
            edit_pause: Default::default(),
            bulk_editor: Default::default(),
            street_dialog: Default::default(),
            connection_draft: Default::default(),
            saved_connections: Default::default(),
            startup: Some(Startup {
                render: render.clone(),
                events: tx,
                requests,
                ready: None,
            }),
        })
    }

    fn handle_messages(&mut self) {
        for frame in self.commands.heatmap_updates() {
            if self.heatmap.is_open() {
                self.heatmap.receive(frame);
            }
        }
        for packet in self.commands.metric_updates() {
            self.metrics.receive(packet);
        }
        for (building, result) in self.commands.parking_results() {
            let Some((target, config)) = self.parking_pending.take() else {
                continue;
            };
            assert_eq!(building, target);
            match result {
                Ok(()) => {
                    self.session
                        .as_mut()
                        .expect("session")
                        .configure_parking(building, config)
                        .expect("render-validated parking configuration");
                    self.buildings.parking_applied();
                }
                Err(error) => self.shell.notify(
                    ca_app::shell::Severity::Warning,
                    self.shell.tr(error.translation_key(), &[]),
                ),
            }
        }
        for (building, occupied) in self.commands.parking_updates() {
            self.buildings.set_parking_occupancy(building, occupied);
        }
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
                    self.metrics.configure(document, None);
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
                ui.add_enabled_ui(
                    self.smoke_frames.is_none()
                        && self
                            .session
                            .as_ref()
                            .expect("session")
                            .document()
                            .editing_street()
                            .is_none(),
                    |ui| {
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
                            if self.playing {
                                self.playing = false;
                            } else {
                                let finished = self.inspector.finish(
                                    ctx,
                                    self.session.as_ref().expect("session").document(),
                                );
                                match finished {
                                    Ok(edit) => {
                                        if edit.is_none_or(|edit| self.edit_streets(edit)) {
                                            if let Some(map) = &mut self.map {
                                                map.finish_edits();
                                            }
                                            self.edit_pause.resume(&mut self.playing);
                                            self.buildings.cancel();
                                        }
                                    }
                                    Err(error) => self.shell.notify(
                                        ca_app::shell::Severity::Warning,
                                        ca_app::inspector::geometry_error_message(
                                            &self.shell,
                                            error,
                                        ),
                                    ),
                                }
                            }
                        }
                        if ui
                            .add_enabled(
                                self.edit_pause.can_step(self.playing),
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
                    },
                );
                let mut action = None;
                ui.add_enabled_ui(
                    self.smoke_frames.is_none()
                        && self
                            .session
                            .as_ref()
                            .expect("session")
                            .document()
                            .editing_street()
                            .is_none(),
                    |ui| {
                        action = self.transport.show_actions(ui, &self.shell);
                    },
                );
                if let Some(action) = action
                    && !self.commands.edit(Edit::Vehicles(action))
                {
                    self.shell.notify(
                        ca_app::shell::Severity::Warning,
                        self.shell.tr("shell.cellEditBusy", &[]),
                    );
                }
            });
        });
    }

    fn control_panel(&mut self, ctx: &egui::Context) {
        use ca_app::control_panel::{ControlPanel, PanelAction};
        let scenario_settings = (
            self.scenarios.mode,
            self.scenarios.rain_active,
            self.scenarios.rain_probability,
        );
        let action = ControlPanel {
            labels: &mut self.labels,
            vehicle_heat: self.vehicle_heat,
            metrics: &mut self.metrics,
            document: self.session.as_ref().expect("session").document(),
            map: self.map.as_mut(),
            connections: self.connections.as_mut(),
            saved_connections: &mut self.saved_connections,
            transport: &mut self.transport,
            scenarios: &mut self.scenarios,
            enabled: self.smoke_frames.is_none(),
            files_ready: self.file_job.is_none()
                && self.capture_job.is_none()
                && self.new_confirmation.is_none()
                && !self.scenario_exchange.busy(),
        }
        .show_at(ctx, &mut self.shell, self.progress.clock);
        if action
            .as_ref()
            .is_some_and(|a| !matches!(a, PanelAction::Metrics(_) | PanelAction::Screenshot))
            || self.map.as_ref().is_some_and(|map| map.drawing())
        {
            self.metrics.picking = false;
        }
        if matches!(
            &action,
            Some(
                PanelAction::Connection
                    | PanelAction::NewConnection
                    | PanelAction::SavedConnection(_)
                    | PanelAction::NewStreet
            )
        ) {
            self.buildings.cancel();
            self.buildings.select(None);
        }
        match action {
            Some(PanelAction::Background(background)) => {
                if self.commands.edit(Edit::Background(background)) {
                    self.session
                        .as_mut()
                        .expect("session")
                        .set_map_background(background);
                }
            }
            Some(PanelAction::ReferenceImage) => {
                self.prepare_connection_edit();
                self.connection_draft.cancel();
                self.reference.open();
            }
            Some(PanelAction::Screenshot) => {
                if self.capture_job.is_none() {
                    match ca_app::capture::start_save(
                        self.shell.tr("capture.button", &[]),
                        ctx.clone(),
                    ) {
                        Ok(job) if self.commands.capture(job.snapshot.clone()) => {
                            self.capture_job = Some(job)
                        }
                        _ => self.shell.notify(
                            ca_app::shell::Severity::Error,
                            self.shell.tr("capture.failed", &[]),
                        ),
                    }
                }
            }
            Some(PanelAction::Metrics(action)) => match action {
                ca_app::metrics::Action::Analyzer => self.analyzer.open(),
                ca_app::metrics::Action::Export(kind) => {
                    if self.metric_export_job.is_none() {
                        let options = ca_app::metric_exports::ImageOptions {
                            language: self.shell.preferences().language,
                            quality: self.shell.preferences().export_quality,
                        };
                        if matches!(kind, ca_app::metric_exports::Kind::Images) {
                            self.metric_export_dialog.open(options);
                        } else {
                            self.start_metric_export(ctx, kind, options);
                        }
                    }
                }
                ca_app::metrics::Action::Heatmap => {
                    self.heatmap.open();
                    self.next_heatmap = std::time::Instant::now();
                }
                ca_app::metrics::Action::VehicleHeat(heat) => {
                    self.vehicle_heat = heat;
                }
                ca_app::metrics::Action::Checklist => self.metrics.open_checklist(),
                ca_app::metrics::Action::Map => {
                    if !self.metrics.picking {
                        if self
                            .session
                            .as_ref()
                            .expect("session")
                            .document()
                            .editing_street()
                            .is_some()
                        {
                            self.edit_streets(ca_core::streets::StreetEdit::CancelSession);
                        }
                        self.buildings.cancel();
                        self.buildings.select(None);
                        self.connection_draft.cancel();
                        self.scenarios.mode = None;
                        let map = self.map.as_mut().expect("map");
                        map.set_painting(false);
                        map.finish_edits();
                        map.clear_bulk();
                        map.select(None);
                    }
                    self.metrics.picking = !self.metrics.picking;
                }
            },
            Some(PanelAction::Scenario(command)) => {
                if !self.scenario_command(command) {
                    (
                        self.scenarios.mode,
                        self.scenarios.rain_active,
                        self.scenarios.rain_probability,
                    ) = scenario_settings;
                }
            }
            Some(PanelAction::UploadBuildingImage) => {
                self.prepare_connection_edit();
                self.connection_draft.cancel();
                if let Some(map) = &mut self.map {
                    map.set_cell_picking(None);
                }
                self.buildings.upload_image(ctx, &self.shell, None);
            }
            Some(PanelAction::BuildingTool(tool)) => {
                self.prepare_connection_edit();
                self.connection_draft.cancel();
                if let Some(map) = &mut self.map {
                    map.set_cell_picking(None);
                }
                self.buildings.start(tool);
            }
            Some(PanelAction::NewBuilding) => {
                self.prepare_connection_edit();
                self.connection_draft.cancel();
                self.buildings.open_form();
            }
            Some(PanelAction::ScenarioTime) => {
                self.time_dialogs.open_time(self.progress.clock);
            }
            Some(PanelAction::Profiles) => {
                self.time.clock = self.progress.clock;
                self.time_dialogs.open_profiles(&self.time);
            }
            Some(PanelAction::NewConnection) => {
                self.prepare_connection_edit();
                self.connection_draft.start_form();
            }
            Some(PanelAction::SavedConnection(action)) => {
                use ca_app::connections::SavedConnectionAction;
                match action {
                    SavedConnectionAction::Edit(index) => {
                        self.prepare_connection_edit();
                        self.connection_draft
                            .edit(index, self.session.as_ref().expect("session").document());
                    }
                    SavedConnectionAction::Delete(index) => {
                        if self.commands.edit(Edit::DeleteConnection(index)) {
                            self.connection_draft.cancel();
                            self.session
                                .as_mut()
                                .expect("session")
                                .delete_connection(index);
                            self.refresh_connection_arrows();
                        } else {
                            self.shell.notify(
                                ca_app::shell::Severity::Warning,
                                self.shell.tr("shell.cellEditBusy", &[]),
                            );
                        }
                    }
                }
            }
            Some(PanelAction::Connection) => {
                self.scenarios.mode = None;
                if let Some(map) = &mut self.map {
                    map.set_painting(false);
                }
                if self.connection_draft.active() {
                    self.connection_draft.cancel();
                } else {
                    self.connection_draft.start();
                    self.inspector = Default::default();
                    self.street_dialog.close();
                    if let Some(map) = &mut self.map {
                        map.set_cell_picking(Some(CellPickMode::Connection));
                    }
                }
            }
            Some(PanelAction::NewStreet) => {
                self.scenarios.mode = None;
                if let Some(map) = &mut self.map {
                    map.set_painting(false);
                }
                self.connection_draft.cancel();
                if let Some(map) = &mut self.map {
                    map.finish_edits();
                    map.clear_bulk();
                    map.select(None);
                }
                self.inspector = Default::default();
                self.street_dialog.open();
            }
            Some(PanelAction::Open) => self.start_file(false, ctx),
            Some(PanelAction::Save) => self.start_file(true, ctx),
            Some(PanelAction::New) => {
                self.new_confirmation = Some(self.shell.confirm(
                    self.shell.tr("mapFiles.new", &[]),
                    self.shell.tr("mapFiles.newConfirm", &[]),
                ));
            }
            None => {}
        }
        if self.map.as_ref().is_some_and(|map| map.drawing()) {
            self.scenarios.mode = None;
            self.buildings.cancel();
            self.buildings.select(None);
            self.connection_draft.cancel();
        }
    }

    fn prepare_connection_edit(&mut self) {
        self.scenarios.mode = None;
        if let Some(map) = &mut self.map {
            map.set_painting(false);
        }
        self.buildings.cancel();
        self.buildings.select(None);
        self.inspector = Default::default();
        self.street_dialog.close();
        if let Some(map) = &mut self.map {
            map.finish_edits();
            map.clear_bulk();
            map.select(None);
            map.set_cell_picking(Some(CellPickMode::Connection));
        }
    }

    fn refresh_connection_arrows(&mut self) {
        let document = self.session.as_ref().expect("session").document();
        if let Some(connections) = &mut self.connections {
            let mut geometry = document.geometry();
            for street in &mut geometry {
                for point in street.centers.iter_mut().flatten() {
                    point[0] += self.map_shift[0];
                    point[1] += self.map_shift[1];
                }
            }
            connections.set_arrows(document.model().connection_arrows(&geometry));
        }
    }

    fn start_file(&mut self, save: bool, ctx: &egui::Context) {
        self.session
            .as_mut()
            .expect("session")
            .set_rain_probability(self.scenarios.rain_probability);
        self.time.clock = self.progress.clock;
        self.session
            .as_mut()
            .expect("session")
            .set_time(self.time.clone());
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

    fn replace_map(&mut self, mut document: MapDocument) {
        document.inherit_profile_switch(self.time.enabled);
        let time = document.time().clone();
        let rain_probability = document.model().rain().1;
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
        self.metrics
            .configure(self.session.as_ref().expect("session").document(), None);
        self.scenarios.rain_probability = rain_probability;
        self.scenario_exchange.capturing = false;
        self.scenario_exchange.open = false;
        for _ in self.commands.scenario_results() {}
        // Feature/info-bar reset must finish before restoring the saved clock.
        self.progress.clock = time.clock;
        self.time = time;
        self.map = Some(map);
        self.map_shift = shift;
        self.background = background;
        if let Some(connections) = &mut self.connections {
            connections.set_arrows(arrows);
        } else {
            self.connections = Some(ca_app::connections::ConnectionOverlays::new(arrows));
        }
    }

    fn time_dialogs(&mut self, ctx: &egui::Context) {
        use ca_app::time::TimeAction;
        let street_session_active = self
            .session
            .as_ref()
            .expect("session")
            .document()
            .editing_street()
            .is_some();
        let Some(action) = self
            .time_dialogs
            .show(ctx, &self.shell, street_session_active)
        else {
            return;
        };
        let edit = match &action {
            TimeAction::Scenario(clock) => Edit::ScenarioTime(*clock),
            TimeAction::Profiles(time) => Edit::Profiles(time.clone()),
        };
        if !self.commands.edit(edit) {
            self.shell.notify(
                ca_app::shell::Severity::Warning,
                self.shell.tr("shell.cellEditBusy", &[]),
            );
            return;
        }
        match action {
            TimeAction::Scenario(clock) => {
                let mut session = self.session.take().expect("session");
                session.reset_scenario_time(clock, self);
                self.session = Some(session);
                self.time.clock = clock;
                self.progress.clock = clock;
            }
            TimeAction::Profiles(time) => {
                self.time.apply_profiles(&time);
                self.session
                    .as_mut()
                    .expect("session")
                    .set_time(self.time.clone());
            }
        }
        self.time_dialogs.accepted();
    }

    fn edit_streets(&mut self, mut edit: ca_core::streets::StreetEdit) -> bool {
        self.connection_draft.cancel();
        use ca_core::streets::StreetEdit;
        if matches!(edit, StreetEdit::BeginSession(_))
            && let Some(map) = &mut self.map
        {
            self.scenarios.mode = None;
            map.set_painting(false);
            map.finish_edits();
            map.clear_bulk();
        }
        if let StreetEdit::Draw(draft) = &mut edit {
            for i in 0..2 {
                draft.origin[i] -= self.map_shift[i] as f64;
            }
        }
        if let StreetEdit::DrawRoundabout(draft) = &mut edit {
            for i in 0..2 {
                draft.center[i] -= self.map_shift[i] as f64;
            }
        }
        // Validate before enqueueing. A rejected/full queue must not change the UI document.
        let preserve_bulk = matches!(edit, StreetEdit::CancelSession)
            && self
                .map
                .as_ref()
                .is_some_and(|map| map.selected().is_none());
        if let Err(error) = self
            .session
            .as_ref()
            .expect("session")
            .document()
            .validate_street_edit(&edit)
        {
            self.shell.notify(
                ca_app::shell::Severity::Warning,
                ca_app::inspector::geometry_error_message(&self.shell, error),
            );
            return false;
        }
        if !self.commands.edit(Edit::Street(edit.clone())) {
            self.shell.notify(
                ca_app::shell::Severity::Warning,
                self.shell.tr("shell.cellEditBusy", &[]),
            );
            return false;
        }
        let session = self.session.as_mut().expect("session");
        let event = session.edit_streets(edit).expect("validated street edit");
        self.metrics.configure(
            session.document(),
            if let ca_app::streets::StreetEvent::Deleted(id) = event {
                Some(id)
            } else {
                None
            },
        );
        // Resizing or deletion can remove/reindex saved links while a draft is open.
        self.connection_draft.cancel();
        let map = self.map.as_mut().expect("map");
        let geometry = map.configure(session.document(), self.map_shift);
        let (selected, key) = match event {
            ca_app::streets::StreetEvent::BulkUpdated => (None, "streetInspector.updated"),
            ca_app::streets::StreetEvent::Drawn(street) => (Some(street), "streetDrawing.drawn"),
            ca_app::streets::StreetEvent::Deleted(_) => (None, "streetDrawing.deleted"),
            ca_app::streets::StreetEvent::Updated(street) => {
                (Some(street), "streetInspector.updated")
            }
            ca_app::streets::StreetEvent::LaneDirectionsChanged(street) => {
                (Some(street), "streetInspector.directionsChanged")
            }
        };
        if !preserve_bulk {
            map.select(selected);
        }
        if let Some(connections) = &mut self.connections {
            connections.set_arrows(
                session
                    .document()
                    .model()
                    .connection_arrows(&geometry.streets),
            );
        }
        self.edit_pause.begin(&mut self.playing);
        if !matches!(event, ca_app::streets::StreetEvent::Updated(_)) {
            self.shell
                .notify(ca_app::shell::Severity::Success, self.shell.tr(key, &[]));
        }
        true
    }

    fn connection_form(&mut self, ctx: &egui::Context, rect: egui::Rect) {
        let session = self.session.as_mut().expect("session");
        let Some(connection) =
            self.connection_draft
                .show(ctx, rect, session.document(), &self.shell)
        else {
            return;
        };
        let editing = self.connection_draft.editing();
        let edit = match editing {
            Some(index) => Edit::ReplaceConnection(index, connection.clone()),
            None => Edit::Connection(connection.clone()),
        };
        if !self.commands.edit(edit) {
            self.shell.notify(
                ca_app::shell::Severity::Warning,
                self.shell.tr("shell.cellEditBusy", &[]),
            );
            return;
        }
        if let Some(index) = editing {
            session
                .replace_connection(index, connection)
                .expect("validated draft");
        } else {
            session.add_connection(connection).expect("validated draft");
        }
        self.refresh_connection_arrows();
        self.connection_draft.cancel();
    }

    fn map_files(&mut self, ctx: &egui::Context) {
        if self.file_job.is_none()
            && !self.scenario_exchange.busy()
            && self.new_confirmation.is_none()
            && self.smoke_frames.is_none()
            && self
                .session
                .as_ref()
                .expect("session")
                .document()
                .editing_street()
                .is_none()
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

    fn street_forms(&mut self, ctx: &egui::Context) {
        // Map input has priority: Shift-drag discards, rather than commits,
        // the inspector's pending focus-loss edit.
        let selected = self.map.as_ref().and_then(MapInteraction::selected);
        self.inspector
            .set_curve_point(self.map.as_ref().and_then(MapInteraction::curve_point));
        let inspector = self.inspector.show(
            ctx,
            self.session.as_ref().expect("session").document(),
            selected,
            &self.shell,
        );
        if inspector.editing {
            self.edit_pause.begin(&mut self.playing);
        }
        if let Some(map) = &mut self.map {
            map.set_curve_point(self.inspector.curve_point());
            if inspector.closed {
                map.select(None);
            }
        }
        for edit in inspector.edits {
            self.edit_streets(edit);
        }
        let bulk = self.bulk_editor.show(
            ctx,
            self.session.as_ref().expect("session").document(),
            self.map.as_ref().map_or(&[], MapInteraction::bulk_selected),
            &self.shell,
        );
        if bulk.closed
            && let Some(map) = &mut self.map
        {
            map.clear_bulk();
        }
        if let Some(edit) = bulk.edit {
            self.edit_streets(edit);
        }
        if let Some(edit) = self.street_dialog.show(
            ctx,
            self.session.as_ref().expect("session").document(),
            &self.shell,
        ) && self.edit_streets(edit)
        {
            self.street_dialog.close();
        }
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.shell.apply_theme(ctx);
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
        if let Some(job) = &self.metric_export_job {
            let result = match job.result.try_recv() {
                Ok(result) => Some(result),
                Err(TryRecvError::Disconnected) => Some(
                    ca_app::metric_exports::SaveResult::Failed("worker closed".into()),
                ),
                Err(TryRecvError::Empty) => None,
            };
            if let Some(result) = result {
                self.metric_export_job = None;
                let (severity, key) = result.notice();
                self.shell.notify(severity, self.shell.tr(key, &[]));
            }
        }
        self.metrics.exporting =
            self.metric_export_job.is_some() || self.metric_export_dialog.is_open();
        self.metrics.export_progress = self
            .metric_export_job
            .as_ref()
            .map(|job| job.progress.snapshot());
        if let Some(job) = &self.capture_job {
            match job.result.try_recv() {
                Ok(result) => {
                    self.capture_job = None;
                    let (severity, key) = match result {
                        ca_app::capture::SaveResult::Saved => {
                            (ca_app::shell::Severity::Success, "capture.saved")
                        }
                        ca_app::capture::SaveResult::Cancelled => {
                            (ca_app::shell::Severity::Info, "capture.cancelled")
                        }
                        ca_app::capture::SaveResult::Failed(error) => {
                            tracing::warn!(%error, "map capture failed");
                            (
                                ca_app::shell::Severity::Error,
                                if error == "capture.empty" {
                                    "capture.empty"
                                } else if error == "capture.referenceUnavailable" {
                                    "capture.referenceUnavailable"
                                } else {
                                    "capture.failed"
                                },
                            )
                        }
                    };
                    self.shell.notify(severity, self.shell.tr(key, &[]));
                }
                Err(TryRecvError::Disconnected) => {
                    self.capture_job = None;
                    self.shell.notify(
                        ca_app::shell::Severity::Error,
                        self.shell.tr("capture.failed", &[]),
                    );
                }
                Err(TryRecvError::Empty) => {}
            }
        }
        // Wait for the render-owned occupancy check before accepting another
        // structural edit or map replacement. No blocking channel read is used.
        if self.parking_pending.is_some() {
            egui::CentralPanel::default().show(ctx, |ui| {
                ui.label(self.shell.tr("parking.ui.applying", &[]));
            });
            ctx.request_repaint();
            return;
        }
        self.map_files(ctx);
        self.scenario_library(ctx);
        if self.error.is_some() || self.smoke_frames.is_some_and(|n| self.progress.frames >= n) {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            return;
        }
        self.controls(ctx);
        self.control_panel(ctx);
        if let Some(options) = self.metric_export_dialog.show(ctx, &self.shell) {
            self.start_metric_export(ctx, ca_app::metric_exports::Kind::Images, options);
        }
        self.time_dialogs(ctx);
        if self.heatmap.is_open() && std::time::Instant::now() >= self.next_heatmap {
            self.commands.request_heatmap();
            self.next_heatmap = std::time::Instant::now() + std::time::Duration::from_millis(200);
        }
        self.heatmap.show(ctx, &self.shell);
        self.analyzer.show(ctx, &self.shell);
        if let Some(included) = self.metrics.dialog(
            ctx,
            self.session.as_ref().expect("session").document(),
            &self.shell,
        ) {
            self.select_metric_streets(included);
        }
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
            self.time.clock = self.progress.clock;
            self.time_labels.refresh(&self.time, &self.shell);
            ui.horizontal_wrapped(|ui| {
                ui.label(&self.time_labels.clock);
                ui.label(&self.time_labels.multiplier);
                if let Some(forecast) = &self.time_labels.forecast {
                    ui.label(forecast);
                }
            });
        });
        egui::CentralPanel::default().show(ctx, |ui| {
            let rect = ui.available_rect_before_wrap();
            self.map
                .as_mut()
                .expect("map")
                .prepare_view([rect.width(), rect.height()]);
            let session = self.session.as_ref().expect("session");
            self.minimap
                .sync(session.document(), session.revision(), self.map_shift);
            let size = egui::vec2(
                200_f32.min(rect.width() * 0.35),
                130_f32.min(rect.height() * 0.3),
            );
            let minimap_rect =
                egui::Rect::from_min_size(rect.right_bottom() - size - egui::vec2(8., 8.), size);
            let minimap_input = self.minimap.captures(ctx, minimap_rect);
            self.minimap
                .show(ui, minimap_rect, self.map.as_mut().expect("map"));
            let view = self
                .map
                .as_ref()
                .expect("map")
                .camera()
                .expect("camera")
                .view();
            self.reference.update(
                ctx,
                self.session.as_ref().expect("session").document(),
                view,
                self.map_shift,
            );
            self.reference.show(
                ctx,
                &self.shell,
                self.session.as_ref().expect("session").document(),
                view,
                self.map_shift,
            );
            self.apply_reference_edit();
            self.buildings.delete_shortcut(
                ctx,
                self.session.as_ref().expect("session").document(),
                &mut self.shell,
            );
            if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
                self.metrics.picking = false;
                self.connection_draft.cancel();
            }
            let parking_picking = self.buildings.parking_picking();
            let building_input = !minimap_input
                && !self.metrics.picking
                && !parking_picking
                && !self.connection_draft.active()
                && !self.map.as_ref().expect("map").drawing()
                && self
                    .map
                    .as_ref()
                    .and_then(|map| map.camera())
                    .is_some_and(|camera| {
                        self.buildings.captures(
                            ctx,
                            self.session.as_ref().expect("session").document(),
                            ui.available_rect_before_wrap(),
                            camera.view(),
                            self.map_shift,
                        )
                    });
            let reference_enabled = !minimap_input
                && !building_input
                && !self.buildings.active()
                && !self.metrics.picking
                && !parking_picking
                && self.scenarios.mode.is_none()
                && !self.connection_draft.active()
                && !self.map.as_ref().expect("map").drawing()
                && self
                    .session
                    .as_ref()
                    .expect("session")
                    .document()
                    .editing_street()
                    .is_none();
            let reference_input = reference_enabled
                && self.reference.captures(
                    ctx,
                    self.session.as_ref().expect("session").document(),
                    rect,
                    view,
                    self.map_shift,
                );
            self.map
                .as_mut()
                .expect("map")
                .set_building_input(minimap_input || building_input || reference_input);
            self.map
                .as_mut()
                .expect("map")
                .set_cell_picking(if self.metrics.picking {
                    Some(CellPickMode::Metrics)
                } else if parking_picking {
                    Some(CellPickMode::Parking)
                } else {
                    self.connection_draft
                        .active()
                        .then_some(CellPickMode::Connection)
                });
            let map = self
                .map
                .as_mut()
                .expect("map installed with render resources")
                .show(ui, self.shell.preferences().cell_detection);
            self.reference.input(
                ui,
                self.session.as_ref().expect("session").document(),
                map.rect,
                map.view,
                self.map_shift,
                reference_enabled,
            );
            self.apply_reference_edit();
            let parking_input = !minimap_input
                && self.buildings.parking_input(
                    ctx,
                    &map,
                    self.session.as_ref().expect("session").document(),
                );
            let building_edit = if minimap_input || self.metrics.picking {
                None
            } else if map.bulk_started {
                self.buildings.cancel();
                self.buildings.select(None);
                None
            } else if !reference_input
                && !parking_input
                && self.scenarios.mode.is_none()
                && !self.connection_draft.active()
                && !self.map.as_ref().expect("map").drawing()
            {
                self.buildings.input(
                    ui,
                    self.session.as_ref().expect("session").document(),
                    map.rect,
                    map.view,
                    self.map_shift,
                )
            } else {
                None
            };
            if self.buildings.selected().is_some() || self.buildings.active() {
                self.map.as_mut().expect("map").select(None);
            }
            if self.buildings.dragging() {
                self.edit_pause.begin(&mut self.playing);
            }
            if let Some(edit) = building_edit {
                self.edit_buildings(edit);
            }
            {
                let session = self.session.as_ref().expect("session");
                self.buildings
                    .sync_parking_form(session.document(), session.revision());
            }
            if let Some(edit) = self.buildings.forms(
                ctx,
                self.session.as_ref().expect("session").document(),
                &mut self.shell,
            ) {
                self.edit_buildings(edit);
            }
            if map.structural_edit {
                self.edit_pause.begin(&mut self.playing);
            }
            if map.bulk_started {
                self.connection_draft.cancel();
                self.inspector = Default::default();
                self.bulk_editor = Default::default();
                self.street_dialog.close();
                if self
                    .session
                    .as_ref()
                    .expect("session")
                    .document()
                    .editing_street()
                    .is_some()
                {
                    self.edit_streets(ca_core::streets::StreetEdit::CancelSession);
                    self.map.as_mut().expect("map").select(None);
                }
            }
            if let Some(cell) = map.picked_cell.filter(|_| !parking_input) {
                if self.metrics.picking {
                    let mut included = self.metrics.included().to_vec();
                    included[cell.street] = !included[cell.street];
                    self.select_metric_streets(included);
                } else {
                    self.connection_draft
                        .pick_cell(cell, self.session.as_ref().expect("session").document());
                }
            }
            if let Some(edit) = map.street_edit.clone() {
                self.edit_streets(edit);
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
                    self.metrics.configure(document, None);
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
            self.street_forms(ctx);
            self.connection_form(ctx, map.rect);
            let request = Paint {
                vehicle_style: if self.vehicle_heat {
                    ca_gpu::VehicleStyle::Heat
                } else {
                    ca_gpu::VehicleStyle::Classes
                },
                playing: self.playing,
                rate: self.rate,
                step_ticket: self.step_ticket,
                view: map.view,
                generation_override: self.transport.generation_override(),
                excluded_street: map.geometry_preview.as_ref().map(|preview| preview.street),
            };
            if let Some(zones) = self
                .buildings
                .render_update(self.session.as_ref().expect("session").document())
            {
                self.commands.buildings(zones);
            }
            let accepted = if let Some(mode) = self.scenarios.mode {
                self.commands.send(request, None)
                    && map.paint_start.is_none_or(|cell| {
                        use ca_core::disruptions::ScenarioAction;
                        self.commands
                            .edit(Edit::Scenario(ScenarioAction::Click(cell, mode)))
                    })
                    && map
                        .clicked
                        .filter(|cell| Some(*cell) != map.paint_start)
                        .is_none_or(|cell| {
                            use ca_core::disruptions::ScenarioAction;
                            self.commands
                                .edit(Edit::Scenario(ScenarioAction::Paint(cell, mode)))
                        })
            } else {
                self.commands.send(request, map.clicked)
            };
            if !accepted {
                self.shell.notify(
                    ca_app::shell::Severity::Warning,
                    self.shell.tr("shell.cellEditBusy", &[]),
                );
            }
            let mut callback = self.callback.clone();
            callback.rect = map.rect;
            let [r, g, b] = self
                .session
                .as_ref()
                .expect("session")
                .document()
                .map_background()
                .rgb(self.progress.clock);
            ui.painter()
                .rect_filled(map.rect, 0.0, egui::Color32::from_rgb(r, g, b));
            let mut background_callback = self.background_callback.clone();
            background_callback.rect = map.rect;
            ui.painter().add(background_callback);
            self.background.paint(ui.painter(), map.view, map.rect);
            self.reference.paint(
                ui.painter(),
                self.session.as_ref().expect("session").document(),
                map.rect,
                map.view,
                self.map_shift,
            );
            // Keep callback allocations at map/structure changes, not in each paint.
            let count = self
                .session
                .as_ref()
                .expect("session")
                .document()
                .buildings()
                .len()
                + 1;
            for index in self.building_callbacks.len()..count {
                self.building_callbacks
                    .push(egui_wgpu::Callback::new_paint_callback(
                        map.rect,
                        crate::render::BackgroundCallback::Building(index),
                    ));
            }
            self.buildings.paint(
                ui,
                self.session.as_ref().expect("session").document(),
                map.rect,
                map.view,
                self.map_shift,
                |index| {
                    let mut callback = self.building_callbacks[index].clone();
                    callback.rect = map.rect;
                    ui.painter().add(callback);
                },
            );
            ui.painter().add(callback);
            self.reference.paint_controls(
                ui.painter(),
                &self.shell,
                self.session.as_ref().expect("session").document(),
                map.rect,
                map.view,
                self.map_shift,
            );
            self.metrics
                .paint(ui.painter(), map.view, map.rect, self.map_shift);
            self.scenarios.paint_rain(ui.painter(), map.rect);
            let session = self.session.as_ref().expect("session");
            self.labels
                .sync(session.document(), session.revision(), self.map_shift);
            self.labels.paint(ui.painter(), map.view, map.rect);
            self.buildings
                .sync_parking(session.document(), session.revision(), self.map_shift);
            self.buildings.paint_controls(
                ui.painter(),
                self.session.as_ref().expect("session").document(),
                map.rect,
                map.view,
                self.map_shift,
            );
            if let Some(connections) = &self.connections {
                connections.paint(ui.painter(), map.view, map.rect);
            }
            map.paint_preview(ui.painter());
            self.buildings.paint_parking_pick(
                ui.painter(),
                &map,
                self.session.as_ref().expect("session").document(),
                &self.shell,
            );
            self.map.as_ref().expect("map").paint_connection_draft(
                ui.painter(),
                map.rect,
                &self.connection_draft,
                self.session.as_ref().expect("session").document(),
            );
            self.map
                .as_ref()
                .expect("map")
                .paint_selection(ui.painter(), map.rect);
            self.map
                .as_ref()
                .expect("map")
                .paint_vertices(ui.painter(), map.rect);
            if let Some(error) = map.geometry_error {
                ui.painter().text(
                    map.rect.left_top() + egui::vec2(12.0, 12.0),
                    egui::Align2::LEFT_TOP,
                    ca_app::inspector::geometry_error_message(&self.shell, error),
                    egui::FontId::proportional(14.0),
                    egui::Color32::RED,
                );
            }
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
        let session = self.session.as_ref().expect("session");
        if self.parking_pending.is_none()
            && let Some((building, config)) = self
                .buildings
                .take_parking_request(session.document(), session.revision())
        {
            if self
                .commands
                .edit(Edit::Parking(building, config.clone().map(Box::new)))
            {
                self.parking_pending = Some((building, config));
                self.edit_pause.begin(&mut self.playing);
            } else {
                self.shell.notify(
                    ca_app::shell::Severity::Warning,
                    self.shell.tr("shell.cellEditBusy", &[]),
                );
            }
        }
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
