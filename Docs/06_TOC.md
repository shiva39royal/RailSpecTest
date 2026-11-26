# Phase 6: KAVACH Table of Control (TOC) Architecture

This document provides a column-by-column engineering reference for the **KAVACH Table of Control (Table 1)** per the Research Designs & Standards Organisation (RDSO) specification (`RDSO/SPN/196/2020 Version 4.0`, Clause I.2.11 Amendment-6).

---

## 1. Executive Summary & Purpose

The **Table of Control (TOC)** is the central safety artifact of Station KAVACH. It governs:
1. Every monitored physical train route from an Entry Signal to an Exit Signal.
2. The dynamic aspect interlocking matrix (Entry Aspect $\rightarrow$ Exit Aspect requirements).
3. Switch point settings (Normal vs. Reverse), excluding overlap points.
4. Required picked-UP track circuits and Track Identification Numbers (TINs) along the route corridor.
5. Exit signal overlap TINs with conditional point proving.
6. The exact RFID balise linking chain (distance tuples and tag IDs) used by the onboard unit to verify position.
7. Movement Authority (MA) distances and Over-Speed (OS) speed limits.

*(Note: Per RDSO Amdt-4 Cl. I.2.11.6, the legacy TSRMS Route ID column is omitted).*

---

## 2. Table of Control Column-by-Column Specification

Below is the complete specification for all 18 columns of Table 1:

```
+-----+--------------+-------------+--------------+------------------+------------------+---------------+--------------+
| 1   | 2            | 3           | 4            | 5                | 6                | 7             | 8            |
| S.No| Entry Signal | Exit Signal | Section Type | Line             | Signal Type      | Aspects Entry | Aspects Exit |
+-----+--------------+-------------+--------------+------------------+------------------+---------------+--------------+
| 9   | 10           | 11          | 12           | 13               | 14               | 15            | 16           |
| Pts Normal         | Pts Reverse | Track Ckt UP | TINs Req. Free   | TINs in Overlap  | Foot Tag      | Linking Seq. |
+-----+--------------+-------------+--------------+------------------+------------------+---------------+--------------+
| 17  | 18           |
| Dist| MA (Sections)| Authorized Speed OS
+-----+--------------+
```

---

### Column 1: S. No. (Sequential Route Number)
* **Key:** `sNo`
* **Clause Reference:** Cl. I.2.11.1
* **Data Type:** Integer (`number`) | **Mandatory:** Yes
* **Engineering Purpose:** Provides a continuous numeric index for every distinct physical route monitored by Stationary KAVACH.
* **Derivation Logic:** Auto-incremented sequentially ($1, 2, 3, \dots$) per unique `(Entry Signal, Exit Signal)` corridor.

---

### Column 2: Entry Signal
* **Key:** `entrySignal`
* **Clause Reference:** Cl. I.2.11.2
* **Data Type:** String | **Mandatory:** Yes
* **Engineering Purpose:** Identifies the approaching signal governing entry into the monitored route.
* **Derivation Logic:**
  * Derived from detected signals: Distant (`S1D`), Inner Distant (`S1 ID`), Home (`S1`, `S30`), Calling-On (`C1`, `S1(CO)`), Starter (`S3`, `S4`), or Advance Starter / LSS (`S11`, `S12`).
  * Shunt signals (`SH-xx`) are excluded.
  * Stop Boards or Buffer Stops are recorded where no further active signal exists.

---

### Column 3: Exit Signal
* **Key:** `exitSignal`
* **Clause Reference:** Cl. I.2.11.3
* **Data Type:** String | **Mandatory:** Yes
* **Engineering Purpose:** Identifies the immediate downstream signal at the termination of the route corridor.
* **Derivation Logic:**
  * Traverses the track corridor downstream from `entrySignal` in the direction of train travel to the first matching running signal.
  * For Advance Starters / LSS entering an Absolute Block section, points to the next block signal (or adjacent station Home signal, e.g., `MARP S1`).
  * For dead-end sidings, recorded as `BUFFER` or `STOP BOARD`.

