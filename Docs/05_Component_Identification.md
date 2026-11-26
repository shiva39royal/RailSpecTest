# Phase 5: Component Identification Architecture

This document provides an exhaustive reference on how every signaling and civil railway component is identified from raw DWG, DXF, and PDF drawings. It details the geometric detection rules, optical pattern recognition, text token parsing, and prefix-agnostic classification algorithms implemented across [`server/cadComponentExtractor.ts`](file:///c:/Users/shiva/OneDrive/Desktop/WORK/railspectest/server/cadComponentExtractor.ts) and [`src/engine/kavachEngine.ts`](file:///c:/Users/shiva/OneDrive/Desktop/WORK/railspectest/src/engine/kavachEngine.ts).

---

## 1. Multi-Layered Dual-Anchor Identification Paradigm

Layout interpretation in RailSpec KAVACH Studio does not rely solely on text labels or purely on vector drawings. Instead, it utilizes a **Dual-Anchor Correlation Architecture**:

```
+---------------------------------------------------------------------------------------+
|                                DUAL-ANCHOR CORRELATION                                |
+---------------------------------------------------+-----------------------------------+
|               GEOMETRIC ANCHOR                    |          TYPOGRAPHIC ANCHOR       |
| • Shape topology (Circle, Triangle, Line)         | • Signaling ID patterns (RegEx)   |
| • Spatial location (X, Y, Layer, Bounding Box)    | • Role letters (S, N, T, G, L, A) |
| • Stroke orientation (Angles, Aspect hatching)    | • Chainage markers (KM 121.80)    |
| • Proximity to switch rails or track centerlines  | • Signal suffixes (ID, D, A, CO)  |
+---------------------------------------------------+-----------------------------------+
                                         |
                                         v
                 +-----------------------------------------------+
                 |  PREFIX-AGNOSTIC COMPONENT RESOLVER           |
                 |  Resolves components even when standard "S"   |
                 |  or "P" prefixes are absent in drawing text   |
                 +-----------------------------------------------+
```

---

## 2. Track Lines & Corridors

Track lines define the physical rails along which trains travel.

### Identification Strategy:
1. **Geometric Rail Detection:**
   * Scans `LINE`, `LWPOLYLINE`, and `POLYLINE` entities.
   * Filters for horizontal line segments ($|\Delta y| \le 1.5\text{ pt}$ over lengths $> 120\text{ pt}$).
   * Segments sharing identical $Y$ coordinates within a vertical tolerance band (`yBandTol = track_spacing * 0.45`) are merged into a continuous linear track corridor.
2. **Track Label Recognition & Anisotropic Matching:**
   * Scans text annotations using regular expressions:
     ```regex
     /\b(UP|DN|DOWN|COMMON|COMM|GOODS|PASSENGER|LOOP|MAIN)\b.*\bLINE\b|\b(UP|DN|DOWN|COMMON|COMM)\s*[-]?\s*(MAIN|LOOP)\b|\bLOOP\s*[-]?\s*\d+\b/i
     ```
   * Anisotropic distance weighting associates text to the nearest rail corridor:
     $$D = 8 \cdot |y_{\text{text}} - y_{\text{track}}| + |x_{\text{text}} - x_{\text{track}}|$$
   * Normalizes line names via [`normalizeLineName()`](file:///c:/Users/shiva/OneDrive/Desktop/WORK/railspectest/server/cadComponentExtractor.ts#L131):
     * `"UP MAIN LINE"` $\rightarrow$ `UP MAIN LINE`
     * `"DN MAIN"` $\rightarrow$ `DN MAIN LINE`
     * `"COMMON LOOP"` / `"LOOP-1"` $\rightarrow$ `COMMON LOOP LINE`

---

## 3. Signals (Signals, Heads, Aspects & Types)

Signals regulate train movements and form the core entry/exit boundaries of Table 1 routes.

### 1. Geometric Signal Head Detection & Aspect Analysis:
* **Circle Aspect Detection:** Scans circular vector entities (`CIRCLE` or closed circular `ARC`) with radii $2.0 \le r \le 40.0\text{ pt}$.
* **Aspect Stroke Classification:**
  * Inspects internal line strokes enclosed inside the circle:
    * **Green (Proceed):** Horizontal strokes ($|\Delta y| \approx 0$).
    * **Red (Stop):** Vertical strokes ($|\Delta x| \approx 0$).
    * **Yellow (Caution):** Single diagonal stroke ($|\Delta x| \approx |\Delta y|$).
    * **Double Yellow (Attention):** $\ge 2$ diagonal strokes.
* **Multi-Aspect Cluster Grouping:**
  * Uses density-based Breadth-First Search (BFS) clustering:
    $$\text{dist}(c_i, c_j) \le 3.6 \times \max(r_i, r_j)$$
  * Groups 1 to 6 adjacent aspect circles into a single unified signal head post.

### 2. Prefix-Agnostic Signal ID Recognition:
The engine handles both standard and prefix-less railway layouts:
* **Tier 1 (Explicit Signal Prefixes):** Matches `S1`, `S1D`, `S1 ID`, `S30`, `S30A`, `SH1`, `C1`, `GS1`, `IB1`.
* **Tier 2 (Numeric with Signal Suffix):** Matches `1D`, `1ID`, `1 ID`, `30D`, `30ID`, `30A`, `1S`.
* **Tier 3 (Standalone Numeric Signal - Prefix-Less Fallback):**
  * Matches standalone digits `1` to `99` (e.g., `1`, `3`, `4`, `24`, `28`).
  * **Disambiguation Rule:** To avoid misclassifying turnout point switch numbers as signals, a standalone number is accepted as a signal **only if**:
    1. It is positioned within $\text{radius} \le \max(38 \cdot s, 26\text{ pt})$ of a detected signal head circle.
    2. It is **not** a paired turnout switch label (`!isPairedSwitchLabel`).

### 3. Functional Signal Type Classification:
Classified via [`classifySignalByStrictRules()`](file:///c:/Users/shiva/OneDrive/Desktop/WORK/railspectest/src/engine/kavachEngine.ts#L37):
* **Distant / Inner Distant:** Contains `D` or `ID` suffix/text (e.g., `S1D`, `S1 ID`).
* **Home Signal:** Located at the entrance of the station yard facing inwards. Classified as *Main Home with Junction Route* if route connects to a loop turnout, or *Main Home without Junction Route* if straight.
* **Starter Signal:** Located at the departure end of a berthing loop or main track facing towards the block section.
* **Advance Starter / LSS (Last Stop Signal):** Outer departure signal controlling entrance into the Absolute Block section.
* **Calling-On (`C` prefix or `CO` suffix):** Miniature aspect signal mounted beneath a Home or Starter signal.
* **Shunt Signal (`SH` prefix):** Miniature ground shunting signal (excluded from main Table 1 routes).

---

## 4. Turnout Points & Crossover Switches

Turnout points allow trains to diverge from one track corridor to another.

### Identification Strategy:
1. **Geometric Switch Detection:**
   * Scans diagonal line segments with slopes $12^\circ \le \theta \le 72^\circ$ and lengths $4 \cdot s \le L \le 180 \cdot s$.
   * Records midpoint $(m_x, m_y)$ and switch tips $(x_1, y_1), (x_2, y_2)$ of each turnout junction.
2. **Point Number Recognition:**
   * **Explicit Point Labels:** Matches `P-17`, `PT-101`, `P11`, `11PT`, `IN-46`.
   * **Bare Numeric Switch Labels (Prefix-Less):** Matches numbers `1` to `99` or suffix pairs (`17A`, `17B`, `18A`, `18B`) located within $28 \cdot s$ of a detected diagonal switch junction line.
   * **Disambiguation:** Labels anchored to signal circles are excluded.
3. **Paired Switch Consolidation:**
   * Crossover junctions have two switch ends (e.g., `17A` on Up Main and `17B` on Down Main).
   * Consolidated into a unified turnout point record: `P-17` with associated sub-switches `17A` and `17B`.
4. **Normal vs. Reverse Route Determination:**
   * **Normal (N):** Straight path along the track corridor.
   * **Reverse (R):** Diverging path traversing the diagonal turnout junction line into an adjacent corridor.

---

## 5. RFID Tags (Balises)

RFID tags provide absolute location references for onboard KAVACH train units.

### Identification Strategy:
1. **Geometric Balise Triangle Detection:**
   * Scans closed 3-vertex polygons (`LWPOLYLINE`, `POLYLINE`, `SOLID`).
   * Validates equilateral/isosceles edge ratios: $\min(\text{edge}) / \max(\text{edge}) \ge 0.15$.
   * **Facing Direction:**
     * Computes centroid: $C = \frac{1}{3} \sum P_i$.
     * Evaluates apex horizontal displacement:
       $$\text{Facing} = \begin{cases} \text{RIGHT (Nominal)} & \text{if } x_{\text{apex}} > C_x \\ \text{LEFT (Reverse)} & \text{if } x_{\text{apex}} < C_x \end{cases}$$
2. **Tag ID Matching:**
   * Matches `R-\d+` (e.g., `R-704`, `R-706`).
   * **Prefix-Less Fallback:** Matches bare 3–4 digit numbers tightly co-located with a detected RFID triangle within $\text{dist} \le \max(\text{size} \times 3.5, 24 \cdot s)$.
3. **Role Code Classification (within $24 \cdot s$ radius):**
   * **`S` (Signal Foot Tag):** Located directly adjacent to a signal post circle.
   * **`N` (Normal Track Tag):** Intermediate in-route tag along a straight section.
   * **`T` (Turnout / TIN Tag):** Located within turnout fouling boundaries.
   * **`G` (Gate Tag):** Located within approach distance of a Level Crossing Gate.
   * **`L` (Adjacent Line Tag):** Installed on an adjacent parallel track.
   * **`A` (Adjustment / Boundary Tag):** Contains dual chainage markers (`LOC.1` for yard chainage, `LOC.2` for block section chainage).
   * **`X` (Territory Exit Tag):** Placed at KAVACH territory boundaries.
4. **Physical Chainage:**
   * Extracts chainage tokens (e.g., `121.710`, `KM 121/7`, `CH.453850m`) to record physical meter positions.

---

## 6. Track Identification Numbers (TINs)

TINs define track segments for spatial authorization and directional interlocking.

### Identification Strategy:
1. **Text Token Recognition:**
   * Matches `N-\d+` (e.g., `N-50`, `N-54`, `N-46`).
   * Matches parenthesized track designations: `(N-46)`, `(53)`, `(TIN-01)`.
2. **Yard TINs vs. Block Section TINs:**
   * Station Yard extent $[X_{\text{min}}, X_{\text{max}}]$ is calculated from outer Home and Starter signals.
   * **Yard TINs:** Located inside $[X_{\text{min}}, X_{\text{max}}]$ $\rightarrow$ Proved in Table 1 column *TINs Requires Free*.
   * **Block Section TINs:** Located outside yard boundaries $\rightarrow$ Excluded from yard routes; classified into block section corridors.
3. **Overlap TIN Resolution:**
   * Traced downstream beyond the Exit Signal within the required overlap distance (typically 120m to 180m).
   * If an overlap turnout is present, qualified with switch setting: e.g., `P-17(N): N-51`.

---

## 7. Track Circuits & Axle Counter Detection Points (DP)

Monitors track occupancy to prove clear routes before signal clearance.

### Identification Strategy:
1. **Track Circuit Labels:**
   * Matches berthing and corridor track circuits:
     * `08T`, `09T`, `C01T`, `3/4T`, `26-28T`, `TC-101`, `1AT`.
     * Functional track circuit codes: `DMAT`, `DMBT`, `UMAT`, `UMBT`, `CLAT`, `CLBT`, `MLT`, `LLT`.
2. **Axle Counter Detection Points (DP):**
   * Matches patterns: `DP2A`, `DP4B`, `UP_BPAC-1`, `3329AC`.
   * **Classification Rule:** Categorized strictly as `track_circuit` (not turnout point), preventing false point generation.

---

## 8. Level Crossing (LC) Gates, Fouling Marks (FM) & Limit Boards

1. **Level Crossing (LC) Gates:**
   * Identified by text tokens `LC-xx`, `GATE`, or `SPL. LC GATE`.
   * Anchored to perpendicular roadway vector intersections across the track lines.
2. **Fouling Marks (FM):**
   * Identified by labels containing `FM` located at the converging junction of two tracks where clearance is minimum (typically 4.265m track centers).
3. **Shunting Limit Boards (BSLB / SLB):**
   * Identified by text `BSLB` (Block Section Limit Board) on double lines or `SLB` (Shunting Limit Board) on single lines.
