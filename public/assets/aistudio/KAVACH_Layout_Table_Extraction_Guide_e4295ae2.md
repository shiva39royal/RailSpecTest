# **KAVACH Control Tables Specification and Automated Layout Extraction Guide**

Under RDSO Specification RDSO/SPN/196/2020 Version 4.0, Annexure-I (*KAVACH Control Table Guidelines*, Amendment-6, effective 07.06.2024), seven tables define the complete Stationary KAVACH configuration for Absolute, Automatic, and Modified Automatic Block Signalling territories. An automated extraction tool that ingests an uploaded railway yard layout (RFID Tag–TIN Layout) produces these seven outputs: (1) **KAVACH Table of Control**, (2) **Block Section Details and System Control Parameters**, (3) **Shunting Limit Table**, (4) **KAVACH Track Profile Table**, (5) **KAVACH TSR Route Table**, (6) **Temporary Single Line (TSL) Working on Double Line Control Table**, and (7) **TSL Working on Double Line Track Profile Data Table**. Note that Amendment-6 also added an Adjustment/Junction tag conformity symbol and template annotations across layouts and sheets rather than a separate eighth control table.  
Because Indian Railways has not yet implemented the Train Speed Restriction Management System (TSRMS) linkage in Stationary KAVACH control tables, Amendment-4 (Cl. I.2.11.6, dated 01.01.2024) deleted the TSRMS Route ID column from the Stationary KAVACH Table of Control. Where legacy templates (such as Chitgidda CTF on Page 35\) still display a TSRMS Route ID header, the extraction agent should leave that field empty. In Table 5 (*KAVACH TSR Route Table*), TSR Route ID is derived from the OHE Line Start RFID Tag ID when configured, or left blank when unallocated, as seen in multiple rows of the Gullaguda (GGD) reference sheets.  
An extraction agent must also account for input boundaries defined in Clause 1.2.2. While signal chains, (Entry Signal, Exit Signal) pairs, points, track circuits, TINs, RFID linking sequences, shunting limits, and block-section resets can be parsed directly from an annotated RFID Tag–TIN Layout, parameters such as signal aspect interlocking rules, engineering gradients, static Permanent Speed Restrictions (PSR), and OHE mast-to-mast spacing originate in companion engineering sheets and must either be co-uploaded or emitted as structured fields for user entry.

| RDSO Input Source (Cl. 1.2.2) | Data Extracted for Automation | Target Tables Populated |
| :---- | :---- | :---- |
| **Approved RFID Tag–TIN Layout** | Signals, Foot Tags (R-xxx), En-Route/Turnout/Exit/Gate/Adjustment (A-tag)/Adjacent-Line Tags, Tag-to-Tag distances, Track Circuits, TINs (N-xx), Points, Direction Arrows (Nominal/Reverse), Absolute km (ABS1/ABS2), LC Gate class/km, Shunting Limits | Tables 1, 2, 3, 4 (partial), 5 (partial), 6, 7 (partial) |
| **Signalling Interlocking Plan (SIP) & TOC** | Valid signalled routes, Aspect matrices (Green, Double Yellow, Yellow, Yellow with Pos, Red, Miniature), Point Normal/Reverse locking, Overlap track/TIN proving, Route Commands (3GNR, UMUNR), Fouling Mark offsets, Turnout speeds | Tables 1, 4 (Turnout Speed & Fouling Mark), 6 |
| **Adjacent Stationary KAVACH Table** | Next Station Id, Next Station Border RFID and location, Adjacent station/IB first Stop signal (S7, S30 CTF), Block section distance | Tables 1 (LSS rows), 2, 6 (Bottom Block sub-table) |
| **Engineering Gradient Index Plan** | Segment-by-segment Rising (R), Falling (F), and Level gradients with lengths in meters; Permanent Speed Restrictions (U/A/B/C) | Tables 4, 7 |
| **OHE Mast / Pole Layout** | OHE Line names, Pole/Km identifiers (122/34), mast-to-mast intervals, Entry Signal offset from OHE start tag, Last pole distance from Exit Signal | Table 5 |
| **TSRMS Database** | TSRMS Route ID (deleted from Table 1 per Cl. I.2.11.6 Amdt-4; keep empty) | Table 5 (TSR Route ID optional/blank) |

## **Layout Parsing Prerequisites and Coordinate Rules**

Before building signal graphs or populating tables, the parsing agent must extract sheet-level metadata, classify every RFID tag symbol from the layout legend, and lock the track's kilometer orientation. Every generated sheet must carry a top header specifying Station Name, Station ID, Section, and Division (Cl. 1.2.11.1), reference document numbers (SIP No., TOC No., RFID Tag Layout), a signature block, a revision history table, and a Version Control string formatted as X.Y.Z, where X is KAVACH version, Y is RFID Tag Layout or SIP version, and Z is guidelines/review version (Cl. 1.2.9). All route distances are measured in meters from the Entry Signal's RFID foot tag (Cl. 1.2.10).

### **RFID Tag Symbol Classification**

On an Indian Railways RFID Tag–TIN Layout (illustrated by Gullaguda GGD on Page 15), the agent classifies each tag icon using the Legend before constructing route sequences:

