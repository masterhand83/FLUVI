//! Shared world/screen transform. Screen coordinates are local to the map view.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WorldView {
    pub origin: [f32; 2],
    pub span: [f32; 2],
}

pub struct Camera {
    extent: [f32; 2],
    minimum: [f32; 2],
    viewport: [f32; 2],
    origin: [f32; 2],
    scale: f32,
}

impl Camera {
    pub fn fit(extent: [f32; 2], viewport: [f32; 2]) -> Self {
        assert!(
            extent
                .into_iter()
                .chain(viewport)
                .all(|v| v.is_finite() && v > 0.0)
        );
        let scale = (viewport[0] / extent[0]).min(viewport[1] / extent[1]);
        Self {
            extent,
            minimum: [0.0; 2],
            viewport,
            origin: std::array::from_fn(|i| (extent[i] - viewport[i] / scale) * 0.5),
            scale,
        }
    }

    pub fn view(&self) -> WorldView {
        WorldView {
            origin: self.origin,
            span: self.viewport.map(|v| v / self.scale),
        }
    }

    /// Geometry edits can extend either side of the map. Keep the current view.
    pub fn set_bounds(&mut self, minimum: [f32; 2], maximum: [f32; 2]) {
        assert!(
            (0..2).all(|i| minimum[i].is_finite()
                && maximum[i].is_finite()
                && maximum[i] > minimum[i])
        );
        self.minimum = minimum;
        self.extent = std::array::from_fn(|i| maximum[i] - minimum[i]);
    }

    pub fn screen_to_world(&self, screen: [f32; 2]) -> [f32; 2] {
        std::array::from_fn(|i| self.origin[i] + screen[i] / self.scale)
    }

    pub fn world_to_screen(&self, world: [f32; 2]) -> [f32; 2] {
        std::array::from_fn(|i| (world[i] - self.origin[i]) * self.scale)
    }

    pub fn zoom_at(&mut self, screen: [f32; 2], factor: f32) {
        if !factor.is_finite() || factor <= 0.0 || !screen.into_iter().all(f32::is_finite) {
            return;
        }
        let anchor = self.screen_to_world(screen);
        let fit = (self.viewport[0] / self.extent[0]).min(self.viewport[1] / self.extent[1]);
        self.scale = (self.scale * factor).clamp(fit * 0.25, fit * 32.0);
        self.origin = std::array::from_fn(|i| anchor[i] - screen[i] / self.scale);
        self.clamp();
    }

    pub fn pan(&mut self, delta: [f32; 2]) {
        if !delta.into_iter().all(f32::is_finite) {
            return;
        }
        for (i, d) in delta.into_iter().enumerate() {
            self.origin[i] -= d / self.scale;
        }
        self.clamp();
    }

    pub fn resize(&mut self, viewport: [f32; 2]) {
        if viewport == self.viewport || !viewport.into_iter().all(|v| v.is_finite() && v > 0.0) {
            return;
        }
        let center = self.screen_to_world(self.viewport.map(|v| v * 0.5));
        self.viewport = viewport;
        self.origin = std::array::from_fn(|i| center[i] - viewport[i] * 0.5 / self.scale);
        self.clamp();
    }

    fn clamp(&mut self) {
        let span = self.view().span;
        for (i, span) in span.into_iter().enumerate() {
            // Keep a visible strip of the map, even at the zoom limits.
            let margin = self.extent[i].min(span) * 0.1;
            self.origin[i] = self.origin[i].clamp(
                self.minimum[i] + margin - span,
                self.minimum[i] + self.extent[i] - margin,
            );
        }
    }
}
