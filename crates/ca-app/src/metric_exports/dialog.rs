use crate::{
    graphics::ExportQuality,
    shell::{Language, Shell},
};
use eframe::egui;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ImageOptions {
    pub language: Language,
    pub quality: ExportQuality,
}

/// A separate draft: opening or cancelling never starts a worker or a save dialog.
#[derive(Default)]
pub struct ExportDialog {
    draft: Option<ImageOptions>,
}

impl ExportDialog {
    pub fn open(&mut self, options: ImageOptions) {
        self.draft = Some(options);
    }

    pub fn is_open(&self) -> bool {
        self.draft.is_some()
    }

    pub fn show(&mut self, ctx: &egui::Context, shell: &Shell) -> Option<ImageOptions> {
        let draft = self.draft.as_mut()?;
        let mut confirm = false;
        let mut cancel = false;
        let modal = egui::Modal::new("metric-export-language".into()).show(ctx, |ui| {
            ui.set_width(380.);
            ui.heading(shell.tr("metrics.export.language", &[]));
            ui.label(shell.tr("metrics.export.languageHint", &[]));
            ui.radio_value(&mut draft.language, Language::Spanish, "Español");
            ui.radio_value(&mut draft.language, Language::English, "English");
            ui.label(format!(
                "{}: {}",
                shell.tr("graphics.exportQuality", &[]),
                shell.tr(draft.quality.key(), &[])
            ));
            ui.horizontal(|ui| {
                cancel = ui.button(shell.tr("common.cancel", &[])).clicked();
                confirm = ui.button(shell.tr("metrics.export.confirm", &[])).clicked();
            });
        });
        if cancel || modal.should_close() {
            self.draft = None;
            None
        } else if confirm {
            self.draft.take()
        } else {
            None
        }
    }
}