---

### Column 4: Section Type
* **Key:** `sectionType`
* **Clause Reference:** Cl. I.2.11.4
* **Data Type:** Enum (`'Station Section' | 'Absolute Block' | 'Automatic Section'`) | **Mandatory:** Yes
* **Engineering Purpose:** Dictates the operating territory rules for braking curves and authority extension.
* **Derivation Logic:**
  * **Station Section:** Routes originating from Home, Calling-On, or Starter signals inside the station yard.
  * **Absolute Block:** Routes originating from Distant / Inner Distant signals approaching the yard, or Advance Starter / LSS routes departing the station into the block section.
  * **Automatic Section:** Territory equipped with continuous automatic block signaling.

---

### Column 5: Line
* **Key:** `line`
* **Clause Reference:** Cl. I.2.11.5
* **Data Type:** String | **Mandatory:** Yes
* **Engineering Purpose:** Functional track designation traversed by the route.
* **Derivation Logic:**
  * Extracted from track labels via anisotropic distance matching:
    * `UP MAIN LINE`
    * `DN MAIN LINE`
    * `COMMON LOOP LINE` / `LOOP-1`
    * `GOODS RUNNING LINE`

---

### Column 6: Signal Type
* **Key:** `signalType`
* **Clause Reference:** Cl. I.2.11.6
* **Data Type:** String | **Mandatory:** Yes
* **Engineering Purpose:** Defines the physical and functional role of the entry signal for Loco Pilot Driver-Machine Interface (LP-OCIP DMI) display per Annexure-B.
* **Derivation Logic:**
  * Formatted to standard RDSO classifications:
    * `Distant` / `Inner Distant`
    * `Main Home with Junction Route` (if the route diverges via a loop turnout)
    * `Main Home without Junction Route` (if straight through the main line)
    * `Calling-on Signal`
    * `Line Starter` / `Main Line Starter`
    * `Adv. Starter` (Advance Starter / LSS)

---

### Column 7: Aspects of Entry Signal
* **Key:** `aspectEntry`
* **Clause Reference:** Cl. I.2.11.7
* **Data Type:** String | **Mandatory:** Yes
* **Engineering Purpose:** Enumerates every permitted visual aspect capable of being displayed by the Entry Signal for this route.
* **Derivation Logic:**
  * Dynamically derived from the signal's vector aspect stroke circles:
    * 4-Aspect Signaling: `Green`, `Double Yellow`, `Yellow`, `Red`
    * 3-Aspect Signaling: `Green`, `Yellow`, `Red`
    * Calling-On Signal: `Miniature Yellow` (or `Yellow`) and `Red`

---

### Column 8: Requires Aspects of Exit Signal
* **Key:** `aspectExit`
* **Clause Reference:** Cl. I.2.11.8
* **Data Type:** String | **Mandatory:** Yes
* **Engineering Purpose:** The necessary aspect displayed by the Exit Signal corresponding to the Entry Signal aspect.
* **Derivation Logic:**
  * Mapped from the aspect cascade hierarchy:
    * Entry `Green` $\rightarrow$ Exit `Green` (or `Double Yellow` in 4-aspect territory)
    * Entry `Double Yellow` $\rightarrow$ Exit `Yellow`
    * Entry `Yellow` $\rightarrow$ Exit `Red`
    * Entry `Red` $\rightarrow$ Exit `Nil` (no exit aspect required when entry signal is at Stop)
    * Calling-On $\rightarrow$ Exit `Red` or `Nil`

---

### Column 9: Requires Points in Route - Normal
* **Key:** `pointsNormal`
* **Clause Reference:** Cl. I.2.11.9
* **Data Type:** String | **Mandatory:** No
* **Engineering Purpose:** Lists switch points that must be locked in the **Normal (Straight)** position to set this route.
* **Derivation Logic & RDSO Invariant:**
  * Scans all turnout points falling within the horizontal corridor between Entry and Exit.
  * Points traversed on the through straight rail are recorded as `P-xx` (e.g., `P-17, P-18`).
  * **Critical Exclusion Rule:** Points located in the signal overlap *beyond* the Exit Signal are **strictly excluded** from this column.

