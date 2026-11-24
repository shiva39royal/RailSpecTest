# Railway Layout & Signaling Component Identification Guide (CAD / Schematic Vision Reference)

**Purpose:** This document provides structured geometric, visual, and contextual rules to help an AI/Computer Vision Agent accurately detect, classify, and extract components from Railway Signaling Interlocking Plans (SIP), Track Layout Plans, and CAD schematics (primarily aligned with Indian Railways / UIC / British signaling standards).

---

## 1. Tracks, Lines & Geometric Paths

Lines form the foundational graph network of the railway layout. The agent should first vectorize or trace continuous line segments before classifying attached symbols.

| Component Name | Visual & Geometric Description | Line Style / Properties | Contextual Rules / Notes |
| :--- | :--- | :--- | :--- |
| **Main Line (Running Line)** | Continuous horizontal or gently curving primary tracks running across the layout. | Thick, solid continuous line (`stroke-width: heavy`). | Usually labeled as `UP MAIN`, `DN MAIN`, or `LINE 1/2`. Carries high-speed through traffic. |
| **Loop Line / Siding** | Parallel track branching off a Main Line via turnouts and rejoining later (Loop) or terminating at a buffer (Siding). | Medium, solid continuous line (`stroke-width: medium`). | Used for overtaking, stabling, or goods loading. |
| **Crossover** | Diagonal line connecting two parallel tracks between two facing/trailing points. | Angled solid line (typically $15^\circ$ to $45^\circ$ in schematics). | Allows trains to switch from one parallel track to another (e.g., UP to DN). |
| **Track Circuit Boundary (Insulated Rail Joint / IRJ)** | Short perpendicular tick mark, small cross, or staggered vertical bar intersecting a track line. | Short vertical line (`|`) or small `X` / `#` cutting across the track line. | Divides tracks into electrical detection sections (e.g., `101T`, `A1T`). Often accompanied by a track circuit name label. |
| **Track / Electrification Boundary / Limits** | Dashed or chain-dotted lines running parallel to or crossing tracks. | Dashed (`- - -`) or Dash-Dot (`- . - .`). | Indicates Station Limits, Yard Limits, or Overhead Equipment (OHE) neutral sections. |
| **Catch Siding / Slip Siding** | Short track branching sharply away from a running line toward a sand hump or buffer. | Solid line ending abruptly in a `T` or `[` symbol. | Safety track to derail/stop runaway vehicles. |

---

## 2. Points, Switches & Crossings (Turnouts)

Points are junctions where a single track splits into two or crosses another.

| Component Name | Visual & Geometric Description | Key Geometric Identifiers | Contextual Rules / Notes |
| :--- | :--- | :--- | :--- |
| **Simple Turnout (Left/Right Hand Point)** | A single line splitting into a straight path and a diverging angled path. | Acute triangle/wedge or thickened switch blade at the vertex of the split. Often has a small circle or point number (e.g., `101`, `202A/B`) near the toe. | **Normal (N):** Straight path.<br>**Reverse (R):** Diverging path. |
| **Diamond Crossing** | Two tracks intersecting each other in an `X` shape without switching capability. | Intersection of two straight/angled lines forming an `X` (obtuse and acute angles). | No switch blades; trains cannot change tracks here. |
| **Single / Double Slip** | A diamond crossing combined with curved switch rails inside the `X`. | An `X` intersection with one (Single) or two (Double) curved arc lines bridging the acute angles. | Allows trains to either cross straight or switch onto the intersecting track. |
| **Derailing Switch (Trap Point)** | A single switch blade on one rail that leads nowhere (into ballast/ground). | Half-turnout symbol; a short angled stub branching off one side of a track without a full second track. | Prevents unauthorized rolling stock from fouling the main line. |
| **Buffer Stop / Dead End** | Flat perpendicular bar or bracket at the absolute end of a track line. | Bold `|` or `]` or `[` cap perpendicular to the track axis. | Marks the physical termination of a siding or bay platform. |

---

## 3. Signals (Main, Shunt, Distant & Repeating)

