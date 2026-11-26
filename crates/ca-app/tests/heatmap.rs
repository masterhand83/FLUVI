use ca_app::heatmap::{HeatmapDialog, HeatmapFrame};
use ca_core::map_json::MapDocument;
use eframe::egui;

#[test]
fn heatmap_widens_only_the_displayed_lanes_and_softens_diagonal_edges() {
    use ca_app::{graphics::ExportQuality, heatmap::render_offscreen_with_quality};
    let mut frame = HeatmapFrame::default();
    frame.tiles.push(ca_core::heatmap::Tile {
        center: [0., 0.],
        axis: [1., 0.],
        density: Some(0.),
        obstacle: false,
    });
    let image = render_offscreen_with_quality(&frame, [200, 200], ExportQuality::Balance);
    let background = egui::Color32::from_rgb(235, 239, 242);
    let green = egui::Color32::from_rgb(164, 210, 181);
    assert_eq!(image.pixels[0], background);
    let occupied: Vec<_> = image
        .pixels
        .iter()
        .enumerate()
        .filter(|(_, p)| **p == green)
        .map(|(i, _)| (i % image.size[0], i / image.size[0]))
        .collect();
    let width =
        occupied.iter().map(|p| p.0).max().unwrap() - occupied.iter().map(|p| p.0).min().unwrap();
    let height =
        occupied.iter().map(|p| p.1).max().unwrap() - occupied.iter().map(|p| p.1).min().unwrap();
    assert!(
        height as f32 > width as f32 * 1.4,
        "lane thickness, not cell length, must increase"
    );
    assert_eq!(frame.tiles[0].axis, [1., 0.]);
    frame.tiles[0].axis = [0.8, 0.6];
    let sharp = render_offscreen_with_quality(&frame, [90, 90], ExportQuality::Performance);
    assert!(sharp.pixels.iter().all(|p| *p == background || *p == green));
    let smooth = render_offscreen_with_quality(&frame, [90, 90], ExportQuality::Balance);
    assert!(
        smooth
            .pixels
            .iter()
            .any(|p| *p != background && *p != green),
        "antialiased edge pixels are required"
    );
    assert!(smooth.pixels.iter().all(|p| p.a() == 255));
}