---

### Column 10: Requires Points in Route - Reverse
* **Key:** `pointsReverse`
* **Clause Reference:** Cl. I.2.11.9
* **Data Type:** String | **Mandatory:** No
* **Engineering Purpose:** Lists switch points that must be locked in the **Reverse (Diverging)** position for this route.
* **Derivation Logic & RDSO Invariant:**
  * Traverses diagonal turnout rails between Entry and Exit.
  * Points traversed into or out of a diverging track are recorded as `P-xx` (e.g., `P-17`).
  * Overlap points are strictly excluded.

---

### Column 11: Requires Track Circuit "UP" in Route
* **Key:** `trackCircuitUp`
* **Clause Reference:** Cl. I.2.11.10
* **Data Type:** String | **Mandatory:** No
* **Engineering Purpose:** Track circuits that must be proved unoccupied (relay picked UP) before the signal can clear.
* **Derivation Logic:**
  * Lists intermediate track circuits, point zone track circuits, and berthing track circuits (e.g., `08T, 34T`, `CLAT, CLBT`).
  * **Calling-On Exception:** Calling-on routes do not prove the berthing track circuit UP (in fact, the approach track must be proved occupied before the calling-on timer begins).

---

### Column 12: TINs Requires Free
* **Key:** `tinsFree`
* **Clause Reference:** Cl. I.2.11.12
* **Data Type:** String | **Mandatory:** No
* **Engineering Purpose:** Track Identification Numbers (TINs) representing route sections that must be free of opposing route locks.
* **Derivation Logic:**
  * Lists ordered in-route yard TINs (e.g., `N-50, N-54, N-46`).
  * **Calling-On Rule:** Left blank (`-`) for Calling-On routes.
  * **Block Section Rule:** Block Section TINs are never proved in station section routes.

---

### Column 13: TINs Requires Free In Overlap
* **Key:** `tinsOverlap`
* **Clause Reference:** Cl. I.2.11.13
* **Data Type:** String | **Mandatory:** No
* **Engineering Purpose:** Proves track sections in the signal overlap beyond the Exit Signal clear, qualified by conditional overlap point settings.
* **Derivation Logic:**
  * Traces track sections extending 120m–180m past the Exit Signal.
  * Formatted with conditional point qualifiers where applicable:
    * `P-17(N): N-51, P-17(R): N-55`
    * Or unconditional: `N-51`

---

### Column 14: Entry Signal Foot Tag
* **Key:** `entryFootTag`
* **Clause Reference:** Cl. I.2.11.14(i)
* **Data Type:** String | **Mandatory:** Yes
* **Engineering Purpose:** Identifies the dedicated RFID balise installed at the foot of the Entry Signal.
* **Derivation Logic:**
  * Matches the RFID tag with role code `S` positioned directly at the entry signal post (e.g., `R-704`).
  * Serves as the origin $(0\text{ m})$ reference for the route linking chain.

---

### Column 15: Check RFID Sequence (Linking Distance, En-Route Tag)
* **Key:** `enRouteTags`
* **Clause Reference:** Cl. I.2.11.14(ii-iii)
* **Data Type:** Tuple List | **Mandatory:** Yes
* **Engineering Purpose:** The ordered sequence of RFID balises along the path, paired with physical linking distances in meters.
* **Derivation Logic:**
  * Generated as an ordered tuple list:
    $$(0, R_{\text{foot}}), (d_1, R_1), (d_2, R_2), \dots, (d_k, R_{\text{exit}})$$
  * Where $d_i$ is the exact physical meter distance from tag $R_{i-1}$ to tag $R_i$.
  * Fouling Mark tags are suffixed with `-F` (e.g., `(40, R-687-F)`).
  * On block departure routes, accounts for A-Tag (`LOC.1` / `LOC.2`) chainage datum resets.

