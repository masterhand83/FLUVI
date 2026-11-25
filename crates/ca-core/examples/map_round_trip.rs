use ca_core::map_json::MapDocument;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let map = MapDocument::parse(include_str!("../tests/fixtures/map-v1.json"))?;
    std::fs::write(
        "crates/ca-core/tests/fixtures/map-v2.json",
        map.to_json() + "\n",
    )?;
    Ok(())
}
