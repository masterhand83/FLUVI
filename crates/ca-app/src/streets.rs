//! UI street order is separate from physical model order.
use ca_core::map_json::MapDocument;
use icu_collator::{
    Collator,
    options::{CollatorOptions, Strength},
    preferences::CollationNumericOrdering,
};

pub fn sorted_streets(document: &MapDocument) -> Vec<usize> {
    let mut options = CollatorOptions::default();
    options.strength = Some(Strength::Primary);
    let mut preferences = icu_locale_core::locale!("es").into();
    // Match Intl.Collator('es', {sensitivity:'base', numeric:true}).
    let preferences: &mut icu_collator::CollatorPreferences = &mut preferences;
    preferences.numeric_ordering = Some(CollationNumericOrdering::True);
    let collator = Collator::try_new(*preferences, options).expect("compiled Spanish collation");
    let mut indices: Vec<_> = (0..document.layout().len()).collect();
    indices.sort_by(|&a, &b| {
        collator
            .compare(&document.layout()[a].name, &document.layout()[b].name)
            .then(a.cmp(&b))
    });
    indices
}

pub use ca_core::streets::StreetEvent;