Signals are directional indicators placed parallel to the track. **Orientation Rule:** The signal post/base attaches to the track or sits beside it, and the circular/geometric head points *toward* the approaching train (facing the direction of traffic).

### A. Main Running Signals (Color Light / Multi-Aspect)
* **Base Geometry:** A horizontal or vertical stem (`|—` or `L`-shaped bracket) connected to **one or more circles** arranged linearly.
* **Circle Fill / Internal Patterns (Aspect Indicators):**
  * **Empty / Hollow Circle (`○`):** Standard unlit/generic aspect placeholder or specific color code depending on legend.
  * **Circle with Cross/Lines (`⊕`, `⊗`, `⊘`):** Indicates specific aspect colors (e.g., Red = cross/hatched, Yellow = single diagonal/vertical line, Green = solid/dot or empty depending on CAD standard).
  * **Dotted / Dashed Circle (`◌`):** Indicates a **Distant Signal** (warning signal placed 1–2 km ahead of Home signal) OR a **Repeater / Co-acting Signal**, or an aspect capable of flashing.
* **Number of Circles (Aspects):**
  * **1 Circle:** Single-aspect (Stop or Distant).
  * **2 Circles (`○—○`):** 2-Aspect Signal (Red/Green or Yellow/Green).
  * **3 Circles (`○—○—○`):** 3-Aspect Signal (Red/Yellow/Green).
  * **4 Circles (`○—○—○—○`):** 4-Aspect Signal (Red/Yellow/Double-Yellow/Green).

### B. Shunt & Subsidiary Signals
* **Shunt Signal (Position Light / Disc):**
  * **Geometry:** **Quarter-circle (sector / wedge `◢` or `◣`)** or a small **D-shape / semi-circle** mounted on a short post or directly on a main signal mast.
  * **Internal Markings:** May contain two small dots/circles inside the quarter-circle or diagonal/horizontal lines representing white/red lights.
  * **Rule:** If attached *below* the circles of a Main Signal mast, it is a **Subsidiary / Shunt-below-Main** signal. If standalone on a short post, it is an **Independent Shunt Signal** (labeled `SH-1`, `S-12`).
* **Calling-On Signal:**
  * **Geometry:** Small single circle (often with a letter **`C`** inside or adjacent) mounted on the mast *below* the main signal circles.
* **Route Indicator (Junction Indicator / Feather):**
  * **Geometry:** A row of small dots/circles angled at $45^\circ$ (left or right) attached to the neck of a main signal mast, OR a square box with an alphanumeric character inside (Theater Type).
  * **Meaning:** Indicates diverging routes (Left feather = diverging left, Right feather = diverging right).

---

## 4. Tags, Balises & Track-Mounted Sensors (Triangles & Polygons)

Trackside transponders, balises (ETCS/Kavach), and axle counters are represented by distinct geometric polygons placed directly on or immediately adjacent to the track line.

| Component Name | Visual & Geometric Description | Internal Markings / Text | Functional Role |
| :--- | :--- | :--- | :--- |
| **RFID Tag / Balise (Kavach / ETCS)** | **Equilateral or Isosceles Triangle (`△` / `▽` / `▷` / `◁`)** placed directly on or touching the track line. | Contains single uppercase letters inside or directly adjacent:<br>• **`T`** = Tin / Turnout / Tag<br>• **`S`** = Signal Tag<br>• **`A`** = Absolute / Advance / Approach Tag<br>• **`N`** = Normal / Neutral Section Tag<br>• **`R`** = Route / Reset Tag | Transmits fixed location, gradient, and signal ID data to the locomotive's onboard computer. Direction of triangle tip often indicates the direction of train travel it applies to. |
| **Axle Counter (Detection Point)** | Small **Square (`□`)**, **Diamond (`◇`)**, or **Filled Dot (`●`)** straddling the rail line, often paired (`●—●`). | Labeled with `AC`, `DP`, or point/section numbers (e.g., `DP-101`). | Counts wheels entering and exiting a track section to verify track occupancy/clearance. |
| **AWS / TPWS Magnet (Inductor)** | Small **Rectangle (`▭`)** or **Oval** placed centrally between rails or directly on the track line. | Often hatched or filled solid black; labeled `AWS` or `TPWS`. | Automatic Warning System / Train Protection inductor located ~200m before signals. |
| **Treadle / Rail Contact** | Small **Semi-circle (`◠`)** or **Arrowhead** touching one side of the track line. | Labeled `TR` or directional arrow. | Mechanical/magnetic switch triggered by train wheel flange. |

