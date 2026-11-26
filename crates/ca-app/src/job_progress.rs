//! Coalesced worker progress. Updates never queue, block, or change saved data.
use crate::shell::Shell;
use std::sync::{
    Arc,
    atomic::{AtomicU16, Ordering},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u16)]
pub enum Stage {
    Waiting,
    Reading,
    Analyzing,
    Images,
    Packing,
    ChooseFile,
    Writing,
    Ready,
}

impl Stage {
    pub fn key(self) -> &'static str {
        match self {
            Self::Waiting => "progress.waiting",
            Self::Reading => "progress.reading",
            Self::Analyzing => "progress.analyzing",
            Self::Images => "progress.images",
            Self::Packing => "progress.packing",
            Self::ChooseFile => "progress.chooseFile",
            Self::Writing => "progress.writing",
            Self::Ready => "progress.ready",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub percent: u8,
    pub stage: Stage,
}

impl Snapshot {
    pub(crate) fn show(self, ui: &mut egui::Ui, shell: &Shell) {
        ui.add(
            egui::ProgressBar::new(f32::from(self.percent) / 100.)
                .desired_width(ui.available_width().min(220.))
                .desired_height(16.)
                .show_percentage(),
        );
        ui.small(shell.tr(self.stage.key(), &[]));
        ui.ctx()
            .request_repaint_after(std::time::Duration::from_millis(30));
    }
}

#[derive(Clone, Default)]
pub struct Progress(Arc<AtomicU16>);

impl Progress {
    pub fn set(&self, percent: u8, stage: Stage) {
        self.0.store(
            (stage as u16) << 7 | u16::from(percent.min(100)),
            Ordering::Relaxed,
        );
    }

    pub fn snapshot(&self) -> Snapshot {
        let state = self.0.load(Ordering::Relaxed);
        let stage = match state >> 7 {
            1 => Stage::Reading,
            2 => Stage::Analyzing,
            3 => Stage::Images,
            4 => Stage::Packing,
            5 => Stage::ChooseFile,
            6 => Stage::Writing,
            7 => Stage::Ready,
            _ => Stage::Waiting,
        };
        Snapshot {
            percent: (state & 127) as u8,
            stage,
        }
    }
}
