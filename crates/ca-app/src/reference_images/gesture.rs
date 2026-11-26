use ca_core::buildings::rotate;
use serde_json::{Value, json};

#[derive(Clone, Copy, Debug)]
pub enum Handle {
    Move,
    Corner(usize),
    Rotate,
}

pub struct Gesture {
    original: Value,
    handle: Handle,
    start: [f64; 2],
}

pub(super) fn number(image: &Value, key: &str) -> f64 {
    image[key].as_f64().unwrap_or(0.)
}

pub(super) fn center(image: &Value) -> [f64; 2] {
    [
        number(image, "x") + number(image, "width") / 2.,
        number(image, "y") + number(image, "height") / 2.,
    ]
}

pub(super) fn corners(image: &Value) -> [[f64; 2]; 4] {
    let x = number(image, "x");
    let y = number(image, "y");
    let w = number(image, "width");
    let h = number(image, "height");
    [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
        .map(|p| rotate(p, center(image), number(image, "rotation")))
}

impl Gesture {
    pub fn begin(image: &Value, handle: Handle, start: [f64; 2]) -> Option<Self> {
        if image["locked"] == true
            || image["visible"] == false
            || number(image, "width") <= 0.
            || number(image, "height") <= 0.
            || matches!(handle, Handle::Corner(i) if i >= 4)
        {
            return None;
        }
        Some(Self {
            // A gesture owns only small placement/display fields, never embedded bytes.
            original: json!({
                "x":number(image,"x"), "y":number(image,"y"),
                "width":number(image,"width"), "height":number(image,"height"),
                "rotation":number(image,"rotation"), "visible":image["visible"] != false,
                "locked":image["locked"] == true,
                "opacity":image["opacity"].as_f64().unwrap_or(1.).clamp(0.,1.)
            }),
            handle,
            start,
        })
    }

    pub fn update(&self, end: [f64; 2]) -> Value {
        let mut image = self.original.clone();
        if !end.iter().all(|n| n.is_finite()) {
            return image;
        }
        let delta: [f64; 2] = std::array::from_fn(|i| end[i] - self.start[i]);
        match self.handle {
            Handle::Move => {
                image["x"] = (number(&self.original, "x") + delta[0]).into();
                image["y"] = (number(&self.original, "y") + delta[1]).into();
            }
            Handle::Rotate => {
                let c = center(&image);
                let angle = (end[1] - c[1]).atan2(end[0] - c[0])
                    - (self.start[1] - c[1]).atan2(self.start[0] - c[0]);
                let delta = angle.sin().atan2(angle.cos()).to_degrees();
                image["rotation"] = (number(&image, "rotation") + delta).into();
            }
            Handle::Corner(index) => {
                let points = corners(&image);
                let anchor = points[(index + 2) % 4];
                let diagonal: [f64; 2] = std::array::from_fn(|i| points[index][i] - anchor[i]);
                let factor = (1.
                    + (delta[0] * diagonal[0] + delta[1] * diagonal[1])
                        / (diagonal[0] * diagonal[0] + diagonal[1] * diagonal[1]))
                    .max(0.05);
                let width = number(&image, "width") * factor;
                let height = number(&image, "height") * factor;
                let c: [f64; 2] = std::array::from_fn(|i| anchor[i] + diagonal[i] * factor / 2.);
                image["x"] = (c[0] - width / 2.).into();
                image["y"] = (c[1] - height / 2.).into();
                image["width"] = width.into();
                image["height"] = height.into();
            }
        }
        image
    }
}
