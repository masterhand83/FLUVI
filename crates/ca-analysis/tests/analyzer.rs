use ca_analysis::{Format, analyze};
use serde_json::Value;

fn compare(actual: &Value, expected: &Value, path: &str) {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            assert!(
                (a - b).abs() <= 1e-9 * b.abs().max(1.),
                "{path}: {a} != {b}"
            );
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                compare(a, b, &format!("{path}/{i}"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (key, b) in b {
                compare(&a[key], b, &format!("{path}/{key}"));
            }
        }
        _ => assert_eq!(actual, expected, "{path}"),
    }
}

#[test]
fn numbers_match_the_unchanged_python_analyzer() {
    let report = analyze(include_str!("fixtures/input.json"), Format::Json).unwrap();
    let expected = serde_json::from_str(include_str!("fixtures/expected.json")).unwrap();
    compare(&report.results, &expected, "");
}

#[test]
fn current_export_files_accept_spanish_weekdays_and_keep_all_rows() {
    for (content, format) in [
        (
            include_str!("../../ca-app/tests/fixtures/metric-exports/all.csv"),
            Format::Csv,
        ),
        (
            include_str!("../../ca-app/tests/fixtures/metric-exports/all.json"),
            Format::Json,
        ),
    ] {
        let report = analyze(content, format).unwrap();
        assert_eq!(report.samples.len(), 55);
        assert_eq!(report.samples[0].weekday, 2);
        assert_eq!(report.samples[0].seconds, 86280.);
        assert_eq!(report.samples[0].values, [99.99, 0., -1., 100., 0.]);
    }
}

#[test]
fn legacy_csv_skips_metadata_and_statistics_and_detects_midnight() {
    let report = analyze(
        include_str!("../../../apps/v1/tests/fixtures/legacy-metrics.csv"),
        Format::Csv,
    )
    .unwrap();
    assert_eq!(report.samples.len(), 3);
    assert_eq!(report.samples[1].accumulated, 86400.);
    assert_eq!(report.samples[1].weekday, 1);
    assert_eq!(report.results["capacidad"]["capacidad_maxima"], 1.35);
}

#[test]
fn malformed_and_empty_files_return_stable_error_keys() {
    use ca_analysis::Error;
    for (content, format, error) in [
        ("{", Format::Json, Error::Invalid),
        ("{}", Format::Json, Error::Invalid),
        ("not,a,metrics,file", Format::Csv, Error::Invalid),
        (
            "Marca_Tiempo,a,b,c,d,e\n25:00:00,1,2,3,4,5",
            Format::Csv,
            Error::Invalid,
        ),
        ("Marca_Tiempo,a,b,c,d,e\n", Format::Csv, Error::Empty),
    ] {
        assert_eq!(analyze(content, format).unwrap_err(), error);
    }
}

#[test]
fn one_sample_and_constant_columns_have_null_undefined_statistics() {
    let report = analyze(
        "Marca_Tiempo,a,b,c,d,e\nLunes 00:00:00,1,2,3,4,5",
        Format::Csv,
    )
    .unwrap();
    assert_eq!(report.results["estadisticas"]["rows"][2][1], Value::Null);
    assert_eq!(report.results["correlaciones"]["rows"][0][1], Value::Null);
}

#[test]
fn plot_aggregates_have_named_quartiles_histograms_and_hour_means() {
    let report = analyze(
        "Marca_Tiempo,a,b,c,d,e\n00:00:00,1,2,0,50,1\n00:30:00,2,2,0,50,1\n01:30:00,3,2,0,50,1\n02:30:00,4,2,0,50,1",
        Format::Csv,
    ).unwrap();
    let data = &report.plot_data;
    assert_eq!(data.density.bounds, [1., 4.]);
    assert_eq!(data.density.box_plot.quartiles, [1.75, 2.5, 3.25]);
    assert_eq!(data.density.box_plot.whiskers, [1., 4.]);
    assert!(data.density.box_plot.outliers.is_empty());
    assert_eq!(data.density.bins[0], 1);
    assert_eq!(data.density.bins[16], 1);
    assert_eq!(data.density.bins[33], 1);
    assert_eq!(data.density.bins[49], 1);
    assert_eq!(data.flow.bounds, [1.5, 2.5]);
    assert_eq!(data.flow.bins[25], 4);
    assert_eq!(data.heatmap.len(), 2);
    assert_eq!(
        (
            data.heatmap[0].weekday,
            data.heatmap[0].hour,
            data.heatmap[0].density
        ),
        (0, 0, 1.5)
    );
    assert_eq!(
        (
            data.heatmap[1].weekday,
            data.heatmap[1].hour,
            data.heatmap[1].density
        ),
        (0, 2, 3.5)
    );
}
