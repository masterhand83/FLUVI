use crate::{COLUMNS, DAYS, Error, STATES, Sample};
use polars_core::prelude::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn table(columns: Vec<String>, rows: Vec<Vec<Value>>) -> Value {
    json!({"columns": columns, "rows": rows})
}
fn names(index: &str, columns: &[&str]) -> Vec<String> {
    std::iter::once(index)
        .chain(columns.iter().copied())
        .map(str::to_owned)
        .collect()
}
fn rounded(n: Option<f64>, digits: i32) -> Value {
    json!(n.map(|n| (n * 10_f64.powi(digits)).round_ties_even() / 10_f64.powi(digits)))
}

fn series(samples: &[&Sample], metric: usize) -> Float64Chunked {
    Float64Chunked::from_vec(
        COLUMNS[metric].into(),
        samples.iter().map(|s| s.values[metric]).collect(),
    )
}
fn describe(c: &Float64Chunked) -> [Option<f64>; 8] {
    [
        Some(c.len() as f64),
        c.mean(),
        c.std(1),
        c.min(),
        c.quantile(0.25, QuantileMethod::Linear).unwrap(),
        c.quantile(0.5, QuantileMethod::Linear).unwrap(),
        c.quantile(0.75, QuantileMethod::Linear).unwrap(),
        c.max(),
    ]
}
fn counts(
    groups: &BTreeMap<String, Vec<&Sample>>,
    samples: &[Sample],
    sample_label: impl Fn(&Sample) -> &'static str,
) -> Vec<Value> {
    let mut order: Vec<_> = groups.iter().collect();
    // pandas value_counts is stable for equally frequent labels.
    order.sort_by_key(|(label, group)| {
        (
            std::cmp::Reverse(group.len()),
            samples
                .iter()
                .position(|s| sample_label(s) == label.as_str())
                .unwrap(),
        )
    });
    order
        .into_iter()
        .map(|(label, group)| {
            json!({
                "label": label, "value": group.len()
            })
        })
        .collect()
}

/// scipy find_peaks(height=2, distance=30): plateau midpoint, then tallest
/// peaks first. Equal-height candidates are considered from right to left.
fn peaks(samples: &[Sample]) -> usize {
    let mut candidates = Vec::new();
    let mut i = 1;
    while i + 1 < samples.len() {
        let start = i;
        let height = samples[i].values[0];
        while i + 1 < samples.len() && samples[i + 1].values[0] == height {
            i += 1;
        }
        if i + 1 < samples.len()
            && height >= 2.
            && height > samples[start - 1].values[0]
            && height > samples[i + 1].values[0]
        {
            candidates.push((start + (i - start) / 2, height));
        }
        i += 1;
    }
    candidates.sort_by(|a, b| b.1.total_cmp(&a.1).then(b.0.cmp(&a.0)));
    let mut accepted = Vec::<usize>::new();
    for (index, _) in candidates {
        if accepted.iter().all(|p| p.abs_diff(index) >= 30) {
            accepted.push(index);
        }
    }
    accepted.len()
}

