use ca_core::{map_json::MapDocument, virtual_time::Clock};
use ca_gpu::TrafficScene;

#[test]
fn metrics_run_once_per_tick_and_reset_with_scenario_or_map() {
    let mut scene = TrafficScene::from_document(&MapDocument::demo());
    assert!(scene.metrics().history().is_empty());
    scene.tick();
    scene.tick();
    assert_eq!(scene.metrics().history().len(), 2);
    assert_eq!(scene.metrics().history()[1].elapsed_seconds, 4);
    assert_eq!(scene.metrics().history()[1].clock, scene.time().clock);
    scene.set_metric_streets(vec![false; 3]);
    scene.tick();
    let point = scene.metrics().history()[2];
    assert_eq!(point.population, 0);
    assert_eq!(point.net_change, 0.);
    scene.reset_scenario_time(Clock::default());
    assert!(scene.metrics().history().is_empty());
    assert_eq!(scene.metrics().included(), &[false; 3]);
    scene.tick();
    assert_eq!(scene.metrics().history()[0].elapsed_seconds, 2);
    scene = TrafficScene::from_document(&MapDocument::empty());
    assert!(scene.metrics().history().is_empty());
}
