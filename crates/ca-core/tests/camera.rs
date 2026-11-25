use ca_core::camera::Camera;

#[test]
fn zoom_preserves_cursor_world_point_and_transform_round_trips() {
    let mut camera = Camera::fit([36.0, 14.0], [720.0, 280.0]);
    assert_eq!(camera.screen_to_world([150.0, 70.0]), [7.5, 3.5]);
    camera.zoom_at([150.0, 70.0], 2.0);
    assert_eq!(camera.screen_to_world([150.0, 70.0]), [7.5, 3.5]);
    assert_eq!(camera.world_to_screen([7.5, 3.5]), [150.0, 70.0]);
    assert_eq!(camera.view().span, [18.0, 7.0]);
}

#[test]
fn pan_zoom_and_resize_keep_part_of_map_visible() {
    let mut camera = Camera::fit([36.0, 14.0], [720.0, 280.0]);
    for delta in [[1e6, -1e6], [-1e6, 1e6]] {
        camera.pan(delta);
        for factor in [1e6, 1e-6] {
            camera.zoom_at([360.0, 140.0], factor);
            camera.resize([500.0, 500.0]);
            let view = camera.view();
            for (axis, extent) in [36.0, 14.0].into_iter().enumerate() {
                assert!(view.origin[axis] < extent);
                assert!(view.origin[axis] + view.span[axis] > 0.0);
            }
        }
    }
}
