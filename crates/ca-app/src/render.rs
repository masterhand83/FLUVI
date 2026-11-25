use std::time::Instant;

use ca_core::traffic::VehicleAction;
use ca_core::{camera::WorldView, cell_index::CellRef};
use ca_gpu::{TrafficDisplay, TrafficScene};
use crossbeam_channel::{Receiver, Sender, TrySendError, bounded};
use eframe::{egui, wgpu};
use egui_wgpu::{CallbackResources, CallbackTrait, ScreenDescriptor};

use crate::timing::TickControl;

#[derive(Clone, Copy, Default)]
pub struct Progress {
    pub frames: u64,
    pub generation: u64,
    pub population: u32,
    pub fps: f64,
    pub render_fps: f64,
}

pub enum Event {
    Progress(Progress),
}

/// UI commands are values. The callback owns the CPU model and GPU resources.
#[derive(Clone, Copy)]
pub struct Paint {
    pub playing: bool,
    pub rate: f64,
    pub step_ticket: u64,
    pub view: WorldView,
    pub generation_override: Option<f64>,
    pub excluded_street: Option<usize>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Edit {
    Connection(ca_core::connections::Connection),
    Toggle(CellRef),
    Vehicles(VehicleAction),
    Vertex(ca_app::vertices::VertexEdit),
    Street(ca_core::streets::StreetEdit),
}

pub struct PaintCallback;
pub struct BackgroundCallback;

impl CallbackTrait for BackgroundCallback {
    fn paint(
        &self,
        _info: egui::PaintCallbackInfo,
        pass: &mut wgpu::RenderPass<'static>,
        resources: &CallbackResources,
    ) {
        resources
            .get::<Resources>()
            .expect("traffic resources installed")
            .display
            .paint_background(pass);
    }
}

/// Only view/control state is coalesced. Cell edits retain FIFO order.
pub struct Commands {
    state: Sender<Paint>,
    stale_state: Receiver<Paint>,
    edits: Sender<Edit>,
    replacement: Sender<TrafficScene>,
}

pub struct Requests {
    state: Receiver<Paint>,
    edits: Receiver<Edit>,
    replacement: Receiver<TrafficScene>,
}

pub fn command_channel() -> (Commands, Requests) {
    let (state_tx, state) = bounded(1);
    let (edits_tx, edits) = bounded(32);
    let (replacement_tx, replacement) = bounded(1);
    (
        Commands {
            state: state_tx,
            stale_state: state.clone(),
            edits: edits_tx,
            replacement: replacement_tx,
        },
        Requests {
            state,
            edits,
            replacement,
        },
    )
}

impl Commands {
    pub fn replace(&self, scene: TrafficScene) -> bool {
        self.replacement.try_send(scene).is_ok()
    }
    /// Returns false if the edit queue is full/closed. The caller must report it.
    pub fn send(&self, state: Paint, edit: Option<CellRef>) -> bool {
        if let Err(TrySendError::Full(state)) = self.state.try_send(state) {
            // Single state producer; the consumer can only empty this slot.
            let _ = self.stale_state.try_recv();
            let _ = self.state.try_send(state);
        }
        edit.is_none_or(|cell| self.edit(Edit::Toggle(cell)))
    }

    pub fn edit(&self, edit: Edit) -> bool {
        self.edits.try_send(edit).is_ok()
    }
}

pub struct Resources {
    scene: TrafficScene,
    display: TrafficDisplay,
    events: Sender<Event>,
    requests: Requests,
    request: Paint,
    ticks: TickControl,
    last_tick: Instant,
    progress: Progress,
    format: wgpu::TextureFormat,
    frame_window: Instant,
    window_frames: u64,
}

impl Resources {
    pub fn new(
        scene: TrafficScene,
        display: TrafficDisplay,
        events: Sender<Event>,
        requests: Requests,
        format: wgpu::TextureFormat,
    ) -> Self {
        let population = scene.population();
        let span = scene.extent().map(|v| v as f32);
        Self {
            scene,
            format,
            frame_window: Instant::now(),
            window_frames: 0,
            display,
            events,
            requests,
            request: Paint {
                playing: true,
                rate: 10.0,
                step_ticket: 0,
                generation_override: None,
                excluded_street: None,
                view: WorldView {
                    origin: [0.0; 2],
                    span,
                },
            },
            ticks: TickControl::default(),
            last_tick: Instant::now(),
            progress: Progress {
                population,
                ..Default::default()
            },
        }
    }

