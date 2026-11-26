use ca_app::{
    graphics::ExportQuality,
    metric_exports::{ExportDialog, ImageOptions},
    shell::{Language, Shell},
};
use eframe::egui;

fn frame(
    ctx: &egui::Context,
    dialog: &mut ExportDialog,
    events: Vec<egui::Event>,
) -> (egui::FullOutput, Option<ImageOptions>) {
    let mut result = None;
    let output = ctx.run(
        egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1000., 800.),
            )),
            events,
            ..Default::default()
        },
        |ctx| {
            result = dialog.show(ctx, &Shell::load(None));
        },
    );
    (output, result)
}

fn click(ctx: &egui::Context, dialog: &mut ExportDialog, label: &str) -> Option<ImageOptions> {
    frame(ctx, dialog, vec![]);
    let (output, result) = frame(ctx, dialog, vec![]);
    assert!(result.is_none(), "nothing exports before confirmation");
    let pos = output
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            egui::Shape::Text(text) if text.galley.job.text == label => {
                Some(text.pos + text.galley.size() * 0.5)
            }
            _ => None,
        })
        .unwrap_or_else(|| panic!("missing {label}"));
    let mut result = None;
    for pressed in [true, false] {
        result = frame(
            ctx,
            dialog,
            vec![
                egui::Event::PointerMoved(pos),
                egui::Event::PointerButton {
                    pos,
                    button: egui::PointerButton::Primary,
                    pressed,
                    modifiers: egui::Modifiers::NONE,
                },
            ],
        )
        .1
        .or(result);
    }
    result
}

#[test]
fn export_waits_for_language_confirmation_and_cancel_discards_the_draft() {
    let ctx = egui::Context::default();
    let mut dialog = ExportDialog::default();
    let options = ImageOptions {
        language: Language::English,
        quality: ExportQuality::Ultraquality,
    };
    dialog.open(options);
    assert!(dialog.is_open());
    assert!(click(&ctx, &mut dialog, "Español").is_none());
    assert!(click(&ctx, &mut dialog, "Cancelar").is_none());
    assert!(!dialog.is_open());
    dialog.open(options);
    let selected = click(&ctx, &mut dialog, "Exportar").unwrap();
    assert_eq!(
        selected.language,
        Language::English,
        "cancel must discard the previous Spanish draft"
    );
    assert_eq!(selected.quality, ExportQuality::Ultraquality);
    assert!(!dialog.is_open());
    dialog.open(options);
    assert!(click(&ctx, &mut dialog, "Español").is_none());
    assert_eq!(
        click(&ctx, &mut dialog, "Exportar").unwrap().language,
        Language::Spanish
    );
}

#[test]
fn escape_closes_the_language_modal_without_exporting() {
    let ctx = egui::Context::default();
    let mut dialog = ExportDialog::default();
    dialog.open(ImageOptions::default());
    frame(&ctx, &mut dialog, vec![]);
    let (_, result) = frame(
        &ctx,
        &mut dialog,
        vec![egui::Event::Key {
            key: egui::Key::Escape,
            physical_key: None,
            pressed: true,
            repeat: false,
            modifiers: egui::Modifiers::NONE,
        }],
    );
    assert!(result.is_none());
    assert!(!dialog.is_open());
}
