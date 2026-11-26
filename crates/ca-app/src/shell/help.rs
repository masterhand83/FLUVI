//! Offline copies of the v1 information and guide dialogs.
use super::{Language, Shell};
use eframe::egui;
use std::sync::OnceLock;

struct Catalog {
    information: Document,
    guide: Document,
}

struct Document {
    title: String,
    blocks: Vec<Block>,
}

struct Block {
    kind: Kind,
    text: String,
}

enum Kind {
    Heading,
    Paragraph,
    Item,
    Code,
    Row,
}

fn parse(source: &str) -> Catalog {
    let value: serde_json::Value = serde_json::from_str(source).expect("built-in help JSON");
    let read = |name: &str| {
        let doc = &value[name];
        Document {
            title: doc["title"].as_str().expect("help title").into(),
            blocks: doc["blocks"]
                .as_array()
                .expect("help blocks")
                .iter()
                .map(|block| Block {
                    kind: match block["kind"].as_str().expect("help block kind") {
                        "heading" => Kind::Heading,
                        "paragraph" => Kind::Paragraph,
                        "item" => Kind::Item,
                        "code" => Kind::Code,
                        "row" => Kind::Row,
                        kind => panic!("unknown help block: {kind}"),
                    },
                    text: block["text"].as_str().expect("help block text").into(),
                })
                .collect(),
        }
    };
    Catalog {
        information: read("information"),
        guide: read("guide"),
    }
}

fn document(language: Language, guide: bool) -> &'static Document {
    static ES: OnceLock<Catalog> = OnceLock::new();
    static EN: OnceLock<Catalog> = OnceLock::new();
    let catalog = match language {
        Language::Spanish => ES.get_or_init(|| parse(include_str!("help/es.json"))),
        Language::English => EN.get_or_init(|| parse(include_str!("help/en.json"))),
    };
    if guide {
        &catalog.guide
    } else {
        &catalog.information
    }
}

impl Shell {
    pub(super) fn help_ui(&self, ui: &mut egui::Ui, guide: bool) {
        let document = document(self.translator().language(), guide);
        crate::icons::heading(
            ui,
            if guide {
                crate::icons::Icon::Guide
            } else {
                crate::icons::Icon::About
            },
            document.title.clone(),
        );
        egui::ScrollArea::vertical()
            .id_salt(("full-help", guide))
            .max_height((ui.ctx().content_rect().height() - 180.0).max(60.0))
            .auto_shrink([false, true])
            .show(ui, |ui| {
                for block in &document.blocks {
                    match block.kind {
                        Kind::Heading => {
                            ui.add_space(10.0);
                            ui.strong(&block.text);
                            ui.separator();
                        }
                        Kind::Item => {
                            ui.horizontal_top(|ui| {
                                ui.label("•");
                                ui.add(egui::Label::new(&block.text).wrap());
                            });
                        }
                        Kind::Code => {
                            egui::ScrollArea::horizontal()
                                .id_salt("help-json-example")
                                .show(ui, |ui| {
                                    ui.monospace(&block.text);
                                });
                        }
                        Kind::Row => {
                            ui.monospace(&block.text);
                        }
                        Kind::Paragraph => {
                            ui.add(egui::Label::new(&block.text).wrap());
                        }
                    }
                }
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn information_retains_all_sections_example_and_credits_in_both_languages() {
        for (language, headings) in [
            (
                Language::English,
                [
                    "Introduction",
                    "Algorithms",
                    "File Format",
                    "Warnings",
                    "Credits",
                ],
            ),
            (
                Language::Spanish,
                [
                    "Introducción",
                    "Algoritmos",
                    "Formato de Archivos",
                    "Advertencias",
                    "Créditos",
                ],
            ),
        ] {
            let doc = document(language, false);
            for heading in headings {
                assert!(
                    doc.blocks
                        .iter()
                        .any(|b| matches!(b.kind, Kind::Heading) && b.text.contains(heading)),
                    "{heading}"
                );
            }
            for credit in [
                "Connor Urbano Mendoza",
                "Luis Gael Molina Figueroa",
                "Denisse Márquez Morales",
                "Juárez Martínez Genaro",
                "Maldonado Castillo Idalia",
                "Artificial Life Robotics",
            ] {
                assert!(
                    doc.blocks.iter().any(|b| b.text.contains(credit)),
                    "{credit}"
                );
            }
            let code = doc
                .blocks
                .iter()
                .find(|b| matches!(b.kind, Kind::Code))
                .unwrap();
            let example: serde_json::Value = serde_json::from_str(&code.text).unwrap();
            assert_eq!(example["calles"][0]["carriles"], 3);
            assert_eq!(example["edificios"][0]["label"], "ESCOM");
            assert_eq!(
                doc.blocks
                    .iter()
                    .filter(|b| matches!(b.kind, Kind::Row))
                    .count(),
                9
            );
        }
    }

    #[test]
    fn guide_retains_controls_parking_metrics_and_full_analyzer() {
        for (language, topics) in [
            (
                Language::English,
                [
                    "Basic Controls",
                    "Parking",
                    "Simulator Metrics",
                    "Distributions",
                ],
            ),
            (
                Language::Spanish,
                [
                    "Controles Básicos",
                    "Estacionamientos",
                    "Métricas del Simulador",
                    "Distribuciones",
                ],
            ),
        ] {
            let doc = document(language, true);
            for topic in topics {
                assert!(doc.blocks.iter().any(|b| b.text.contains(topic)), "{topic}");
            }
            assert!(doc.blocks.last().unwrap().text.contains("60-90"));
        }
    }
}
