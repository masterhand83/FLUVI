use ca_core::{map_json::MapDocument, scenario_json::Scenario};

fn main() {
    let mut map = MapDocument::parse(include_str!("../tests/fixtures/map-v1.json")).unwrap();
    map.load_scenario(
        &Scenario::parse(include_str!("../tests/fixtures/scenario-v1.json")).unwrap(),
    )
    .unwrap();
    print!(
        "{}",
        map.capture_scenario("Storm", "v2-export")
            .unwrap()
            .to_json()
    );
}
