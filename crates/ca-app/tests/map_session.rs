use ca_app::map_session::{MapSession, ResetPhase};
use ca_core::map_json::MapDocument;

#[derive(Default)]
struct State {
    playing: bool,
    draft: bool,
    steps: Vec<&'static str>,
    labels: bool,
}

#[test]
fn scenario_resets_only_registered_traffic_features_and_restores_clock_last() {
    use ca_core::virtual_time::Clock;
    let mut session = MapSession::<State>::new(MapDocument::demo());
    session.register_reset(ResetPhase::Pause, |s| s.playing = false);
    session.register_reset(ResetPhase::Tools, |s| s.draft = false);
    session.register_scenario_reset(|s| s.steps.push("metrics"));
    session.register_scenario_reset(|s| s.steps.push("parking"));
    let mut state = State {
        playing: true,
        draft: true,
        labels: true,
        ..Default::default()
    };
    let before: serde_json::Value = serde_json::from_str(&session.document().to_json()).unwrap();
    let clock = Clock::new(0, 0, 0, 0).unwrap();
    session.reset_scenario_time(clock, &mut state);
    assert!(state.playing && state.draft && state.labels);
    assert_eq!(state.steps, ["metrics", "parking"]);
    assert_eq!(session.document().time().clock, clock);
    let after: serde_json::Value = serde_json::from_str(&session.document().to_json()).unwrap();
    for key in ["calles", "conexiones", "edificios"] {
        assert_eq!(before[key], after[key]);
    }
    for street in session.document().model().streets() {
        assert_eq!(street.cells()[18], 7);
        assert!(!street.cells().iter().any(|n| (1..=6).contains(n)));
    }
}

#[test]
fn accepted_street_edits_notify_registered_features_only_after_cleanup() {
    use ca_app::streets::StreetEvent;
    use ca_core::streets::{StreetDraft, StreetEdit};
    let mut session = MapSession::<State>::new(MapDocument::empty());
    let mut events = Vec::new();
    session.on_street_event(|event, document| {
        assert_eq!(
            document.model().streets().len(),
            usize::from(matches!(event, StreetEvent::Drawn(_)))
        );
    });
    events.push(
        session
            .edit_streets(StreetEdit::Draw(
                StreetDraft::between([0.0, 0.0], [5.0, 0.0]).unwrap(),
            ))
            .unwrap(),
    );
    events.push(session.edit_streets(StreetEdit::Delete(0)).unwrap());
    assert_eq!(events, [StreetEvent::Drawn(0), StreetEvent::Deleted(0)]);
    assert!(session.edit_streets(StreetEdit::Delete(0)).is_err());
}

#[test]
fn cancelled_new_map_and_invalid_load_leave_the_session_unchanged() {
    let mut session = MapSession::<State>::new(
        MapDocument::parse(include_str!("../../ca-core/tests/fixtures/map-v1.json")).unwrap(),
    );
    let mut state = State {
        playing: true,
        draft: true,
        labels: true,
        ..Default::default()
    };
    session.register_reset(ResetPhase::Pause, |s| s.playing = false);
    session.register_reset(ResetPhase::Tools, |s| s.draft = false);
    assert!(!session.replace(false, MapDocument::empty(), &mut state));
    let error = session.load("{}", &mut state).unwrap_err();
    use ca_app::shell::{Language, Translator};
    assert_eq!(
        Translator::new(Language::English).tr(error.translation_key(), &[]),
        "Cannot open this map. The file is invalid or too large. The current map has not changed."
    );
    assert_eq!(
        Translator::new(Language::Spanish).tr(error.translation_key(), &[]),
        "No se puede abrir este mapa. El archivo no es válido o es demasiado grande. El mapa actual no ha cambiado."
    );
    assert!(state.playing);
    assert!(state.draft);
    assert!(state.labels);
    assert_eq!(session.document().model().streets().len(), 2);
}

#[test]
fn shared_reset_pauses_then_cancels_tools_then_resets_registered_features() {
    let mut session = MapSession::<State>::new(MapDocument::empty());
    session.register_reset(ResetPhase::Features, |s| {
        assert!(!s.playing && !s.draft);
        s.steps.push("features");
    });
    session.register_reset(ResetPhase::Tools, |s| {
        assert!(!s.playing);
        s.draft = false;
        s.steps.push("tools");
    });
    session.register_reset(ResetPhase::Pause, |s| {
        s.playing = false;
        s.steps.push("pause");
    });
    let mut state = State {
        playing: true,
        draft: true,
        labels: true,
        ..Default::default()
    };
    assert!(session.replace(true, MapDocument::empty(), &mut state));
    assert_eq!(state.steps, ["pause", "tools", "features"]);
    assert!(state.labels, "session-only labels must not be reset");
}

#[test]
fn invalid_topology_after_valid_roads_never_resets_the_current_session() {
    let fixture = include_str!("../../ca-core/tests/fixtures/map-v1.json");
    let mut session = MapSession::<State>::new(MapDocument::parse(fixture).unwrap());
    session.register_reset(ResetPhase::Pause, |s| s.playing = false);
    session.register_reset(ResetPhase::Tools, |s| s.draft = false);
    let before = session.document().to_json();
    let mut broken: serde_json::Value = serde_json::from_str(fixture).unwrap();
    broken["conexiones"][1]["destinoIdx"] = serde_json::json!(999);
    let mut state = State {
        playing: true,
        draft: true,
        ..Default::default()
    };
    assert!(session.load(&broken.to_string(), &mut state).is_err());
    assert!(state.playing && state.draft);
    assert_eq!(session.document().to_json(), before);
}