---

## 5. Station, Yard & Miscellaneous Infrastructure

| Component Name | Visual & Geometric Description | Key Geometric Identifiers |
| :--- | :--- | :--- |
| **Platform** | Long, wide **Rectangle (`▭`)** running parallel to a track line. | Often hatched inside or labeled `PF-1`, `PF-2`, `PLATFORM`. |
| **Level Crossing (LC Gate)** | Two parallel vertical/angled lines cutting across all tracks with diagonal barrier arms. | Resembles a road crossing the tracks; labeled `LC-42` or `GATE`. |
| **Foot Over Bridge (FOB) / ROB** | Two parallel dashed or solid lines spanning perpendicular across all tracks and platforms. | Labeled `FOB` (Foot Over Bridge) or `ROB` (Road Over Bridge). |
| **Station Building / Cabin / Relay Room** | Distinct **Square or Rectangular box** outside the track corridor. | Labeled `SM OFFICE`, `RELAY ROOM`, `ASM`, `CABIN`. |
| **Gradient / Chainage Marker** | Vertical post with angled arms (Gradient) or small vertical tick with numbers (Chainage/KM post). | Numbers like `102/14` (KM/Pole) or `1 in 200` with up/down arrows. |

---

## 6. Decision Tree / Rule Engine for the AI Detection Agent

When your agent processes an image or vector layout, instruct it to follow this hierarchical classification pipeline:

1. **Step 1: Line & Graph Extraction**
   * Detect all continuous horizontal and angled lines $\rightarrow$ Classify as **Tracks**.
   * Detect intersections/splits of lines $\rightarrow$ Classify as **Points / Turnouts / Crossings**.
   * Detect perpendicular short ticks cutting a single track $\rightarrow$ Classify as **Track Circuit Boundaries (IRJ)**.
2. **Step 2: Polygon & Symbol Detection on/near Tracks**
   * **IF shape == `Triangle` (`△`, `▷`)** on/near track:
     * Classify as **RFID Tag / Balise**.
     * Run OCR inside/around the triangle to extract tag type (`T`, `S`, `A`, `N`, etc.) and Tag ID.
   * **IF shape == `Quarter-Circle` (`◢`, `◣`)** or `D-Shape`:
     * Classify as **Shunt Signal**.
     * Check if attached to a main signal mast (*Subsidiary Shunt*) or standalone (*Independent Shunt*).
   * **IF shape == `Circle(s)` (`○`, `◌`, `⊕`)** attached to a stem (`L` or `T` bracket):
     * Classify as **Main Running Signal**.
     * Count number of circles $\rightarrow$ Determine **Aspect Count** (2, 3, or 4 aspects).
     * Check circle stroke $\rightarrow$ If **Dotted/Dashed (`◌`)**, tag as **Distant / Repeater Signal**.
     * Check internal lines/hatching $\rightarrow$ Map to color aspect legend (Red/Yellow/Green).
     * Check stem orientation $\rightarrow$ Determine **Direction of Traffic** (Up/Down, Left-to-Right/Right-to-Left).
   * **IF shape == `Square` / `Diamond` (`□`, `◇`)** straddling track:
     * Classify as **Axle Counter / Detection Point**.
3. **Step 3: Spatial Association (Linking Labels to Components)**
   * Perform nearest-neighbor text association (OCR) within a bounding radius $R$ of every detected symbol to bind signal numbers (e.g., `S-14`), point numbers (e.g., `102A`), track circuit IDs (`102AT`), and tag IDs (`T-04`).