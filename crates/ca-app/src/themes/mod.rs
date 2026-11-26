//! Portable, data-only UI themes. No simulation or map types belong here.
use eframe::egui::{self, Color32, Stroke};
use serde_json::Value;
use std::{collections::BTreeMap, io, io::Read, path::Path};

pub const MAX_BYTES: u64 = 64 * 1024;

#[derive(Clone, Debug)]
pub struct Theme {
    pub id: String,
    pub name: String,
    dark: bool,
    colors: BTreeMap<String, Color32>,
    document: Value,
}

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

impl Theme {
    pub fn parse(bytes: &[u8]) -> io::Result<Self> {
        if bytes.len() as u64 > MAX_BYTES {
            return Err(invalid("Theme exceeds 64 KiB"));
        }
        let document: Value = serde_json::from_slice(bytes)?;
        if document["version"].as_u64() != Some(1) {
            return Err(invalid("Unsupported theme version"));
        }
        let id = document["id"]
            .as_str()
            .ok_or_else(|| invalid("Missing theme id"))?;
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        {
            return Err(invalid(
                "Theme id must use 1–64 lowercase letters, digits or hyphens",
            ));
        }
        let name = document["name"]
            .as_str()
            .ok_or_else(|| invalid("Missing theme name"))?;
        if name.trim().is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control)
        {
            return Err(invalid("Invalid theme name"));
        }
        let dark = match document["base"].as_str() {
            Some("dark") => true,
            Some("light") => false,
            _ => return Err(invalid("Theme base must be light or dark")),
        };
        let palette = document["colors"]
            .as_object()
            .ok_or_else(|| invalid("Missing theme colors"))?;
        let mut colors = BTreeMap::new();
        for (key, value) in palette {
            if ![
                "background",
                "surface",
                "input",
                "text",
                "muted",
                "border",
                "widget",
                "hover",
                "active",
                "accent",
                "selection",
                "selection-text",
                "warning",
                "error",
            ]
            .contains(&key.as_str())
            {
                return Err(invalid(format!("Unknown theme color: {key}")));
            }
            let hex = value
                .as_str()
                .ok_or_else(|| invalid("Colors must use #RRGGBB"))?;
            if hex.len() != 7
                || !hex.starts_with('#')
                || !hex[1..].bytes().all(|c| c.is_ascii_hexdigit())
            {
                return Err(invalid(format!("Invalid color: {key}")));
            }
            let rgb = u32::from_str_radix(&hex[1..], 16).map_err(|_| invalid("Invalid color"))?;
            colors.insert(
                key.clone(),
                Color32::from_rgb((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8),
            );
        }
        Ok(Self {
            id: id.into(),
            name: name.into(),
            dark,
            colors,
            document,
        })
    }

    pub fn read(path: &Path) -> io::Result<Self> {
        let mut bytes = Vec::new();
        std::fs::File::open(path)?
            .take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)?;
        Self::parse(&bytes)
    }

    pub fn to_bytes(&self) -> io::Result<Vec<u8>> {
        Ok(serde_json::to_vec_pretty(&self.document)?)
    }

    /// A portable editable copy, including the active Default light/dark choice.
    pub fn export_bytes(&self, default_dark: bool) -> io::Result<Vec<u8>> {
        let mut document = self.document.clone();
        // Leave room for the prefix within the 64-byte identifier limit.
        document["id"] = format!("custom-{}", &self.id[..self.id.len().min(57)]).into();
        if self.id == "default" && default_dark {
            document["base"] = "dark".into();
        }
        Ok(serde_json::to_vec_pretty(&document)?)
    }

    pub fn visuals(&self, default_dark: bool) -> egui::Visuals {
        let dark = if self.id == "default" {
            default_dark
        } else {
            self.dark
        };
        let mut v = if dark {
            egui::Visuals::dark()
        } else {
            egui::Visuals::light()
        };
        let color = |key: &str, fallback| self.colors.get(key).copied().unwrap_or(fallback);
        v.panel_fill = color("background", v.panel_fill);
        v.window_fill = color("surface", v.window_fill);
        v.extreme_bg_color = color("input", v.extreme_bg_color);
        v.text_edit_bg_color = Some(v.extreme_bg_color);
        v.faint_bg_color = color("surface", v.faint_bg_color);
        v.code_bg_color = color("input", v.code_bg_color);
        v.weak_text_color = Some(color("muted", v.weak_text_color()));
        v.hyperlink_color = color("accent", v.hyperlink_color);
        v.warn_fg_color = color("warning", v.warn_fg_color);
        v.error_fg_color = color("error", v.error_fg_color);
        v.window_stroke.color = color("border", v.window_stroke.color);
        v.selection.bg_fill = color("selection", v.selection.bg_fill);
        v.selection.stroke.color = color("selection-text", v.selection.stroke.color);
        v.text_cursor.stroke.color = color("accent", v.text_cursor.stroke.color);
        for (widget, fill) in [
            (&mut v.widgets.noninteractive, "surface"),
            (&mut v.widgets.inactive, "widget"),
            (&mut v.widgets.hovered, "hover"),
            (&mut v.widgets.active, "active"),
            (&mut v.widgets.open, "hover"),
        ] {
            widget.bg_fill = color(fill, widget.bg_fill);
            widget.weak_bg_fill = color(fill, widget.weak_bg_fill);
            widget.bg_stroke.color = color("border", widget.bg_stroke.color);
            widget.fg_stroke.color = color("text", widget.fg_stroke.color);
        }
        if let Some(accent) = self.colors.get("accent") {
            v.widgets.hovered.bg_stroke = Stroke::new(1_f32, *accent);
            v.widgets.active.bg_stroke = Stroke::new(1_f32, *accent);
        }
        v
    }
}

pub fn builtins() -> Vec<Theme> {
    [
        include_str!("default.json"),
        include_str!("monokai.json"),
        include_str!("gruvbox.json"),
        include_str!("retro.json"),
        include_str!("nord.json"),
        include_str!("dracula.json"),
        include_str!("rose-pine.json"),
    ]
    .into_iter()
    .map(|json| Theme::parse(json.as_bytes()).expect("valid bundled theme"))
    .collect()
}

/// Custom files cannot replace built-ins or each other by identifier.
pub fn load_directory(directory: &Path) -> (Vec<Theme>, bool) {
    let mut themes = builtins();
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) => return (themes, error.kind() != io::ErrorKind::NotFound),
    };
    let mut warning = false;
    let mut paths: Vec<_> = entries
        .filter_map(|entry| match entry {
            Ok(entry) => Some(entry),
            Err(_) => {
                warning = true;
                None
            }
        })
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    paths.sort();
    for path in paths {
        match Theme::read(&path) {
            Ok(theme) if !themes.iter().any(|existing| existing.id == theme.id) => {
                themes.push(theme)
            }
            _ => warning = true,
        }
    }
    (themes, warning)
}

/// Use create_new so a failed or duplicate import cannot destroy an existing theme.
pub fn install(theme: &Theme, directory: &Path, existing: &[Theme]) -> io::Result<()> {
    use io::Write;
    if existing.iter().any(|entry| entry.id == theme.id) {
        return Err(invalid("Theme id already exists; choose a new id"));
    }
    std::fs::create_dir_all(directory)?;
    let path = directory.join(format!("{}.json", theme.id));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;
    if let Err(error) = file.write_all(&theme.to_bytes()?) {
        let _ = std::fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}
