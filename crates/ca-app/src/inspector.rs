//! Immediate street fields. Validation belongs to the document, not the widgets.
use crate::shell::Shell;
use ca_core::{
    map_json::MapDocument,
    streets::{StreetChange, StreetEdit, StreetError},
    traffic::{CalleType, LaneDirection},
};
use eframe::egui;

#[derive(Default)]
pub struct StreetInspector {
    selected: Option<usize>,
    values: [String; 8],
    error: Option<StreetError>,
    dimension_field: Option<Field>,
}

#[derive(Default)]
pub struct InspectorResponse {
    pub edit: Option<StreetEdit>,
    pub closed: bool,
    pub editing: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Field {
    Name,
    X,
    Y,
    Angle,
    Length,
    Lanes,
    Generation,
    LaneChange,
}

impl Field {
    const ALL: [Self; 8] = [
        Self::Name,
        Self::X,
        Self::Y,
        Self::Angle,
        Self::Length,
        Self::Lanes,
        Self::Generation,
        Self::LaneChange,
    ];
    fn dimension(self) -> bool {
        matches!(self, Self::Length | Self::Lanes)
    }
    fn key(self) -> &'static str {
        match self {
            Self::Name => "streetInspector.name",
            Self::X => "streetInspector.x",
            Self::Y => "streetInspector.y",
            Self::Angle => "streetInspector.angle",
            Self::Length => "streetInspector.length",
            Self::Lanes => "streetInspector.lanes",
            Self::Generation => "streetInspector.generation",
            Self::LaneChange => "streetInspector.laneChange",
        }
    }
    fn current(self, document: &MapDocument, street: usize) -> String {
        let p = &document.layout()[street];
        let c = document.model().streets()[street].config();
        match self {
            Self::Name => p.name.clone(),
            Self::X => (p.origin[0] * 5.0).to_string(),
            Self::Y => (p.origin[1] * 5.0).to_string(),
            Self::Angle => p.angle_degrees.to_string(),
            Self::Length => c.tamano.to_string(),
            Self::Lanes => c.carriles.to_string(),
            Self::Generation => c.generation_probability.to_string(),
            Self::LaneChange => c.lane_change_probability.to_string(),
        }
    }
}

/// Structural edits stay paused until the user explicitly resumes.
#[derive(Default)]
pub struct EditPause {
    active: bool,
}

impl EditPause {
    pub fn begin(&mut self, playing: &mut bool) {
        self.active = true;
        *playing = false;
    }

    pub fn resume(&mut self, playing: &mut bool) {
        self.active = false;
        *playing = true;
    }

    pub fn can_step(&self, playing: bool) -> bool {
        !playing && !self.active
    }
}

/// Shared wording for inspector fields and map gestures.
pub fn geometry_error_message(shell: &Shell, reason: StreetError) -> String {
    shell.tr(reason.translation_key(), &[])
}

impl StreetInspector {
    pub fn finish(
        &mut self,
        ctx: &egui::Context,
        document: &MapDocument,
    ) -> Result<Option<StreetEdit>, StreetError> {
        let edit = if let (Some(field), Some(street)) = (self.dimension_field, self.selected) {
            let p = &document.layout()[street];
            let c = document.model().streets()[street].config();
            let change = parse_field(
                field,
                &self.values[field as usize],
                p.origin,
                c.carriles,
                c.tamano,
            )?;
            let edit = StreetEdit::Update(street, change);
            document.validate_street_edit(&edit)?;
            Some(edit)
        } else {
            None
        };
        ctx.memory_mut(|m| {
            if let Some(id) = m.focused() {
                m.surrender_focus(id);
            }
        });
        self.error = None;
        self.dimension_field = None;
        Ok(edit)
    }

