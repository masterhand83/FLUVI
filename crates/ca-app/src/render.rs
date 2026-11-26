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
    pub clock: ca_core::virtual_time::Clock,
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
    Parking(usize, Option<Box<ca_core::parking::ParkingConfig>>),
    Building(ca_core::buildings::BuildingEdit),
    ScenarioTime(ca_core::virtual_time::Clock),
    Profiles(Box<ca_core::virtual_time::VirtualTime>),
    Connection(ca_core::connections::Connection),
    ReplaceConnection(usize, ca_core::connections::Connection),
    DeleteConnection(usize),
    Toggle(CellRef),
    Vehicles(VehicleAction),
    Vertex(ca_app::vertices::VertexEdit),
    Street(ca_core::streets::StreetEdit),
}

pub struct PaintCallback;
pub enum BackgroundCallback {
    Zones,
    Building(usize),
    #[cfg(test)]
    All,
}

impl CallbackTrait for BackgroundCallback {
    fn paint(
        &self,
        _info: egui::PaintCallbackInfo,
        pass: &mut wgpu::RenderPass<'static>,
        resources: &CallbackResources,
    ) {
        let display = &resources
            .get::<Resources>()
            .expect("traffic resources installed")
            .display;
        match self {
            Self::Zones => display.paint_zones(pass),
            Self::Building(index) => display.paint_building(pass, *index),
            #[cfg(test)]
            Self::All => display.paint_background(pass),
        }
    }
}

/// Only view/control state is coalesced. Cell edits retain FIFO order.
pub struct Commands {
    parking_results: Receiver<(usize, Result<(), ca_core::parking::ParkingError>)>,
    parking: Receiver<(usize, usize)>,
    buildings: Sender<Vec<ca_core::map_json::BackgroundZone>>,
    stale_buildings: Receiver<Vec<ca_core::map_json::BackgroundZone>>,
    state: Sender<Paint>,
    stale_state: Receiver<Paint>,
    edits: Sender<Edit>,
    replacement: Sender<TrafficScene>,
}

pub struct Requests {
    parking_results: Sender<(usize, Result<(), ca_core::parking::ParkingError>)>,
    parking: Sender<(usize, usize)>,
    buildings: Receiver<Vec<ca_core::map_json::BackgroundZone>>,
    state: Receiver<Paint>,
    edits: Receiver<Edit>,
    replacement: Receiver<TrafficScene>,
}

pub fn command_channel() -> (Commands, Requests) {
    let (parking_results_tx, parking_results) = bounded(32);
    let (parking_tx, parking) = bounded(1024);
    let (building_tx, buildings) = bounded(1);
    let (state_tx, state) = bounded(1);
    let (edits_tx, edits) = bounded(32);
    let (replacement_tx, replacement) = bounded(1);
    (
        Commands {
            parking_results,
            parking,
            buildings: building_tx,
            stale_buildings: buildings.clone(),
            state: state_tx,
            stale_state: state.clone(),
            edits: edits_tx,
            replacement: replacement_tx,
        },
        Requests {
            parking_results: parking_results_tx,
            parking: parking_tx,
            buildings,
            state,
            edits,
            replacement,
        },
    )
}

