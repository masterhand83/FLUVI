use ca_app::scenario_library::ScenarioLibrary;
use ca_core::{map_json::MapDocument, scenario_json::Scenario};

#[test]
fn save_reopen_load_and_delete_persist_across_restarts() {
    let directory = std::env::temp_dir().join(format!("fluvi-scenarios-{}", std::process::id()));
    let path = directory.join("scenarios.json");
    let _ = std::fs::remove_file(&path);
    let scenario = Scenario::parse(include_str!(
        "../../ca-core/tests/fixtures/scenario-v1.json"
    ))
    .unwrap();
    let mut library = ScenarioLibrary::open(&path).unwrap();
    library.save(scenario).unwrap();
    drop(library);
    let mut reopened = ScenarioLibrary::open(&path).unwrap();
    assert_eq!(reopened.entries()[0].name(), "Storm");
    let mut map =
        MapDocument::parse(include_str!("../../ca-core/tests/fixtures/map-v1.json")).unwrap();
    map.load_scenario(&reopened.entries()[0]).unwrap();
    assert_eq!(map.model().rain(), (false, 0.37));
    let id = reopened.entries()[0].id().to_owned();
    reopened.delete(&id).unwrap();
    assert!(ScenarioLibrary::open(&path).unwrap().entries().is_empty());
    std::fs::remove_file(path).unwrap();
    std::fs::remove_dir(directory).unwrap();
}
