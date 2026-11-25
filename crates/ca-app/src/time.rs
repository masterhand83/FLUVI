//! Validated dialog drafts. Editing a draft never changes live traffic.
use crate::shell::Shell;
use crate::shell::Translator;
use ca_core::virtual_time::Clock;
use ca_core::virtual_time::{DEFAULT_PROFILES, VirtualTime};
use eframe::egui;

pub fn display_clock(clock: Clock, translator: &Translator) -> String {
    format!(
        "{} {}",
        translator.tr(clock.day_key(), &[]),
        clock.numeric()
    )
}

pub struct TimeDraft {
    pub day: u8,
    pub hour: String,
    pub minute: String,
    pub second: String,
}

impl TimeDraft {
    pub fn new(clock: Clock) -> Self {
        let [day, hour, minute, second] = clock.parts();
        Self {
            day,
            hour: hour.to_string(),
            minute: minute.to_string(),
            second: second.to_string(),
        }
    }
    pub fn candidate(&self) -> Option<Clock> {
        Clock::new(
            self.day,
            self.hour.parse().ok()?,
            self.minute.parse().ok()?,
            self.second.parse().ok()?,
        )
    }
}

#[derive(Clone, Copy)]
pub enum Preset {
    Workday,
    Weekend,
    Constant,
    Night,
}
#[derive(Clone, Copy)]
pub enum Scope {
    Selected,
    Weekdays,
    Weekend,
    All,
}

pub struct ProfileDraft {
    original: VirtualTime,
    pub enabled: bool,
    pub day: usize,
    pub values: [[String; 24]; 7],
}

impl ProfileDraft {
    pub fn new(time: &VirtualTime) -> Self {
        Self {
            original: time.clone(),
            enabled: time.enabled,
            day: time.clock.parts()[0] as usize,
            values: time.profiles().map(|day| day.map(|v| v.to_string())),
        }
    }
    pub fn candidate(&self) -> Option<VirtualTime> {
        let mut time = self.original.clone();
        time.enabled = self.enabled;
        for (day, values) in self.values.iter().enumerate() {
            let mut profile = [0.0; 24];
            for (target, value) in profile.iter_mut().zip(values) {
                // Only dot decimals, no comma, NaN, exponent, or signs.
                if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
                    return None;
                }
                *target = value.parse().ok()?;
            }
            if !time.set_profile(day, profile) {
                return None;
            }
        }
        Some(time)
    }
    pub fn copy_to_all(&mut self) {
        self.values = std::array::from_fn(|_| self.values[self.day].clone());
    }
    pub fn restore(&mut self, scope: Scope) {
        for (day, defaults) in DEFAULT_PROFILES.iter().enumerate() {
            if match scope {
                Scope::Selected => day == self.day,
                Scope::Weekdays => (1..=5).contains(&day),
                Scope::Weekend => day == 0 || day == 6,
                Scope::All => true,
            } {
                self.values[day] = defaults.map(|v| v.to_string());
            }
        }
    }
    pub fn preset(&mut self, preset: Preset) {
        let values: [f64; 24] = match preset {
            Preset::Workday => [
                0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.5, 1.5, 1.8, 1.3, 0.8, 0.8, 1.0, 1.2, 1.1, 0.9,
                0.8, 1.2, 1.7, 1.6, 1.3, 0.7, 0.5, 0.3,
            ],
            Preset::Weekend => [
                0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.4, 0.5, 0.8, 0.9, 1.0, 1.2, 1.3, 1.3,
                1.2, 1.1, 1.0, 0.9, 0.7, 0.6, 0.5, 0.4,
            ],
            Preset::Constant => [1.0; 24],
            Preset::Night => [
                1.5, 1.5, 1.3, 1.0, 0.8, 0.5, 0.3, 0.2, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
                1.0, 1.2, 1.4, 1.6, 1.8, 1.8, 1.7, 1.6,
            ],
        };
        self.values[self.day] = values.map(|v| v.to_string());
    }
}

pub enum TimeAction {
    Scenario(Clock),
    Profiles(Box<VirtualTime>),
}

#[derive(Default)]
pub struct TimeDialogs {
    time: Option<TimeDraft>,
    profiles: Option<ProfileDraft>,
}

