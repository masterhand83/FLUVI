//! Stable v1 artwork keys. Paths are relative to the bundled v1 image directory.
pub fn path(key: &str) -> Option<&'static str> {
    Some(match key.to_lowercase().as_str() {
        "escom" => "buildings/ESCOM.png",
        "cic" | "poi-ipn" | "oic-ipn" | "sad-ipn" | "siis-ipn" | "secademica-ipn" | "cendi"
        | "biblioteca" => "buildings/CIC.png",
        "c.f.i.e" => "buildings/C.F.I.E.png",
        "planetario" => "buildings/planetario.png",
        "plaza torres lindavista" => "buildings/torres_lindavista.png",
        "alberca" => "buildings/ALBERCA.png",
        "campo burros blancos" => "buildings/CAMPO BURROS BLANCOS ESTADIO WILFRIDO MASSIEU.png",
        "establo de burros" => "buildings/establo de burros.png",
        "centro cultural jtb" => "buildings/CENTRO CULTURAL JTB.png",
        "dirección general" => "buildings/Dirección General.png",
        "edificio inteligente" => "buildings/EDIFICIO INTELIGENTE.png",
        "esime" | "esime edificio 2" | "esime edificio 3" | "esime edificio 4"
        | "esime edificio 5" | "esfm" | "esiqie edificio 7" | "esiqie edificio 8" | "esiquie"
        | "esia" => "buildings/ESIME ESIQIE ESFM ETC.png",
        "estadio americano" => "buildings/ESTADIO AMERICANO.png",
        "beisbol" => "buildings/campo beisbol.png",
        "campo escom" => "buildings/campo escom.png",
        "campo tiro con arco" => "buildings/campo tiro con arco.png",
        "ciclovía" => "buildings/ciclovia.png",
        "gimnasio" => "buildings/GIMNASIO.png",
        "cenlex" => "buildings/cenlex.png",
        "cidetec" => "buildings/CIDETEC falta en el mapa.png",
        "dae" => "buildings/DAE_falta_en_el_mapa.png",
        "estacionamiento" => "buildings/estacionamientos.png",
        "est" => "buildings/EST.png",
        "cono" => "objects/cono.png",
        "bache" => "objects/Bache.png",
        "trabajador" => "objects/Trabajador.png",
        "arbol" => "objects/Arbol.png",
        "inundacion" => "objects/Inundacion.png",
        _ => return None,
    })
}
