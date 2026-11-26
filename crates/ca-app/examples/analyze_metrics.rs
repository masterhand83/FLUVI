//! Headless integration example:
//! cargo run -p ca-app --example analyze_metrics -- metrics.csv output-directory en
use ca_analysis::{Format, MAX_BYTES};
use ca_app::{analyzer::analyze_with_images, shell::Language};
use std::{io::Read, path::PathBuf};

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let input = PathBuf::from(
        args.next()
            .ok_or_else(|| anyhow::anyhow!("Input CSV/JSON path required"))?,
    );
    let output = PathBuf::from(
        args.next()
            .ok_or_else(|| anyhow::anyhow!("Output directory required"))?,
    );
    let language = Language::from_preference(&args.next().unwrap_or_else(|| "es".into()));
    let format = match input
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("csv") => Format::Csv,
        Some("json") => Format::Json,
        _ => anyhow::bail!("Input must be CSV or JSON"),
    };
    let mut bytes = Vec::new();
    std::fs::File::open(input)?
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    anyhow::ensure!(bytes.len() <= MAX_BYTES, "Input exceeds 16 MiB");
    let analysis = analyze_with_images(&String::from_utf8(bytes)?, format, language)
        .map_err(anyhow::Error::msg)?;
    std::fs::create_dir_all(&output)?;
    std::fs::write(
        output.join("analisis_metricas.json"),
        serde_json::to_vec_pretty(&analysis.report.results)?,
    )?;
    for plot in analysis.plots {
        std::fs::write(output.join(plot.file_name), plot.png)?;
    }
    Ok(())
}