---

### Column 16: Distance Entry to Exit (m)
* **Key:** `distanceMeters`
* **Clause Reference:** Cl. I.2.11.15
* **Data Type:** Distance (Meters) | **Mandatory:** Yes
* **Engineering Purpose:** Total physical distance between the Entry Signal foot tag and the Exit Signal foot tag.
* **Derivation Logic:**
  * Calculated as the cumulative sum of intermediate linking distances:
    $$\text{Distance} = \sum_{i=1}^{k} d_i$$
  * Verified against CAD chainage difference: $|\text{KM}_{\text{exit}} - \text{KM}_{\text{entry}}|$.

---

### Column 17: Movement Authority (Sections)
* **Key:** `movementAuthority`
* **Clause Reference:** Cl. I.2.11.16
* **Data Type:** String | **Mandatory:** Yes
* **Engineering Purpose:** The number of block sections or signaling blocks over which the train is authorized to travel without stopping.
* **Derivation Logic:**
  * Derived from signal aspect capability:
    * Entry `Green` $\rightarrow$ `4` or `3` Sections
    * Entry `Double Yellow` $\rightarrow$ `2` Sections
    * Entry `Yellow` $\rightarrow$ `1` Section
    * Entry `Red` $\rightarrow$ `0` Sections
  * For LSS departure routes into Absolute Block territory, records: `"1 Section + [Distance]m to Next Stop Signal"`.

---

### Column 18: Authorized Speed In OS (kmph)
* **Key:** `authorizedSpeedOs`
* **Clause Reference:** Cl. I.2.11.17
* **Data Type:** String | **Mandatory:** Yes
* **Engineering Purpose:** Maximum permitted speed while operating under On-Sight (OS) or aspect authority.
* **Derivation Logic:**
  * **Main Line Straight Route:** `MPS` (Maximum Permissible Speed, e.g., 110–130 km/h).
  * **Standard Loop Turnout Route:** `30` km/h (standard 1 in 8.5 / 1 in 12 turnout speed).
  * **Sharp / Siding Turnout Route:** `15` km/h.
  * **Calling-On / Red Aspect:** `15` km/h.

---

## 3. Representative Table of Control Excerpt

| S.No | Entry Signal | Exit Signal | Section Type | Line | Signal Type | Aspects Entry | Aspects Exit | Points Normal | Points Reverse | Track Circuit UP | TINs Req. Free | TINs Overlap | Foot Tag | (Linking Distance, En-Route Tag) | Dist (m) | MA | Speed (kmph) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1** | S1 | S3 | Station Section | UP MAIN LINE | Main Home without Junction | Green | Green | P-17 | - | 08T, UMT | N-50, N-54 | N-58 | R-704 | (0, R-704), (200, R-706), (200, R-708) | 400 | 4 | MPS |
| **2** | S1 | S3 | Station Section | UP MAIN LINE | Main Home without Junction | Yellow | Red | P-17 | - | 08T, UMT | N-50, N-54 | N-58 | R-704 | (0, R-704), (200, R-706), (200, R-708) | 400 | 1 | MPS |
| **3** | S1 | S5 | Station Section | COMMON LOOP | Main Home with Junction | Yellow | Red | - | P-17 | 08T, CLT | N-46, N-48 | P-18(N): N-52 | R-704 | (0, R-704), (180, R-710), (220, R-712) | 400 | 1 | 30 |
| **4** | C1 | S3 | Station Section | UP MAIN LINE | Calling-on Signal | Yellow | Nil | P-17 | - | - | - | N-58 | R-704 | (0, R-704), (400, R-708) | 400 | 1 | 15 |
| **5** | S3 | S11 | Station Section | UP MAIN LINE | Main Line Starter | Green | Green | P-18 | - | UMT, UAT | N-54, N-60 | N-62 | R-708 | (0, R-708), (350, R-714), (250, R-718) | 600 | 3 | MPS |
