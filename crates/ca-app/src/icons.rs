//! Remix icons are images, not font glyphs. All UI features share this adapter.
use eframe::egui;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Icon {
    Expand,
    Collapse,
    About,
    Tools,
    Constructor,
    Streets,
    Scenarios,
    Metrics,
    Customization,
    Settings,
    Information,
    Guide,
    CellDetection,
    DarkMode,
}

impl Icon {
    pub const ALL: [Self; 14] = [
        Self::Expand,
        Self::Collapse,
        Self::About,
        Self::Tools,
        Self::Constructor,
        Self::Streets,
        Self::Scenarios,
        Self::Metrics,
        Self::Customization,
        Self::Settings,
        Self::Information,
        Self::Guide,
        Self::CellDetection,
        Self::DarkMode,
    ];

    fn data(self) -> icondata_core::Icon {
        use icondata_ri::*;
        match self {
            Self::Expand => RiArrowRightSArrowsLine,
            Self::Collapse => RiArrowDownSArrowsLine,
            Self::About => RiInformationSystemLine,
            Self::Tools => RiToolsDesignLine,
            Self::Constructor => RiRoadMapMapLine,
            Self::Streets => RiSettings3SystemLine,
            Self::Scenarios => RiMovieMediaLine,
            Self::Metrics => RiBarChartBusinessLine,
            Self::Customization => RiPaletteDesignLine,
            Self::Settings => RiSettings3SystemLine,
            Self::Information => RiBookOpenDocumentLine,
            Self::Guide => RiBookReadDocumentLine,
            Self::CellDetection => RiGridDesignLine,
            Self::DarkMode => RiMoonWeatherLine,
        }
    }

    pub fn section(section: &str) -> Option<Self> {
        match section {
            "about" => Some(Self::About),
            "tools" => Some(Self::Tools),
            "constructor" => Some(Self::Constructor),
            "streetSettings" => Some(Self::Streets),
            "scenarios" => Some(Self::Scenarios),
            "metrics" => Some(Self::Metrics),
            "customization" => Some(Self::Customization),
            _ => None,
        }
    }

    /// Rasterize trusted bundled paths once. White pixels are tinted at paint time.
    /// A fixed 4x backing size stays sharp across normal desktop display scales.
    pub fn rasterize(self) -> egui::ColorImage {
        let data = self.data();
        let svg = format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="{}" fill="white" color="white">{}</svg>"##,
            data.view_box.unwrap_or("0 0 24 24"),
            data.data,
        );
        let tree = resvg::usvg::Tree::from_str(&svg, &resvg::usvg::Options::default())
            .expect("valid bundled Remix icon");
        let mut pixmap = resvg::tiny_skia::Pixmap::new(64, 64).expect("small icon image");
        resvg::render(
            &tree,
            resvg::tiny_skia::Transform::from_scale(64.0 / 24.0, 64.0 / 24.0),
            &mut pixmap.as_mut(),
        );
        egui::ColorImage::new(
            [64, 64],
            pixmap
                .data()
                .as_chunks::<4>()
                .0
                .iter()
                .map(|pixel| {
                    egui::Color32::from_rgba_premultiplied(pixel[0], pixel[1], pixel[2], pixel[3])
                })
                .collect(),
        )
    }

    pub fn image(self, ctx: &egui::Context) -> egui::Image<'static> {
        let cache_id = egui::Id::new("remix-icons");
        let cached = ctx.data_mut(|data| {
            data.get_temp_mut_or_default::<IconTextures>(cache_id)
                .0
                .get(&self)
                .cloned()
        });
        let texture = cached.unwrap_or_else(|| {
            // load_texture also locks the context. Never call it inside data_mut.
            let texture = ctx.load_texture(
                format!("remix-{self:?}"),
                self.rasterize(),
                egui::TextureOptions::LINEAR,
            );
            ctx.data_mut(|data| {
                data.get_temp_mut_or_default::<IconTextures>(cache_id)
                    .0
                    .insert(self, texture.clone());
            });
            texture
        });
        egui::Image::new((texture.id(), egui::vec2(16., 16.)))
    }
}

#[derive(Clone, Default)]
struct IconTextures(HashMap<Icon, egui::TextureHandle>);

pub fn button(ui: &mut egui::Ui, icon: Icon, text: impl Into<egui::WidgetText>) -> egui::Response {
    ui.add(
        egui::Button::image_and_text(icon.image(ui.ctx()), text)
            .image_tint_follows_text_color(true),
    )
}

pub fn section_button(ui: &mut egui::Ui, icon: Icon, open: bool, text: String) -> egui::Response {
    let arrow = if open { Icon::Collapse } else { Icon::Expand };
    ui.add(
        egui::Button::new((arrow.image(ui.ctx()), icon.image(ui.ctx()), text))
            .image_tint_follows_text_color(true),
    )
}

pub fn heading(ui: &mut egui::Ui, icon: Icon, text: String) {
    ui.horizontal(|ui| {
        ui.add(icon.image(ui.ctx()).tint(ui.visuals().text_color()));
        ui.heading(text);
    });
}

pub fn checkbox(ui: &mut egui::Ui, icon: Icon, value: &mut bool, text: String) -> egui::Response {
    ui.horizontal(|ui| {
        ui.add(icon.image(ui.ctx()).tint(ui.visuals().text_color()));
        ui.checkbox(value, text)
    })
    .inner
}
