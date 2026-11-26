use ca_app::icons::{self, Icon};
use eframe::egui;

#[test]
fn every_remix_icon_has_visible_ink_and_a_transparent_background() {
    for icon in Icon::ALL {
        let image = icon.rasterize();
        assert_eq!(image.size, [64, 64]);
        assert!(image.pixels.iter().any(|pixel| pixel.a() > 200), "{icon:?}");
        assert!(image.pixels.iter().any(|pixel| pixel.a() == 0), "{icon:?}");
        for pixel in image.pixels {
            // A white alpha mask takes the exact UI tint, without a white square.
            assert_eq!(pixel.r(), pixel.a(), "{icon:?}");
            assert_eq!(pixel.g(), pixel.a(), "{icon:?}");
            assert_eq!(pixel.b(), pixel.a(), "{icon:?}");
        }
    }
}

#[test]
fn icon_textures_are_cached_per_context_not_uploaded_each_frame() {
    let ctx = egui::Context::default();
    let frame = || {
        ctx.run(Default::default(), |ctx| {
            for icon in Icon::ALL {
                let _ = icon.image(ctx);
            }
        })
    };
    let first = frame();
    assert!(first.textures_delta.set.len() >= Icon::ALL.len());
    let second = frame();
    assert!(second.textures_delta.set.is_empty());
}

#[test]
fn remix_buttons_follow_each_theme_text_color() {
    for theme in ca_app::themes::builtins() {
        let ctx = egui::Context::default();
        let visuals = theme.visuals(false);
        let expected = visuals.widgets.inactive.fg_stroke.color;
        ctx.set_visuals(visuals);
        let mut output = None;
        for _ in 0..2 {
            output = Some(ctx.run(Default::default(), |ctx| {
                egui::CentralPanel::default().show(ctx, |ui| {
                    icons::button(ui, Icon::Customization, "Customization");
                });
            }));
        }
        let output = output.unwrap();
        let primitives = ctx.tessellate(output.shapes, output.pixels_per_point);
        let image = primitives
            .iter()
            .find_map(|primitive| match &primitive.primitive {
                egui::epaint::Primitive::Mesh(mesh)
                    if mesh.texture_id != egui::TextureId::default() =>
                {
                    Some(mesh)
                }
                _ => None,
            })
            .expect("icon image mesh");
        assert!(
            image.vertices.iter().any(|vertex| vertex.color == expected),
            "{}",
            theme.id
        );
        // The tessellator also adds fully transparent anti-aliasing vertices.
        assert!(
            image
                .vertices
                .iter()
                .filter(|vertex| vertex.color.a() > 0)
                .all(|vertex| vertex.color == expected),
            "{}",
            theme.id
        );
    }
}
