//! Weekly simulation time. Export strings never depend on the UI language.
pub const SECONDS_PER_TICK: u32 = 2;
pub const DAY_KEYS: [&str; 7] = [
    "clock.sunday",
    "clock.monday",
    "clock.tuesday",
    "clock.wednesday",
    "clock.thursday",
    "clock.friday",
    "clock.saturday",
];
const EXPORT_DAYS: [&str; 7] = [
    "Domingo",
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Clock {
    day: u8,
    hour: u8,
    minute: u8,
    second: u8,
}

impl Default for Clock {
    fn default() -> Self {
        Self {
            day: 1,
            hour: 7,
            minute: 0,
            second: 0,
        }
    }
}

impl Clock {
    pub fn new(day: u8, hour: u8, minute: u8, second: u8) -> Option<Self> {
        (day < 7 && hour < 24 && minute < 60 && second < 60).then_some(Self {
            day,
            hour,
            minute,
            second,
        })
    }
    pub fn parts(self) -> [u8; 4] {
        [self.day, self.hour, self.minute, self.second]
    }
    pub fn day_key(self) -> &'static str {
        DAY_KEYS[self.day as usize]
    }
    pub fn numeric(self) -> String {
        format!("{:02}:{:02}:{:02}", self.hour, self.minute, self.second)
    }
    pub fn export_timestamp(self) -> String {
        format!("{} {}", EXPORT_DAYS[self.day as usize], self.numeric())
    }
    fn advance(&mut self) {
        let seconds =
            ((u32::from(self.day) * 24 + u32::from(self.hour)) * 60 + u32::from(self.minute)) * 60
                + u32::from(self.second)
                + SECONDS_PER_TICK;
        self.day = ((seconds / 86400) % 7) as u8;
        self.hour = ((seconds / 3600) % 24) as u8;
        self.minute = ((seconds / 60) % 60) as u8;
        self.second = (seconds % 60) as u8;
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct VirtualTime {
    pub clock: Clock,
    pub active: bool,
    pub enabled: bool,
    profiles: [[f64; 24]; 7],
}

impl Default for VirtualTime {
    fn default() -> Self {
        Self {
            clock: Clock::default(),
            active: true,
            enabled: true,
            profiles: DEFAULT_PROFILES,
        }
    }
}

impl VirtualTime {
    pub fn profiles(&self) -> &[[f64; 24]; 7] {
        &self.profiles
    }
    pub fn set_profile(&mut self, day: usize, values: [f64; 24]) -> bool {
        if day >= 7
            || values
                .iter()
                .any(|n| !n.is_finite() || !(0.0..=3.0).contains(n))
        {
            return false;
        }
        self.profiles[day] = values;
        true
    }
    /// Apply profile settings without replacing the live clock or its active state.
    pub fn apply_profiles(&mut self, settings: &Self) {
        self.enabled = settings.enabled;
        self.profiles = settings.profiles;
    }
    pub fn from_json(value: &serde_json::Value) -> Option<Self> {
        let mut time = Self::default();
        if value.is_null() {
            return Some(time);
        }
        value.as_object()?;
        let read = |key: &str, default: u8| -> Option<u8> {
            value
                .get(key)
                .map_or(Some(default), |v| u8::try_from(v.as_u64()?).ok())
        };
        time.clock = Clock::new(
            read("diaActual", 1)?,
            read("horaActual", 7)?,
            read("minutoActual", 0)?,
            read("segundoActual", 0)?,
        )?;
        time.active = value.get("activo").map_or(Some(true), |v| v.as_bool())?;
        time.enabled = value
            .get("usarPerfiles")
            .map_or(Some(true), |v| v.as_bool())?;
        let read_day = |v: &serde_json::Value| -> Option<[f64; 24]> {
            let values = v.as_array()?;
            if values.len() != 24 {
                return None;
            }
            let mut day = [0.0; 24];
            for (target, value) in day.iter_mut().zip(values) {
                *target = value
                    .as_f64()
                    .filter(|n| n.is_finite() && (0.0..=3.0).contains(n))?;
            }
            Some(day)
        };
        if let Some(profiles) = value.get("multiplicadoresPorDiaHora") {
            profiles.as_object()?;
            for day in 0..7 {
                if let Some(profile) = profiles.get(day.to_string()) {
                    time.profiles[day] = read_day(profile)?;
                }
            }
        } else if let Some(profile) = value.get("multiplicadoresPorHora") {
            time.profiles = [read_day(profile)?; 7];
        }
        Some(time)
    }
    pub fn to_json(&self) -> serde_json::Value {
        let [day, hour, minute, second] = self.clock.parts();
        let profiles: serde_json::Map<String, serde_json::Value> = self
            .profiles
            .iter()
            .enumerate()
            .map(|(i, values)| (i.to_string(), serde_json::json!(values)))
            .collect();
        serde_json::json!({
            "activo": self.active, "diaActual": day, "horaActual": hour,
            "minutoActual": minute, "segundoActual": second, "usarPerfiles": self.enabled,
            "segundosPorPaso": SECONDS_PER_TICK, "multiplicadoresPorDiaHora": profiles,
        })
    }
    /// First significant change (> 0.3), across the actual weekly calendar.
    pub fn next_change(&self) -> Option<Forecast> {
        if !self.enabled {
            return None;
        }
        let hour = usize::from(self.clock.day) * 24 + usize::from(self.clock.hour);
        for offset in 1..=168 {
            let next = (hour + offset) % 168;
            let multiplier = self.profiles[next / 24][next % 24];
            if (multiplier - self.multiplier()).abs() > 0.3 {
                return Some(Forecast {
                    clock: Clock::new((next / 24) as u8, (next % 24) as u8, 0, 0)?,
                    seconds_remaining: offset as u32 * 3600
                        - u32::from(self.clock.minute) * 60
                        - u32::from(self.clock.second),
                    multiplier,
                });
            }
        }
        None
    }
    pub fn advance(&mut self) {
        if self.active {
            self.clock.advance();
        }
    }
    pub fn multiplier(&self) -> f64 {
        if self.enabled {
            self.profiles[self.clock.day as usize][self.clock.hour as usize]
        } else {
            1.0
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Forecast {
    pub clock: Clock,
    pub seconds_remaining: u32,
    pub multiplier: f64,
}

// v1 MULTIPLICADORES_POR_DIA_HORA. Sunday is index zero.
pub const DEFAULT_PROFILES: [[f64; 24]; 7] = [
    [
        0.0, 0.0, 0.1, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.3, 0.4, 0.6, 0.6, 0.7, 0.7, 0.7, 0.7, 0.6,
        0.6, 0.5, 0.2, 0.1, 0.0, 0.0,
    ],
    [
        0.0, 0.05, 0.08, 0.1, 0.2, 0.1, 0.4, 1.2, 1.4, 1.0, 0.6, 0.7, 0.9, 1.0, 0.9, 0.8, 0.8, 1.1,
        1.4, 1.3, 1.1, 0.4, 0.2, 0.0,
    ],
    [
        0.0, 0.05, 0.08, 0.2, 0.2, 0.2, 0.4, 1.2, 1.4, 1.0, 0.7, 0.7, 0.9, 1.0, 0.9, 0.8, 0.8, 1.1,
        1.5, 1.3, 1.1, 0.2, 0.1, 0.0,
    ],
    [
        0.0, 0.05, 0.08, 0.1, 0.2, 0.1, 0.4, 1.3, 1.5, 1.0, 0.5, 0.7, 0.9, 1.1, 1.0, 0.8, 0.9, 1.2,
        1.5, 1.4, 1.2, 0.3, 0.2, 0.0,
    ],
    [
        0.0, 0.05, 0.08, 0.2, 0.2, 0.2, 0.4, 1.3, 1.5, 1.0, 0.7, 0.7, 0.9, 1.1, 1.0, 0.8, 1.0, 1.3,
        1.6, 1.5, 1.0, 0.2, 0.1, 0.0,
    ],
    [
        0.0, 0.1, 0.1, 0.1, 0.2, 0.3, 0.5, 1.5, 1.8, 1.3, 0.8, 0.8, 1.0, 1.2, 1.1, 0.9, 1.7, 2.1,
        3.0, 2.5, 1.0, 0.5, 0.2, 0.0,
    ],
    [
        0.0, 0.1, 0.2, 0.3, 0.3, 0.3, 0.3, 0.3, 0.4, 0.5, 0.8, 0.9, 1.0, 1.2, 1.3, 1.3, 1.2, 1.1,
        1.0, 0.9, 0.5, 0.1, 0.1, 0.0,
    ],
];
