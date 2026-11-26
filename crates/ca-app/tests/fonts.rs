use ca_app::shell::Preferences;

#[test]
fn font_choices_survive_restart_and_invalid_fields_fall_back_independently() {
    let path = std::env::temp_dir().join(format!("fluvi-font-prefs-{}.json", std::process::id()));
    let prefs = Preferences {
        ui_font: "DejaVu Sans".into(),
        label_font: "Liberation Serif".into(),
        ..Default::default()
    };
    prefs.save(&path).unwrap();
    let (loaded, warning) = Preferences::load(&path);
    assert!(!warning);
    assert_eq!(loaded.ui_font, "DejaVu Sans");
    assert_eq!(loaded.label_font, "Liberation Serif");

    std::fs::write(&path, r#"{"ui_font":42,"label_font":"DejaVu Serif"}"#).unwrap();
    let (loaded, warning) = Preferences::load(&path);
    assert!(warning);
    assert_eq!(loaded.ui_font, "");
    assert_eq!(loaded.label_font, "DejaVu Serif");

    std::fs::write(&path, r#"{"label_font":"bad\nfont"}"#).unwrap();
    let (loaded, warning) = Preferences::load(&path);
    assert!(warning);
    assert_eq!(loaded.label_font, "");

    std::fs::write(&path, "{}").unwrap();
    let (loaded, warning) = Preferences::load(&path);
    assert!(!warning);
    assert_eq!(loaded.ui_font, "");
    assert_eq!(loaded.label_font, "");
    std::fs::remove_file(path).unwrap();
}
