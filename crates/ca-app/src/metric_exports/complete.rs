use super::{Context, ImageOptions, Snapshot, build_csv, build_json, images::write_images};
use crate::{
    analyzer::{Analysis, analyze_with_images},
    shell::Language,
};
use std::io::{Cursor, Write};

type Archive = zip::ZipWriter<Cursor<Vec<u8>>>;

fn add(zip: &mut Archive, name: &str, bytes: &[u8]) -> Result<(), String> {
    zip.start_file(
        name,
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
    )
    .map_err(|e| e.to_string())?;
    zip.write_all(bytes).map_err(|e| e.to_string())
}

/// All base artifacts are owned and encoded before an analyzer can run.
pub struct CompleteExport {
    zip: Archive,
    csv: String,
    generated_at: String,
    language: Language,
}

pub struct CompleteArchive {
    pub bytes: Vec<u8>,
    pub analysis_error: Option<String>,
}

impl CompleteExport {
    /// Worker-only: uses no live charts, heatmap dialog, or simulation state.
    pub fn prepare(
        snapshot: &Snapshot,
        context: &Context,
        viewport_png: &[u8],
        options: ImageOptions,
    ) -> Result<Self, String> {
        let csv = build_csv(&snapshot.history, context).content;
        let json = build_json(&snapshot.history, context).content;
        let mut zip = Archive::new(Cursor::new(Vec::new()));
        add(&mut zip, "metricas.csv", csv.as_bytes())?;
        add(&mut zip, "metricas.json", json.as_bytes())?;
        add(&mut zip, "mapa_actual.png", viewport_png)?;
        write_images(
            &snapshot.history,
            &snapshot.document,
            snapshot.included,
            options,
            "graficas/",
            |name, bytes| add(&mut zip, name, bytes),
        )?;
        Ok(Self {
            zip,
            csv,
            generated_at: context.export_date.clone(),
            language: options.language,
        })
    }

    pub fn finish(self) -> Result<CompleteArchive, String> {
        self.finish_with(|csv, language| {
            analyze_with_images(csv, ca_analysis::Format::Csv, language)
        })
    }

    /// Alternate analyzer adapter, including controlled failure for integration checks.
    pub fn finish_with(
        mut self,
        analyze: impl FnOnce(&str, Language) -> Result<Analysis, String>,
    ) -> Result<CompleteArchive, String> {
        let analysis_error = match analyze(&self.csv, self.language) {
            Ok(analysis) => {
                let report = serde_json::json!({
                    "generatedAt": self.generated_at,
                    "language": self.language.code(),
                    "analysis": analysis.report.results,
                });
                add(
                    &mut self.zip,
                    "analisis_metricas.json",
                    &serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
                )?;
                for plot in analysis.plots {
                    // Complete Export in v1 uses the singular name, unlike the analyzer dialog.
                    let name = if plot.file_name == "diagramas_fundamentales.png" {
                        "diagrama_fundamental.png"
                    } else {
                        plot.file_name
                    };
                    add(&mut self.zip, name, &plot.png)?;
                }
                None
            }
            Err(error) => {
                add(&mut self.zip, "analisis_python_error.txt", error.as_bytes())?;
                Some(error)
            }
        };
        Ok(CompleteArchive {
            bytes: self.zip.finish().map_err(|e| e.to_string())?.into_inner(),
            analysis_error,
        })
    }
}