> 1. **Normal Tag:** Circle with an internal diagonal stroke (◯ with /), placed sequentially along main, loop, and block tracks.  
> 2. **Signal Foot Tag:** Circle containing a filled square (⬢), placed directly at a signal post; serves as the 0 m origin for routes starting at that signal.  
> 3. **Turnout Tag:** Split rectangle (⧟) placed near facing/trailing switch geometry.  
> 4. **Exit Tag:** Circle containing an X (⊗), marking track or TIN exit boundaries.  
> 5. **Gate Tag:** Circle containing an S (Ⓢ), marking Level Crossing (LC) locations.  
> 6. **Adjustment / Junction Tag (A-Tag):** Square containing an inner square (▣), annotated with 'A' (e.g., R-660 and R-548 in GGD), placed where absolute kilometer chainage resets or jumps between ABS1 and ABS2.  
> 7. **Adjacent Line Tag:** Circle containing an N (Ⓝ), referencing parallel track TINs.  
> 8. **Fouling Mark Tag:** Any tag positioned at a fouling mark must carry a \-F suffix in control tables (e.g., R-696-F, R-702-F in CTF) per Amendment-1 Clause 1.2.11.12.3.

### **Nominal vs. Reverse Direction and Track Naming**

Direction in KAVACH is anchored strictly to railway kilometer chainage rather than UP or DN train naming alone. Per the KAVACH RFID Tag Data Format (RDSO/SPN/196/2020 Ver. 4.0), **Nominal** is the direction of *increasing* absolute location (km), whereas **Reverse** is the direction of *decreasing* absolute location (km). In Gullaguda (GGD, Station ID 521, km 128.660), chainage increases from left (CTF side, \~km 123.8–126.8) to right (GGD-SKP-IB / Hussain Sagar Jn. side, \~km 129.4–134.9). Therefore, Down (DN) trains moving left-to-right travel in the **Nominal** direction, while Up (UP) trains moving right-to-left travel in the **Reverse** direction. Note also that GGD labels yard tracks by functional name (UP LOOP, UP MAIN, DOWN MAIN, UP-COMM LOOP-DN) rather than generic numbers (Line 1–4).

## **Identifying Signal Types and Signal Relationships from the Layout**

To automate route generation, the agent must classify every signal icon on the layout and then resolve directed (Entry Signal, Exit Signal) relationships by traversing the track-point topology.

### **Signal Taxonomy and Table Inclusion Rules**

| Signal Category | Typical Layout Naming (GGD Examples) | Control Table Signal Type Label | Table Inclusion Rules |
| :---- | :---- | :---- | :---- |
| **Distant** | S1 D, S30 D | Dist. | Included in Tables 1, 4, 5 |
| **Inner Distant** | S1 ID, S30 ID | Inner Dist. | Included in Tables 1, 4, 5 |
| **Home (Main / Junction)** | S1, S30 | Main Home with Junction Route / Main Home without Junction Route | Included in Tables 1, 4, 5 |
| **Calling-On** | S1A, S30A (A suffix on Home post) | Calling-on Signal / Calling on Signal | Included in Table 1; omitted from Table 4 (shares parent Home geometry) |
| **Starter (Main / Loop)** | S3, S4, S26, S27, S28 | Main Line Starter, Line Starter, Loop Line Starter, Up Loop Line Starter | Included in Tables 1, 4, 5, 6, 7 |
| **Advanced Starter (LSS)** | S6, S25 (outermost station stop signal) | Down Main Adv. Starter, Up Main Adv. Starter | Included in Tables 1, 2, 4, 5, 6, 7 |
| **Shunt Signal** | SH10, SH21, SH23 | Shunt Signal | Excluded from Tables 1 & 4 (Cl. 1.2.4); used in Table 6 (TSL) if designated |
| **Terminal Stop Board / Buffer** | BS, UM Stop Board | UP main Stop Board / Buffer Stop | Treated as permanent RED (ON) aspect in Table 1 (Cl. 1.2.11.2) and Table 6 |

For permissive signals (Distant, Inner Distant), when signal indication (ECR) inputs are available, ECR drives the displayed aspect while Movement Authority (MA) is governed by the approaching Stop Signal; when ECR inputs are unavailable, both aspect and MA are derived from the approaching Stop Signal (Cl. 1.2.6–1.2.7).

### **Five-Step Algorithm to Extract Signal Relationships**

