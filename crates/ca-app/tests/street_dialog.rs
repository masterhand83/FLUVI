use ca_app::{shell::Shell, street_dialog::StreetDialog};
use ca_core::{map_json::MapDocument, streets::StreetEdit};
use eframe::egui;

#[test]
fn new_street_form_emits_a_valid_creation_and_cancel_emits_nothing() {
    let ctx = egui::Context::default();
    let mut dialog = StreetDialog::default();
    dialog.open();
    let document = MapDocument::empty();
    let mut run = |events| {
        let mut edit = None;
        let output = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1000.0, 900.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                edit = dialog.show(ctx, &document, &Shell::load(None));
            },
        );
        (output, edit)
    };
    run(vec![]);
    let output = run(vec![]).0;
    let pos = output
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            egui::Shape::Text(s) if s.galley.job.text == "Crear calle" => {
                Some(s.visual_bounding_rect().center())
            }
            _ => None,
        })
        .expect("create button");
    let mut created = None;
    for pressed in [true, false] {
        created = run(vec![
            egui::Event::PointerMoved(pos),
            egui::Event::PointerButton {
                pos,
                pressed,
                button: egui::PointerButton::Primary,
                modifiers: egui::Modifiers::NONE,
            },
        ])
        .1
        .or(created);
    }
    assert!(matches!(created, Some(StreetEdit::Create(_))));
    document.validate_street_edit(&created.unwrap()).unwrap();
    let cancel = run(vec![egui::Event::Key {
        key: egui::Key::Escape,
        physical_key: None,
        pressed: true,
        repeat: false,
        modifiers: egui::Modifiers::NONE,
    }])
    .1;
    assert!(cancel.is_none());
    assert!(!dialog.is_open());
}
