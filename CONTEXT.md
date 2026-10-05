# FLUVI Traffic Simulation

FLUVI models traffic moving through a visually editable network of streets.

## Language

**Calle (street)**:
A positioned stretch of road with lanes and cells through which simulated vehicles move. Its type may be `GENERADOR`, `CONEXION`, or `DEVORADOR`.

**Conexión entre calles (street connection)**:
A directed transfer of vehicles from a lane and cell of one street to a lane and cell of another. It is distinct from a street whose type is `CONEXION`.
_Avoid_: Using “connection street” to mean a link between two streets.

**Transfer mapping**:
One directed source-street lane and cell to destination-street lane and cell relationship. A street connection may contain several such mappings; mappings can share an endpoint without being identical.

**Curve control point**:
An off-street handle that pulls the shape of a curved street. It is not an intermediate street endpoint or a traffic connection. Removing it changes the street's shape, not its existence.

**Street centerline**:
The path from the start to the end of a street around which its lanes are positioned. Its shape is distinct from the directed street connections that transfer vehicles between streets.

**Etiqueta (map label)**:
The name of a street or building displayed on the map. It is attached to that object, not a standalone text annotation.

**Edificio (building)**:
A named object on the map with a fixed appearance mode chosen when it is created: rectangular, polygonal, or image-based. Parking behavior is independent of its appearance.

**Edificio rectangular (rectangular building)**:
A building with independent width and height; equal sides make it a square.
_Avoid_: Using “square” for every rectangular building.

**Edificio poligonal (polygonal building)**:
A building whose visible footprint follows a user-defined polygon rather than a rectangle.

**Edificio con imagen (image building)**:
A building whose user-provided image is displayed within a rectangular footprint, rather than used to derive its outline.

**Estacionamiento funcional (functional parking building)**:
A building connected to streets that participates in vehicle parking behavior, regardless of its appearance or name. A parking-themed image or name alone does not make a building a functional parking facility.
