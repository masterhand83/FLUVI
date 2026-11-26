use super::Language;
use crate::graphics::ExportQuality;
use serde_json::{Value, json};
use std::{
    io,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Preferences {
    pub language: Language,
    pub sidebar_visible: bool,
    pub panels_open: [bool; 7],
    pub cell_detection: bool,
    pub dark_mode: bool,
    pub export_quality: ExportQuality,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            language: Language::Spanish,
            sidebar_visible: true,
            panels_open: [true, false, false, false, false, false, false],
            cell_detection: false,
            dark_mode: false,
            export_quality: ExportQuality::Balance,
        }
    }
}

impl Preferences {
    /// Missing files are normal. Invalid fields fall back independently.
    pub fn load(path: &Path) -> (Self, bool) {
        let defaults = Self::default();
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) => return (defaults, error.kind() != io::ErrorKind::NotFound),
        };
        let Ok(Value::Object(object)) = serde_json::from_slice::<Value>(&bytes) else {
            return (defaults, true);
        };
        let mut prefs = defaults;
        let mut warning = false;
        if let Some(value) = object.get("export_quality") {
            if let Some(quality) = value.as_str().and_then(ExportQuality::from_code) {
                prefs.export_quality = quality;
            } else {
                warning = true;
            }
        }
        if let Some(value) = object.get("language") {
            match value.as_str() {
                Some("es") => prefs.language = Language::Spanish,
                Some("en") => prefs.language = Language::English,
                _ => warning = true,
            }
        }
        for (key, target) in [
            ("sidebar_visible", &mut prefs.sidebar_visible),
            ("cell_detection", &mut prefs.cell_detection),
            ("dark_mode", &mut prefs.dark_mode),
        ] {
            if let Some(value) = object.get(key) {
                if let Some(value) = value.as_bool() {
                    *target = value;
                } else {
                    warning = true;
                }
            }
        }
        if let Some(value) = object.get("panels_open") {
            if let Some(values) = value.as_array().filter(|values| values.len() == 7) {
                for (target, value) in prefs.panels_open.iter_mut().zip(values) {
                    if let Some(value) = value.as_bool() {
                        *target = value;
                    } else {
                        warning = true;
                    }
                }
            } else {
                warning = true;
            }
        }
        (prefs, warning)
    }

    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let value = json!({
            "language": self.language.code(),
            "sidebar_visible": self.sidebar_visible,
            "panels_open": self.panels_open,
            "cell_detection": self.cell_detection,
            "dark_mode": self.dark_mode,
            "export_quality": self.export_quality.code(),
        });
        // Write beside the destination, then replace it. A partial write never
        // destroys the last valid preferences file.
        let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
        std::fs::write(&temporary, serde_json::to_vec_pretty(&value)?)?;
        std::fs::rename(temporary, path)
    }
}

pub fn config_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Application Support"));
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")));
    base.map(|base| base.join("fluvi").join("preferences.json"))
}