> 1. **Construct the Track-Point Graph:** Model every track segment (approach tracks, point-zone tracks like 25T, 26-28T, 3-4T, 6T, berthing tracks like DMT, CLT, UMT, ULT, and block sections) as edges carrying Track\_Circuit, TIN (N-xx), and Allowed\_Directions (UP, DN, or Both for common loops). Model every point (P-11, P-12, P-13, P-17KL, P-18, P-19, P-20) as a switch node with distinct Normal (N) and Reverse (R) outgoing branches.  
> 2. **Bind Signals and Foot Tags:** Attach each non-shunt signal S to its track edge, travel direction (UP or DN), and colocated Signal Foot Tag (R-xxx). When a Calling-On signal shares a Home post (S1A with S1; S30A with S30), bind both to the identical edge and Signal Foot Tag (R-514 and R-513 in GGD).  
> 3. **Traverse Downstream to First Same-Direction Signal:** From each Entry Signal E, execute a directed depth-first traversal along valid point settings (N/R) in E's travel direction. Stop each branch immediately at the **first downstream signal X facing the same travel direction** (Cl. 1.2.11.3). Never skip past an intermediate same-direction signal: for example, S1 terminates at S3 on Down Main and S4 on Common Loop, never directly at S6.  
> 4. **Resolve Last Stop Signals Across Block Boundaries:** When E is the outermost station Stop signal in its direction (S6 in DN, S25 in UP), no same-direction yard signal exists ahead. Continue traversal across the Block Section TIN (N-90 or N-91) until reaching the first approaching Stop signal of the adjacent station, Intermediate Block (IB) hut, or Gate signal shown at the layout boundary (S6 \-\> S7 (GGD-SKP-IB) and S25 \-\> S30 (CTF)) per Cl. 1.2.11.14(iii) and Cl. I.2.11.16 Exception.  
> 5. **Group Physical Paths and Expand Aspect Rows:** Each unique (Entry Signal, Exit Signal, Point Configuration) tuple defines one physical route. In Table 1, expand each route into one sub-row per valid Aspect of Entry Signal paired with its required Aspect of Exit Signal and MA. In Table 4, emit one row per physical route and suppress Calling-On signals (S1A, S30A).

### **Verified Signal Relationship Map for Gullaguda**

Applying this traversal to Page 15 of the specification yields 16 primary physical routes across both directions (which expand into the S. No. 1–23 routes in Table 1 and S. No. 1–16 rows in Table 4). Note that Table 1 (GGD) also includes a Red/Nil entry for S30 \-\> S25 (S. No. 19\) representing a non-cleared direct aspect condition, which has no separate physical row in Table 4\.

| Direction | Operational Stage | Entry Signal | Exit Signal | Line / Track | Required Points (Normal / Reverse) |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **DN (Nominal)** | Approach | S1 D | S1 ID | Down Main | None |
| **DN (Nominal)** | Approach | S1 ID | S1 | Down Main | None |
| **DN (Nominal)** | Reception (Main) | S1 / S1A | S3 | Down Main (DMT) | N: P-11, P-13 (or N: P-11, R: P-13 for junction aspect) |
| **DN (Nominal)** | Reception (Loop) | S1 / S1A | S4 | Common Loop (CLT) | N: P-11; R: P-13, P-17KL |
| **DN (Nominal)** | Departure (Loop) | S4 | S6 | Down Main | N: P-18; R: P-17KL, P-20 |
| **DN (Nominal)** | Departure (Main) | S3 | S6 | Down Main | N: P-18; R: P-20 |
| **DN (Nominal)** | Block Section (LSS) | S6 | S7 (GGD-SKP-IB) | Down Main (N-90) | None |
| **UP (Reverse)** | Approach | S30 D | S30 ID | Up Main Line | None |
| **UP (Reverse)** | Approach | S30 ID | S30 | Up Main Line | None |
| **UP (Reverse)** | Reception (Main) | S30 / S30A | S28 | Up Main (UMT) | N: P-20, P-19 |
| **UP (Reverse)** | Reception (Loop 1\) | S30 / S30A | S27 | Up Loop (ULT) | N: P-20; R: P-19 |
| **UP (Reverse)** | Reception (Loop 2\) | S30 / S30A | S26 | Common Loop (CLT) | N: P-20, P-18; R: P-19, P-17KL |
| **UP (Reverse)** | Departure (Common Loop) | S26 | S25 | Up Main Line | N: P-17KL; R: P-12 |
| **UP (Reverse)** | Departure (Up Loop) | S27 | S25 | Up Main Line | R: P-12 |
| **UP (Reverse)** | Departure (Main) | S28 | S25 | Up Main Line | N: P-12 |
| **UP (Reverse)** | Block Section (LSS) | S25 | S30 (CTF) | Up Main (N-91) | None |

## **Detailed Specification and Extraction Logic for All 7 Tables**

### **Table 1: KAVACH Table of Control**

*Reference: PDF Pages 16–21 (GGD) and Page 35 (CTF Template).*  
**Entry Signal (How to Identify in Layout):** Select every Distant, Inner Distant, Home, Calling-On, Starter, and Advanced Starter signal monitored by the Stationary KAVACH unit (Cl. 1.2.5). Exclude Shunt signals (SH10, SH21, SH23) per Clause 1.2.4. In terminal yards, treat a Stop Board, Shunt Signal, or Buffer Stop acting as a route origin/end as having a permanent RED ("ON") aspect (Cl. 1.2.11.2).  
**Exit Signal (How to Identify in Layout):** Trace downstream from the Entry Signal along each valid point setting (Normal/Reverse) in the Entry Signal's travel direction until hitting the immediate next Stop or Inner Distant/Home signal facing the same direction (Cl. 1.2.11.3). When the Entry Signal is a Last Stop Signal (S6, S25), the Exit Signal is the first approaching Stop signal of the adjacent station, IB hut, or Gate signal (S7 (GGD-SKP-IB) or S30 (CTF)).

