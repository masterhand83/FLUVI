//! v1 building geometry, in saved pixel coordinates. Unknown fields stay intact.
use serde_json::{Value, json};
pub mod artwork;

pub const PALETTE: [&str; 6] = [
    "#A0522D", "#6C757D", "#1F4E9E", "#46B5D1", "#2E7D32", "#8B4513",
];

#[derive(Clone, Debug, PartialEq)]
pub enum BuildingEdit {
    Create(Building),
    Update(usize, Building),
    Delete(usize),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BuildingError(pub &'static str);

impl BuildingError {
    pub fn translation_key(self) -> String {
        format!("buildings.{}", self.0)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Building {
    pub label: String,
    pub center: [f64; 2],
    pub size: [f64; 2],
    pub angle: f64,
    pub color: String,
    pub vertices: Option<Vec<[f64; 2]>>,
    saved: Value,
    image_key: Option<String>,
}

fn cross(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

fn on_segment(a: [f64; 2], b: [f64; 2], p: [f64; 2]) -> bool {
    cross(a, b, p).abs() < 1e-8
        && (0..2).all(|i| p[i] >= a[i].min(b[i]) - 1e-8 && p[i] <= a[i].max(b[i]) + 1e-8)
}

fn intersects(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> bool {
    let [abc, abd, cda, cdb] = [
        cross(a, b, c),
        cross(a, b, d),
        cross(c, d, a),
        cross(c, d, b),
    ];
    (((abc > 0. && abd < 0.) || (abc < 0. && abd > 0.))
        && ((cda > 0. && cdb < 0.) || (cda < 0. && cdb > 0.)))
        || on_segment(a, b, c)
        || on_segment(a, b, d)
        || on_segment(c, d, a)
        || on_segment(c, d, b)
}

/// Same order and tolerances as v1's edificioPolygonGeometry.validate.
pub fn validate_polygon(points: &[[f64; 2]]) -> Result<(), BuildingError> {
    if points.len() < 3 || points.iter().flatten().any(|n| !n.is_finite()) {
        return Err(BuildingError("invalid-vertices"));
    }
    let distinct = points
        .iter()
        .enumerate()
        .filter(|(i, point)| !points[..*i].contains(point))
        .count();
    if distinct < 3 {
        return Err(BuildingError("too-few-distinct-vertices"));
    }
    let n = points.len();
    let area: f64 = (0..n)
        .map(|i| points[i][0] * points[(i + 1) % n][1] - points[(i + 1) % n][0] * points[i][1])
        .sum();
    if area.abs() < 1e-8 {
        return Err(BuildingError("zero-area"));
    }
    for i in 0..n {
        let a = points[i];
        let b = points[(i + 1) % n];
        if a == b {
            return Err(BuildingError("zero-length-edge"));
        }
        for j in i + 1..n {
            if j == i + 1 || (i == 0 && j == n - 1) {
                continue;
            }
            if intersects(a, b, points[j], points[(j + 1) % n]) {
                return Err(BuildingError("self-intersection"));
            }
        }
    }
    Ok(())
}

pub fn contains_polygon(points: &[[f64; 2]], p: [f64; 2]) -> bool {
    if validate_polygon(points).is_err() || p.iter().any(|n| !n.is_finite()) {
        return false;
    }
    let mut inside = false;
    for i in 0..points.len() {
        let a = points[(i + points.len() - 1) % points.len()];
        let b = points[i];
        if on_segment(a, b, p) {
            return true;
        }
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            inside = !inside;
        }
    }
    inside
}

pub fn rotate(p: [f64; 2], center: [f64; 2], degrees: f64) -> [f64; 2] {
    let (s, c) = degrees.to_radians().sin_cos();
    let [x, y] = [p[0] - center[0], p[1] - center[1]];
    [center[0] + x * c - y * s, center[1] + x * s + y * c]
}

impl Building {
    pub fn rectangle(center: [f64; 2], size: [f64; 2]) -> Self {
        Self {
            label: String::new(),
            center,
            size,
            angle: 0.,
            color: PALETTE[5].into(),
            vertices: None,
            saved: json!({"esEstacionamiento":false,"capacidadMaxima":50,
                "vehiculosActuales":0,"conexiones":[]}),
            image_key: None,
        }
    }

    pub fn image_key(&self) -> Option<&str> {
        self.image_key.as_deref()
    }

    pub fn image_data(&self) -> Option<&str> {
        (self.saved["appearanceMode"] == "uploaded-image")
            .then(|| self.saved["imageData"].as_str())
            .flatten()
    }

    pub fn is_image(&self) -> bool {
        self.vertices.is_none() && (self.image_key.is_some() || self.image_data().is_some())
    }

    pub fn display_angle(&self) -> f64 {
        if self.legacy_image_rotation() {
            -self.angle
        } else {
            self.angle
        }
    }

    pub fn legacy_image_rotation(&self) -> bool {
        self.image_key.is_some() || self.saved["imageRotationConvention"] == "legacy"
    }

    /// The decoder validates bytes before this geometry/persistence boundary.
    pub fn replace_image(&mut self, data: String, pixels: [u32; 2]) -> Result<(), BuildingError> {
        if pixels.contains(&0) {
            return Err(BuildingError("invalid-size"));
        }
        if self.image_key.is_some() {
            self.saved["imageRotationConvention"] = json!("legacy");
        }
        self.image_key = None;
        self.vertices = None;
        self.saved
            .as_object_mut()
            .expect("object")
            .remove("geometryType");
        self.saved
            .as_object_mut()
            .expect("object")
            .remove("vertices");
        self.saved["appearanceMode"] = json!("uploaded-image");
        self.saved["imageData"] = json!(data);
        self.size =
            pixels.map(|n| n as f64 * 120. / *pixels.iter().max().expect("two dimensions") as f64);
        Ok(())
    }

    pub fn polygon(vertices: Vec<[f64; 2]>) -> Result<Self, BuildingError> {
        validate_polygon(&vertices)?;
        let mut result = Self::rectangle([0.; 2], [1.; 2]);
        result.vertices = Some(vertices);
        result.saved["appearanceMode"] = json!("polygon");
        result.sync_polygon_bounds();
        Ok(result)
    }

    pub fn validate(&self) -> Result<(), BuildingError> {
        if let Some(points) = &self.vertices {
            validate_polygon(points)?;
        }
        if self
            .center
            .iter()
            .chain(&self.size)
            .chain([&self.angle])
            .any(|n| !n.is_finite())
            || self.size.iter().any(|&n| n <= 0.)
        {
            return Err(BuildingError("invalid-size"));
        }
        Ok(())
    }

    pub fn points(&self) -> Vec<[f64; 2]> {
        if let Some(points) = &self.vertices {
            return points.clone();
        }
        self.corners().to_vec()
    }

    pub fn corners(&self) -> [[f64; 2]; 4] {
        [[-1., -1.], [1., -1.], [1., 1.], [-1., 1.]].map(|sign| {
            rotate(
                std::array::from_fn(|i| self.center[i] + sign[i] * self.size[i] / 2.),
                self.center,
                self.display_angle(),
            )
        })
    }

    pub fn bounds(&self) -> [[f64; 2]; 2] {
        let mut bounds = [[f64::INFINITY; 2], [f64::NEG_INFINITY; 2]];
        let corners = self.corners();
        for p in self.vertices.as_deref().unwrap_or(&corners) {
            for i in 0..2 {
                bounds[0][i] = bounds[0][i].min(p[i]);
                bounds[1][i] = bounds[1][i].max(p[i]);
            }
        }
        bounds
    }

    pub fn contains(&self, point: [f64; 2]) -> bool {
        match &self.vertices {
            Some(points) => contains_polygon(points, point),
            None => contains_polygon(&self.corners(), point),
        }
    }

    pub fn palette_index(&self) -> Option<usize> {
        PALETTE
            .iter()
            .position(|c| c.eq_ignore_ascii_case(&self.color))
    }

    pub fn sync_polygon_bounds(&mut self) {
        if self
            .vertices
            .as_ref()
            .is_some_and(|points| !points.is_empty())
        {
            let [min, max] = self.bounds();
            let points = self.vertices.as_ref().expect("polygon");
            let mut twice_area = 0.;
            let mut center = [0.; 2];
            for (a, b) in points.iter().zip(points.iter().cycle().skip(1)) {
                let factor = a[0] * b[1] - b[0] * a[1];
                twice_area += factor;
                for i in 0..2 {
                    center[i] += (a[i] + b[i]) * factor;
                }
            }
            self.center = if twice_area.abs() < 1e-8 {
                points[0]
            } else {
                center.map(|n| n / (3. * twice_area))
            };
            self.size = std::array::from_fn(|i| max[i] - min[i]);
        }
    }

    pub fn resized_corner(
        &self,
        index: usize,
        point: [f64; 2],
        square: bool,
    ) -> Result<Self, BuildingError> {
        if index >= 4 {
            return Err(BuildingError("invalid-vertices"));
        }
        let mut next = self.clone();
        let [min, max] = self.bounds();
        let corners = if self.vertices.is_some() {
            [
                [min[0], min[1]],
                [max[0], min[1]],
                [max[0], max[1]],
                [min[0], max[1]],
            ]
        } else {
            self.corners()
        };
        let fixed = corners[(index + 2) % 4];
        let moving = corners[index];
        let local = if self.vertices.is_some() {
            point
        } else {
            rotate(point, fixed, -self.display_angle())
        };
        let mut delta: [f64; 2] = std::array::from_fn(|i| local[i] - fixed[i]);
        if self.is_image() {
            let scale = (delta[0].abs() / self.size[0]).max(delta[1].abs() / self.size[1]);
            delta = std::array::from_fn(|i| {
                self.size[i] * scale * if delta[i] < 0. { -1. } else { 1. }
            });
        } else if square {
            let length = delta[0].abs().max(delta[1].abs());
            delta = delta.map(|n| if n < 0. { -length } else { length });
        }
        if let Some(points) = &mut next.vertices {
            for p in points {
                for i in 0..2 {
                    p[i] = fixed[i] + (p[i] - fixed[i]) * delta[i] / (moving[i] - fixed[i]);
                }
            }
            next.sync_polygon_bounds();
        } else {
            next.center = rotate(
                std::array::from_fn(|i| fixed[i] + delta[i] / 2.),
                fixed,
                self.display_angle(),
            );
            next.size = delta.map(f64::abs);
        }
        next.validate()?;
        Ok(next)
    }

    pub fn vertex_moved(&self, index: usize, point: [f64; 2]) -> Result<Self, BuildingError> {
        let mut next = self.clone();
        let target = next
            .vertices
            .as_mut()
            .and_then(|v| v.get_mut(index))
            .ok_or(BuildingError("invalid-vertices"))?;
        *target = point;
        next.sync_polygon_bounds();
        next.validate()?;
        Ok(next)
    }

    pub fn moved(&self, delta: [f64; 2]) -> Self {
        let mut next = self.clone();
        for (value, offset) in next.center.iter_mut().zip(delta) {
            *value += offset;
        }
        if let Some(points) = &mut next.vertices {
            for p in points {
                for i in 0..2 {
                    p[i] += delta[i];
                }
            }
        }
        next
    }

    pub fn rotated(&self, degrees: f64) -> Self {
        let mut next = self.clone();
        next.angle = degrees;
        if let Some(points) = &mut next.vertices {
            for p in points {
                *p = rotate(*p, self.center, degrees - self.angle);
            }
            next.sync_polygon_bounds();
        }
        next
    }

    pub fn from_json(value: &Value) -> Result<Self, BuildingError> {
        if !value.is_object()
            || ["x", "y", "width", "height", "angle"]
                .iter()
                .any(|key| value.get(key).is_some_and(|n| n.as_f64().is_none()))
        {
            return Err(BuildingError("invalid-size"));
        }
        let number = |key: &str, default| value[key].as_f64().unwrap_or(default);
        let mut result = Self::rectangle(
            [number("x", 0.), number("y", 0.)],
            [number("width", 1.), number("height", 1.)],
        );
        result.saved = value.clone();
        result.label = value["label"].as_str().unwrap_or("").into();
        if value["geometryType"] != "polygon" && value["appearanceMode"] != "uploaded-image" {
            let key = value["imagen"]
                .as_str()
                .filter(|key| !key.is_empty())
                .unwrap_or(&result.label);
            if artwork::path(key).is_some() {
                result.image_key = Some(key.into());
            }
        }
        result.color = value["color"].as_str().unwrap_or(PALETTE[5]).into();
        result.angle = number("angle", 0.);
        if value["geometryType"] == "polygon" {
            result.vertices = Some(
                value["vertices"]
                    .as_array()
                    .ok_or(BuildingError("invalid-vertices"))?
                    .iter()
                    .map(|p| {
                        Ok([
                            p["x"].as_f64().ok_or(BuildingError("invalid-vertices"))?,
                            p["y"].as_f64().ok_or(BuildingError("invalid-vertices"))?,
                        ])
                    })
                    .collect::<Result<_, BuildingError>>()?,
            );
        }
        result.validate()?;
        Ok(result)
    }

    pub fn to_json(&self) -> Value {
        let mut value = self.saved.clone();
        for (key, number) in [
            ("x", self.center[0]),
            ("y", self.center[1]),
            ("width", self.size[0]),
            ("height", self.size[1]),
            ("angle", self.angle),
        ] {
            if value[key].as_f64() != Some(number) {
                value[key] = json!(number);
            }
        }
        value["label"] = json!(self.label);
        if let Some(key) = &self.image_key
            && value["label"] != self.saved["label"]
            && self.saved["imagen"].as_str().is_none_or(str::is_empty)
        {
            value["imagen"] = json!(key);
        }
        value["color"] = json!(self.color);
        if let Some(points) = &self.vertices {
            value["geometryType"] = json!("polygon");
            let unchanged = value["vertices"].as_array().is_some_and(|saved| {
                saved.len() == points.len()
                    && saved.iter().zip(points).all(|(s, p)| {
                        s["x"].as_f64() == Some(p[0]) && s["y"].as_f64() == Some(p[1])
                    })
            });
            if !unchanged {
                value["vertices"] = points.iter().map(|p| json!({"x":p[0],"y":p[1]})).collect();
            }
        }
        value
    }
}
