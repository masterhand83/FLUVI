use std::time::Instant;

use ca_gpu::{TrafficDisplay, TrafficScene};
use crossbeam_channel::{Receiver, Sender};
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
}

pub struct PaintCallback;

pub struct Resources {
    scene: TrafficScene,
    display: TrafficDisplay,
    events: Sender<Event>,
    commands: Receiver<Paint>,
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
        commands: Receiver<Paint>,
    ) -> Self {
        let population = scene.population();
        Self {
            scene,
            display,
            events,
            commands,
            request: Paint {
                playing: true,
                rate: 10.0,
                step_ticket: 0,
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
        while let Ok(request) = self.commands.try_recv() {
            self.request = request;
        }
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_tick);
        self.last_tick = now;
        let request = self.request;
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
        if steps > 0 {
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