| Column Name | Extraction Logic & RDSO Rule | GGD Example (S30 \-\> S27, S. No. 15 / S1 \-\> S4, S. No. 5\) |
| :---- | :---- | :---- |
| S. No. | Sequential integer (1, 2, 3...) per (Entry, Exit) route. | 15 / 5 |
| Entry Signal | Origin signal name from layout (S30, S1, S1A, etc.). | S30 / S1 |
| Exit Signal | Immediate next signal along route (S27, S4, etc.). | S27 / S4 |
| Section Type | Absolute Block (Distant/Inner Distant approaches and LSS block routes), Station Section (Home, Calling-On, Starter routes), or Automatic Section (Cl. 1.2.11.4). | Station Section |
| Line | Destination/traversed track name (UP Loop, Common Loop, Down Main, Cl. 1.2.11.5). Omit TSRMS Route ID per Amdt-4 Cl. I.2.11.6 (or leave blank in legacy templates). | UP Loop / Common Loop |
| Signal Type | Post classification for LP-OCIP DMI display per Annexure-B (Dist., Inner Dist., Main Home with Junction Route, Calling-on Signal, Line Starter, Adv. Starter, Cl. 1.2.11.6). | Main Home with Junction Route |
| Aspects of Entry Signal | List every valid OFF, Red, and Blank aspect (Green, Double Yellow, Yellow, Yellow with "Pos1", Yellow with "Pos4", Miniature for Calling-On, Red, Cl. 1.2.11.7). | Yellow with "Pos1", Red |
| Requires Aspects of Exit Signal | Corresponding required aspect of Exit Signal (Yellow, S27 Red/Blank, Red, Nil for Red LSS, Cl. 1.2.11.8). | Yellow, S27 Red/Blank, Red |
| Requires Points in Route (Normal / Reverse) | Points traversed between Entry and Exit split into Normal and Reverse lists. **Omit overlap points** (already proved in interlocking, Cl. 1.2.11.9). | N: P-20; R: P-19 / N: P-11; R: P-13, P-17KL |
| Requires Track Circuit "UP" in Route | Berthing/route track circuits required picked UP (ULT, CLT, DMT, UMT, 6T, 3-4T). For Calling-On (S1A/S30A), mark approach track Occupied (1AT Occupied, 30AT Occupied). Use \- or Route Free for Distant/LSS (Cl. I.2.11.10). | ULT / CLT |
| TINs Requires Free | Ordered TINs (N-xx) traversed between Entry and Exit. Use Route Free for Distant signals and Nil for LSS (**Block Section TIN is never proved**, Cl. I.2.11.12). Omit TIN proving for Calling-On or danger OS entry until route ascertained. | N-61, N-67 / N-62, N-70, N-71 |
| TINs Requires Free In Overlap | Overlap TIN(s) beyond Exit Signal proved conditionally on overlap point position (N-65 (W12R) or N-72, N-66 (W18R)). Include overlap track circuits in Automatic sections (Cl. I.2.11.11, I.2.11.13). Not proved for Calling-On. | N-69, N-65 (W12R) / N-72, N-66 (W18R) |
| Entry Signal Foot Tag | Signal Foot Tag ID (R-xxx) colocated at Entry Signal. | R-513 / R-514 |
| Check RFID Sequence (Linking Distance, En-Route Tag) | Sequence (0, R-entry), (d\_1, R-tag1), ..., (d\_k, R-exit) where each d\_i is the incremental meter spacing from the immediately preceding tag (Cl. I.2.11.14). For LSS, include all Block Section tags up to the adjacent station's first Stop signal foot tag. | (0, R-513), (200, R-515), (163, R-517), (139, R-531), (250, R-533), (256, R-535), (250, R-537) |
| Distance between Entry & Exit Signal (Meters) | Total physical distance in meters (sum of tag intervals for standard routes; adjusted by A-tag offset for LSS block routes). | 1258 / 1125 |
| Movement Authority From Foot of Entry Signal (in Sections) | Authority in sections (1, 2, 3, 4\) per aspect control chart and occupancy (Cl. I.2.11.16). For LSS in Absolute Block, specify distance/sections to next stop signal (e.g., 3 Sections (5567 upto S7 GGD-SKP-IB)). | 2 (Pos1), 1 (Red) |
| Authorized Speed (kmph) In OS | Permitted speed in On-Sight mode: MPS for straight main line, 30 for single-turnout loop, 15 for multiple turnouts, Calling-On, or Red LSS (Cl. 1.2.11.17). | 30 / 15–30 |

### **Table 2: Block Section Details and System Control Parameters**

