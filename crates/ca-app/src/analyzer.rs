//! File analyzer and headless report images. No simulation state is accessed.
mod dialog;
mod plots;
mod session;
use crate::shell::{Language, Translator};
use ca_analysis::{Format, Report};
pub use dialog::AnalyzerDialog;
pub use session::Session;

pub struct Plot {
    pub file_name: &'static str,
    pub key: &'static str,
    pub svg: String,
    pub png: Vec<u8>,
    pub image: egui::ColorImage,
}

pub struct Analysis {
    pub report: Report,
    pub plots: Vec<Plot>,
    pub language: Language,
}

/// Complete Export can call this directly on its worker without opening a dialog.
pub fn analyze_with_images(
    content: &str,
    format: Format,
    language: Language,
) -> Result<Analysis, String> {
    let report = ca_analysis::analyze(content, format).map_err(|e| e.to_string())?;
    let plots = plots::render(&report, &Translator::new(language))?;
    Ok(Analysis {
        report,
        plots,
        language,
    })
}
