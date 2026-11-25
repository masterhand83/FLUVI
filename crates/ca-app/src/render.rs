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
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Edit {
    Toggle(CellRef),
    Vehicles(VehicleAction),
}

pub struct PaintCallback;

/// Only view/control state is coalesced. Cell edits retain FIFO order.
pub struct Commands {
    state: Sender<Paint>,
    stale_state: Receiver<Paint>,
    edits: Sender<Edit>,
}

pub struct Requests {
    state: Receiver<Paint>,
    edits: Receiver<Edit>,
}

pub fn command_channel() -> (Commands, Requests) {
    let (state_tx, state) = bounded(1);
    let (edits_tx, edits) = bounded(32);
    (
        Commands {
            state: state_tx,
            stale_state: state.clone(),
            edits: edits_tx,
        },
        Requests { state, edits },
    )
}

impl Commands {
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
}

impl Resources {
    pub fn new(
        scene: TrafficScene,
        display: TrafficDisplay,
        events: Sender<Event>,
        requests: Requests,
    ) -> Self {
        let population = scene.population();
        let span = scene.extent().map(|v| v as f32);
        Self {
            scene,
            display,
            events,
            requests,
            request: Paint {
                playing: true,
                rate: 10.0,
                step_ticket: 0,
                generation_override: None,
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

    fn prepare(&mut self, queue: &wgpu::Queue) {
        if let Ok(request) = self.requests.state.try_recv() {
            self.request = request;
        }
        let request = self.request;
        self.scene
            .set_generation_override(request.generation_override)
            .expect("UI probability is in 0..=1");
        let mut edited = false;
        while let Ok(edit) = self.requests.edits.try_recv() {
            edited |= match edit {
                Edit::Toggle(cell) => self.scene.toggle_vehicle(cell, !request.playing),
                Edit::Vehicles(action) => {
                    self.scene
                        .edit_vehicles(action, !request.playing)
                        .expect("UI probability is in 0..=1");
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
        let _ = self.events.try_send(Event::Progress(self.progress));
    }
}

impl CallbackTrait for PaintCallback {
    fn prepare(
        &self,
        _device: &wgpu::Device,
        queue: &wgpu::Queue,
        _screen: &ScreenDescriptor,
        _encoder: &mut wgpu::CommandEncoder,
        resources: &mut CallbackResources,
    ) -> Vec<wgpu::CommandBuffer> {
        resources
            .get_mut::<Resources>()
            .expect("traffic resources were installed at startup")
            .prepare(queue);
        Vec::new()
    }

    fn paint(
        &self,
        _info: egui::PaintCallbackInfo,
        pass: &mut wgpu::RenderPass<'static>,
        resources: &CallbackResources,
    ) {
        resources
            .get::<Resources>()
            .expect("traffic resources were installed at startup")
            .display
            .paint(pass);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn view_updates_coalesce_but_clicks_remain_ordered_and_queue_full_is_reported() {
        let (commands, requests) = command_channel();
        let state = Paint {
            playing: false,
            rate: 10.0,
            step_ticket: 0,
            generation_override: None,
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
        for action in actions {
            assert!(commands.edit(action));
        }
        for action in actions {
            assert_eq!(requests.edits.try_recv().unwrap(), action);
        }
        assert!(requests.edits.try_recv().is_err());
    }
}