    pub fn show(
        &mut self,
        ctx: &egui::Context,
        document: &MapDocument,
        selected: Option<usize>,
        shell: &Shell,
    ) -> InspectorResponse {
        let mut result = InspectorResponse::default();
        if self.selected != selected {
            for field in Field::ALL {
                ctx.memory_mut(|m| m.surrender_focus(egui::Id::new(("street-field", field))));
            }
            self.selected = selected;
            self.error = None;
            self.values = Default::default();
            self.dimension_field = None;
        }
        let Some(street) = selected.filter(|&id| id < document.layout().len()) else {
            return result;
        };
        let p = &document.layout()[street];
        let model_street = &document.model().streets()[street];
        let c = model_street.config();
        let mut open = true;
        let mut change = None;
        egui::Window::new(shell.tr("streetInspector.title", &[]))
            .id(egui::Id::new("street-inspector"))
            .default_pos([760.0, 80.0])
            .default_width(285.0)
            .resizable(false)
            .open(&mut open)
            .show(ctx, |ui| {
                egui::ScrollArea::vertical()
                    .max_height(600.0)
                    .show(ui, |ui| {
                        egui::Grid::new("street-fields")
                            .num_columns(2)
                            .show(ui, |ui| {
                                for field in Field::ALL {
                                    let id = egui::Id::new(("street-field", field));
                                    let index = field as usize;
                                    if !ctx.memory(|m| m.has_focus(id))
                                        && self.dimension_field != Some(field)
                                    {
                                        self.values[index] = field.current(document, street);
                                    }
                                    ui.label(shell.tr(field.key(), &[]));
                                    let response = ui.add(
                                        egui::TextEdit::singleline(&mut self.values[index])
                                            .id(id)
                                            .desired_width(125.0),
                                    );
                                    if field.dimension() && response.has_focus() {
                                        self.dimension_field = Some(field);
                                        result.editing = true;
                                    }
                                    if response.changed()
                                        || (field.dimension() && response.lost_focus())
                                    {
                                        let value = &self.values[index];
                                        let parsed = parse_field(
                                            field, value, p.origin, c.carriles, c.tamano,
                                        );
                                        match parsed {
                                            Ok(candidate) => match document.validate_street_edit(
                                                &StreetEdit::Update(street, candidate.clone()),
                                            ) {
                                                Ok(()) => {
                                                    self.error = None;
                                                    // Enter or blur commits one complete dimension, not a destructive text prefix.
                                                    if !field.dimension() || response.lost_focus() {
                                                        change = Some(candidate);
                                                    }
                                                }
                                                Err(error) => self.error = Some(error),
                                            },
                                            Err(error) => self.error = Some(error),
                                        }
                                    }
                                    if field.dimension() && response.lost_focus() {
                                        self.dimension_field = None;
                                    }
                                    ui.end_row();
                                }
                                ui.label(shell.tr("streetInspector.type", &[]));
                                let mut tipo = c.tipo;
                                egui::ComboBox::from_id_salt("street-type")
                                    .selected_text(type_label(shell, tipo))
                                    .show_ui(ui, |ui| {
                                        for t in [
                                            CalleType::Generador,
                                            CalleType::Conexion,
                                            CalleType::Devorador,
                                        ] {
                                            ui.selectable_value(&mut tipo, t, type_label(shell, t));
                                        }
                                    });
                                if tipo != c.tipo {
                                    change = Some(StreetChange::Type(tipo));
                                }
                                ui.end_row();
                            });
                        ui.separator();
                        ui.small(shell.tr("streetInspector.dimensionHint", &[]));
                        for lane in 0..c.carriles {
                            ui.push_id(lane, |ui| {
                                ui.label(shell.tr(
                                    "streetInspector.lane",
                                    &[("number", &(lane + 1).to_string())],
                                ));
                                let old = model_street.lane_direction(lane);
                                let mut direction = old;
                                egui::ComboBox::from_id_salt("direction")
                                    .selected_text(shell.tr(
                                        if direction == LaneDirection::Forward {
                                            "streetInspector.forward"
                                        } else {
                                            "streetInspector.reverse"
                                        },
                                        &[],
                                    ))
                                    .show_ui(ui, |ui| {
                                        ui.selectable_value(
                                            &mut direction,
                                            LaneDirection::Forward,
                                            shell.tr("streetInspector.forward", &[]),
                                        );
                                        ui.selectable_value(
                                            &mut direction,
                                            LaneDirection::Reverse,
                                            shell.tr("streetInspector.reverse", &[]),
                                        );
                                    });
                                if direction != old {
                                    change = Some(StreetChange::Direction { lane, direction });
                                }
                                let old = c.lane_generation_enabled.get(lane) != Some(&Some(false));
                                let mut enabled = old;
                                if ui
                                    .checkbox(
                                        &mut enabled,
                                        shell.tr("streetInspector.generateVehicles", &[]),
                                    )
                                    .changed()
                                {
                                    change = Some(StreetChange::LaneGeneration { lane, enabled });
                                }
                            });
                        }
                        if let Some(error) = self.error {
                            ui.colored_label(
                                egui::Color32::RED,
                                geometry_error_message(shell, error),
                            );
                        }
                    });
            });
        if let Some(change) = change {
            let edit = StreetEdit::Update(street, change);
            match document.validate_street_edit(&edit) {
                Ok(()) => {
                    self.error = None;
                    result.edit = Some(edit);
                }
                Err(error) => self.error = Some(error),
            }
        }
        result.closed = !open;
        result
    }
}

fn type_label(shell: &Shell, tipo: CalleType) -> String {
    shell.tr(
        match tipo {
            CalleType::Generador => "streetInspector.generator",
            CalleType::Conexion => "streetInspector.connection",
            CalleType::Devorador => "streetInspector.devourer",
        },
        &[],
    )
}

fn parse_field(
    field: Field,
    text: &str,
    origin: [f64; 2],
    lanes: usize,
    length: usize,
) -> Result<StreetChange, StreetError> {
    if field == Field::Name {
        return Ok(StreetChange::Name(text.to_owned()));
    }
    let error = StreetError(match field {
        Field::Length => "streetInspector.errors.length",
        Field::Lanes => "streetInspector.errors.lanes",
        Field::Generation | Field::LaneChange => "streetInspector.errors.probability",
        _ => "streetInspector.errors.geometry",
    });
    let n: f64 = text.trim().parse().map_err(|_| error)?;
    if !n.is_finite() {
        return Err(error);
    }
    if field.dimension() && (n.fract() != 0.0 || n < 1.0 || n > 2500.0) {
        return Err(error);
    }
    Ok(match field {
        Field::X => StreetChange::Origin([n / 5.0, origin[1]]),
        Field::Y => StreetChange::Origin([origin[0], n / 5.0]),
        Field::Angle => StreetChange::Angle(n),
        Field::Length => StreetChange::Dimensions {
            lanes,
            length: n as usize,
        },
        Field::Lanes => StreetChange::Dimensions {
            lanes: n as usize,
            length,
        },
        Field::Generation => StreetChange::Generation(n),
        Field::LaneChange => StreetChange::LaneChange(n),
        _ => unreachable!(),
    })
}
