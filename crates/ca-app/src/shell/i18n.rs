use std::collections::BTreeMap;

#[cfg(test)]
pub(super) fn validate_catalogs(
    es: &BTreeMap<String, String>,
    en: &BTreeMap<String, String>,
) -> Result<(), String> {
    if !es.keys().eq(en.keys()) {
        return Err("catalog keys or plural forms differ".into());
    }
    let placeholders = |text: &str| {
        let mut names: Vec<_> = text
            .split("{{")
            .skip(1)
            .filter_map(|part| part.split_once("}}").map(|(name, _)| name.to_owned()))
            .collect();
        names.sort();
        names
    };
    for (key, text) in es {
        if placeholders(text) != placeholders(&en[key]) {
            return Err(format!("placeholders differ: {key}"));
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Language {
    #[default]
    Spanish,
    English,
}

impl Language {
    pub fn from_preference(value: &str) -> Self {
        if value == "en" {
            Self::English
        } else {
            Self::Spanish
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Self::Spanish => "es",
            Self::English => "en",
        }
    }
}

/// Immutable for the session. Parameters are data, never keys or markup.
pub struct Translator {
    language: Language,
    es: BTreeMap<String, String>,
    en: BTreeMap<String, String>,
}

impl Translator {
    pub(super) fn language(&self) -> Language {
        self.language
    }

    pub fn new(language: Language) -> Self {
        Self {
            language,
            es: serde_json::from_str(include_str!("es.json")).expect("built-in Spanish catalog"),
            en: serde_json::from_str(include_str!("en.json")).expect("built-in English catalog"),
        }
    }

    pub fn tr(&self, key: &str, params: &[(&str, &str)]) -> String {
        let plural_key = params
            .iter()
            .find(|(name, _)| *name == "count")
            .map(|(_, count)| {
                let form = match count.parse::<f64>().map(f64::abs) {
                    Ok(1.0) => "one",
                    Ok(n)
                        if self.language == Language::Spanish
                            && n != 0.0
                            && n % 1_000_000.0 == 0.0 =>
                    {
                        "many"
                    }
                    _ => "other",
                };
                format!("{key}_{form}")
            });
        let catalog = match self.language {
            Language::Spanish => &self.es,
            Language::English => &self.en,
        };
        let lookup = |catalog: &BTreeMap<String, String>| {
            plural_key
                .as_ref()
                .and_then(|key| catalog.get(key))
                .or_else(|| catalog.get(key))
                .cloned()
        };
        let template = lookup(catalog)
            .or_else(|| lookup(&self.es))
            .unwrap_or_else(|| key.to_owned());
        // Expand only the original template, so a name containing {{...}} stays literal.
        let mut output = String::new();
        let mut rest = template.as_str();
        while let Some((prefix, tail)) = rest.split_once("{{") {
            output.push_str(prefix);
            let Some((name, suffix)) = tail.split_once("}}") else {
                output.push_str("{{");
                rest = tail;
                break;
            };
            if let Some((_, value)) = params.iter().find(|(key, _)| *key == name) {
                output.push_str(value);
            } else {
                output.push_str("{{");
                output.push_str(name);
                output.push_str("}}");
            }
            rest = suffix;
        }
        output.push_str(rest);
        output
    }
}