*Reference: PDF Page 21 (GGD) and Page 35 (CTF Template).*  
**Entry Signal (How to Identify in Layout):** Identify the Last Stop Signal (LSS) in each departure direction (UP and DN)—the outermost station Stop signal governing entry from station limits into the inter-station Block Section (S25 for UP, S6 for Down in GGD, Cl. 1.2.11.18.1(i)).  
**Exit Signal (How to Identify in Layout):** Trace across the Block Section TIN to the first approaching Stop signal of the adjacent Stationary KAVACH unit, IB signal, or Gate signal (S30 (CTF) for S25, S7 (GGD-SKP-IB) for S6).  
**Absolute Location Reset Formulas (Adjustment / Junction A-Tag):** When a departure block section contains an Adjustment/Junction tag (A-tag) where chainage jumps between ABS1 and ABS2, the onboard odometer reset parameters are computed as:  
\\text{Absolute Location Correction (m)} \= \|ABS1 \- ABS2\| \\times 1000 \\text{Start Distance to Absolute Location Reset (m)} \= \\text{Cumulative Distance from LSS Foot Tag to } A\\text{-Tag (adjusted for chainage jump in Reverse direction)}  
In GGD, S6 (Down, Nominal) reaches A-tag R-454 after intervals 150 \+ 50 \+ 911 \+ 500 \= 1611 m, where ABS1 \= 131.270 and ABS2 \= 131.163, giving a correction of 107 m (Loco Direction \= Nominal). S25 (Up, Reverse) reaches A-tag R-613 after intervals 150 \+ 150 \+ 936 \+ 470 \= 1706 m, where ABS2 \= 126.370 and ABS1 \= 126.341, giving a correction of 29 m and a start distance of 1706 \- 29 \= 1677 m (Loco Direction \= Reverse).