pub(super) fn analyze(samples: &[Sample]) -> Result<Value, Error> {
    let all: Vec<_> = samples.iter().collect();
    // Polars owns the numeric columns and their aggregation semantics.
    let frame = DataFrame::new(
        samples.len(),
        (0..5)
            .map(|m| series(&all, m).into_series().into())
            .collect(),
    )
    .map_err(|_| Error::Invalid)?;
    let columns: Vec<_> = COLUMNS
        .iter()
        .map(|name| frame.column(name).unwrap().f64().unwrap())
        .collect();
    let stats: Vec<_> = columns.iter().map(|c| describe(c)).collect();
    let statistics = table(
        names("index", &COLUMNS),
        ["count", "mean", "std", "min", "25%", "50%", "75%", "max"]
            .iter()
            .enumerate()
            .map(|(i, label)| {
                std::iter::once(json!(label))
                    .chain(stats.iter().map(|s| json!(s[i])))
                    .collect()
            })
            .collect(),
    );
    let mut weekdays = BTreeMap::<String, Vec<&Sample>>::new();
    let mut days = BTreeMap::<usize, Vec<&Sample>>::new();
    let mut states = BTreeMap::<String, Vec<&Sample>>::new();
    let mut minutes = BTreeMap::<i64, Vec<&Sample>>::new();
    for s in samples {
        weekdays.entry(DAYS[s.weekday].into()).or_default().push(s);
        days.entry(s.day).or_default().push(s);
        states.entry(STATES[s.state()].into()).or_default().push(s);
        minutes
            .entry((s.accumulated / 60.).round_ties_even() as i64)
            .or_default()
            .push(s);
    }
    let day_stats = [
        (0, "mean"),
        (0, "std"),
        (0, "min"),
        (0, "max"),
        (0, "count"),
        (1, "mean"),
        (1, "std"),
        (1, "min"),
        (1, "max"),
        (3, "mean"),
        (3, "std"),
        (4, "mean"),
        (4, "std"),
    ];
    let weekday_table = table(
        std::iter::once("Dia_Semana".into())
            .chain(
                day_stats
                    .iter()
                    .map(|(m, op)| format!("{} | {op}", COLUMNS[*m])),
            )
            .collect(),
        weekdays
            .iter()
            .map(|(label, group)| {
                let mut row = vec![json!(label)];
                for (m, op) in day_stats {
                    let s = series(group, m);
                    row.push(rounded(
                        match op {
                            "mean" => s.mean(),
                            "std" => s.std(1),
                            "min" => s.min(),
                            "max" => s.max(),
                            _ => Some(s.len() as f64),
                        },
                        3,
                    ));
                }
                row
            })
            .collect(),
    );
    let day_table = table(
        names(
            "Dia_Numero",
            &[
                "Dia_Semana | first",
                "Densidad | mean",
                "Densidad | count",
                "Flujo | mean",
                "Velocidad | mean",
                "Entropia | mean",
            ],
        ),
        days.iter()
            .map(|(day, group)| {
                vec![
                    json!(day),
                    json!(DAYS[group[0].weekday]),
                    rounded(series(group, 0).mean(), 3),
                    json!(group.len()),
                    rounded(series(group, 1).mean(), 3),
                    rounded(series(group, 3).mean(), 3),
                    rounded(series(group, 4).mean(), 3),
                ]
            })
            .collect(),
    );
    let metric_indices = [0, 1, 3, 4];
    let correlations = table(
        names("index", &["Densidad", "Flujo", "Velocidad", "Entropia"]),
        metric_indices
            .iter()
            .map(|&a| {
                let mut row = vec![json!(COLUMNS[a])];
                for &b in &metric_indices {
                    let ma = stats[a][1].unwrap();
                    let mb = stats[b][1].unwrap();
                    let mut covariance = 0.;
                    let mut va = 0.;
                    let mut vb = 0.;
                    for s in samples {
                        let da = s.values[a] - ma;
                        let db = s.values[b] - mb;
                        covariance += da * db;
                        va += da * da;
                        vb += db * db;
                    }
                    row.push(json!(covariance / (va * vb).sqrt()));
                }
                row
            })
            .collect(),
    );
    let critical = samples
        .iter()
        .enumerate()
        .max_by(|(ia, a), (ib, b)| a.values[1].total_cmp(&b.values[1]).then(ib.cmp(ia)))
        .unwrap()
        .1;
    let base = time::Date::from_calendar_date(2024, time::Month::January, 1)
        .unwrap()
        .with_hms(7, 0, 10)
        .unwrap();
    let date = base + time::Duration::seconds_f64(critical.accumulated);
    let date = format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        date.year(),
        u8::from(date.month()),
        date.day(),
        date.hour(),
        date.minute(),
        date.second()
    );
    let capacity = json!({
        "capacidad_maxima": critical.values[1], "densidad_critica": critical.values[0],
        "velocidad_critica": critical.values[3], "tiempo_critico": critical.timestamp,
        "dia_critico": DAYS[critical.weekday], "dia_numero_critico": critical.day, "fecha_critica": date,
    });
    let gen_threshold = columns[2]
        .quantile(0.95, QuantileMethod::Linear)
        .unwrap()
        .unwrap();
    let entropy_threshold = columns[4]
        .quantile(0.9, QuantileMethod::Linear)
        .unwrap()
        .unwrap();
    let events = json!({
        "alta_generacion": samples.iter().filter(|s| s.values[2] > gen_threshold).count(),
        "baja_velocidad": samples.iter().filter(|s| s.values[3] < 85.).count(),
        "alta_entropia": samples.iter().filter(|s| s.values[4] > entropy_threshold).count(),
        "picos_densidad": peaks(samples),
    });
    let state_stats = table(
        names(
            "Estado_Nombre",
            &["Densidad", "Flujo", "Velocidad", "Entropia"],
        ),
        states
            .iter()
            .map(|(label, group)| {
                std::iter::once(json!(label))
                    .chain(
                        metric_indices
                            .iter()
                            .map(|&m| rounded(series(group, m).mean(), 2)),
                    )
                    .collect()
            })
            .collect(),
    );
    let distribution = counts(&states, samples, |s| STATES[s.state()]);
    let percentages: Vec<_> = distribution
        .iter()
        .map(|item| {
            json!({
                "label": item["label"],
                "value": item["value"].as_f64().unwrap() / samples.len() as f64 * 100.,
            })
        })
        .collect();
    let temporal = table(
        names(
            "Minuto_Redondeado",
            &["Densidad", "Flujo", "Velocidad", "Entropia"],
        ),
        minutes
            .iter()
            .map(|(minute, group)| {
                std::iter::once(json!(minute))
                    .chain(
                        metric_indices
                            .iter()
                            .map(|&m| json!(series(group, m).mean())),
                    )
                    .collect()
            })
            .collect(),
    );
    Ok(json!({
        "estadisticas": statistics,
        "analisis_dias": {"stats_dia_semana": weekday_table, "stats_dia_numero": day_table,
            "conteo_dias": counts(&weekdays, samples, |s| DAYS[s.weekday]), "total_dias": samples.last().unwrap().day},
        "correlaciones": correlations, "capacidad": capacity, "eventos_criticos": events,
        "clustering": {"distribucion": distribution, "porcentajes": percentages, "estadisticas": state_stats},
        "temporal": temporal,
    }))
}
