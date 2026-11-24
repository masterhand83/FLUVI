# FLUVI - Vehicular Traffic Flow Simulator

![FLUVI](main/src/assets/logos/logo_horizontal.png)

**[Live Demo](https://fluvi.netlify.app)** · **[Research Paper](https://www.comunidad.escom.ipn.mx/genaro/Papers/Thesis_files/FLUVI.pdf)** · [Report Bug](mailto:simuladordetraficoescomipn@gmail.com)

> Published by **Instituto Politécnico Nacional (IPN)** — ESCOM · ALIROB Lab

---

FLUVI is a virtual-time vehicular traffic simulator built on **Cellular Automata** (CA) theory. Developed as a Bachelor's thesis at the **Instituto Politécnico Nacional (IPN) — ESCOM**, it models complex urban traffic behavior using a modified implementation of **Rule 184**, extended to support multi-lane roads, dynamic intersections, configurable probabilistic connections, and live Shannon entropy metrics.

The system was designed to analyze and optimize traffic flow near academic zones, enabling researchers and urban planners to simulate scenarios before implementing real infrastructure changes.

![FLUVI Screenshot](main/src/assets/logos/FLUVI.png)

---

## Main Features

Maintainers can build separate [Windows, Ubuntu Linux, and macOS desktop packages](docs/v1/desktop.md) around the unchanged v1 application. That guide covers build commands, internet requirements, profile/download locations, and platform acceptance checks.

### Traffic Simulation
- **Cellular Automata**: Modified Rule 184 implementation
- **Multi-lane**: Support for multiple lanes with dynamic lane changes
- **Connections**: Three types of connections (linear, merge, probabilistic) between streets
- **Virtual Time System**: Simulation of days of the week and schedules with dynamic progression
- **Dynamic Traffic Multiplier**: Vehicle generation that varies by day and hour (peak hours, off-peak, etc.)
- **Multiplier Configuration**: Complete system for configuring multipliers by day of the week (7 days) and hour (24 hours), with quick presets and independent values per time range
- **Manual Date/Time Control**: Ability to modify simulated time at any moment
- **Smart Parking**: Vehicle entry/exit system with configurable hourly probabilities
- **Scenario Management**: Save and load complete simulation configurations

### User Interface
- **Visual Editor**: Drag and rotate streets with interactive handles
- **Map Builder**: Create custom simulations from scratch
- **Real-Time Info Bar**: Displays generation count, vehicle population, simulated time, time per frame, and traffic multiplier
- **Date and Time Control**: Intuitive interface for changing the simulator day and time with preview
- **Real-Time Metrics**: Density, flow, and speed charts
- **Minimap**: General overview of the simulation area
- **Dark Mode**: Toggle between light and dark theme with persistence
- **Sidebar Control**: Hide/show side panel with Ctrl+B

### Advanced Features
- **Curved Streets**: Vertex system with angular interpolation
- **Interactive Tooltips**: Information on hover over streets and buildings
- **SHIFT Drag**: Easily move streets in edit mode
- **Edit Handles**: Visual controls to move and rotate streets
- **Day/Night Cycle**: Dynamic background color changes based on simulated time
- **Export/Import**: Save and load simulations in JSON format
- **Layered Rendering**: Z-index system for correct visualization order
- **Interactive Camera**: Zoom with scroll and pan by dragging the canvas

---

## System Metrics

### Density (%)
- `<15%` — Very low
- `15-25%` — Low
- `25-45%` — Moderate
- `45-60%` — Good occupancy
- `60-75%` — High
- `75-85%` — Very high
- `≥85%` — Critical

### Speed (%)
- `<15%` — Stopped
- `15-30%` — Slow
- `30-50%` — Moderate
- `50-70%` — Flowing
- `70-80%` — Very fluid
- `≥80%` — Excellent

### Vehicular Flow (veh/s)
- `<0.8` — Very low
- `0.8-2.0` — Low
- `2.0-3.0` — Moderate
- `3.0-4.0` — Good
- `4.0-4.5` — High
- `≥4.5` — Excellent

### Rate of Change (veh/s)
- `<-3` — Fast decrease
- `-3 to -1` — Slow decrease
- `-1 to 1` — Stable
- `1 to 3` — Slow growth
- `3 to 6` — Moderate growth
- `≥6` — Fast growth

### Shannon Entropy (bits)

Metric that measures the **diversity of the 8 transitions** of the cellular automaton based on the 3-cell neighborhood (left-center-right).

#### Formula
```
H = -Σ(p_i × log₂(p_i))
```

Where `p_i` is the empirical probability (relative frequency) of each transition:

```
p_i = (number of times transition i occurred) / (total cells)
```

#### 8 Measured Transitions (L-C-R Neighborhood)

The calculation is based on the **binary** state of the 3-cell neighborhood in the previous step:
- **0** = empty cell
- **1** = cell with a vehicle (any type 1-6)

| Index | Configuration (L-C-R) | Binary Value | Neighborhood Description |
|-------|-----------------------|--------------|--------------------------|
| 0 | `000` | 0 | Empty — Empty — Empty |
| 1 | `001` | 1 | Empty — Empty — Vehicle |
| 2 | `010` | 2 | Empty — Vehicle — Empty |
| 3 | `011` | 3 | Empty — Vehicle — Vehicle |
| 4 | `100` | 4 | Vehicle — Empty — Empty |
| 5 | `101` | 5 | Vehicle — Empty — Vehicle |
| 6 | `110` | 6 | Vehicle — Vehicle — Empty |
| 7 | `111` | 7 | Vehicle — Vehicle — Vehicle |

**Note**: The configuration is evaluated in the previous state of the automaton (step t-1) for each cell.

#### Value Interpretation

- **0 bits**: Static system (single neighborhood configuration)
  - Example: All cells empty (000 in all positions)
- **~1 bit**: Low diversity (1-2 configurations dominate)
  - Example: Very repetitive pattern with little variation
- **1.5-2.5 bits**: Moderate diversity (mix of several configurations)
  - Example: System with varied traffic patterns
- **3.000 bits**: Theoretical maximum (uniform distribution of all 8 configurations)
  - Example: All configurations occur with equal frequency (log₂(8) = 3)

#### Classification Ranges

- `<0.5` — Homogeneous (very simple system)
- `0.5-1.0` — Low diversity
- `1.0-1.8` — Low-moderate diversity
- `1.8-2.5` — Moderate-high diversity
- `≥2.5` — High diversity (very dynamic system)

### System States

#### 🔴 COLLAPSE
- **Condition**: `density >80% && speed <15%`
- **Description**: Streets are severely congested and nearly paralyzed
- **Typical throughput**: 0-1 veh/s
- **Required action**: Reduce generation or improve exits

#### 🟢 OPTIMAL
- **Condition**: `density 25-60% && speed ≥50%`
- **Description**: Maximum system efficiency: good balance between density and speed
- **Typical throughput**: 2.5-5 veh/s
- **Feature**: System operating at maximum performance

#### 🟠 CONGESTED
- **Condition**: `density >60% && speed <35%`
- **Description**: High vehicle density with slow movement
- **Typical throughput**: 1-2 veh/s
- **Warning**: Risk of collapse if density increases

#### 🔵 UNDERUSED
- **Condition**: `density <25%`
- **Description**: Low street occupancy, available capacity
- **Typical throughput**: 0-1.5 veh/s
- **Recommendation**: Consider increasing generation to use available capacity

#### 🟡 MODERATE
- **Condition**: Other combinations
- **Description**: Acceptable traffic conditions with room for improvement
- **Typical throughput**: Variable
- **Feature**: Default state, functional but improvable

---

## Smart Parking

The system allows converting buildings into functional parking lots that interact with vehicular flow.

### Parking Configuration

**Basic parameters:**
- **Capacity**: Maximum number of vehicles the parking lot can store
- **Entry Connections**: Specific cells on streets where vehicles can enter
- **Exit Connections**: Cells where vehicles leaving the parking lot are generated

**Hourly Probabilities:**
- **Entry Probability** (0-100%): Percentage of vehicles that decide to enter when passing an entry cell
- **Exit Probability** (0-100%): Probability percentage that a vehicle exits the parking lot each frame
- Configurable for each of the 24 hours of the day
- Predefined profiles: Normal, Office, Shopping Center

### System Behavior

**Vehicle Entry:**
- Vehicles arriving at an entry cell are evaluated according to the probability configured for that hour
- If they accept entry, they disappear from traffic and the parking counter increases
- If they reject, they continue their route normally
- Anticipatory absorption system: detects vehicles before they reach the entry

**Vehicle Exit:**
- Vehicles are generated at exit cells according to the hourly probability
- A vehicle is only generated if the exit cell and the previous cell are empty (prevents collisions)
- The type of generated vehicle is random (1-6)
- The parking counter decreases when each vehicle is generated

**Validations:**
- Entries and exits cannot be created in the same cell
- Cells are validated to be within street limits (valid lanes and positions)
- The parking lot does not allow entries if it is full
- Does not generate exits if it is empty

### Scenario Management

The system allows saving and loading complete simulation configurations that include:

**Saved Information:**
- All streets with their positions, angles, lanes, and vertices (curves)
- All buildings with their visual properties
- Complete parking configuration (capacity, connections, probabilities)
- Street connections
- Simulation parameters (generation probabilities, lane changes)

**Features:**
- **Save Scenario**: Exports the current configuration as a JSON file
- **Load Scenario**: Imports a previously saved configuration
- Parking lots maintain their hourly probabilities when saving/loading
- Allows creating libraries of test scenarios

---

## Info Bar

The real-time information bar displays key simulation metrics at the top of the screen:

### Generation
- **Description**: Iteration counter of the cellular automaton (simulation frames)
- **Format**: Integer with thousands separators
- **Use**: Indicates how many simulation steps have been executed since the start

### Vehicles
- **Description**: Total active vehicles on all streets
- **Calculation**: Counts all cells with values 1-6 (vehicle types)
- **Format**: Integer with thousands separators
- **Use**: Monitors vehicle population in real time

### Time
- **Description**: Current simulated time (day, hour, minutes, seconds)
- **Format**: `Day HH:MM:SS` (e.g. "Monday 14:35:42")
- **System**: Virtual time synchronized with the traffic multiplier
- **Control**: Modifiable from "Scenario Configuration" with modal interface

### Time/Frame
- **Description**: Simulated time represented by each frame/generation
- **Format**: Decimal number in seconds (e.g. "0.512s")
- **Use**: Indicates how much simulated time advances in each simulation step

### Vehicle Generation Multiplier per Hour
- **Description**: Dynamic factor that modifies the vehicle generation rate
- **Format**: Decimal number with one decimal place + "×" symbol (e.g. "1.5×")
- **Range**: Varies by day of the week and hour of the day
- **System**: Based on realistic traffic profiles (peak hour, off-peak hour)
- **Use**: Simulates real traffic patterns with higher generation during peak hours

### Simulator Date and Time Control

The system allows manually modifying the simulator date and time through an intuitive modal interface:

**Location**: Scenario Configuration → Change Date and Time

**Features**:
- Day of the week selector (Sunday to Saturday)
- Numeric inputs for hour (0-23) and minutes (0-59)
- Real-time preview of the selected time
- Automatic range validation
- Application with Enter or confirmation button
- Perfect synchronization between sidebar and info bar
- Multiplier cache invalidation when changing date/time

**Usage**:
1. Click "Change Date and Time"
2. Select desired day, hour, and minutes
3. Verify the preview
4. Click "Confirm and Apply"
5. The simulator immediately adjusts the virtual time

### Generation Multiplier Configuration

The system allows configuring custom vehicle generation multipliers by day of the week and hour of the day, enabling simulation of realistic traffic patterns.

**Location**: Scenario Configuration → 📊 Configure Generation Multiplier

**Features**:
- **Per-day configuration**: Independent multipliers for each day of the week (Sunday to Saturday)
- **Per-hour configuration**: 24 sliders (one per hour of the day: 00:00 to 23:00)
- **Value range**: 0.0 (no traffic) to 3.0 (very intense traffic)
- **Range independence**: Each slider controls exclusively its time range (e.g. 08:00 controls from 08:00 to 08:59)
- **Quick presets**:
  - 🏢 **Workday**: Peaks at entry/exit hours (7-9 AM, 6-8 PM)
  - 🎉 **Weekend**: Relaxed pattern with afternoon peak
  - 📊 **Constant**: Uniform traffic (1.0) all day
  - 🌙 **Night**: Inverted pattern (high at night, low during day)
- **Additional functions**:
  - 📋 **Copy to All Days**: Replicates current configuration to all 7 days
  - 🔄 **Restore Default**: Returns to predefined values (a specific day or all)

**Default Configuration** (editable in code):
- **Monday-Thursday**: Typical workdays with morning and evening peaks
- **Friday**: Workday with higher traffic in the afternoon
- **Saturday**: Active weekend with afternoon peak
- **Sunday**: Low and relaxed traffic all day

**Code location**: `main/src/js/core/tiempo.js` (lines 39-89) — variable `MULTIPLICADORES_POR_DIA_HORA`

**Usage**:
1. Click "Configure Generation Multiplier"
2. Select the day of the week to configure
3. Adjust the 24 sliders according to the desired pattern
4. (Optional) Apply a quick preset
5. (Optional) Copy to all days if you want the same pattern
6. Click "Update Multipliers"
7. Changes apply immediately and are saved with the scenario

**Persistence**:
- Configured multipliers are automatically saved when exporting a scenario
- They are automatically loaded when importing a scenario
- Maintains compatibility with previous simulator versions

---

## Technologies Used

### Graphics Engine
- **PixiJS v7+**: High-performance 2D rendering engine
  - GPU-accelerated rendering via WebGL
  - Automatic fallback to Canvas 2D if WebGL is unavailable
  - Scene Graph with layer system and z-index
  - Optimized sprite and texture system
  - Native interactive events on 2D objects
  - Object pool for better memory management

### Rendering Architecture
- **PixiApp**: Singleton managing the PixiJS lifecycle
- **SceneManager**: Manages layers, sprites, and the Scene Graph
  - Layers: background, streets, connections, vehicles, buildings, ui, debug
  - Sprite tracking by type (streets, vehicles, buildings, connections)
  - Selective update system for optimization
- **CameraController**: Zoom, pan, and view transformation management
- **Specialized Renderers**:
  - `CalleRenderer`: Street rendering with textures and orientation
  - `CarroRenderer`: Vehicle rendering with animation
  - `EdificioRenderer`: Building rendering with textures
  - `ConexionRenderer`: Connection rendering between streets
  - `UIRenderer`: Labels and UI element rendering
  - `MinimapRenderer`: General map overview
- **AssetLoader**: Asynchronous texture loading from `assets/images/`
- **DayNightCycle**: Day/night cycle system with color interpolation

### Frontend
- **HTML5, CSS3, JavaScript (ES6+)**: Modern web technologies
- **Bootstrap 5**: UI framework for responsive interface
- **Chart.js**: Real-time metric chart visualization

### Simulation
- **Cellular Automata**: Simulation engine based on modified Rule 184
- **Multi-lane System**: Lane change and priority logic
- **Connection Management**: Street connection system with priorities

---

## Technical Architecture

### Modular JavaScript Architecture

The project uses a modular architecture with scripts separated by responsibility:

**Core Modules (`src/js/core/`)**:
- `trafico.js`: Main simulation engine with cellular automata, speed control, and vehicle generation
- `tiempo.js`: Virtual time system with support for days of the week, hours, minutes, and seconds. Includes traffic multiplier profiles by day/hour
- `graficas.js`: Collection and calculation of metrics (density, flow, speed, entropy)
- `curvas.js`: Bézier curve system for streets with angular interpolation
- `ClickActionManager.js`: Centralized management of click events and interactions

**UI Modules (`src/js/ui/`)**:
- `infoBar.js`: Real-time information system that updates the top bar with generation, population, simulated time, time/frame, and multiplier
- `timeControl.js`: Modal control to modify simulator date and time with perfect synchronization
- `multiplicadoresUI.js`: Configuration interface for generation multipliers by day and hour (24 sliders, presets, copy to all days)
- `darkMode.js`: Dark mode toggle with localStorage persistence
- `loadingSystem.js`: Loading screen with progress bar during initialization
- `tooltips.js`: Bootstrap 5 tooltip initialization on UI elements
- `modalFixes.js`: Fixes for accessibility warnings in modals
- `consoleControl.js`: Console log enable/disable system
- `sidebarToggle.js`: Side panel control with Ctrl+B shortcut and canvas resizing
- `editor.js`: Visual street editor with vertex edit mode (toggle with Z key)
- `constructor.js`: Interactive map builder from scratch
- `etiquetas.js`: Informational tooltip system for streets and buildings

**Renderer Modules (`src/js/renderer/`)**:
- `PixiApp.js`: Singleton that manages the PixiJS lifecycle (WebGL/Canvas2D)
- `SceneManager.js`: Scene graph management with layer and z-index system
- `CameraController.js`: Camera control with zoom (scroll) and pan (drag)
- `DayNightCycle.js`: Background color interpolation based on simulated hour
- `EditorHandles.js`: Visual handles to move and rotate streets in edit mode
- Specialized renderers in `renderers/`: Each object type (streets, vehicles, buildings, connections, UI, minimap) has its own renderer
- Utilities in `utils/`: Asset loading and coordinate conversion

**Benefits of Modular Architecture**:
- **Separation of Concerns**: Each module has a specific and well-defined function
- **Maintainability**: Changes in one module do not affect others
- **Scalability**: Easy to add new functionality without modifying existing code
- **Reusability**: Modules can be reused in other projects
- **Testing**: Each module can be tested independently
- **Debugging**: Easier to locate and fix errors
- **Collaboration**: Multiple developers can work in parallel

### Initialization Flow

1. **PixiJS Loading**: PixiJS library is loaded from CDN
2. **PixiApp Initialization**: Singleton that creates the PixiJS application
   - Attempts to use WebGL with GPU acceleration
   - Falls back to Canvas 2D if it fails
   - Replaces the traditional HTML5 canvas
3. **Asset Loading**: `AssetLoader` loads all textures asynchronously
4. **Scene Graph Creation**: `SceneManager` creates the rendering layers
5. **Renderer Initialization**: All specialized renderers are created
6. **Camera Setup**: `CameraController` configures zoom and pan
7. **Loop Start**: PixiJS starts the automatic rendering loop

### Layer System (Z-Index)

```
Debug Layer   (z: 40)  → Vertices, debug elements
UI Layer      (z: 30)  → Labels, edit handles
Buildings     (z: 25)  → Buildings
Vehicles      (z: 20)  → Vehicles (animated)
Connections   (z: 15)  → Connection lines between streets
Streets       (z: 10)  → Streets with textures
Background    (z: 0)   → Background (solid color)
```

### Rendering Cycle

```javascript
// Every frame (typical 60 FPS):
PixiApp.ticker → SceneManager.update(delta) → {
  1. Update background color (DayNightCycle)
  2. Update vehicles (CarroRenderer)
  3. Update labels if state changes
  4. Update connections if state changes
  5. Update vertices if state changes
  6. PixiJS automatically renders the scene graph
}
```

### Implemented Optimizations

- **Selective Rendering**: Only sprites are updated when their data changes
- **Sprite Pooling**: Object reuse to avoid garbage collection
- **State-Based Updates**: Labels, connections, and vertices are only rendered when they change
- **Dirty Flags**: Flag system to detect changes
- **Batch Rendering**: PixiJS groups similar sprites in a single draw call (WebGL)
- **Texture Atlas**: Combined textures to reduce GPU state changes

### Interactivity

The system uses native PixiJS events:
- **pointerdown/pointerup**: Clicks on objects
- **pointermove**: Mouse movement over objects
- **pointerover/pointerout**: Hover for tooltips
- **Capture Phase**: CameraController intercepts events before PixiJS for pan/zoom

### Compatibility

- **WebGL**: Full GPU acceleration (preferred)
- **Canvas 2D**: Automatic fallback if WebGL is not available
- **Cross-platform**: Works in all modern browsers
- **Responsive**: Adapts to window size

### Benefits of Using PixiJS

**Performance:**
- **60 FPS** with hundreds of simultaneous vehicles
- **GPU acceleration** via WebGL for high-speed rendering
- **Automatic batch rendering** reduces draw calls by 90%
- **Cached sprites** avoid unnecessary recalculations

**Development:**
- **Scene Graph** simplifies 2D object management
- **Native events** on sprites eliminate manual collision calculations
- **Modern API** with ES6+ support
- **Integrated debugging** with browser DevTools

**Maintainability:**
- **Separation of concerns** with specialized renderers
- **Modular code** easy to extend and maintain
- **Layer system** clarifies rendering order
- **Complete PixiJS documentation** available

---

## Project Structure

```
FLUVI/
├── main/
│   ├── index.html                         # Main entry point
│   ├── START_SERVER.bat                   # Script to start server (Windows)
│   ├── server.py                          # Local HTTP server (Python)
│   ├── docs/                              # Project documentation
│   │   └── CONSTRUCTOR.md                 # Map builder documentation
│   └── src/
│       ├── js/
│       │   ├── core/                      # Core simulation logic
│       │   │   ├── trafico.js             # Main simulation engine and cellular automata
│       │   │   ├── tiempo.js              # Virtual time system (day/hour)
│       │   │   ├── graficas.js            # Metrics system (density, flow, speed)
│       │   │   ├── curvas.js              # Street curve and vertex system
│       │   │   ├── estacionamientos.js    # Smart parking system
│       │   │   └── ClickActionManager.js  # Click and interaction manager
│       │   ├── renderer/                  # Rendering system with PixiJS
│       │   │   ├── PixiApp.js             # Main PixiJS application (Singleton)
│       │   │   ├── SceneManager.js        # Scene and layer manager (Scene Graph)
│       │   │   ├── CameraController.js    # Camera system (zoom, pan)
│       │   │   ├── DayNightCycle.js       # Day/night cycle (background colors)
│       │   │   ├── EditorHandles.js       # Street editing handles
│       │   │   ├── renderers/             # Specialized renderers
│       │   │   │   ├── CalleRenderer.js   # Street rendering
│       │   │   │   ├── CarroRenderer.js   # Vehicle rendering
│       │   │   │   ├── EdificioRenderer.js # Building rendering
│       │   │   │   ├── ConexionRenderer.js # Connection rendering
│       │   │   │   ├── UIRenderer.js      # UI rendering (labels)
│       │   │   │   └── MinimapRenderer.js # Minimap rendering
│       │   │   └── utils/                 # Rendering utilities
│       │   │       ├── AssetLoader.js     # Texture and asset loader
│       │   │       └── CoordinateConverter.js # Coordinate conversion
│       │   └── ui/                        # User interface modules
│       │       ├── darkMode.js            # Dark mode system
│       │       ├── loadingSystem.js       # Loading screen with progress bar
│       │       ├── tooltips.js            # Bootstrap tooltip initialization
│       │       ├── modalFixes.js          # Modal accessibility fixes
│       │       ├── consoleControl.js      # Console log control
│       │       ├── sidebarToggle.js       # Sidebar toggle (Ctrl+B)
│       │       ├── infoBar.js             # Real-time information bar
│       │       ├── timeControl.js         # Simulator date and time control
│       │       ├── multiplicadoresUI.js   # Day/hour multiplier configuration
│       │       ├── editor.js              # Visual street editor
│       │       ├── constructor.js         # Map builder
│       │       ├── edificioUI.js          # Parking configuration interface
│       │       ├── analizadorMetricas.js  # Advanced metrics analyzer
│       │       └── etiquetas.js           # Label system
│       ├── python/                        # Python scripts for analysis
│       │   └── analizador.py              # Metrics analyzer with visualizations
│       └── css/                           # Style sheets
│           ├── estilos.css                # Main styles
│           └── minimapa.css               # Minimap styles
├── assets/                                # Static resources
│   └── images/                            # Images and textures
│       ├── vehicles/                      # Vehicle sprites (PNG)
│       ├── buildings/                     # Building textures (PNG)
│       ├── roads/                         # Road textures (PNG)
│       └── objects/                       # Miscellaneous objects (PNG)
└── README.md                              # This file
```

---

## Requirements

### Required Software
- **Python 3.x**: To run the local HTTP server
- **Modern Web Browser**: Chrome, Firefox, Safari, Edge (latest versions)
- **WebGL**: For GPU acceleration (optional, Canvas 2D fallback available)
- **Internet Connection**: To load PixiJS from CDN
- **JavaScript Enabled**: Required for the application to work

### Why is a local server needed?

WebGL and resource loading (textures, images) require the application to run from an HTTP server due to browser CORS (Cross-Origin Resource Sharing) security policies. **It is not possible to open `index.html` directly** from the file system (`file://`) for WebGL to work correctly.

---

## Quick Start

### Step 1: Start the Local Server

**Option A - Windows (Recommended):**
```bash
# Navigate to the main/ folder
cd main

# Run the .bat file
START_SERVER.bat
```

**Option B - Any Operating System:**
```bash
# Navigate to the main/ folder
cd main

# Run the Python server directly
python server.py
```

The server will start on port **8000** and you will see:
```
============================================================
WEB SERVER FOR FLUVI - TRAFFIC SIMULATOR
============================================================

Server started successfully!

Open your browser and go to:
   http://localhost:8000
   http://127.0.0.1:8000
```

### Step 2: Open in the Browser

1. With the server running, open your browser
2. Navigate to: **http://localhost:8000**
3. The simulation will load automatically:
   - PixiJS initialization with **WebGL enabled**
   - Loading textures and assets from `assets/images/`
   - Rendering the initial scene with GPU acceleration
   - Layer system activated

### Step 3: Use the Application

Use the side panel to:
- Configure simulation parameters
- Enable/disable edit mode
- View real-time metrics
- Export/import configurations

**Camera Controls:**

| Input | Action |
|-------|--------|
| Mouse scroll | Zoom in/out |
| Click + drag | Pan (move camera) |
| Ctrl+B | Hide/show sidebar |
| Enter | Apply changes in date/time modal |

**Edit Mode:**

| Input | Action |
|-------|--------|
| SHIFT + Drag | Move streets |
| Click on street/building | View information |
| Handles (circles) | Move and rotate streets |
| Z | Toggle vertex edit mode |

> When vertex edit mode is active, drag any vertex to create curves. Press Z again to disable.

### Stop the Server

To stop the server, press **Ctrl+C** in the terminal where it is running.

---

## Troubleshooting

### "Port 8000 is already in use"
**Solution:** Another process is using port 8000
- Close other server instances
- Or modify `server.py` to use a different port (e.g. 8080, 3000)

### "WebGL is not available"
**Solution:** Your browser/GPU does not support WebGL
- The system will automatically use Canvas 2D as fallback
- You will see the message: "WebGL not available, using Canvas 2D renderer..."
- The application will work, but with lower performance

### "Textures won't load"
**Solution:** You are opening `index.html` directly with `file://`
- **You must use the local server** so that CORS allows loading images
- Run `START_SERVER.bat` and open `http://localhost:8000`

### "Python is not recognized as a command"
**Solution:** Python is not installed or is not in PATH
- Download Python from: https://www.python.org/downloads/
- During installation, check "Add Python to PATH"
- Restart the terminal after installing

### Verify that WebGL is working
Open the browser console (F12) and look for:
```
WebGL available, using GPU acceleration
PixiApp initialized successfully
```

If you see these messages, **PixiJS is using WebGL correctly**.

---

## Python Metrics Analyzer

FLUVI includes an **Advanced Metrics Analyzer** that allows analyzing exported CSV files using Python directly in the browser via **Pyodide** (Python compiled to WebAssembly).

### Generated Visualizations

**1. Temporal Analysis (4 charts)**
- Density vs Time
- Flow vs Time
- Speed vs Time
- Traffic states classified by color

**2. Fundamental Diagram (2 charts)**
- Entropy vs Density (colored by Flow)
- **Heatmap by Day and Hour**

**3. Statistical Distributions**
- Density and Flow Histograms
- Comparative Boxplots

### Heatmap

Visualizes traffic patterns organized by:
- **Y Axis**: Days of the week (Monday - Sunday)
- **X Axis**: Hours of the day (0 - 23)
- **Color**: 🟡 yellow (low density) → 🔴 red (high density)

### How to Use

1. Run a simulation in FLUVI
2. Export metrics using "Download CSV"
3. Click "Analyze Metrics" (blue button)
4. Load the CSV file
5. Wait for processing (~60 sec first time, ~5 sec after)
6. Navigate between the 3 tabs
7. Download images (individual or ZIP)

### Features

- **100% in the browser**: No Python installation required
- **Full privacy**: Local data, not sent to servers
- **Professional visualizations**: matplotlib, pandas, scipy
- **Advanced metrics**: State classification, critical capacity, correlations, anomaly detection

---

## Documentation

- See `docs/CONSTRUCTOR.md` to use the map builder
- Rendering architecture: `src/js/renderer/`
- PixiJS documentation: https://pixijs.com/

---

## Credits

**Developers:**
- Connor Urbano Mendoza
- Luis Gael Molina Figueroa
- Denisse Márquez Morales

**Advisors:**
- Juárez Martínez Genaro
- Maldonado Castillo Idalia

**Institution:**
Instituto Politécnico Nacional (IPN)
Escuela Superior de Cómputo (ESCOM)
Artificial Life Robotics (ALIROB)

## Version

1.0.0 — 2025

---

*FLUVI — Vehicular Flow Management System on Roadways*