    fn prepare(&mut self, device: &wgpu::Device, queue: &wgpu::Queue) {
        if let Ok(request) = self.requests.state.try_recv() {
            self.request = request;
        }
        let request = self.request;
        if let Ok(scene) = self.requests.replacement.try_recv() {
            // All old edits are obsolete. UI and render reset in this same frame.
            while self.requests.edits.try_recv().is_ok() {}
            self.display = TrafficDisplay::new(device, &scene, self.format);
            self.scene = scene;
            self.ticks = TickControl::default();
            self.last_tick = Instant::now();
            self.progress = Progress {
                frames: self.progress.frames,
                population: self.scene.population(),
                ..Default::default()
            };
        }
        self.scene
            .set_generation_override(request.generation_override)
            .expect("UI probability is in 0..=1");
        let mut edited = false;
        while let Ok(edit) = self.requests.edits.try_recv() {
            edited |= match edit {
                Edit::Connection(connection) => {
                    self.scene
                        .add_connection(connection)
                        .expect("validated ordered connection edit");
                    false
                }
                Edit::Toggle(cell) => self.scene.toggle_vehicle(cell, !request.playing),
                Edit::Vehicles(action) => {
                    self.scene
                        .edit_vehicles(action, !request.playing)
                        .expect("UI probability is in 0..=1");
                    true
                }
                Edit::Vertex(edit) => {
                    if self
                        .scene
                        .set_vertex_offset(edit.street, edit.vertex, edit.offset)
                    {
                        self.display.upload_street(queue, &self.scene, edit.street);
                    }
                    false
                }
                Edit::Street(edit) => {
                    if self.scene.edit_streets(edit) {
                        self.display = TrafficDisplay::new(device, &self.scene, self.format);
                    }
                    true
                }
            };
        }
        let published = !request.playing && self.scene.publish_edits();
        self.display.set_view(queue, request.view);
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_tick);
        self.last_tick = now;
        let steps = self
            .ticks
            .advance(elapsed, request.rate, request.playing, request.step_ticket);
        {
            puffin::profile_scope!("traffic full ticks");
            for _ in 0..steps {
                self.scene.tick();
                // Count only after all CPU phases finish.
                self.progress.generation += 1;
                self.ticks.completed(1);
            }
        }
        if steps > 0 || published || (edited && !request.playing) {
            self.display.upload(queue, &self.scene);
            self.progress.population = self.scene.population();
        }
        self.progress.fps = self.ticks.fps();
        self.progress.frames += 1;
        self.window_frames += 1;
        let frame_elapsed = now.duration_since(self.frame_window).as_secs_f64();
        if frame_elapsed >= 1.0 {
            self.progress.render_fps = self.window_frames as f64 / frame_elapsed;
            self.window_frames = 0;
            self.frame_window = now;
        }
        let _ = self.events.try_send(Event::Progress(self.progress));
    }
}

impl CallbackTrait for PaintCallback {
    fn prepare(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        _screen: &ScreenDescriptor,
        _encoder: &mut wgpu::CommandEncoder,
        resources: &mut CallbackResources,
    ) -> Vec<wgpu::CommandBuffer> {
        resources
            .get_mut::<Resources>()
            .expect("traffic resources were installed at startup")
            .prepare(device, queue);
        Vec::new()
    }

