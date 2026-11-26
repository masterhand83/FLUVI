//! Native, language-independent analysis of v1/v2 metric exports.
//! Plot text is supplied separately, at the presentation boundary.
mod input;
mod plot_data;
mod statistics;
pub use input::Format;
pub use plot_data::{BoxPlot, Distribution, HeatCell, PlotData};
use serde_json::Value;

pub const COLUMNS: [&str; 5] = ["Densidad", "Flujo", "Generacion", "Velocidad", "Entropia"];
pub const DAYS: [&str; 7] = [
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
    "Domingo",
];
pub const STATES: [&str; 5] = [
    "🔵 Sub-utilizado",
    "🟡 Moderado",
    "🟢 Óptimo",
    "🟠 Congestionado",
    "🔴 Colapso",
];
pub const MAX_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_ROWS: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("analyzer.error.invalid")]
    Invalid,
    #[error("analyzer.error.empty")]
    Empty,
    #[error("analyzer.error.limit")]
    Limit,
}

#[derive(Debug, Clone)]
pub struct Sample {
    pub timestamp: String,
    pub values: [f64; 5],
    pub seconds: f64,
    /// Monday-based weekday, independent of the display language.
    pub weekday: usize,
    pub day: usize,
    pub accumulated: f64,
}

impl Sample {
    pub fn state(&self) -> usize {
        let [density, flow, _, speed, _] = self.values;
        if density > 80. && speed < 15. {
            4
        } else if flow >= 2.5 && (25. ..=60.).contains(&density) && speed >= 50. {
            2
        } else if density > 65. && speed < 35. {
            3
        } else if density < 25. && flow < 1.5 {
            0
        } else {
            1
        }
    }
}

#[derive(Debug, Clone)]
pub struct Report {
    /// Same tables and stable identifiers as the Python JSON serializer.
    pub results: Value,
    pub samples: Vec<Sample>,
    pub plot_data: PlotData,
}

/// Headless numeric entry point. No window, Python, locale, or simulation state.
pub fn analyze(content: &str, format: Format) -> Result<Report, Error> {
    let samples = input::parse(content, format)?;
    let results = statistics::analyze(&samples)?;
    let plot_data = plot_data::build(&samples);
    Ok(Report {
        results,
        samples,
        plot_data,
    })
}