#[test]
fn heat_colors_have_less_background_contrast_than_the_previous_palette() {
    fn luminance(rgb: [u8; 3]) -> f64 {
        let linear = rgb.map(|v| {
            let v = f64::from(v) / 255.;
            if v <= 0.04045 {
                v / 12.92
            } else {
                ((v + 0.055) / 1.055).powf(2.4)
            }
        });
        0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
    fn contrast(a: [u8; 3], b: [u8; 3]) -> f64 {
        let (a, b) = (luminance(a), luminance(b));
        (a.max(b) + 0.05) / (a.min(b) + 0.05)
    }
    let mut frame = HeatmapFrame::default();
    frame.tiles.push(ca_core::heatmap::Tile {
        center: [0., 0.],
        axis: [1., 0.],
        density: Some(0.),
        obstacle: false,
    });
    for (density, old) in [
        (0., [0, 220, 40]),
        (0.5, [255, 220, 40]),
        (1., [255, 0, 40]),
    ] {
        frame.tiles[0].density = Some(density);
        let exported = ca_app::heatmap::render_on_white(&frame, [60, 60]);
        let color = exported.pixels[exported.size[1] / 2 * exported.size[0] + exported.size[0] / 2];
        let rgb = [color.r(), color.g(), color.b()];
        assert!(
            contrast(rgb, [255; 3]) < contrast(old, [255; 3]),
            "export contrast at {density}"
        );
        assert!(
            contrast(rgb, [235, 239, 242]) < contrast(old, [18, 22, 28]),
            "preview contrast at {density}"
        );
    }
}

#[test]
fn thicker_heat_tiles_stay_visible_over_adjacent_empty_lanes() {
    let mut frame = HeatmapFrame::default();
    frame.tiles = vec![
        ca_core::heatmap::Tile {
            center: [0., 0.],
            axis: [1., 0.],
            density: Some(0.),
            obstacle: false,
        },
        ca_core::heatmap::Tile {
            center: [0., 1.],
            axis: [1., 0.],
            density: None,
            obstacle: false,
        },
    ];
    let image = ca_app::heatmap::render_offscreen(&frame, [200, 200]);
    assert_eq!(image.size, [114, 200]);
    // World (0, 0.5) lies in the shared display margin of the two physical lanes.
    assert_eq!(
        image.pixels[100 * 114 + 57],
        egui::Color32::from_rgb(164, 210, 181)
    );
    frame.tiles[1].obstacle = true;
    let obstacle = ca_app::heatmap::render_offscreen(&frame, [200, 200]);
    assert_eq!(
        obstacle.pixels[100 * 114 + 57],
        egui::Color32::from_rgb(155, 165, 176)
    );
    assert_eq!(
        obstacle.pixels[72 * 114 + 57],
        egui::Color32::from_rgb(164, 210, 181)
    );
}

#[test]
fn live_snapshots_reuse_storage_without_overwriting_the_displayed_frame() {
    use ca_core::cell_index::CellRef;
    let mut scene = ca_gpu::TrafficScene::from_document(&MapDocument::demo());
    let first = scene.heatmap_snapshot().unwrap();
    let storage = first.tiles.as_ptr();
    assert_eq!(first.tiles[5].density, Some(0.2));
    assert!(scene.toggle_vehicle(
        CellRef {
            street: 0,
            lane: 0,
            index: 5
        },
        true
    ));
    let second = scene.heatmap_snapshot().unwrap();
    assert_eq!(second.tiles[5].density, None);
    assert_eq!(first.tiles[5].density, Some(0.2));
    assert!(
        scene.heatmap_snapshot().is_none(),
        "a slow UI must not cause an allocation"
    );
    drop(first);
    let reused = scene.heatmap_snapshot().unwrap();
    assert_eq!(reused.tiles.as_ptr(), storage);
    assert_eq!(reused.tiles[5].density, None);
}

#[test]
fn image_colours_show_density_only_on_vehicles_and_neutral_obstacles() {
    use ca_core::{
        cell_index::StreetGeometry,
        traffic::{Calle, CalleConfig, CalleType},
    };
    let street = Calle::new(
        CalleConfig::new(1, 5, CalleType::Conexion),
        vec![1, 7, 2, 0, 0],
    )
    .unwrap();
    let frame = HeatmapFrame::from_geometry(
        &[street],
        &[StreetGeometry {
            id: 0,
            centers: vec![vec![
                [0.5, 0.5],
                [1.5, 0.5],
                [2.5, 0.5],
                [3.5, 0.5],
                [4.5, 0.5],
            ]],
        }],
        &[vec![vec![[1., 0.]; 5]]],
    );
    let image = ca_app::heatmap::render_offscreen(&frame, [120, 60]);
    assert_eq!(image.size, [120, 52]);
    assert_eq!(
        image.pixels[26 * 120 + 40],
        egui::Color32::from_rgb(155, 165, 176)
    );
    assert_eq!(
        image.pixels[26 * 120 + 60],
        egui::Color32::from_rgb(226, 224, 173)
    );
    assert_eq!(
        image.pixels[26 * 120 + 80],
        egui::Color32::from_rgb(198, 205, 211)
    );
}

#[test]
fn empty_and_tiny_exports_respect_both_size_limits() {
    for maximum in [
        [0, 0],
        [0, 20],
        [1, 1],
        [1, 50],
        [50, 1],
        [80, 60],
        [25, 90],
    ] {
        for frame in [
            HeatmapFrame::default(),
            HeatmapFrame::from_document(&MapDocument::demo()),
        ] {
            let image = ca_app::heatmap::render_offscreen(&frame, maximum);
            assert!(image.size[0] <= maximum[0] && image.size[1] <= maximum[1]);
            assert_eq!(image.pixels.len(), image.size[0] * image.size[1]);
        }
    }
}

#[test]
fn unselected_streets_remain_visible_and_offscreen_render_preserves_the_dialog() {
    let document = MapDocument::demo();
    let mut scene = ca_gpu::TrafficScene::from_document(&document);
    scene.set_metric_streets(vec![false; document.layout().len()]);
    let frame = scene.heatmap_snapshot().unwrap();
    assert_eq!(frame.street_count(), document.layout().len());
    assert_eq!(frame.tiles.len(), 192, "three two-lane, 32-cell streets");
    // Each unselected street retains its occupied and neutral physical cells.
    for tiles in frame.tiles.as_chunks::<64>().0 {
        assert!(tiles.iter().any(|tile| tile.density.is_some()));
        assert!(tiles.iter().any(|tile| tile.obstacle));
    }
    let mut dialog = HeatmapDialog::default();
    dialog.open();
    dialog.receive(frame);
    let ctx = egui::Context::default();
    let shell = ca_app::shell::Shell::load(None);
    let _ = ctx.run(Default::default(), |ctx| dialog.show(ctx, &shell));
    let before = dialog.render_offscreen([640, 480]);
    let thumbnail = dialog.render_offscreen([80, 60]);
    assert!(thumbnail.size[0] <= 80 && thumbnail.size[1] <= 60);
    assert!(
        thumbnail
            .pixels
            .iter()
            .any(|c| *c != egui::Color32::from_rgb(235, 239, 242))
    );
    assert!(dialog.render_offscreen([640, 480]) == before);
    assert!(dialog.is_open());
    // Export does not replace the dialog texture.
    let output = ctx.run(Default::default(), |ctx| dialog.show(ctx, &shell));
    assert!(output.textures_delta.set.is_empty());
}

#[test]
fn quality_changes_refresh_the_open_heatmap_without_a_new_snapshot() {
    use ca_app::{
        graphics::ExportQuality,
        shell::{Preferences, Shell},
    };
    let path =
        std::env::temp_dir().join(format!("fluvi-heatmap-quality-{}.json", std::process::id()));
    Preferences::default().save(&path).unwrap();
    let mut shell = Shell::load(Some(path.clone()));
    let frame = std::sync::Arc::new(HeatmapFrame::from_document(&MapDocument::demo()));
    let original_density = frame.tiles[5].density;
    let mut dialog = HeatmapDialog::default();
    dialog.open();
    dialog.receive(frame.clone());
    let ctx = egui::Context::default();
    for (quality, width) in [
        (ExportQuality::Performance, 960),
        (ExportQuality::Balance, 1440),
        (ExportQuality::Quality, 1920),
        (ExportQuality::Ultraquality, 2400),
    ] {
        let mut prefs = shell.preferences().clone();
        prefs.export_quality = quality;
        shell.set_preferences(prefs).unwrap();
        let output = ctx.run(Default::default(), |ctx| dialog.show(ctx, &shell));
        let (_, delta) = output
            .textures_delta
            .set
            .iter()
            .find(|(_, delta)| delta.image.size()[0] == width)
            .unwrap_or_else(|| panic!("missing {width}-pixel backing image"));
        assert_eq!(delta.options.magnification, egui::TextureFilter::Linear);
        assert_eq!(delta.options.minification, egui::TextureFilter::Linear);
        let unchanged = ctx.run(Default::default(), |ctx| dialog.show(ctx, &shell));
        assert!(unchanged.textures_delta.set.is_empty());
    }
    assert_eq!(frame.tiles[5].density, original_density);
    std::fs::remove_file(path).unwrap();
}
