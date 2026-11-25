use ca_app::shell::{Language, Translator};
use ca_app::time::{TimeDraft, display_clock};
use ca_core::virtual_time::Clock;

#[test]
fn scenario_time_validates_without_changing_live_time_and_localizes_preview_only() {
    let clock = Clock::new(3, 14, 35, 42).unwrap();
    let mut draft = TimeDraft::new(clock);
    let es = Translator::new(Language::Spanish);
    let en = Translator::new(Language::English);
    assert_eq!(display_clock(clock, &es), "Miércoles 14:35:42");
    assert_eq!(display_clock(clock, &en), "Wednesday 14:35:42");
    assert_eq!(clock.export_timestamp(), "Miércoles 14:35:42");
    draft.hour = "24".into();
    assert!(draft.candidate().is_none());
    draft.hour = "0".into();
    assert_eq!(draft.candidate().unwrap().parts(), [3, 0, 35, 42]);
}

#[test]
fn profile_draft_keeps_dot_decimals_and_restores_only_selected_days() {
    use ca_app::time::{Preset, ProfileDraft, Scope};
    use ca_core::virtual_time::VirtualTime;
    let live = VirtualTime::default();
    let mut draft = ProfileDraft::new(&live);
    draft.values[0][0] = "0,5".into();
    assert!(draft.candidate().is_none());
    draft.values[0][0] = "0.0".into();
    assert_eq!(draft.candidate().unwrap().profiles()[0][0], 0.0);
    draft.day = 0;
    draft.preset(Preset::Constant);
    draft.copy_to_all();
    draft.restore(Scope::Selected);
    let saved = draft.candidate().unwrap();
    assert_eq!(saved.profiles()[0][0], 0.0);
    assert_eq!(saved.profiles()[1], [1.0; 24]);
    draft.restore(Scope::Weekdays);
    assert_eq!(draft.candidate().unwrap().profiles()[1][7], 1.2);
    assert_eq!(draft.candidate().unwrap().profiles()[6], [1.0; 24]);
    draft.restore(Scope::All);
    assert_eq!(draft.candidate().unwrap(), live);
    draft.preset(Preset::Workday);
    assert_eq!(draft.candidate().unwrap().profiles()[0][18], 1.7);
    draft.preset(Preset::Night);
    assert_eq!(draft.candidate().unwrap().profiles()[0][0], 1.5);
    draft.preset(Preset::Weekend);
    assert_eq!(draft.candidate().unwrap().profiles()[0][0], 0.3);
}

#[test]
fn dialog_retains_an_unaccepted_apply_then_escape_or_street_session_discards_it() {
    use ca_app::{
        shell::Shell,
        time::{TimeAction, TimeDialogs},
    };
    use eframe::egui;
    let ctx = egui::Context::default();
    let shell = Shell::load(None);
    let mut dialogs = TimeDialogs::default();
    dialogs.open_time(Clock::new(0, 0, 0, 0).unwrap());
    let frame = |dialogs: &mut TimeDialogs, events, blocked| {
        let mut action = None;
        let output = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1200.0, 900.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                action = dialogs.show(ctx, &shell, blocked);
            },
        );
        (output, action)
    };
    frame(&mut dialogs, vec![], false);
    let output = frame(&mut dialogs, vec![], false).0;
    let pos = output
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            egui::Shape::Text(s) if s.galley.job.text == "Aplicar" => {
                Some(s.visual_bounding_rect().center())
            }
            _ => None,
        })
        .expect("apply button");
    let mut action = None;
    for pressed in [true, false] {
        action = frame(
            &mut dialogs,
            vec![
                egui::Event::PointerMoved(pos),
                egui::Event::PointerButton {
                    pos,
                    pressed,
                    button: egui::PointerButton::Primary,
                    modifiers: egui::Modifiers::NONE,
                },
            ],
            false,
        )
        .1
        .or(action);
    }
    assert!(matches!(action, Some(TimeAction::Scenario(clock)) if clock.parts() == [0,0,0,0]));
    assert!(
        dialogs.is_open(),
        "a rejected command has not acknowledged Apply"
    );
    let (_, action) = frame(
        &mut dialogs,
        vec![egui::Event::Key {
            key: egui::Key::Escape,
            physical_key: None,
            pressed: true,
            repeat: false,
            modifiers: egui::Modifiers::NONE,
        }],
        false,
    );
    assert!(action.is_none());
    assert!(!dialogs.is_open());
    dialogs.open_time(Clock::default());
    assert!(frame(&mut dialogs, vec![], true).1.is_none());
    assert!(
        !dialogs.is_open(),
        "a street edit must not restore traffic after a time reset"
    );
}
