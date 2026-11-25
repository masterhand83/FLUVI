use std::time::Instant;

use ca_gpu::{Brush, Grid, PopulationSample, Simulation};
use crossbeam_channel::{Receiver, Sender};
use eframe::{egui, wgpu};
use egui_wgpu::{CallbackResources, CallbackTrait, ScreenDescriptor};

use crate::timing::SimulationClock;

pub const GRID_SIZE: u32 = 512;
pub const INITIAL_SEED: u64 = 42;

#[derive(Clone, Copy, Default)]
pub struct Progress {
    pub frames: u64,
    pub epoch: u64,
    pub generation: u64,
    pub total_generations: u64,
}

pub enum Event {
    Progress(Progress),
    Population(PopulationSample),
    Error(String),
}

/// UI commands are values. The renderer owns every mutable GPU resource.
#[derive(Clone, Copy)]
pub struct Paint {
    pub playing: bool,
    pub rate: f64,
    pub epoch: u64,
    pub seed: u64,
    pub step_ticket: u64,
    pub brush: Option<Brush>,
}

pub struct PaintCallback;

pub struct Resources {
    sim: Simulation,
    events: Sender<Event>,
    commands: Receiver<Paint>,
    request: Paint,
    clock: SimulationClock,
    last_tick: Instant,
    progress: Progress,
    step_ticket: u64,
    dirty: bool,
    failed: bool,
}

impl Resources {
    pub fn new(sim: Simulation, events: Sender<Event>, commands: Receiver<Paint>) -> Self {
        Self {
            sim,
            events,
            commands,
            request: Paint {
                playing: true,
                rate: 60.0,
                epoch: 0,
                seed: INITIAL_SEED,
                step_ticket: 0,
                brush: None,
            },
            clock: SimulationClock::default(),
            last_tick: Instant::now(),
            progress: Progress::default(),
            step_ticket: 0,
            dirty: true,
            failed: false,
        }
    }

    fn prepare(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
    ) -> anyhow::Result<()> {
        // The callback itself is allocated once. Commands use a bounded channel.
        while let Ok(request) = self.commands.try_recv() {
            self.request = request;
        }
        let request = self.request;
        // Pointer edits are one-frame commands, unlike persistent play/rate state.
        self.request.brush = None;
        while let Some(sample) = self.sim.poll(device)? {
            let _ = self.events.try_send(Event::Population(sample));
        }
        let now = Instant::now();
        let mut elapsed = now.duration_since(self.last_tick);
        self.last_tick = now;
        if request.epoch != self.progress.epoch {
            let grid = Grid::seeded(GRID_SIZE, GRID_SIZE, request.seed)?;
            self.sim.reset(queue, &grid)?;
            self.progress.epoch = request.epoch;
            self.progress.generation = 0;
            self.clock = SimulationClock::default();
            elapsed = std::time::Duration::ZERO;
            self.dirty = true;
        }
        let mut steps = self.clock.advance(elapsed, request.rate, request.playing);
        if request.step_ticket != self.step_ticket && !request.playing {
            steps = 1;
        }
        self.step_ticket = request.step_ticket;
        self.sim.step(encoder, steps);
        self.progress.generation += u64::from(steps);
        self.progress.total_generations += u64::from(steps);
        if let Some(brush) = request.brush {
            self.sim.brush(queue, encoder, brush);
        }
        if steps != 0 || request.brush.is_some() || self.dirty {
            self.sim
                .sample(encoder, self.progress.epoch, self.progress.generation);
            self.dirty = false;
        }
        self.progress.frames += 1;
        let _ = self.events.try_send(Event::Progress(self.progress));
        Ok(())
    }
}

impl CallbackTrait for PaintCallback {
    fn prepare(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        _screen: &ScreenDescriptor,
        encoder: &mut wgpu::CommandEncoder,
        resources: &mut CallbackResources,
    ) -> Vec<wgpu::CommandBuffer> {
        let state = resources
            .get_mut::<Resources>()
            .expect("CA resources were installed at startup");
        if !state.failed
            && let Err(error) = state.prepare(device, queue, encoder)
        {
            state.failed = true;
            let _ = state.events.try_send(Event::Error(error.to_string()));
        }
        // Use egui's encoder, so this empty vector allocates nothing.
        Vec::new()
    }

    fn paint(
        &self,
        _info: egui::PaintCallbackInfo,
        pass: &mut wgpu::RenderPass<'static>,
        resources: &CallbackResources,
    ) {
        let state = resources
            .get::<Resources>()
            .expect("CA resources were installed at startup");
        state.sim.paint(pass);
    }
}
