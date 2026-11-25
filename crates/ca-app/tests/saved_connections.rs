use ca_app::connections::SavedConnections;
use ca_core::{
    connections::{Connection, Mapping},
    map_json::MapDocument,
    streets::{StreetChange, StreetEdit},
    traffic::LaneDirection,
};

fn document() -> MapDocument {
    let mut doc = MapDocument::parse(
        r#"{"calles":[
        {"nombre":"Árbol Norte","tipo":"conexion","tamano":4},
        {"nombre":"Destino Sur","tipo":"conexion","tamano":5}
    ]}"#,
    )
    .unwrap();
    doc.add_connection(Connection::Lineal(Mapping {
        source_street: 0,
        source_lane: 0,
        source_cell: -1,
        destination_street: 1,
        destination_lane: 0,
        destination_cell: 0,
    }))
    .unwrap();
    doc
}

#[test]
fn search_matches_either_street_without_changing_saved_names() {
    let doc = document();
    let before = doc.to_json();
    let mut list = SavedConnections {
        search: "ÁRBOL".into(),
    };
    assert_eq!(list.rows(&doc).len(), 1);
    list.search = "sur".into();
    let rows = list.rows(&doc);
    assert_eq!(rows[0].source, "Árbol Norte");
    assert_eq!(rows[0].destination, "Destino Sur");
    list.search = "missing".into();
    assert!(list.rows(&doc).is_empty());
    assert_eq!(doc.to_json(), before);
}

#[test]
fn direction_warning_updates_without_replacing_the_list() {
    let mut doc = document();
    let list = SavedConnections::default();
    assert!(!list.rows(&doc)[0].incompatible);
    doc.edit_streets(StreetEdit::Update(
        0,
        StreetChange::Direction {
            lane: 0,
            direction: LaneDirection::Reverse,
        },
    ))
    .unwrap();
    assert!(list.rows(&doc)[0].incompatible);
}

#[test]
fn editing_replaces_in_place_and_cancel_keeps_the_original() {
    use ca_app::connection_draft::ConnectionDraft;
    let mut doc = document();
    let before = doc.to_json();
    let mut draft = ConnectionDraft::default();
    assert!(draft.edit(0, &doc));
    assert_eq!(draft.editing(), Some(0));
    draft.cancel();
    assert_eq!(doc.to_json(), before);
    draft.edit(0, &doc);
    // An unchanged saved link must not conflict with itself.
    let candidate = draft.candidate(&doc).unwrap();
    doc.replace_connection(0, candidate).unwrap();
    assert_eq!(doc.model().connections().len(), 1);
    draft.edit(0, &doc);
    draft.rows_mut()[0].mapping.source_cell = 2;
    draft.rows_mut()[0].mapping.destination_cell = 1;
    doc.replace_connection(0, draft.candidate(&doc).unwrap())
        .unwrap();
    let Connection::Lineal(saved) = &doc.model().connections()[0] else {
        panic!("linear")
    };
    assert_eq!((saved.source_cell, saved.destination_cell), (2, 1));
    draft.rows_mut()[0].mapping.destination_lane = 99;
    assert!(draft.candidate(&doc).is_err());
    draft.cancel();
    assert_eq!(doc.model().connections().len(), 1);
    let restored = MapDocument::parse(&doc.to_json()).unwrap();
    assert_eq!(restored.model().connections(), doc.model().connections());
}

#[test]
fn replacement_cannot_duplicate_another_link_and_failure_is_atomic() {
    let mut doc = document();
    let other = Connection::Lineal(Mapping {
        source_street: 0,
        source_lane: 0,
        source_cell: 2,
        destination_street: 1,
        destination_lane: 0,
        destination_cell: 1,
    });
    doc.add_connection(other.clone()).unwrap();
    let before = doc.to_json();
    assert_eq!(
        doc.replace_connection(0, other),
        Err(ca_core::connections::ConnectionError::Duplicate)
    );
    assert_eq!(doc.to_json(), before);
    assert_eq!(doc.model().connections().len(), 2);
}

#[test]
fn form_and_map_use_the_same_validation() {
    use ca_app::connection_draft::{ConnectionDraft, DraftKind};
    let doc = document();
    let mut form = ConnectionDraft::default();
    form.start_form();
    form.select_streets(0, 1, &doc);
    assert_eq!(
        form.candidate(&doc),
        Err(ca_core::connections::ConnectionError::Duplicate)
    );
    form.set_kind(DraftKind::Probabilistica, &doc);
    form.rows_mut()[0].mapping.source_cell = 1;
    form.rows_mut()[0].probability = "101".into();
    assert_eq!(
        form.candidate(&doc),
        Err(ca_core::connections::ConnectionError::Probability)
    );
    form.rows_mut()[0].probability = "25".into();
    assert!(form.candidate(&doc).is_ok());
}

