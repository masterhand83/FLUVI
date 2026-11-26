//! Reusable legacy export builders. Data text never depends on UI language.
use ca_core::{
    metrics::{LIVE_POINTS, Point},
    virtual_time::VirtualTime,
};
use serde_json::{Value, json};
mod images;
pub use images::build_image_zip;
mod worker;
pub use worker::{Kind, SaveJob, start_save};

pub struct Snapshot {
    pub document: ca_core::map_json::MapDocument,
    pub history: Vec<Point>,
    pub included: usize,
}

pub struct Context {
    pub time: VirtualTime,
    /// Explicit wall-clock timestamp makes callers and compatibility fixtures deterministic.
    pub export_date: String,
}

pub struct TextExport {
    pub content: String,
    pub file_name: String,
    pub count: usize,
}

const KEYS: [&str; 5] = ["density", "throughput", "netGeneration", "speed", "entropy"];
const LABELS: [&str; 5] = [
    "Densidad (%)",
    "Flujo (veh/s)",
    "Generacion Neta (veh/s)",
    "Velocidad (% movimiento)",
    "Entropia (bits)",
];

fn values(p: &Point) -> [f64; 5] {
    [p.density, p.throughput, p.net_change, p.speed, p.entropy]
}

fn day(context: &Context) -> String {
    context
        .time
        .clock
        .export_timestamp()
        .split_once(' ')
        .unwrap()
        .0
        .into()
}

fn file_name(context: &Context, extension: &str) -> String {
    let [_, hour, minute, _] = context.time.clock.parts();
    format!(
        "metricas_trafico_{}_{hour:02}h{minute:02}m.{extension}",
        day(context)
    )
}

// Match JS Number spelling for the bounded metric range, including integral floats.
fn number(value: f64) -> Value {
    if value.fract() == 0. && value.abs() < i64::MAX as f64 {
        json!(value as i64)
    } else {
        json!(value)
    }
}

// JS toFixed(2): round the exact binary fraction, with ties away from zero.
fn fixed(value: f64) -> String {
    let bits = value.abs().to_bits();
    let exponent = ((bits >> 52) & 0x7ff) as i32 - 1023 - 52;
    if value == 0. {
        return "0.00".into();
    }
    if exponent >= 0 {
        return format!("{value:.2}");
    }
    let shift = (-exponent) as u32;
    let cents = if shift >= 128 {
        0
    } else {
        let numerator = u128::from((bits & ((1_u64 << 52) - 1)) | (1_u64 << 52)) * 100;
        let denominator = 1_u128 << shift;
        numerator / denominator + u128::from(numerator % denominator >= denominator / 2)
    };
    format!(
        "{}{}.{:02}",
        if value < 0. { "-" } else { "" },
        cents / 100,
        cents % 100
    )
}

fn statistics(history: &[Point], metric: usize) -> Value {
    if history.is_empty() {
        return json!({"avg": 0, "min": 0, "max": 0});
    }
    let mut sum = 0.;
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    for p in history {
        let v = values(p)[metric];
        sum += v;
        min = min.min(v);
        max = max.max(v);
    }
    json!({"avg": fixed(sum / history.len() as f64), "min": fixed(min), "max": fixed(max)})
}

/// CSV always uses exactly the history supplied, normally the complete history.
pub fn build_csv(history: &[Point], context: &Context) -> TextExport {
    let mut content = format!(
        "FLUVI - Simulador de Trafico - Exportacion de Metricas\nTiempo Virtual: {}\nPerfiles Dinamicos Activos: {}\nTiempo por Paso: 2 segundo(s) simulados\nTotal de Mediciones: {}\n\nMarca de Tiempo,Densidad (%),Flujo (veh/s),Generacion Neta (veh/s),Velocidad (% movimiento),Entropia (bits)\n",
        context.time.clock.export_timestamp(),
        if context.time.enabled { "Si" } else { "No" },
        history.len()
    );
    for p in history {
        content.push_str(&p.clock.export_timestamp());
        for v in values(p) {
            content.push(',');
            content.push_str(&number(v).to_string());
        }
        content.push('\n');
    }
    content.push_str("\nESTADISTICAS\nMetrica,Promedio,Minimo,Maximo\n");
    for (i, label) in LABELS.iter().enumerate() {
        let stats = statistics(history, i);
        let text = |key: &str| {
            stats[key]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| stats[key].to_string())
        };
        content.push_str(&format!(
            "{label},{},{},{}\n",
            text("avg"),
            text("min"),
            text("max")
        ));
    }
    TextExport {
        content,
        file_name: file_name(context, "csv"),
        count: history.len(),
    }
}

pub fn standalone_json(history: &[Point], context: &Context) -> TextExport {
    build_json(
        &history[history.len().saturating_sub(LIVE_POINTS)..],
        context,
    )
}

/// No implicit window here: Complete Export can reuse this with all points.
pub fn build_json(history: &[Point], context: &Context) -> TextExport {
    let [_, hour, minute, second] = context.time.clock.parts();
    let multiplier = context.time.multiplier();
    let description = if multiplier >= 1.5 {
        "Hora pico"
    } else if multiplier >= 1.2 {
        "Tráfico alto"
    } else if multiplier >= 0.8 {
        "Tráfico moderado"
    } else if multiplier >= 0.5 {
        "Tráfico bajo"
    } else {
        "Tráfico muy bajo"
    };
    let metadata = json!({
        "version": "2.2",
        "exportDate": context.export_date,
        "simulationName": "FLUVI Traffic Simulation",
        "totalDataPoints": history.len(),
        "metricsDescription": {
            "density": "Porcentaje de celdas ocupadas",
            "throughput": "Flujo vehicular real (Q = Densidad × Velocidad) en veh/s",
            "netGeneration": "Tasa de cambio neta de población vehicular en veh/s",
            "speed": "Porcentaje de vehículos en movimiento",
            "entropy": "Entropía de Shannon del autómata celular en bits (mide diversidad de las 8 transiciones basadas en vecindario de 3 celdas: 000, 001, 010, 011, 100, 101, 110, 111 con estado binario 0=vacío, 1=carro)"
        },
        "virtualTime": {
            "currentTime": context.time.clock.export_timestamp(),
            "day": day(context), "hour": hour, "minute": minute, "second": second,
            "profilesActive": context.time.enabled, "secondsPerStep": 2,
            "currentMultiplier": number(multiplier), "trafficDescription": description
        }
    });
    let mut metrics = json!({"timestamps": history.iter().map(|p| p.clock.export_timestamp()).collect::<Vec<_>>()});
    let mut stats = json!({});
    for (i, key) in KEYS.iter().enumerate() {
        metrics[*key] = json!(
            history
                .iter()
                .map(|p| number(values(p)[i]))
                .collect::<Vec<_>>()
        );
        stats[*key] = statistics(history, i);
    }
    let content = serde_json::to_string_pretty(
        &json!({"metadata": metadata, "metrics": metrics, "statistics": stats}),
    )
    .expect("finite metric data");
    TextExport {
        content,
        file_name: file_name(context, "json"),
        count: history.len(),
    }
}