impl Commands {
    pub fn parking_results(
        &self,
    ) -> impl Iterator<Item = (usize, Result<(), ca_core::parking::ParkingError>)> + '_ {
        self.parking_results.try_iter()
    }
    pub fn parking_updates(&self) -> impl Iterator<Item = (usize, usize)> + '_ {
        self.parking.try_iter()
    }
    pub fn buildings(&self, zones: Vec<ca_core::map_json::BackgroundZone>) {
        if let Err(TrySendError::Full(zones)) = self.buildings.try_send(zones) {
            let _ = self.stale_buildings.try_recv();
            let _ = self.buildings.try_send(zones);
        }
    }
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
            while self.requests.buildings.try_recv().is_ok() {}
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
        let mut buildings_edited = false;
        let mut reset_time = false;
        while let Ok(edit) = self.requests.edits.try_recv() {
            edited |= match edit {
                Edit::Parking(building, config) => {
                    let result = self.scene.configure_parking(building, config.map(|c| *c));
                    // At most one UI parking request can be in flight.
                    let _ = self.requests.parking_results.try_send((building, result));
                    false
                }
                Edit::Building(edit) => {
                    self.scene.edit_buildings(edit);
                    buildings_edited = true;
                    false
                }
                Edit::Profiles(time) => {
                    self.scene.set_profiles(*time);
                    false
                }
                Edit::ScenarioTime(clock) => {
                    self.scene.reset_scenario_time(clock);
                    self.progress.generation = 0;
                    self.ticks.reset(request.step_ticket, request.playing);
                    reset_time = true;
                    true
                }
                Edit::ReplaceConnection(index, connection) => {
                    self.scene
                        .replace_connection(index, connection)
                        .expect("validated ordered replacement");
                    false
                }
                Edit::DeleteConnection(index) => {
                    assert!(
                        self.scene.delete_connection(index),
                        "validated ordered deletion"
                    );
                    false
                }
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
        if let Ok(zones) = self.requests.buildings.try_recv() {
            self.display
                .set_buildings(device, queue, &zones, self.scene.shift());
        } else if buildings_edited {
            self.display.set_buildings(
                device,
                queue,
                &self.scene.building_zones(),
                self.scene.shift(),
            );
        }
        let published = !request.playing && self.scene.publish_edits();
        self.display.set_view(queue, request.view);
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_tick);
        self.last_tick = now;
        let steps = if reset_time {
            0
        } else {
            self.ticks
                .advance(elapsed, request.rate, request.playing, request.step_ticket)
        };
        {
            puffin::profile_scope!("traffic full ticks");
            for _ in 0..steps {
                self.scene.tick();
                // Count only after all CPU phases finish.
                self.progress.generation += 1;
                self.ticks.completed(1);
            }
        }
        if steps > 0 || published || reset_time || (edited && !request.playing) {
            self.display.upload(queue, &self.scene);
            self.progress.population = self.scene.population();
        }
        self.progress.fps = self.ticks.fps();
        self.progress.clock = self.scene.time().clock;
        self.progress.frames += 1;
        self.window_frames += 1;
        let frame_elapsed = now.duration_since(self.frame_window).as_secs_f64();
        if frame_elapsed >= 1.0 {
            self.progress.render_fps = self.window_frames as f64 / frame_elapsed;
            self.window_frames = 0;
            self.frame_window = now;
        }
        let _ = self.events.try_send(Event::Progress(self.progress));
        // Bounded, non-blocking display telemetry; retry on the next frame.
        // Rotate the first item so even large maps cannot starve later buildings.
        let count = self.scene.parking_occupancies().count();
        if count > 0 {
            let first = self.progress.frames as usize % count;
            for update in self
                .scene
                .parking_occupancies()
                .skip(first)
                .chain(self.scene.parking_occupancies().take(first))
            {
                if self.requests.parking.try_send(update).is_err() {
                    break;
                }
            }
        }
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
    fn parking_counter_uses_render_owned_occupancy_and_scenario_reset() {
        use ca_core::{
            buildings::Building,
            map_json::MapDocument,
            parking::{ParkingConfig, ParkingPair},
            virtual_time::Clock,
        };
        let mut document = MapDocument::demo();
        document.model_mut().clear_vehicles();
        let building = document
            .add_building(Building::rectangle([0.; 2], [10.; 2]))
            .unwrap();
        let entrance = CellRef {
            street: 0,
            lane: 0,
            index: 1,
        };
        let mut parking = ParkingConfig::new(
            2,
            vec![ParkingPair {
                entrance,
                exit: CellRef {
                    index: 5,
                    ..entrance
                },
            }],
        );
        parking.entry_probabilities = [1.; 24];
        parking.exit_probabilities = [0.; 24];
        document.configure_parking(building, Some(parking)).unwrap();
        document.model_mut().toggle_vehicle(entrance);
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
        let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
        let (device, queue) =
            pollster::block_on(adapter.request_device(&Default::default())).unwrap();
        let scene = TrafficScene::from_document(&document);
        let format = wgpu::TextureFormat::Rgba8Unorm;
        let display = TrafficDisplay::new(&device, &scene, format);
        let (commands, requests) = command_channel();
        let (events, _) = bounded(2);
        let mut resources = Resources::new(scene, display, events, requests, format);
        assert!(commands.send(
            Paint {
                playing: false,
                rate: 10.,
                step_ticket: 1,
                generation_override: Some(0.),
                excluded_street: None,
                view: WorldView {
                    origin: [0.; 2],
                    span: [20.; 2]
                },
            },
            None
        ));
        resources.prepare(&device, &queue);
        assert_eq!(
            commands.parking_updates().collect::<Vec<_>>(),
            vec![(building, 1)]
        );
        assert!(commands.edit(Edit::Toggle(entrance)));
        assert!(commands.send(
            Paint {
                playing: false,
                rate: 10.,
                step_ticket: 2,
                generation_override: Some(0.),
                excluded_street: None,
                view: WorldView {
                    origin: [0.; 2],
                    span: [20.; 2]
                },
            },
            None
        ));
        resources.prepare(&device, &queue);
        assert_eq!(
            commands.parking_updates().collect::<Vec<_>>(),
            vec![(building, 2)]
        );
        let mut changed = document.model().parking(building).unwrap().config.clone();
        changed.capacity = 6;
        assert!(commands.edit(Edit::Parking(building, Some(Box::new(changed)))));
        resources.prepare(&device, &queue);
        assert_eq!(
            commands.parking_results().collect::<Vec<_>>(),
            vec![(building, Ok(()))]
        );
        assert_eq!(
            resources.scene.parking_occupancies().collect::<Vec<_>>(),
            vec![(building, 2)]
        );
        let mut too_small = document.model().parking(building).unwrap().config.clone();
        too_small.capacity = 1;
        assert!(commands.edit(Edit::Parking(building, Some(Box::new(too_small)))));
        resources.prepare(&device, &queue);
        assert_eq!(
            commands.parking_results().collect::<Vec<_>>(),
            vec![(
                building,
                Err(ca_core::parking::ParkingError(
                    "parking.validation.capacityBelowOccupancy"
                ))
            )]
        );
        commands.parking_updates().for_each(drop);
        assert!(commands.edit(Edit::ScenarioTime(Clock::default())));
        resources.prepare(&device, &queue);
        assert_eq!(
            commands.parking_updates().collect::<Vec<_>>(),
            vec![(building, 0)]
        );
        assert!(
            commands.edit(Edit::Building(ca_core::buildings::BuildingEdit::Delete(
                building
            )))
        );
        resources.prepare(&device, &queue);
        assert!(commands.parking_updates().next().is_none());
    }

    #[test]
    fn scenario_time_command_preserves_map_blockers_and_pause_without_a_tick() {
        use ca_core::{map_json::MapDocument, virtual_time::Clock};
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
        let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
        let (device, queue) =
            pollster::block_on(adapter.request_device(&Default::default())).unwrap();
        let document = MapDocument::demo();
        let scene = TrafficScene::from_document(&document);
        let geometry = scene.geometry();
        let format = wgpu::TextureFormat::Rgba8Unorm;
        let display = TrafficDisplay::new(&device, &scene, format);
        let (commands, requests) = command_channel();
        let (events, results) = bounded(2);
        let mut resources = Resources::new(scene, display, events, requests, format);
        let state = Paint {
            playing: false,
            rate: 10.0,
            step_ticket: 1,
            generation_override: Some(1.0),
            excluded_street: None,
            view: WorldView {
                origin: [0.0; 2],
                span: [20.0; 2],
            },
        };
        assert!(commands.send(state, None));
        resources.prepare(&device, &queue);
        let Event::Progress(first) = results.try_recv().unwrap();
        assert_eq!(first.generation, 1);
        assert_eq!(first.clock.parts(), [1, 7, 0, 2]);
        let clock = Clock::new(6, 23, 59, 58).unwrap();
        assert!(commands.edit(Edit::ScenarioTime(clock)));
        resources.prepare(&device, &queue);
        let Event::Progress(reset) = results.try_recv().unwrap();
        assert_eq!(reset.generation, 0);
        assert_eq!(reset.population, 0);
        assert_eq!(reset.clock, clock);
        assert_eq!(resources.scene.geometry(), geometry);
        for street in 0..3 {
            assert_eq!(
                resources.scene.cells()[street * 64 + 18],
                7,
                "blocker stays"
            );
        }
        resources.prepare(&device, &queue);
        let Event::Progress(still_paused) = results.try_recv().unwrap();
        assert_eq!(
            still_paused.generation, 0,
            "an old manual ticket must not replay"
        );
        assert_eq!(still_paused.clock, clock);
        assert!(commands.send(
            Paint {
                step_ticket: 2,
                ..state
            },
            None
        ));
        resources.prepare(&device, &queue);
        let Event::Progress(next) = results.try_recv().unwrap();
        assert_eq!(next.generation, 1);
        assert_eq!(next.clock.parts(), [0, 0, 0, 0]);
    }

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
        // Replacement/deletion use the same ordered queue, without resetting traffic.
        let replacement = ca_core::connections::Connection::Lineal(ca_core::connections::Mapping {
            source_street: 0,
            source_lane: 0,
            source_cell: 3,
            destination_street: 1,
            destination_lane: 0,
            destination_cell: 2,
        });
        assert!(commands.edit(Edit::ReplaceConnection(0, replacement)));
        resources.prepare(&device, &queue);
        let Event::Progress(replaced) = results.try_recv().unwrap();
        assert_eq!(replaced.generation, 1);
        assert_eq!(resources.scene.cells(), &[0, 0, 0, 0, 0, 1, 0, 0]);
        assert!(commands.edit(Edit::DeleteConnection(0)));
        resources.prepare(&device, &queue);
        let Event::Progress(deleted) = results.try_recv().unwrap();
        assert_eq!(deleted.generation, 1);
        assert_eq!(deleted.population, 1);
        assert_eq!(resources.scene.cells(), &[0, 0, 0, 0, 0, 1, 0, 0]);
        assert!(resources.scene.connection_arrows().is_empty());
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
                                BackgroundCallback::All,
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
    #[test]
    fn parking_queue_full_is_non_blocking_and_keeps_accepted_edits_in_order() {
        let (commands, requests) = command_channel();
        for building in 0..32 {
            assert!(commands.edit(Edit::Parking(building, None)));
        }
        assert!(!commands.edit(Edit::Parking(32, None)));
        for building in 0..32 {
            assert_eq!(
                requests.edits.try_recv().unwrap(),
                Edit::Parking(building, None)
            );
        }
    }
}
