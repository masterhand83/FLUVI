use ca_app::heatmap::{HeatmapDialog, HeatmapFrame};
use ca_core::map_json::MapDocument;
use eframe::egui;

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
    let image = ca_app::heatmap::render_offscreen(&frame, [60, 20]);
    assert_eq!(image.size, [60, 20]);
    assert_eq!(image.pixels[10 * 60 + 20], egui::Color32::from_gray(145));
    assert_eq!(
        image.pixels[10 * 60 + 30],
        egui::Color32::from_rgb(204, 220, 40)
    );
    assert_eq!(image.pixels[10 * 60 + 40], egui::Color32::from_gray(55));
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
            .any(|c| *c != egui::Color32::from_rgb(18, 22, 28))
    );
    assert!(dialog.render_offscreen([640, 480]) == before);
    assert!(dialog.is_open());
    // Export does not replace the dialog texture.
    let output = ctx.run(Default::default(), |ctx| dialog.show(ctx, &shell));
    assert!(output.textures_delta.set.is_empty());
}
