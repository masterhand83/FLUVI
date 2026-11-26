use ca_app::shell::Shell;
use ca_app::themes::{self, Theme};
use eframe::egui;

fn directory(label: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("fluvi-themes-{label}-{}", std::process::id()));
    std::fs::create_dir_all(&path).unwrap();
    path
}

const CUSTOM: &[u8] = br##"{
    "version":1, "id":"my-theme", "name":"My theme", "base":"light",
    "colors":{"background":"#123456","surface":"#234567","input":"#345678",
        "text":"#ABCDEF","accent":"#FEDCBA","selection":"#567890",
        "selection-text":"#FFFFFF","widget":"#456789","hover":"#678901","active":"#789012"}
}"##;

#[test]
fn exported_themes_can_be_imported_without_builtin_id_conflicts() {
    for theme in themes::builtins() {
        let exported = Theme::parse(&theme.export_bytes(true).unwrap()).unwrap();
        assert_eq!(exported.id, format!("custom-{}", theme.id));
        assert_eq!(exported.name, theme.name);
        assert_eq!(exported.visuals(false), theme.visuals(true));
    }
    let mut document: serde_json::Value = serde_json::from_slice(CUSTOM).unwrap();
    document["id"] = "x".repeat(64).into();
    let theme = Theme::parse(&serde_json::to_vec(&document).unwrap()).unwrap();
    assert!(Theme::parse(&theme.export_bytes(false).unwrap()).is_ok());
}

#[test]
fn bundled_themes_have_the_expected_palettes() {
    let themes = themes::builtins();
    assert_eq!(
        themes
            .iter()
            .map(|theme| theme.id.as_str())
            .collect::<Vec<_>>(),
        [
            "default",
            "monokai",
            "gruvbox",
            "retro",
            "nord",
            "dracula",
            "rose-pine"
        ]
    );
    for (id, background, text) in [
        ("monokai", [39, 40, 34], [248, 248, 242]),
        ("gruvbox", [40, 40, 40], [235, 219, 178]),
        ("retro", [0, 0, 0], [0, 255, 65]),
        ("nord", [46, 52, 64], [236, 239, 244]),
        ("dracula", [40, 42, 54], [248, 248, 242]),
        ("rose-pine", [25, 23, 36], [224, 222, 244]),
    ] {
        let visuals = themes
            .iter()
            .find(|theme| theme.id == id)
            .unwrap()
            .visuals(false);
        assert!(visuals.dark_mode);
        assert_eq!(visuals.panel_fill.to_array()[..3], background);
        assert_eq!(visuals.text_color().to_array()[..3], text);
        assert_eq!(
            visuals.widgets.hovered.fg_stroke.color.to_array()[..3],
            text
        );
    }
}

#[test]
fn custom_theme_styles_panels_dialogs_inputs_and_interaction_states() {
    let theme = Theme::parse(CUSTOM).unwrap();
    let v = theme.visuals(true); // A plugin's base is independent of the legacy switch.
    assert!(!v.dark_mode);
    assert_eq!(v.panel_fill, egui::Color32::from_rgb(0x12, 0x34, 0x56));
    assert_eq!(v.window_fill, egui::Color32::from_rgb(0x23, 0x45, 0x67));
    assert_eq!(
        v.text_edit_bg_color(),
        egui::Color32::from_rgb(0x34, 0x56, 0x78)
    );
    assert_eq!(v.text_color(), egui::Color32::from_rgb(0xAB, 0xCD, 0xEF));
    assert_eq!(v.hyperlink_color, egui::Color32::from_rgb(0xFE, 0xDC, 0xBA));
    assert_eq!(
        v.selection.bg_fill,
        egui::Color32::from_rgb(0x56, 0x78, 0x90)
    );
    assert_eq!(
        v.widgets.inactive.bg_fill,
        egui::Color32::from_rgb(0x45, 0x67, 0x89)
    );
    assert_eq!(
        v.widgets.hovered.bg_fill,
        egui::Color32::from_rgb(0x67, 0x89, 0x01)
    );
    assert_eq!(
        v.widgets.active.bg_fill,
        egui::Color32::from_rgb(0x78, 0x90, 0x12)
    );
}

#[test]
fn imported_theme_is_self_contained_and_survives_restart() {
    let directory = directory("restart");
    let plugin_dir = directory.join("themes");
    let path = directory.join("preferences.json");
    let theme = Theme::parse(CUSTOM).unwrap();
    themes::install(&theme, &plugin_dir, &themes::builtins()).unwrap();
    let mut shell = Shell::load(Some(path.clone()));
    assert_eq!(shell.themes().len(), 8);
    let mut prefs = shell.preferences().clone();
    prefs.theme = "my-theme".into();
    shell.set_preferences(prefs).unwrap();
    let restarted = Shell::load(Some(path));
    let ctx = egui::Context::default();
    restarted.apply_theme(&ctx);
    assert_eq!(restarted.preferences().theme, "my-theme");
    assert_eq!(
        ctx.style().visuals.panel_fill,
        egui::Color32::from_rgb(0x12, 0x34, 0x56)
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&theme.to_bytes().unwrap()).unwrap()["colors"]
            ["text"],
        "#ABCDEF"
    );
    assert!(themes::install(&theme, &plugin_dir, shell.themes()).is_err());
    assert_eq!(
        Theme::read(&plugin_dir.join("my-theme.json")).unwrap().name,
        "My theme"
    );
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn invalid_and_duplicate_plugins_do_not_replace_builtins() {
    let directory = directory("invalid");
    std::fs::write(directory.join("bad.json"), b"invalid").unwrap();
    std::fs::write(
        directory.join("override.json"),
        include_bytes!("../src/themes/nord.json"),
    )
    .unwrap();
    let (themes, warning) = themes::load_directory(&directory);
    assert!(warning);
    assert_eq!(themes.len(), 7);
    for (key, value) in [
        ("version", serde_json::json!(2)),
        ("id", serde_json::json!("../escape")),
        ("name", serde_json::json!("")),
        ("base", serde_json::json!("unknown")),
        ("colors", serde_json::json!({"text":"#GGFFFF"})),
        ("colors", serde_json::json!({"text":"#fff"})),
        ("colors", serde_json::json!({"typo":"#FFFFFF"})),
    ] {
        let mut document: serde_json::Value = serde_json::from_slice(CUSTOM).unwrap();
        document[key] = value;
        assert!(
            Theme::parse(&serde_json::to_vec(&document).unwrap()).is_err(),
            "{key}"
        );
    }
    assert!(Theme::parse(&vec![b' '; themes::MAX_BYTES as usize + 1]).is_err());
    let path = directory.join("preferences.json");
    std::fs::write(&path, br#"{"theme":"removed-theme","cell_detection":true}"#).unwrap();
    let shell = Shell::load(Some(path));
    assert_eq!(shell.preferences().theme, "default");
    assert!(shell.preferences().cell_detection);
    assert!(shell.notices().next().is_some());
    std::fs::remove_dir_all(directory).unwrap();
}

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
