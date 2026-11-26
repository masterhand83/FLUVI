use crate::{DAYS, Error, MAX_BYTES, MAX_ROWS, Sample};
use serde_json::Value;

#[derive(Debug, Clone, Copy)]
pub enum Format {
    Csv,
    Json,
}

fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|v| v.is_finite())
}

fn clock(text: &str) -> Result<(f64, Option<usize>), Error> {
    let mut parts = text.split_whitespace().collect::<Vec<_>>();
    let numeric = parts.pop().ok_or(Error::Invalid)?;
    let day = if let Some(name) = parts.pop() {
        Some(DAYS.iter().position(|d| *d == name).ok_or(Error::Invalid)?)
    } else {
        None
    };
    if !parts.is_empty() {
        return Err(Error::Invalid);
    }
    let time = numeric
        .split(':')
        .map(str::parse::<f64>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| Error::Invalid)?;
    if time.len() != 3
        || time.iter().any(|n| !n.is_finite() || *n < 0.)
        || time[0] >= 24.
        || time[1] >= 60.
        || time[2] >= 60.
    {
        return Err(Error::Invalid);
    }
    Ok((time[0] * 3600. + time[1] * 60. + time[2], day))
}

pub(super) fn parse(content: &str, format: Format) -> Result<Vec<Sample>, Error> {
    if content.len() > MAX_BYTES {
        return Err(Error::Limit);
    }
    let mut rows = Vec::<(String, [f64; 5])>::new();
    match format {
        Format::Json => {
            let data: Value = serde_json::from_str(content.trim_start_matches('\u{feff}'))
                .map_err(|_| Error::Invalid)?;
            let metrics = data.get("metrics").ok_or(Error::Invalid)?;
            let keys = [
                "timestamps",
                "density",
                "throughput",
                "netGeneration",
                "speed",
                "entropy",
            ];
            let arrays = keys
                .iter()
                .map(|key| {
                    metrics
                        .get(*key)
                        .and_then(Value::as_array)
                        .ok_or(Error::Invalid)
                })
                .collect::<Result<Vec<_>, _>>()?;
            let count = arrays[0].len();
            if count > MAX_ROWS {
                return Err(Error::Limit);
            }
            if arrays.iter().any(|a| a.len() != count) {
                return Err(Error::Invalid);
            }
            for i in 0..count {
                let Some(timestamp) = arrays[0][i].as_str() else {
                    continue;
                };
                let values: Option<Vec<_>> = arrays[1..].iter().map(|a| number(&a[i])).collect();
                if let Some(values) = values {
                    rows.push((timestamp.into(), values.try_into().unwrap()));
                }
            }
        }
        Format::Csv => {
            // Metadata is not a CSV table. Locate the stable legacy header and
            // stop before the separate statistics table.
            let lines: Vec<_> = content.trim_start_matches('\u{feff}').lines().collect();
            let header = lines
                .iter()
                .position(|line| {
                    line.starts_with("Marca de Tiempo,") || line.starts_with("Marca_Tiempo,")
                })
                .ok_or(Error::Invalid)?;
            let body = lines[header..]
                .iter()
                .take_while(|line| !line.starts_with("ESTADISTICAS"))
                .copied()
                .collect::<Vec<_>>()
                .join("\n");
            let mut reader = csv::ReaderBuilder::new()
                .flexible(false)
                .from_reader(body.as_bytes());
            if reader.headers().map_err(|_| Error::Invalid)?.len() != 6 {
                return Err(Error::Invalid);
            }
            for record in reader.records() {
                let record = record.map_err(|_| Error::Invalid)?;
                let values = record
                    .iter()
                    .skip(1)
                    .map(|v| v.parse::<f64>().ok().filter(|v| v.is_finite()))
                    .collect::<Option<Vec<_>>>();
                if let Some(values) = values {
                    rows.push((record[0].into(), values.try_into().unwrap()));
                }
                if rows.len() > MAX_ROWS {
                    return Err(Error::Limit);
                }
            }
        }
    }
    if rows.is_empty() {
        return Err(Error::Empty);
    }
    let mut samples = Vec::<Sample>::with_capacity(rows.len());
    for (timestamp, values) in rows {
        let (seconds, explicit_day) = clock(&timestamp)?;
        let (day, weekday) = if let Some(previous) = samples.last() {
            let advance = explicit_day.map_or_else(
                || usize::from(seconds < previous.seconds),
                |weekday| {
                    let delta = (weekday + 7 - previous.weekday) % 7;
                    if delta == 0 && seconds < previous.seconds {
                        7
                    } else {
                        delta
                    }
                },
            );
            (previous.day + advance, (previous.weekday + advance) % 7)
        } else {
            (1, explicit_day.unwrap_or(0))
        };
        samples.push(Sample {
            timestamp,
            values,
            seconds,
            weekday,
            day,
            accumulated: (day - 1) as f64 * 86400. + seconds,
        });
    }
    Ok(samples)
}