#[test]
fn editing_or_deleting_one_legacy_detail_preserves_adjacent_links() {
    let mut doc = MapDocument::parse(
        r#"{"calles":[
        {"nombre":"A","tipo":"conexion","tamano":4,"carriles":2},
        {"nombre":"B","tipo":"conexion","tamano":5,"carriles":2}
    ],"conexiones":[{"origenIdx":0,"destinoIdx":1,"tipo":"LINEAL","detalles":[
        {"carrilOrigen":0,"posOrigen":-1,"carrilDestino":0,"posDestino":0},
        {"carrilOrigen":1,"posOrigen":-1,"carrilDestino":1,"posDestino":0}
    ]}]}"#,
    )
    .unwrap();
    let original = doc.model().connections()[1].clone();
    let replacement = Connection::Lineal(Mapping {
        source_street: 0,
        source_lane: 0,
        source_cell: 2,
        destination_street: 1,
        destination_lane: 0,
        destination_cell: 1,
    });
    doc.replace_connection(0, replacement.clone()).unwrap();
    assert_eq!(
        MapDocument::parse(&doc.to_json())
            .unwrap()
            .model()
            .connections(),
        &[replacement, original.clone()]
    );
    assert!(doc.delete_connection(0));
    assert_eq!(
        MapDocument::parse(&doc.to_json())
            .unwrap()
            .model()
            .connections(),
        &[original]
    );
    assert!(!doc.delete_connection(99));
}

#[test]
fn replacing_a_link_retains_unowned_link_and_detail_fields() {
    let mut doc = MapDocument::parse(
        r#"{"calles":[
        {"nombre":"A","tipo":"conexion","tamano":4},
        {"nombre":"B","tipo":"conexion","tamano":5}
    ],"conexiones":[{"origenIdx":0,"destinoIdx":1,"tipo":"LINEAL",
        "futureLink":{"value":17},"detalles":[
        {"carrilOrigen":0,"posOrigen":-1,"carrilDestino":0,"posDestino":0,"futureRow":"keep"}
    ]}]}"#,
    )
    .unwrap();
    let link = doc.model().connections()[0].clone();
    doc.replace_connection(0, link).unwrap();
    let data: serde_json::Value = serde_json::from_str(&doc.to_json()).unwrap();
    assert_eq!(data["conexiones"][0]["futureLink"]["value"], 17);
    assert_eq!(data["conexiones"][0]["detalles"][0]["futureRow"], "keep");
}

#[test]
fn displaying_a_saved_independent_group_keeps_each_rows_source() {
    use ca_app::{connection_draft::ConnectionDraft, shell::Shell};
    use eframe::egui;
    let doc = MapDocument::parse(
        r#"{"calles":[
        {"nombre":"A","tipo":"conexion","tamano":4},
        {"nombre":"B","tipo":"conexion","tamano":5}
    ],"conexiones":[{"origenIdx":0,"destinoIdx":1,"tipo":"PROBABILISTICA",
        "independentProbabilities":true,"detalles":[
        {"carrilOrigen":0,"posOrigen":1,"carrilDestino":0,"posDestino":1,"probabilidad":0.25},
        {"carrilOrigen":0,"posOrigen":2,"carrilDestino":0,"posDestino":2,"probabilidad":0.35}
    ]}]}"#,
    )
    .unwrap();
    let mut draft = ConnectionDraft::default();
    draft.edit(0, &doc);
    let ctx = egui::Context::default();
    let shell = Shell::load(None);
    for _ in 0..2 {
        let _ = ctx.run(Default::default(), |ctx| {
            draft.show(
                ctx,
                egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(1000.0, 800.0)),
                &doc,
                &shell,
            );
        });
    }
    assert_eq!(draft.candidate(&doc).unwrap(), doc.model().connections()[0]);
}

#[test]
fn editing_preserves_disabled_saved_merge_rows_for_later_reenable() {
    use ca_app::connection_draft::ConnectionDraft;
    let mut doc = MapDocument::parse(
        r#"{"calles":[
        {"nombre":"A","tipo":"conexion","tamano":4,"carriles":2},
        {"nombre":"B","tipo":"conexion","tamano":5}
    ],"conexiones":[{"origenIdx":0,"destinoIdx":1,"tipo":"INCORPORACION","detalles":[
        {"carrilOrigen":0,"posOrigen":-1,"carrilDestino":0,"posDestino":0,"enabled":true},
        {"carrilOrigen":1,"posOrigen":-1,"carrilDestino":0,"posDestino":1,"enabled":false}
    ]}]}"#,
    )
    .unwrap();
    let original = doc.model().connections()[0].clone();
    let mut draft = ConnectionDraft::default();
    draft.edit(0, &doc);
    assert_eq!(draft.preview_mappings(&doc).count(), 1);
    doc.replace_connection(0, draft.candidate(&doc).unwrap())
        .unwrap();
    assert_eq!(doc.model().connections(), &[original]);
    draft.edit(0, &doc);
    draft.rows_mut()[1].enabled = true;
    let Connection::Incorporacion(rows) = draft.candidate(&doc).unwrap() else {
        panic!("merge")
    };
    assert!(rows[1].enabled);
    assert_eq!(rows[1].mapping.source_lane, 1);
    for row in draft.rows_mut() {
        row.enabled = false;
    }
    doc.replace_connection(0, draft.candidate(&doc).unwrap())
        .unwrap();
    draft.edit(0, &doc);
    let Connection::Incorporacion(rows) = draft.candidate(&doc).unwrap() else {
        panic!("disabled merge")
    };
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|row| !row.enabled));
    doc.edit_streets(StreetEdit::Update(
        0,
        StreetChange::Direction {
            lane: 1,
            direction: LaneDirection::Reverse,
        },
    ))
    .unwrap();
    draft.edit(0, &doc);
    draft.rows_mut()[0].enabled = true;
    doc.replace_connection(0, draft.candidate(&doc).unwrap())
        .unwrap();
    assert!(!SavedConnections::default().rows(&doc)[0].incompatible);
    assert_eq!(
        MapDocument::parse(&doc.to_json())
            .unwrap()
            .model()
            .connections(),
        doc.model().connections()
    );
}
