//! World-space Bézier curves. Immutable curves own their sampled geometry cache.
//! All distances use cell units; JSON conversion is the only five-unit boundary.
use crate::streets::StreetError;
use std::sync::Arc;

pub type Point = [f64; 2];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CurvePoint {
    Start,
    Anchor(usize),
    Control(usize, usize),
}

#[derive(Clone, Debug, PartialEq)]
pub enum BezierChange {
    Convert,
    Move(CurvePoint, Point),
    Split(usize, f64),
    AddControl(usize),
    Remove(CurvePoint),
    /// Maximum control deviation divided by its section's chord length.
    Strength(f64),
}

pub(crate) fn from_json(road: &serde_json::Value) -> Result<Option<BezierCurve>, StreetError> {
    let invalid = StreetError("bezier.invalidControls");
    if road.get("bezierSegments").is_none() && road.get("bezierControls").is_none() {
        return Ok(None);
    }
    let point = |p: &serde_json::Value| -> Result<Point, StreetError> {
        Ok([
            p["x"].as_f64().ok_or(invalid)? / 5.0,
            p["y"].as_f64().ok_or(invalid)? / 5.0,
        ])
    };
    let controls = |v: &serde_json::Value| -> Result<Vec<Point>, StreetError> {
        let values = v.as_array().ok_or(invalid)?;
        if values.len() > 32 {
            return Err(invalid);
        }
        values.iter().map(point).collect()
    };
    let start = point(road)?;
    let end = match (road["endX"].as_f64(), road["endY"].as_f64()) {
        (Some(x), Some(y)) => [x / 5.0, y / 5.0],
        _ if road.get("bezierSegments").is_none() => {
            let angle = -road["angulo"].as_f64().unwrap_or(0.0).to_radians();
            let length = road["tamano"].as_f64().ok_or(invalid)?;
            [
                start[0] + angle.cos() * length,
                start[1] + angle.sin() * length,
            ]
        }
        _ => return Err(invalid),
    };
    let sections = if let Some(v) = road.get("bezierSegments") {
        let values = v.as_array().ok_or(invalid)?;
        if values.is_empty() || values.len() > 128 {
            return Err(invalid);
        }
        let sections = values
            .iter()
            .map(|s| {
                Ok(Section {
                    controls: controls(&s["controls"])?,
                    end: point(&s["end"])?,
                })
            })
            .collect::<Result<Vec<_>, StreetError>>()?;
        if sections.last().map(|s| s.end) != Some(end) {
            return Err(invalid);
        }
        sections
    } else {
        vec![Section {
            controls: controls(&road["bezierControls"])?,
            end,
        }]
    };
    BezierCurve::new(start, sections).map(Some)
}

