use ca_app::shell::Shell;
use eframe::egui;

#[test]
fn saved_theme_applies_before_any_ui_and_can_switch_back() {
    let path = std::env::temp_dir().join(format!("fluvi-theme-{}.json", std::process::id()));
    let mut shell = Shell::load(Some(path.clone()));
    let mut prefs = shell.preferences().clone();
    prefs.dark_mode = true;
    shell.set_preferences(prefs).unwrap();
    let mut restarted = Shell::load(Some(path.clone()));
    let ctx = egui::Context::default();
    ctx.set_visuals(egui::Visuals::light());
    restarted.apply_theme(&ctx);
    assert!(ctx.style().visuals.dark_mode);
    assert_eq!(
        ctx.style().visuals.extreme_bg_color,
        egui::Color32::from_gray(10)
    );
    let mut prefs = restarted.preferences().clone();
    prefs.dark_mode = false;
    restarted.set_preferences(prefs).unwrap();
    restarted.apply_theme(&ctx);
    assert!(!ctx.style().visuals.dark_mode);
    assert_eq!(
        ctx.style().visuals.extreme_bg_color,
        egui::Color32::from_gray(255)
    );
    std::fs::remove_file(path).unwrap();
}