| Column Name | Extraction Logic & RDSO Rule | GGD Example (S25 / S6) |
| :---- | :---- | :---- |
| Last Stop Signal for entering into Block Section | Departure LSS name (UP/DN, Cl. 1.2.11.18.1(i)). | S25 / S6 |
| Distance from LSS to Next Approaching Stop Signal (m) | Physical distance in meters from LSS foot tag to next Stop signal foot tag (Cl. 1.2.11.18.1(ii)). | 5197 / 5567 |
| Block Section TIN | TIN assigned to the departure block track (Cl. 1.2.11.18.1(iii)). | N-91 / N-90 |
| Up/Down (Movement) | Traffic direction (UP or Down). | UP / Down |
| Adjacent Line TINs | TIN of the parallel track sharing the block corridor (Cl. 1.2.11.18.1(iv)). | N-96 / N-89 |
| Next Station Id | Adjacent Stationary KAVACH Station ID from layout boundary/allotment (Cl. 1.2.11.18.1(v)). | 520 / 522 |
| Next Station Border RFID with Location | Border RFID tag ID and absolute location in meters where station handover occurs (Cl. 1.2.11.18.1(vi)). | R-611, 126811 / R-452, 130663 |
| Authorised Speed | Permitted speed on detection in OS mode in block section (MPS, Cl. 1.2.11.18.1(vii)). | MPS / MPS |
| Start Distance to Absolute Location Reset (m) | Distance from LSS foot tag to A-tag reset point (Cl. 1.2.11.18.1(viii)). | 1677 / 1611 |
| Absolute Location Correction (m) | Chainage correction \` | ABS1 \- ABS2 |
| Loco Direction after Adjustment | Nominal (increasing km) or Reverse (decreasing km) post-reset (Cl. 1.2.11.18.1(x)). | Reverse / Nominal |

Two global station parameters sit beneath Table 2 (Page 21): **Signals Override (OV) not required at zero speed** (S25, S6 in GGD, applicable when LSS/semi-auto signals work in automatic mode per Cl. I.2.11.19), and **Authorized speed on detection of train in on-sight mode** (110 kmph in GGD, Cl. 1.2.11.20).

### **Table 3: Shunting Limit Table**

*Reference: PDF Page 22 (GGD) and Page 35 (CTF Template).*  
**Entry / Exit Signal Identification:** Table 3 has no Entry Signal or Exit Signal columns. Because Shunt signals are omitted from Table 1 (Cl. 1.2.4), the agent instead scans the four yard boundaries (UP and DN main lines × Nominal and Reverse directions) to identify the Shunting Limit tags (marked near Block Section Limit Boards BSLB / Shunt Limit Boards / outermost yard boundary tags) and records their handover attributes (Cl. I.2.11.21).

| Column Name | Extraction Logic from Layout | GGD Row 1 | GGD Row 2 | GGD Row 3 | GGD Row 4 |
| :---- | :---- | :---- | :---- | :---- | :---- |
| Adjacent Station Name | Station/IB name toward which the shunting direction faces. | GGD-SKP-IB | CTF | GGD-SKP-IB | CTF |
| Direction | Nominal (rightward/increasing km) or Reverse (leftward/decreasing km). | Nominal | Reverse | Nominal | Reverse |
| RFID Tag No | Outermost yard tag governing shunting limit on that line/direction. | R-526 | R-516 | R-515 | R-527 |
| TIN | Station yard TIN enclosing that shunting limit tag. | N-66 | N-62 | N-61 | N-65 |
| Absolute Location in Meters | Absolute km/meter location of the tag (km × 1000 in integer meters). | 129430 | 128182 | 129417 | 128163 (blank in PDF p. 22\) |

### **Table 4: KAVACH Track Profile Table**

*Reference: PDF Pages 23–29 (GGD) and Page 36 (CTF Template).*  
**Entry Signal (How to Identify in Layout):** Select every primary Entry Signal from Table 1 **except Calling-On signals (S1A, S30A) and Shunt signals**. Calling-On signals are omitted because they share the identical physical track geometry, gradient, PSR, turnout, and LC gate profile as their parent Home signal (S1, S30).  
**Exit Signal (How to Identify in Layout):** Identical to Table 1's next approaching downstream signal along each physical route (including adjacent station/IB Stop signals for LSS routes).  
**Turnout Speed Formulas (Cl. 1.2.12.1):** Set Speed Value to 30 kmph for a single turnout in the route, 15 kmph for multiple turnouts in the route, or the Zonal Railway/train-specific PSR value. Set Start Distance to the meter distance from the Entry Signal Foot Tag to the start of the first diverging point. Compute restriction Length based on movement direction relative to station premises:  
L\_{\\text{TO, entry}} \= (\\text{Distance from start of first diverging point to Exit Signal}) \+ 30\\text{ m} L\_{\\text{TO, exit}} \= (\\text{Distance from Entry Signal Foot Tag to end of last converging point}) \+ 10\\text{ m}  
For example, in GGD S1 \-\> S4 (station entry, total 1125 m, diverging point P-11 at 307 m), L\_{\\text{TO, entry}} \= (1125 \- 307\) \+ 30 \= 848\\text{ m}. In S4 \-\> S6 (station exit, converging turnout zone 110 m from S4), L\_{\\text{TO, exit}} \= 110 \+ 10 \= 120\\text{ m}; similarly S26 \-\> S25 yields 216 \+ 10 \= 226 m and S27 \-\> S25 yields 115 \+ 10 \= 125 m.  
**Average Gradient Formula (Cl. 1.2.12.3(b)):** Extract engineering gradients strictly between Entry Signal and Exit Signal (**excluding signal/block overlap gradients**) with R (Rising) and F (Falling) oriented to the train's travel direction (Nominal/Reverse). Combine consecutive same-direction slopes (1 in g\_1, d\_1), ..., (1 in g\_n, d\_n) over D \= \\sum d\_i using:  
G \= \\frac{\\sum\_{i=1}^{n} d\_i}{\\sum\_{i=1}^{n} \\frac{d\_i}{g\_i}}  
In Clause 1.2.12.3(b), (R 1 in 100, 150m) plus (R 1 in 260, 620m) produces G \= 770 / (150/100 \+ 620/260) \= 198.22 \\approx 198, recorded as R 1 in 198\. Keep the number of average gradient segments per route at **≤ 31** (merging intermediate segments in the middle of the route if exceeded, while preserving SPAD-critical braking precision near the Exit Signal).

| Column Group | Sub-Columns & Extraction Rules | GGD Example (S1 \-\> S4, S. No. 4\) |
| :---- | :---- | :---- |
| **Route Keys** | S. No., Entry Signal, Exit Signal, Line. | 4 / S1 / S4 / Common Loop |
| Turnout Speed | Speed Value (kmph), Start Distance (m), Length (m) per Cl. 1.2.12.1 formulas. | 30 / 307 / 848 |
| Permanent Speed Restriction | Tuples (Type, Speed Value (kmph), Length (m)) where Type is U (all trains), A (LE/Passenger), B (Loaded Goods), or C (Empty Goods). Sum of lengths equals Entry-to-Exit distance. | (U, 110, 307), (U, 30, 818\) |
| Gradient | Engineering Gradient tuples, Average Gradient value (R/F/LEVEL), and Length (m) from Engineering Index Plan. | (Level, 179), (R 1 in 260, 401), (Level, 184), (F 1 in 300, 361\) |
| LC Gate | LC Distance (m) from Entry tag, LC ID Numeric/Alpha suffix, LC Manning Type (Manned/Unmanned), LC Class (Special, A, B1, B2, B, C, D), LC Auto Whistling Enabled/Type (Yes, Distance Based). | Blank on S1-\>S4 (for S1 D-\>S1 ID: 477, 19, Manned, C, Yes, Distance Based) |
| Track Condition | Track Condition Type (Dead Stop and KAVACH Territory Exit mandatory; Fouling Mark etc. optional), Start Distance (m), Length (m). | Fouling Mark / 411 From S1 (applied to S. No. 3 & 4 block on p. 23\) |

### **Table 5: KAVACH TSR Route Table**

*Reference: PDF Pages 30–34 (GGD). Added via Amendment-4 (Cl. 1.2.12.6, 01.01.2024).*  
**Entry Signal (How to Identify in Layout):** Every primary Entry Signal from Table 4 (Distant, Inner Distant, Home, Starter, Advanced Starter, or terminal Stop Board/Buffer per Cl. 1.2.12.6.1) ordered sequentially along a continuous OHE Line.  
**Exit Signal (How to Identify in Layout):** The next approaching signal along that OHE Line (Cl. 1.2.12.6.2).  
**Cumulative Offset Formula:** For each route along a shared OHE Line anchored at OHE Line Start RFID Tag:  
\\text{Entry Signal Distance from OHE Line Start RFID Tag} \= \\sum (\\text{Lengths of preceding routes on the same OHE Line from Start Tag})  
Thus, in GGD, S30 \-\> S28 (GGD UP Main Line, starting at R-513) has offset 0 m, and the continuation route S28 \-\> S25 has offset 1217 m (the distance from S30 to S28); similarly, S26 \-\> S25 has offset 1218 m and S27 \-\> S25 has offset 1258 m.

| Column Name | Extraction Logic & RDSO Rule | GGD Example (S30 \-\> S28 & S28 \-\> S25) |
| :---- | :---- | :---- |
| S. No. | Sequential integer matching TSR route rows. | 8 / 9 |
| Entry Signal | Origin signal of segment (Cl. 1.2.12.6.1). | S30 / S28 |
| Exit Signal | Immediate next signal of segment (Cl. 1.2.12.6.2). | S28 / S25 |
| OHE Line | OHE line identifier covering the corridor (GGD UP Main Line, GGD DN Main Line, Cl. 1.2.12.6.3). | GGD UP Main Line |
| OHE Line Start RFID Tag | Signal Foot Tag from which TSRMS transmits TSR data along that OHE line (Cl. 1.2.12.6.4); merged/blank on continuation rows. | R-513 / Merged |
| TSR Route ID | Numeric ID of Start RFID Tag; append line/route digit when multiple routes share the start tag (Cl. 1.2.12.6.5, e.g., 5131, 5133, 5134 from R-513; 5142 from R-514). Leave blank if unallocated. | 5133 / Merged |
| Entry Signal Distance from OHE Line Start RFID Tag | Cumulative meter distance from Start Tag to current Entry Signal (0 at origin, Cl. 1.2.12.6.6). | 0 / 1217 |
| Last pole Distance from Exit Signal | Residual meter distance from final OHE mast before Exit Signal to Exit Signal foot tag (Cl. 1.2.12.6.7). | 34.9 / 45.1 |
| OHE Pole/Km Data (in meter) | Ordered tuples (distance \- km/pole) giving distance from Start Tag to 1st pole and pole-to-pole intervals thereafter (Cl. 1.2.12.6.8). | (45.1-129/33), (45.40-129/31), ... |

### **Table 6: Temporary Single Line Working on Double Line Control Table**

*Reference: PDF Page 37 (CTF Template, Cl. 1.2.12.7–1.2.12.19).*  
**TSL Entry Signal (How to Identify in Layout):** Identify every signal, Stop Board (UM Stop Board), or Shunt Signal (SH23) authorized to dispatch trains in the wrong direction onto the single active track during TSL working (Cl. 1.2.12.8).  
**TSL Exit Signal (How to Identify in Layout):** Trace in the TSL travel direction (opposite to normal line flow, across crossovers into the active block line) to the next approaching Stop signal or adjacent station's receiving/exit signal (S25 of GGD, S15 of VKB, Cl. 1.2.12.9).

| Column Name | TSL-Specific Extraction Logic | CTF Template Example (UM Stop Board \-\> S25 of GGD) |
| :---- | :---- | :---- |
| TSL Entry Signal | Wrong-direction dispatch signal, Stop Board, or Shunt signal (Cl. 1.2.12.8). | UM Stop Board (other rows: S6, S26, SH23, S25) |
| TSL Exit Signal | Next approaching signal on TSL path, often at adjacent station (Cl. 1.2.12.9). | S25 of GGD |
| Signal Type | Entry point type (UP main Stop Board, Loopline Starter, Mainline Starter, Advanced Starter). | UP main Stop Board |
| Aspect of Entry Signal | Always Red/Blank or Blank (Cl. 1.2.12.10). | Blank |
| Requires Aspects of Exit Signal | Always Red or Red/Blank (Cl. I.2.12.11). | Red |
| Required Route Command | Interlocking panel/VDU button sequence locking the TSL path. | UMUNR, 30GNR |
| Requires Points in Route (Rev / Normal) | Points locked in Normal/Reverse per Zonal Railway TSL rules (Cl. I.2.12.12). | Rev: 19, 20; Normal: Blank |
| Requires Track Ckt Up in Route for TSL Exit signal | Yard track circuits (DMT, CLT) and Axle Counter section free; entire block section treated as absolute block without block instrument line clear (Cl. I.2.12.13). | Axle Counter section free |
| TINS Requires Free | All TINs along TSL route; **exclude Block Section TIN** (Cl. I.2.12.14). | N-56, 53 |
| Entry Signal Foot Tag | RFID tag at TSL Entry point (Cl. 1.2.12.15). | R-687 |
| Check RFID Sequence | Ordered (distance, tag) pairs along TSL route. **Strictly exclude the Exit Signal Foot Tag** (Cl. 1.2.12.16). | (430, R-683), (180, R-681), ..., (100, R-529) |
| Distance between Entry & Exit Signal | Total physical distance in meters (Cl. 1.2.12.17). | 5810 |
| Movement Authority From Foot of Entry Signal (in Sections) | Onsight movement authority defined in meters/sections (Cl. I.2.12.18). | Blank in CTF template |
| Authorized Speed in OS (kmph) for first train/subsequent trains | Split OS speed authorization for first train vs. subsequent trains (Cl. I.2.12.19). | 25/booked speed |

Below Table 6 sits an 8-column **Block Section Sub-Table** (Signal for entering into Block Section, TSL Block Section TIN, Adjacent Line TINs, Next Station Id, Next Station Border RFID, Start Distance to Absolute Location Reset (m), Absolute Location Correction (m), and Loco Direction after Adjustment, e.g., S30, N-91/N-95, N-96/N-94, 521/503, 3440, 60 (+ve), Reverse) mirroring Table 2 for TSL block operations.

### **Table 7: TSL Working on Double Line Track Profile Data Table**

*Reference: PDF Pages 38–39 (CTF Template, SST\_CTF\_V2\_1.0).*  
**TSL Entry / Exit Signal Identification:** Replicates the exact (TSL Entry Signal, TSL Exit Signal) pairs from Table 6 (Cl. 1.2.12.1). Note that the Line column is omitted on Pages 38–39, and because TSL trains move opposite to normal line direction, **gradient signs (R vs. F or \+ vs. \-) must be inverted** relative to normal-direction profiles.

| Column Group | Sub-Columns & Extraction Rules | CTF Template Example (S6 \-\> S26, Page 38\) |
| :---- | :---- | :---- |
| **TSL Route Keys** | TSL Entry Signal, TSL Exit Signal. | S6 / S26 |
| Turnout Speed | Speed Value (kmph), Start Distance (m), Length (m) measured in TSL travel direction. | 30 / 450 / 860 |
| Permanent Speed Restriction | (Speed Value (kmph), Static Speed Type, Length (m)) supporting category-specific restrictions (90-A, 60-B, 65-C, 80\) alongside U speeds. | (90-A, 60-B, 65-C, 80), (110, U, 960), (90-A, 60-B, 65-C, 110), (110, U, 70\) |
| Gradient | Engineering Gradients (direction-adjusted signs), Average Gradient Value, and Length (m). | (1 in \-1000, 10), (1 in 150, 190), ... / 1 in 159, 1 in \-14369, 1 in \-26309 |
| LC Distance / Length | LC Distance (m) and route Length (m). | 1280 |
| LC Gate | LC ID Numeric/Alpha suffix, LC Manning Type, LC Class, LC Auto Whistling Enabled / Type. | None / Manned / 'A' Class / Distance Based |
| Track Condition | Track Condition Type, Start Distance (m), Length (m). | Blank unless Dead Stop, Territory Exit, or Fouling Mark applies |

## **Agent Validation Rules and Mathematical Invariants**

Before outputting the seven tables, the generation pipeline should run five deterministic verification checks grounded in the RDSO specification and Gullaguda reference data:

> 1. **Tag-Sequence Distance Conservation:** On every standard route in Table 1, verify that the sum of linking distances equals Distance between Entry & Exit Signal (e.g., S1 \-\> S4: 199 \+ 158 \+ 59 \+ 210 \+ 249 \+ 250 \= 1125 m). On LSS routes containing an A-tag, verify that the tag sum adjusted by Absolute Location Correction matches the Table 1/Table 2 distance (S6 \-\> S7: 5460 \+ 107 \= 5567 m; S25 \-\> S30: 5226 \- 29 \= 5197 m).  
> 2. **PSR and Gradient Length Conservation:** In Tables 4 and 7, verify that the sum of all PSR segment lengths and the sum of all Gradient segment lengths along a route each equal the Entry-to-Exit Signal distance (e.g., S1 D \-\> S1 ID: 297 \+ 552 \+ 174 \= 1023 m).  
> 3. **Turnout Offset Verification:** Confirm that Turnout Start Distance equals the distance from Entry Signal Foot Tag to the first diverging point, and that Turnout Length satisfies the \+30 m (station entry) or \+10 m (station exit) rule.  
> 4. **TSL Tag Exclusion Check:** In Table 6, enforce that Aspect of Entry Signal is Red/Blank or Blank (Cl. 1.2.12.10) and that the Exit Signal Foot Tag is **excluded** from Check RFID Sequence (Cl. 1.2.12.16).  
> 5. **TSRMS Empty Handling:** Ensure no TSRMS Route ID column is populated in Table 1 (per Amdt-4 Cl. I.2.11.6), and leave TSR Route ID in Table 5 blank unless TSRMS route-tag allocations are explicitly provided.

#### **Works cited**

1\. KAVACH Table of Control Guidelines \| PDF \- Scribd, https\://www\.scribd.com/presentation/925225870/Kavach-Table-of-Control-Design 2\. Kavach RFID Tag Data Format Overview \| PDF \- Scribd, https\://www\.scribd.com/document/819538467/RFID-Tag-Format-20-06-22 3\. DHOLERA DOUBLE LINE SEMI HIGH SPEED PROJECT ... \- Tenders, https\://www\.tenderfiles.com/tenderdocuments/82026/17/d45c4cac-0743-42a0-af5e-ec432e00381c?FileName=SandTEMPLOYERREQUIREMENTSignaling.pdf