#[derive(Clone, Debug, PartialEq)]
pub struct Section {
    pub controls: Vec<Point>,
    pub end: Point,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Sample {
    point: Point,
    distance: f64,
    angle: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BezierCurve {
    start: Point,
    sections: Vec<Section>,
    samples: Arc<Vec<Sample>>,
    seams: Vec<f64>,
    rounded: bool,
}

fn mix(a: Point, b: Point, t: f64) -> Point {
    std::array::from_fn(|i| a[i] * (1.0 - t) + b[i] * t)
}

fn distance(a: Point, b: Point) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

fn evaluate(points: &[Point], t: f64) -> Point {
    // The constructor bounds polynomial degree. Sampling reuses stack storage,
    // rather than allocating for each point and tangent evaluation.
    let mut work = [[0.0; 2]; 34];
    work[..points.len()].copy_from_slice(points);
    for count in (1..points.len()).rev() {
        for i in 0..count {
            work[i] = mix(work[i], work[i + 1], t);
        }
    }
    work[0]
}

fn at_distance(samples: &[Sample], target: f64) -> Sample {
    let index = samples
        .partition_point(|p| p.distance < target)
        .min(samples.len() - 1);
    let b = samples[index];
    let a = samples[index.saturating_sub(1)];
    let ratio = if b.distance == a.distance {
        0.0
    } else {
        ((target - a.distance) / (b.distance - a.distance)).clamp(0.0, 1.0)
    };
    Sample {
        point: mix(a.point, b.point, ratio),
        distance: target,
        angle: if b.distance == a.distance {
            b.angle
        } else {
            a.angle
        },
    }
}

fn append(samples: &mut Vec<Sample>, mut point: Sample) {
    point.distance = samples.last().map_or(0.0, |prior| {
        prior.distance + distance(prior.point, point.point)
    });
    samples.push(point);
}

impl BezierCurve {
    pub fn strength(&self) -> f64 {
        self.sections
            .iter()
            .enumerate()
            .fold(0.0_f64, |strength, (i, s)| {
                let start = if i == 0 {
                    self.start
                } else {
                    self.sections[i - 1].end
                };
                let length = distance(start, s.end);
                if length < 1e-9 {
                    return strength;
                }
                s.controls.iter().fold(strength, |max, &p| {
                    max.max(orient(start, s.end, p).abs() / (length * length))
                })
            })
            .min(10.0)
    }

    pub fn changed(&self, change: &BezierChange) -> Result<Self, StreetError> {
        let invalid = StreetError("bezier.invalidControls");
        let mut start = self.start;
        let mut sections = self.sections.clone();
        match *change {
            BezierChange::Convert => return Err(invalid),
            BezierChange::Split(section, t) => return self.split(section, t),
            BezierChange::Move(point, p) => match point {
                CurvePoint::Start => start = p,
                CurvePoint::Anchor(i) => sections.get_mut(i).ok_or(invalid)?.end = p,
                CurvePoint::Control(i, j) => {
                    *sections
                        .get_mut(i)
                        .ok_or(invalid)?
                        .controls
                        .get_mut(j)
                        .ok_or(invalid)? = p
                }
            },
            BezierChange::Remove(point) => match point {
                CurvePoint::Control(i, j) => {
                    let controls = &mut sections.get_mut(i).ok_or(invalid)?.controls;
                    if j >= controls.len() {
                        return Err(invalid);
                    }
                    controls.remove(j);
                }
                CurvePoint::Anchor(i) if i + 1 < sections.len() => {
                    let next = sections.remove(i + 1);
                    sections[i].controls.extend(next.controls);
                    sections[i].end = next.end;
                }
                _ => return Err(invalid),
            },
            BezierChange::AddControl(i) => {
                let start = if i == 0 {
                    start
                } else {
                    sections.get(i - 1).ok_or(invalid)?.end
                };
                let s = sections.get_mut(i).ok_or(invalid)?;
                let points: Vec<_> = [start]
                    .into_iter()
                    .chain(s.controls.iter().copied())
                    .chain([s.end])
                    .collect();
                let degree = points.len() - 1;
                s.controls = (1..=degree)
                    .map(|i| mix(points[i], points[i - 1], i as f64 / (degree + 1) as f64))
                    .collect();
            }
            BezierChange::Strength(target) => {
                if !target.is_finite() || !(0.0..=10.0).contains(&target) {
                    return Err(invalid);
                }
                let current = self.strength();
                for (i, s) in sections.iter_mut().enumerate() {
                    let start = if i == 0 {
                        start
                    } else {
                        self.sections[i - 1].end
                    };
                    let length = distance(start, s.end);
                    if length < 1e-9 {
                        continue;
                    }
                    let axis = [
                        (s.end[0] - start[0]) / length,
                        (s.end[1] - start[1]) / length,
                    ];
                    for p in &mut s.controls {
                        let delta = [p[0] - start[0], p[1] - start[1]];
                        let along = delta[0] * axis[0] + delta[1] * axis[1];
                        let perpendicular = -delta[0] * axis[1] + delta[1] * axis[0];
                        let next = if current > 1e-9 {
                            perpendicular * target / current
                        } else {
                            target * length
                        };
                        *p = [
                            start[0] + axis[0] * along - axis[1] * next,
                            start[1] + axis[1] * along + axis[0] * next,
                        ];
                    }
                }
            }
        }
        Self::new(start, sections)
    }

    pub fn transformed(&self, origin: Point, angle: f64) -> Result<Self, StreetError> {
        let transform = |p: Point| {
            let delta = [p[0] - self.start[0], p[1] - self.start[1]];
            [
                origin[0] + delta[0] * angle.cos() - delta[1] * angle.sin(),
                origin[1] + delta[0] * angle.sin() + delta[1] * angle.cos(),
            ]
        };
        Self::new(
            origin,
            self.sections
                .iter()
                .map(|s| Section {
                    controls: s.controls.iter().copied().map(transform).collect(),
                    end: transform(s.end),
                })
                .collect(),
        )
    }

    pub(crate) fn write_json(&self, road: &mut serde_json::Value) {
        use serde_json::json;
        let point = |p: Point| json!({"x":p[0]*5.0,"y":p[1]*5.0});
        let end = self.sections.last().expect("section").end;
        road["x"] = json!(self.start[0] * 5.0);
        road["y"] = json!(self.start[1] * 5.0);
        road["endX"] = json!(end[0] * 5.0);
        road["endY"] = json!(end[1] * 5.0);
        road["bezierGeometry"] = json!(true);
        road["esCurva"] = json!(true);
        road["vertices"] = json!([]);
        road["bezierControls"] = json!(if self.sections.len() == 1 {
            self.sections[0]
                .controls
                .iter()
                .copied()
                .map(point)
                .collect::<Vec<_>>()
        } else {
            vec![]
        });
        if self.sections.len() > 1 {
            road["bezierSegments"] = json!(self.sections.iter().map(|s| json!({
                "controls":s.controls.iter().copied().map(point).collect::<Vec<_>>(),"end":point(s.end)
            })).collect::<Vec<_>>());
        } else {
            road.as_object_mut()
                .expect("street")
                .remove("bezierSegments");
        }
    }

    pub fn new(start: Point, sections: Vec<Section>) -> Result<Self, crate::streets::StreetError> {
        use crate::streets::StreetError;
        if sections.is_empty()
            || sections.len() > 128
            || sections.iter().any(|s| s.controls.len() > 32)
            || start
                .iter()
                .chain(
                    sections
                        .iter()
                        .flat_map(|s| s.controls.iter().chain([&s.end]))
                        .flatten(),
                )
                .any(|v| !v.is_finite() || v.abs() > 200_000.0)
        {
            return Err(StreetError("bezier.invalidControls"));
        }
        let mut raw = Vec::new();
        let mut seams = Vec::new();
        let mut length = 0.0;
        let mut origin = start;
        let mut sample_budget = 0;
        let mut work_budget = 0;
        let mut previous = start;
        // Reject pathological input before allocating the sampling cache.
        for s in &sections {
            let points: Vec<_> = [previous]
                .into_iter()
                .chain(s.controls.iter().copied())
                .chain([s.end])
                .collect();
            let length: f64 = points.windows(2).map(|p| distance(p[0], p[1])).sum();
            let count = ((length * 8.0).ceil() as usize).clamp(256, 100_000) + 1;
            sample_budget += count;
            work_budget += count * points.len() * points.len();
            if sample_budget > 250_000 || work_budget > 10_000_000 {
                return Err(StreetError("bezier.invalidControls"));
            }
            previous = s.end;
        }
        for (section, s) in sections.iter().enumerate() {
            let points: Vec<_> = [origin]
                .into_iter()
                .chain(s.controls.iter().copied())
                .chain([s.end])
                .collect();
            let control_length: f64 = points.windows(2).map(|p| distance(p[0], p[1])).sum();
            let count = ((control_length * 8.0).ceil() as usize).clamp(256, 100_000);
            let mut previous = None;
            for i in 0..=count {
                let p = evaluate(&points, i as f64 / count as f64);
                if let Some(prior) = previous {
                    length += distance(p, prior);
                }
                let neighbor = evaluate(
                    &points,
                    if i == count {
                        (i - 1) as f64
                    } else {
                        (i + 1) as f64
                    } / count as f64,
                );
                let delta = if i == count {
                    [p[0] - neighbor[0], p[1] - neighbor[1]]
                } else {
                    [neighbor[0] - p[0], neighbor[1] - p[1]]
                };
                raw.push(Sample {
                    point: p,
                    distance: length,
                    angle: delta[1].atan2(delta[0]),
                });
                previous = Some(p);
            }
            if section + 1 < sections.len() {
                seams.push(length);
            }
            origin = s.end;
        }
        let corners: Vec<_> = seams
            .iter()
            .enumerate()
            .filter_map(|(i, &seam)| {
                // A smooth exact split creates no corner. Looking only before
                // and after the seam mistakes ordinary curvature for a join.
                let join = sections[i].end;
                let incoming_start = if i == 0 { start } else { sections[i - 1].end };
                let incoming = [incoming_start]
                    .into_iter()
                    .chain(sections[i].controls.iter().copied())
                    .rev()
                    .find(|p| distance(*p, join) > 1e-12);
                let outgoing = sections[i + 1]
                    .controls
                    .iter()
                    .copied()
                    .chain([sections[i + 1].end])
                    .find(|p| distance(*p, join) > 1e-12);
                if let (Some(a), Some(b)) = (incoming, outgoing) {
                    let dot = ((join[0] - a[0]) * (b[0] - join[0])
                        + (join[1] - a[1]) * (b[1] - join[1]))
                        / (distance(a, join) * distance(b, join));
                    if dot >= 1.0 - 1e-9 {
                        return None;
                    }
                }
                let before = at_distance(&raw, (seam - 0.1).max(0.0));
                let after = at_distance(&raw, (seam + 0.1).min(length));
                let previous = if i == 0 { 0.0 } else { seams[i - 1] };
                let next = seams.get(i + 1).copied().unwrap_or(length);
                let radius = 4.0_f64
                    .min((seam - previous) * 0.4)
                    .min((next - seam) * 0.4);
                ((before.angle - after.angle).cos() < 0.999 && radius > 0.0000002)
                    .then_some((seam, radius))
            })
            .collect();
        let rounded = !corners.is_empty();
        let samples = if rounded {
            let mut samples = Vec::new();
            let mut rounded_seams = Vec::new();
            let mut index = 0;
            for (seam, radius) in corners {
                while index < raw.len() && raw[index].distance < seam - radius {
                    append(&mut samples, raw[index]);
                    index += 1;
                }
                let entry = at_distance(&raw, seam - radius);
                let exit = at_distance(&raw, seam + radius);
                append(&mut samples, entry);
                let handle = radius * 0.6;
                let controls = [
                    [
                        entry.point[0] + entry.angle.cos() * handle,
                        entry.point[1] + entry.angle.sin() * handle,
                    ],
                    [
                        exit.point[0] - exit.angle.cos() * handle,
                        exit.point[1] - exit.angle.sin() * handle,
                    ],
                ];
                let points = [entry.point, controls[0], controls[1], exit.point];
                let derivatives: Vec<_> = points
                    .windows(2)
                    .map(|p| [3.0 * (p[1][0] - p[0][0]), 3.0 * (p[1][1] - p[0][1])])
                    .collect();
                let count = 32.max((radius * 8.0).ceil() as usize);
                for i in 1..count {
                    let t = i as f64 / count as f64;
                    let tangent = evaluate(&derivatives, t);
                    append(
                        &mut samples,
                        Sample {
                            point: evaluate(&points, t),
                            distance: 0.0,
                            angle: tangent[1].atan2(tangent[0]),
                        },
                    );
                    if i == count / 2 {
                        rounded_seams.push(samples.last().expect("corner").distance);
                    }
                }
                append(&mut samples, exit);
                while index < raw.len() && raw[index].distance <= seam + radius {
                    index += 1;
                }
            }
            for sample in &raw[index..] {
                append(&mut samples, *sample);
            }
            seams = rounded_seams;
            samples
        } else {
            raw
        };
        Ok(Self {
            start,
            sections,
            samples: Arc::new(samples),
            seams,
            rounded,
        })
    }

    pub fn start(&self) -> Point {
        self.start
    }
    /// De Casteljau subdivision preserves both section polynomials exactly.
    pub fn split(&self, section: usize, t: f64) -> Result<Self, StreetError> {
        let s = self
            .sections
            .get(section)
            .ok_or(StreetError("bezier.invalidControls"))?;
        if !t.is_finite() || t <= 0.0 || t >= 1.0 {
            return Err(StreetError("bezier.invalidControls"));
        }
        let start = if section == 0 {
            self.start
        } else {
            self.sections[section - 1].end
        };
        let mut level: Vec<_> = [start]
            .into_iter()
            .chain(s.controls.iter().copied())
            .chain([s.end])
            .collect();
        let mut left = Vec::new();
        let mut right = Vec::new();
        while level.len() > 1 {
            level = level.windows(2).map(|p| mix(p[0], p[1], t)).collect();
            left.push(level[0]);
            if level.len() > 1 {
                right.push(*level.last().expect("level"));
            }
        }
        right.reverse();
        let end = left.pop().expect("split endpoint");
        let mut sections = self.sections.clone();
        sections.splice(
            section..=section,
            [
                Section {
                    controls: left,
                    end,
                },
                Section {
                    controls: right,
                    end: s.end,
                },
            ],
        );
        Self::new(self.start, sections)
    }
    pub fn sections(&self) -> &[Section] {
        &self.sections
    }
    pub fn length(&self) -> f64 {
        self.samples.last().expect("sampled curve").distance
    }
    pub fn cell_count(&self) -> usize {
        self.length().round() as usize
    }

    pub fn validate(&self, lanes: usize) -> Result<usize, StreetError> {
        if !(1..=10).contains(&lanes) {
            return Err(StreetError("streetInspector.errors.lanes"));
        }
        if self.length() < 1.0 {
            return Err(StreetError("bezier.tooShort"));
        }
        let cells = self.cell_count();
        if cells > 2500 {
            return Err(StreetError("bezier.tooLong"));
        }
        let mut buckets = std::collections::HashMap::<(i32, i32), Vec<usize>>::new();
        let mut segments: Vec<(Point, Point, usize, usize)> = Vec::new();
        for lane in 0..lanes {
            for index in 0..cells.saturating_sub(1) {
                let a = self.cell(lane, lanes, index).0.map(f64::from);
                let b = self.cell(lane, lanes, index + 1).0.map(f64::from);
                let min = std::array::from_fn::<_, 2, _>(|i| (a[i].min(b[i]) - 0.5).floor() as i32);
                let max = std::array::from_fn::<_, 2, _>(|i| (a[i].max(b[i]) + 0.5).floor() as i32);
                let mut candidates = std::collections::HashSet::new();
                for x in min[0]..=max[0] {
                    for y in min[1]..=max[1] {
                        if let Some(ids) = buckets.get(&(x, y)) {
                            candidates.extend(ids.iter().copied());
                        }
                    }
                }
                for id in candidates {
                    let (c, d, other_lane, other_index) = segments[id];
                    if other_lane == lane && index.abs_diff(other_index) <= 1 {
                        continue;
                    }
                    if index.abs_diff(other_index) <= lanes * 2
                        && self.seams.iter().any(|seam| {
                            ((index + 1) as f64 - seam).abs() <= lanes as f64
                                && ((other_index + 1) as f64 - seam).abs() <= lanes as f64
                        })
                    {
                        continue;
                    }
                    if segments_overlap(a, b, c, d) || segment_distance(a, b, c, d) < 0.5 {
                        return Err(StreetError("bezier.overlap"));
                    }
                }
                let id = segments.len();
                segments.push((a, b, lane, index));
                for x in min[0]..=max[0] {
                    for y in min[1]..=max[1] {
                        buckets.entry((x, y)).or_default().push(id);
                    }
                }
            }
        }
        Ok(cells)
    }

    pub fn point(&self, t: f64) -> Point {
        let t = t.clamp(0.0, 1.0);
        if self.rounded {
            return at_distance(&self.samples, t * self.length()).point;
        }
        let scaled = t * self.sections.len() as f64;
        let section = (scaled.floor() as usize).min(self.sections.len() - 1);
        self.section_point(section, scaled - section as f64)
            .expect("section")
    }

    /// Evaluate the stored polynomial, without the display-only corner rounding.
    pub fn section_point(&self, section: usize, t: f64) -> Option<Point> {
        let s = self.sections.get(section)?;
        if !t.is_finite() {
            return None;
        }
        let start = if section == 0 {
            self.start
        } else {
            self.sections[section - 1].end
        };
        Some(evaluate(
            &[start]
                .into_iter()
                .chain(s.controls.iter().copied())
                .chain([s.end])
                .collect::<Vec<_>>(),
            t.clamp(0.0, 1.0),
        ))
    }

    pub fn cell(&self, lane: usize, lanes: usize, index: usize) -> ([f32; 2], [f32; 2]) {
        let p = at_distance(&self.samples, index as f64 + 0.5);
        let offset = lane as f64 - (lanes - 1) as f64 / 2.0;
        (
            [
                (p.point[0] - p.angle.sin() * offset) as f32,
                (p.point[1] + p.angle.cos() * offset) as f32,
            ],
            [p.angle.cos() as f32, p.angle.sin() as f32],
        )
    }
}

fn orient(a: Point, b: Point, c: Point) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

fn segments_overlap(a: Point, b: Point, c: Point, d: Point) -> bool {
    let on = |p: Point, q: Point, r: Point| {
        orient(p, q, r).abs() <= 0.000000004
            && (0..2)
                .all(|i| r[i] >= p[i].min(q[i]) - 0.00000002 && r[i] <= p[i].max(q[i]) + 0.00000002)
    };
    (orient(a, b, c) * orient(a, b, d) < 0.0 && orient(c, d, a) * orient(c, d, b) < 0.0)
        || on(a, b, c)
        || on(a, b, d)
        || on(c, d, a)
        || on(c, d, b)
}

fn segment_distance(a: Point, b: Point, c: Point, d: Point) -> f64 {
    let point_segment = |p: Point, a: Point, b: Point| {
        let delta = [b[0] - a[0], b[1] - a[1]];
        let squared = delta[0] * delta[0] + delta[1] * delta[1];
        let t = (((p[0] - a[0]) * delta[0] + (p[1] - a[1]) * delta[1])
            / if squared == 0.0 { 1.0 } else { squared })
        .clamp(0.0, 1.0);
        distance(p, mix(a, b, t))
    };
    point_segment(a, c, d)
        .min(point_segment(b, c, d))
        .min(point_segment(c, a, b))
        .min(point_segment(d, a, b))
}