    fn paint(
        &self,
        _info: egui::PaintCallbackInfo,
        pass: &mut wgpu::RenderPass<'static>,
        resources: &CallbackResources,
    ) {
        let resources = resources
            .get::<Resources>()
            .expect("traffic resources were installed at startup");
        resources
            .display
            .paint_excluding(pass, resources.request.excluded_street);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacing_a_session_discards_old_edits_and_resets_the_render_owned_simulation() {
        use ca_core::map_json::MapDocument;
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
        let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
        let (device, queue) =
            pollster::block_on(adapter.request_device(&Default::default())).unwrap();
        let format = wgpu::TextureFormat::Rgba8Unorm;
        let scene = TrafficScene::demo();
        let display = TrafficDisplay::new(&device, &scene, format);
        let (commands, requests) = command_channel();
        let (events, results) = bounded(2);
        let mut resources = CallbackResources::default();
        resources.insert(Resources::new(scene, display, events, requests, format));
        let state = Paint {
            playing: false,
            rate: 10.0,
            step_ticket: 0,
            generation_override: None,
            excluded_street: None,
            view: WorldView {
                origin: [0.0; 2],
                span: [36.0, 14.0],
            },
        };
        let screen = ScreenDescriptor {
            size_in_pixels: [360, 140],
            pixels_per_point: 1.0,
        };
        let mut prepare = |commands: &Commands, state| {
            assert!(commands.send(state, None));
            let mut encoder = device.create_command_encoder(&Default::default());
            PaintCallback.prepare(&device, &queue, &screen, &mut encoder, &mut resources);
            match results.try_recv().unwrap() {
                Event::Progress(progress) => progress,
            }
        };
        assert_eq!(prepare(&commands, state).population, 18);
        assert!(commands.edit(Edit::Vehicles(VehicleAction::Fill(1.0))));
        assert!(commands.replace(TrafficScene::from_document(&MapDocument::empty())));
        let empty = prepare(&commands, state);
        assert_eq!(empty.population, 0);
        assert_eq!(empty.generation, 0);
        let document =
            MapDocument::parse(include_str!("../../ca-core/tests/fixtures/map-v1.json")).unwrap();
        assert!(commands.replace(TrafficScene::from_document(&document)));
        let loaded = prepare(&commands, state);
        assert_eq!(
            loaded.population, 0,
            "old fill must not enter the loaded map"
        );
        assert_eq!(loaded.generation, 0);
        assert_eq!(
            prepare(
                &commands,
                Paint {
                    step_ticket: 1,
                    ..state
                }
            )
            .generation,
            1
        );
    }

    #[test]
    fn view_updates_coalesce_but_clicks_remain_ordered_and_queue_full_is_reported() {
        let (commands, requests) = command_channel();
        let state = Paint {
            playing: false,
            rate: 10.0,
            step_ticket: 0,
            generation_override: None,
            excluded_street: None,
            view: WorldView {
                origin: [0.0; 2],
                span: [36.0, 14.0],
            },
        };
        for index in 0..32 {
            assert!(commands.send(
                Paint {
                    step_ticket: index as u64,
                    ..state
                },
                Some(CellRef {
                    street: 0,
                    lane: 1,
                    index
                })
            ));
        }
        assert_eq!(requests.state.try_recv().unwrap().step_ticket, 31);
        assert!(!commands.send(
            state,
            Some(CellRef {
                street: 0,
                lane: 1,
                index: 99
            })
        ));
        for index in 0..32 {
            assert_eq!(
                requests.edits.try_recv().unwrap(),
                Edit::Toggle(CellRef {
                    street: 0,
                    lane: 1,
                    index
                })
            );
        }
        assert!(requests.edits.try_recv().is_err());
    }

    #[test]
    fn saved_connection_uses_ordered_edits_and_transfers_on_the_next_tick() {
        use ca_app::connection_draft::ConnectionDraft;
        use ca_core::map_json::MapDocument;
        let document = MapDocument::parse(
            r#"{"calles":[
            {"nombre":"A","tipo":"conexion","tamano":4,"x":25,"y":25},
            {"nombre":"B","tipo":"conexion","tamano":4,"x":75,"y":75}
        ]}"#,
        )
        .unwrap();
        let mut draft = ConnectionDraft::default();
        draft.start();
        draft.pick(0, &document);
        draft.pick(1, &document);
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
        let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
        let (device, queue) =
            pollster::block_on(adapter.request_device(&Default::default())).unwrap();
        let scene = TrafficScene::from_document(&document);
        let format = wgpu::TextureFormat::Rgba8Unorm;
        let display = TrafficDisplay::new(&device, &scene, format);
        let (commands, requests) = command_channel();
        let (events, results) = bounded(2);
        let mut resources = Resources::new(scene, display, events, requests, format);
        let state = Paint {
            playing: false,
            rate: 10.0,
            step_ticket: 0,
            generation_override: None,
            excluded_street: None,
            view: WorldView {
                origin: [0.0; 2],
                span: [25.0; 2],
            },
        };
        assert!(commands.send(state, None));
        assert!(commands.edit(Edit::Toggle(CellRef {
            street: 0,
            lane: 0,
            index: 3
        })));
        assert!(commands.edit(Edit::Connection(draft.candidate(&document).unwrap())));
        resources.prepare(&device, &queue);
        let Event::Progress(paused) = results.try_recv().unwrap();
        assert_eq!(paused.generation, 0);
        assert_eq!(resources.scene.cells(), &[0, 0, 0, 1, 0, 0, 0, 0]);
        assert_eq!(resources.scene.connection_arrows().len(), 1);
        assert!(commands.send(
            Paint {
                step_ticket: 1,
                ..state
            },
            None
        ));
        resources.prepare(&device, &queue);
        let Event::Progress(ticked) = results.try_recv().unwrap();
        assert_eq!(ticked.generation, 1);
        assert_eq!(ticked.population, 1);
        assert_eq!(resources.scene.cells(), &[0, 0, 0, 0, 0, 1, 0, 0]);
    }

    #[test]
    fn independent_probabilities_keep_their_chances_and_transfer_to_at_most_one_target() {
        use ca_app::connection_draft::{ConnectionDraft, DraftKind};
        use ca_core::map_json::MapDocument;
        let document = MapDocument::parse(
            r#"{"calles":[
            {"nombre":"A","tipo":"conexion","tamano":4,"x":25,"y":25},
            {"nombre":"B","tipo":"conexion","tamano":4,"x":75,"y":75}
        ]}"#,
        )
        .unwrap();
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
        let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
        let (device, queue) =
            pollster::block_on(adapter.request_device(&Default::default())).unwrap();
        // Seed 42 starts with a roll of about 0.741565. A 25% trial fails;
        // an 80% first trial succeeds, even when a later row also has 80%.
        let cases: &[(&[&str], bool, [u32; 8])] = &[
            (&["25"], false, [0, 0, 1, 0, 0, 0, 0, 0]),
            (&["80", "80"], false, [0, 0, 0, 0, 0, 1, 0, 0]),
            (&["0", "0"], false, [0, 0, 1, 0, 0, 0, 0, 0]),
            (&["0", "100"], false, [0, 0, 0, 0, 0, 0, 0, 1]),
            (&["100", "100"], false, [0, 0, 0, 0, 0, 1, 0, 0]),
            (&["100", "100"], true, [0, 1, 0, 0, 0, 1, 0, 0]),
        ];
        for &(percentages, occupied, expected) in cases {
            let mut draft = ConnectionDraft::default();
            draft.start();
            draft.pick(0, &document);
            draft.pick(1, &document);
            draft.set_kind(DraftKind::Probabilistica, &document);
            draft.rows_mut()[0].mapping.source_cell = 1;
            draft.rows_mut()[0].probability = percentages[0].into();
            if percentages.len() == 2 {
                draft.add_destination(&document);
                draft.rows_mut()[1].mapping.destination_cell = 2;
                draft.rows_mut()[1].probability = percentages[1].into();
            }
            let scene = TrafficScene::from_document(&document);
            let format = wgpu::TextureFormat::Rgba8Unorm;
            let display = TrafficDisplay::new(&device, &scene, format);
            let (commands, requests) = command_channel();
            let (events, results) = bounded(2);
            let mut resources = Resources::new(scene, display, events, requests, format);
            assert!(commands.edit(Edit::Toggle(CellRef {
                street: 0,
                lane: 0,
                index: 1
            })));
            if occupied {
                assert!(commands.edit(Edit::Toggle(CellRef {
                    street: 1,
                    lane: 0,
                    index: 0
                })));
            }
            assert!(commands.edit(Edit::Connection(draft.candidate(&document).unwrap())));
            assert!(commands.send(
                Paint {
                    playing: false,
                    rate: 10.0,
                    step_ticket: 1,
                    generation_override: None,
                    excluded_street: None,
                    view: WorldView {
                        origin: [0.0; 2],
                        span: [25.0; 2]
                    },
                },
                None
            ));
            resources.prepare(&device, &queue);
            let Event::Progress(progress) = results.try_recv().unwrap();
            assert_eq!(progress.generation, 1);
            assert_eq!(progress.population, if occupied { 2 } else { 1 });
            assert_eq!(
                resources.scene.cells(),
                expected,
                "{percentages:?}, occupied={occupied}"
            );
        }
    }

    #[test]
    fn transport_actions_share_fifo_order_with_cell_edits() {
        use ca_core::traffic::VehicleAction;
        let (commands, requests) = command_channel();
        let actions = [
            Edit::Vehicles(VehicleAction::Fill(0.5)),
            Edit::Vehicles(VehicleAction::Clear),
            Edit::Toggle(CellRef {
                street: 0,
                lane: 0,
                index: 2,
            }),
        ];
        for action in actions.clone() {
            assert!(commands.edit(action));
        }
        for action in actions {
            assert_eq!(requests.edits.try_recv().unwrap(), action);
        }
        assert!(requests.edits.try_recv().is_err());
    }

    #[test]
    fn topology_edits_preserve_tick_count_and_apply_cell_edits_in_physical_order() {
        use ca_core::{
            map_json::MapDocument,
            streets::{StreetDraft, StreetEdit},
        };
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
        let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
        let (device, queue) =
            pollster::block_on(adapter.request_device(&Default::default())).unwrap();
        let format = wgpu::TextureFormat::Rgba8Unorm;
        let scene = TrafficScene::from_document(&MapDocument::empty());
        let display = TrafficDisplay::new(&device, &scene, format);
        let (commands, requests) = command_channel();
        let (events, results) = bounded(2);
        let mut resources = Resources::new(scene, display, events, requests, format);
        let state = Paint {
            playing: false,
            rate: 10.0,
            step_ticket: 1,
            generation_override: None,
            excluded_street: None,
            view: WorldView {
                origin: [0.0; 2],
                span: [36.0, 14.0],
            },
        };
        assert!(commands.send(state, None));
        resources.prepare(&device, &queue);
        let Event::Progress(first) = results.try_recv().unwrap();
        assert_eq!(first.generation, 1);
        let draft = StreetDraft::between([0.0, 0.0], [5.0, 0.0]).unwrap();
        assert!(commands.edit(Edit::Street(StreetEdit::Draw(draft))));
        assert!(commands.edit(Edit::Street(StreetEdit::Draw(draft))));
        assert!(commands.edit(Edit::Toggle(CellRef {
            street: 1,
            lane: 0,
            index: 1
        })));
        assert!(commands.edit(Edit::Street(StreetEdit::Delete(0))));
        resources.prepare(&device, &queue);
        let Event::Progress(edited) = results.try_recv().unwrap();
        assert_eq!(
            edited.generation, 1,
            "topology must not restart simulation time"
        );
        assert_eq!(edited.population, 1);
        assert_eq!(resources.scene.cells(), [0, 1, 0, 0, 0]);
        assert!(commands.send(
            Paint {
                step_ticket: 2,
                ..state
            },
            None
        ));
        resources.prepare(&device, &queue);
        let Event::Progress(resumed) = results.try_recv().unwrap();
        assert_eq!(resumed.generation, 2);
        assert_eq!(resumed.population, 1);
        assert_eq!(resources.scene.cells(), [0, 0, 1, 0, 0]);
    }

    #[test]
    fn zones_stay_below_traffic_and_paused_creation_preview_in_real_egui_gpu_callback() {
        use ca_app::map::MapInteraction;
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
        let adapter = match pollster::block_on(instance.request_adapter(&Default::default())) {
            Ok(adapter) => adapter,
            Err(error) => {
                eprintln!("SKIP placement GPU test: no adapter: {error}");
                return;
            }
        };
        let (device, queue) =
            pollster::block_on(adapter.request_device(&Default::default())).unwrap();
        for pixels_per_point in [1.0, 1.5, 2.0] {
            let zones = ca_core::map_json::MapDocument::parse(r##"{"calles":[],"backgroundAreas":[
                {"x":10,"y":10,"width":160,"height":50,"color":"#00ff00","alpha":1,"label":"Zone","showLabel":false},
                {"vertices":[{"x":50,"y":40},{"x":80,"y":40},{"x":80,"y":45},{"x":55,"y":45},{"x":55,"y":60},{"x":50,"y":60}],
                 "color":"#0000ff","alpha":1,"showLabel":false}
            ]}"##).unwrap();
            let mut data: serde_json::Value =
                serde_json::from_str(&ca_core::map_json::MapDocument::demo().to_json()).unwrap();
            data["backgroundAreas"] = serde_json::from_str::<serde_json::Value>(&zones.to_json())
                .unwrap()["backgroundAreas"]
                .clone();
            let document = ca_core::map_json::MapDocument::parse(&data.to_string()).unwrap();
            let scene = TrafficScene::from_document(&document);
            let background = ca_app::background::Background::new(zones.zones(), [0.0; 2]);
            let mut map = MapInteraction::new(
                scene.extent().map(|v| v as f32),
                &scene.geometry(),
                scene.street_names(),
            );
            let display = TrafficDisplay::new(&device, &scene, wgpu::TextureFormat::Rgba8Unorm);
            let (commands, requests) = command_channel();
            let (events, _) = bounded(2);
            let mut renderer = egui_wgpu::Renderer::new(
                &device,
                wgpu::TextureFormat::Rgba8Unorm,
                egui_wgpu::RendererOptions::PREDICTABLE,
            );
            renderer.callback_resources.insert(Resources::new(
                scene,
                display,
                events,
                requests,
                wgpu::TextureFormat::Rgba8Unorm,
            ));
            let ctx = egui::Context::default();
            let pos = egui::pos2(490.0, 320.0);
            let button = |pressed| egui::Event::PointerButton {
                pos,
                button: egui::PointerButton::Primary,
                pressed,
                modifiers: egui::Modifiers::NONE,
            };
            let mut output = None;
            for events in [
                vec![],
                vec![egui::Event::PointerMoved(pos), button(true)],
                vec![button(false)],
            ] {
                let mut input = egui::RawInput {
                    screen_rect: Some(egui::Rect::from_min_size(
                        egui::Pos2::ZERO,
                        egui::vec2(1000.0, 600.0),
                    )),
                    events,
                    ..Default::default()
                };
                input
                    .viewports
                    .get_mut(&egui::ViewportId::ROOT)
                    .unwrap()
                    .native_pixels_per_point = Some(pixels_per_point);
                let frame = ctx.run(input, |ctx| {
                    egui::TopBottomPanel::top("toolbar")
                        .exact_height(60.0)
                        .frame(egui::Frame::NONE)
                        .show(ctx, |_| {});
                    egui::SidePanel::left("sidebar")
                        .exact_width(280.0)
                        .frame(egui::Frame::NONE)
                        .show(ctx, |_| {});
                    egui::CentralPanel::default()
                        .frame(egui::Frame::NONE)
                        .show(ctx, |ui| {
                            let frame = map.show(ui, false);
                            assert!(commands.send(
                                Paint {
                                    playing: false,
                                    rate: 10.0,
                                    step_ticket: 0,
                                    view: frame.view,
                                    generation_override: None,
                                    excluded_street: None,
                                },
                                frame.clicked
                            ));
                            ui.painter()
                                .rect_filled(frame.rect, 0.0, egui::Color32::BLACK);
                            ui.painter().add(egui_wgpu::Callback::new_paint_callback(
                                frame.rect,
                                BackgroundCallback,
                            ));
                            background.paint(ui.painter(), frame.view, frame.rect);
                            ui.painter().add(egui_wgpu::Callback::new_paint_callback(
                                frame.rect,
                                PaintCallback,
                            ));
                            frame.paint_preview(ui.painter());
                        });
                });
                for (id, delta) in &frame.textures_delta.set {
                    renderer.update_texture(&device, &queue, *id, delta);
                }
                output = Some(frame);
            }
            let output = output.unwrap();
            let jobs = ctx.tessellate(output.shapes, output.pixels_per_point);
            let screen = ScreenDescriptor {
                size_in_pixels: [
                    (1000.0 * pixels_per_point) as u32,
                    (600.0 * pixels_per_point) as u32,
                ],
                pixels_per_point,
            };
            let mut encoder = device.create_command_encoder(&Default::default());
            let callbacks = renderer.update_buffers(&device, &queue, &mut encoder, &jobs, &screen);
            let size = wgpu::Extent3d {
                width: screen.size_in_pixels[0],
                height: screen.size_in_pixels[1],
                depth_or_array_layers: 1,
            };
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("placement integration test"),
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let view = texture.create_view(&Default::default());
            {
                let pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    ..Default::default()
                });
                renderer.render(&mut pass.forget_lifetime(), &jobs, &screen);
            }
            let row_bytes = (size.width * 4).div_ceil(256) * 256;
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("placement pixel readback"),
                size: u64::from(row_bytes * size.height),
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            encoder.copy_texture_to_buffer(
                texture.as_image_copy(),
                wgpu::TexelCopyBufferInfo {
                    buffer: &buffer,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(row_bytes),
                        rows_per_image: None,
                    },
                },
                size,
            );
            queue.submit(callbacks.into_iter().chain([encoder.finish()]));
            let (tx, rx) = std::sync::mpsc::channel();
            buffer.map_async(wgpu::MapMode::Read, .., move |result| {
                tx.send(result).unwrap()
            });
            device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
            rx.recv().unwrap().unwrap();
            let bytes = buffer.slice(..).get_mapped_range();
            let pixel = |x: f32, y: f32| {
                let index = (y * pixels_per_point) as usize * row_bytes as usize
                    + (x * pixels_per_point) as usize * 4;
                &bytes[index..index + 4]
            };
            // Known empty cell center, not a position computed from the picking code.
            let center = pixel(490.0, 320.0);
            assert_eq!(
                &pixel(490.0, 360.0)[..3],
                &[0, 0, 255],
                "polygon under the map"
            );
            assert_eq!(
                &pixel(540.0, 380.0)[..3],
                &[0, 255, 0],
                "concave notch exposes rectangular zone"
            );
            assert!(
                center[0] > 220 && center[1] < 100 && center[2] < 100,
                "cursor center must contain the created red vehicle at scale {pixels_per_point}: {center:?}"
            );
            // Measure the whole rendered vehicle, not only a pixel beneath the
            // cursor: an off-center rectangle could still cover that pixel.
            let mut bounds = [u32::MAX, u32::MAX, 0, 0];
            for y in (300.0 * pixels_per_point) as u32..(340.0 * pixels_per_point) as u32 {
                for x in (470.0 * pixels_per_point) as u32..(510.0 * pixels_per_point) as u32 {
                    let index = (y * row_bytes + x * 4) as usize;
                    let colour = &bytes[index..index + 3];
                    if colour[0] > 220 && colour[1] < 100 && colour[2] < 100 {
                        bounds[0] = bounds[0].min(x);
                        bounds[1] = bounds[1].min(y);
                        bounds[2] = bounds[2].max(x);
                        bounds[3] = bounds[3].max(y);
                    }
                }
            }
            assert_ne!(bounds[0], u32::MAX, "created vehicle must be rendered");
            for (axis, expected) in [(0, 490.0), (1, 320.0)] {
                // Include both boundary pixels' areas, not only their centers.
                let midpoint = (bounds[axis] + bounds[axis + 2] + 1) as f32 * 0.5;
                assert!(
                    (midpoint - expected * pixels_per_point).abs() <= 0.5,
                    "vehicle midpoint must match cursor within half a physical pixel at scale {pixels_per_point}: {bounds:?}"
                );
            }
            let outline = pixel(480.5, 320.0);
            assert!(
                outline[..3].iter().all(|&v| v > 180),
                "preview outline must be visible over GPU map at scale {pixels_per_point}: {outline:?}"
            );
        }
    }
}