impl TimeDialogs {
    pub fn is_open(&self) -> bool {
        self.time.is_some() || self.profiles.is_some()
    }
    pub fn open_time(&mut self, clock: Clock) {
        self.time = Some(TimeDraft::new(clock));
    }
    pub fn open_profiles(&mut self, time: &VirtualTime) {
        self.profiles = Some(ProfileDraft::new(time));
    }
    pub fn accepted(&mut self) {
        self.time = None;
        self.profiles = None;
    }
    pub fn show(
        &mut self,
        ctx: &egui::Context,
        shell: &Shell,
        street_session_active: bool,
    ) -> Option<TimeAction> {
        if street_session_active || ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            self.accepted();
            return None;
        }
        let mut action = None;
        let mut open = true;
        if let Some(draft) = &mut self.time {
            egui::Window::new(shell.tr("clock.setTime", &[]))
                .open(&mut open)
                .collapsible(false)
                .show(ctx, |ui| {
                    day_selector(ui, shell, &mut draft.day);
                    for (key, field) in [
                        ("clock.hour", &mut draft.hour),
                        ("clock.minute", &mut draft.minute),
                        ("clock.second", &mut draft.second),
                    ] {
                        ui.horizontal(|ui| {
                            ui.label(shell.tr(key, &[]));
                            ui.add(egui::TextEdit::singleline(field).desired_width(55.0));
                        });
                    }
                    let clock = draft.candidate();
                    if let Some(clock) = clock {
                        ui.label(display_clock(clock, shell.translator()));
                    } else {
                        ui.colored_label(egui::Color32::RED, shell.tr("clock.invalidTime", &[]));
                    }
                    ui.label(shell.tr("clock.resetWarning", &[]));
                    if ui
                        .add_enabled(
                            clock.is_some(),
                            egui::Button::new(shell.tr("clock.apply", &[])),
                        )
                        .clicked()
                    {
                        action = clock.map(TimeAction::Scenario);
                    }
                });
            if !open {
                self.time = None;
            }
        }
        open = true;
        if let Some(draft) = &mut self.profiles {
            egui::Window::new(shell.tr("clock.profiles", &[]))
                .open(&mut open)
                .collapsible(false)
                .vscroll(true)
                .show(ctx, |ui| {
                    ui.checkbox(&mut draft.enabled, shell.tr("clock.enabled", &[]));
                    let mut day = draft.day as u8;
                    day_selector(ui, shell, &mut day);
                    draft.day = day as usize;
                    ui.label(shell.tr("clock.decimals", &[]));
                    ui.horizontal_wrapped(|ui| {
                        for (key, preset) in [
                            ("clock.workday", Preset::Workday),
                            ("clock.weekend", Preset::Weekend),
                            ("clock.constant", Preset::Constant),
                            ("clock.night", Preset::Night),
                        ] {
                            if ui.button(shell.tr(key, &[])).clicked() {
                                draft.preset(preset);
                            }
                        }
                    });
                    if ui.button(shell.tr("clock.copy", &[])).clicked() {
                        draft.copy_to_all();
                    }
                    ui.horizontal_wrapped(|ui| {
                        ui.label(shell.tr("clock.restore", &[]));
                        for (key, scope) in [
                            ("clock.selected", Scope::Selected),
                            ("clock.weekdays", Scope::Weekdays),
                            ("clock.weekend", Scope::Weekend),
                            ("clock.all", Scope::All),
                        ] {
                            if ui.button(shell.tr(key, &[])).clicked() {
                                draft.restore(scope);
                            }
                        }
                    });
                    egui::Grid::new("hourly_profiles")
                        .num_columns(4)
                        .show(ui, |ui| {
                            for hour in 0..12 {
                                for h in [hour, hour + 12] {
                                    ui.label(format!("{h:02}:00"));
                                    ui.add(
                                        egui::TextEdit::singleline(&mut draft.values[draft.day][h])
                                            .desired_width(60.0),
                                    );
                                }
                                ui.end_row();
                            }
                        });
                    let candidate = draft.candidate();
                    if candidate.is_none() {
                        ui.colored_label(egui::Color32::RED, shell.tr("clock.invalidProfile", &[]));
                    }
                    if ui
                        .add_enabled(
                            candidate.is_some(),
                            egui::Button::new(shell.tr("clock.apply", &[])),
                        )
                        .clicked()
                    {
                        action = candidate.map(|time| TimeAction::Profiles(Box::new(time)));
                    }
                });
            if !open {
                self.profiles = None;
            }
        }
        action
    }
}

fn day_selector(ui: &mut egui::Ui, shell: &Shell, day: &mut u8) {
    egui::ComboBox::from_id_salt("clock_day")
        .selected_text(shell.tr(ca_core::virtual_time::DAY_KEYS[*day as usize], &[]))
        .show_ui(ui, |ui| {
            for (i, key) in ca_core::virtual_time::DAY_KEYS.iter().enumerate() {
                ui.selectable_value(day, i as u8, shell.tr(key, &[]));
            }
        });
}

#[derive(Default)]
pub struct TimeLabels {
    previous: Option<(VirtualTime, crate::shell::Language)>,
    pub clock: String,
    pub multiplier: String,
    pub forecast: Option<String>,
}

impl TimeLabels {
    pub fn refresh(&mut self, time: &VirtualTime, shell: &Shell) {
        let language = shell.preferences().language;
        if self
            .previous
            .as_ref()
            .is_some_and(|(previous, lang)| previous == time && *lang == language)
        {
            return;
        }
        self.clock = display_clock(time.clock, shell.translator());
        self.multiplier = format!("{:.2}×", time.multiplier());
        self.forecast = time.next_change().map(|next| {
            shell.tr(
                "clock.forecast",
                &[
                    ("time", &display_clock(next.clock, shell.translator())),
                    ("minutes", &next.seconds_remaining.div_ceil(60).to_string()),
                    ("multiplier", &format!("{:.2}", next.multiplier)),
                ],
            )
        });
        self.previous = Some((time.clone(), language));
    }
}
