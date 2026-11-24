# X-Tractor — Railway Layout & KAVACH Control Table Studio

**X-Tractor** is an offline, zero-AI engineering workbench designed for Indian Railways signaling and KAVACH (TCAS) systems. It processes railway station engineering layouts (**DWG**, **DXF**, and vector/scanned **PDF**), extracts signaling and track infrastructure components deterministically, performs engineering validations, and generates all 7 RDSO KAVACH Control Tables with interactive editing, audit tracking, and multi-format export.

---

## Key Capabilities

- **100% Offline & Deterministic Processing**:
  - Zero cloud dependencies, zero external AI models, zero API keys required.
  - Native DWG binary parsing via WebAssembly LibreDWG (`@mlightcad/libredwg-web`).
  - Native DXF parsing (`dxf-parser`).
  - Lossless vector PDF geometry & spatial text extraction (`pdfjs-dist` + PyMuPDF).
  - High-precision local OCR fallback (`pytesseract` / Tesseract-OCR) for scanned or legacy blueprints.
- **Dynamic Component Extraction**:
  - **Signals**: Auto-classifies Home, Routing, Starter, Advance Starter (LSS), Distant, Calling-On, and Shunt signals per RDSO conventions.
  - **RFID Tags**: Extracts and maps Foot Tags, Normal, Reverse, and In-Route tags with spatial chainage and linking distance calculations.
  - **Turnout Points & Track Circuits**: Detects normal/reverse point numbers, track circuit bounds, and Track Identification Numbers (TINs).
  - **Level Crossing Gates**: Identifies LC gates, chainages, and protection limits.
- **RDSO KAVACH Table Generation (Tables 1 – 7 & 6B)**:
  - **Table 1**: Station Control Table (Routes, Aspects, Overlaps, Points Normal/Reverse, Track Circuits, TINs, Check RFID Sequence, Movement Authority).
  - **Table 2**: Block Section Details (LSS signals, Block TINs, Adjacent TINs, Next Station IDs, A-Tag resets).
  - **Table 3**: Shunting Limits & Stop Boards.
  - **Table 4**: Track Profile & Gradient Characteristics.
  - **Table 5**: RFID Tag Layout & Nominal Chainages.
  - **Table 6 / 6B**: Temporary Single Line (TSL) Working & Route Protection.
  - **Table 7**: TSL Track Profile & Gradients.
- **Dynamic Movement Authority & Aspect Separation**:
  - Exit Green $\rightarrow$ **Movement Authority: 4**
  - Exit Double Yellow $\rightarrow$ **Movement Authority: 3**
  - Exit Yellow $\rightarrow$ **Movement Authority: 2**
  - Exit Red / Nil / Blank / `-` $\rightarrow$ **Movement Authority: 1**
  - Separate individual rows for every distinct exit aspect combination.
- **Hierarchical Table Management**:
  - Contextual **Add Row** flow with route selection, entry/exit aspect color hierarchy, and in-place insertion.
  - Inline cell editing with provenance audit flags (calculated vs. manual).
  - Instant engineering rule validation and math invariant checking.
- **Comprehensive Export**:
  - Full RDSO-compliant multi-sheet Microsoft Excel (`.xlsx`) export.
  - Publication-ready vector PDF document export.
  - Lossless JSON project archive for backup and restore.

---

## Getting Started

### Prerequisites

- **Node.js**: v18.0.0 or higher
- **Python**: 3.10+ with `pymupdf`, `pytesseract`, `pillow` (for scanned PDF OCR extraction)
- **Tesseract-OCR**: Installed at `C:\Program Files\Tesseract-OCR\tesseract.exe` (optional, for raster scans)

### Installation

```bash
git clone https://github.com/shiva39royal/RailSpecTest.git
cd RailSpecTest
npm install
```

### Running Locally

```bash
# Start development server
npm run dev
```

Open your browser at `http://localhost:3000` (or `http://localhost:3001` if 3000 is occupied).

### Building for Production

```bash
npm run build
npm start
```

---

## System Architecture

```
X-Tractor
├── server/
│   ├── cadParser.ts             # Lossless DWG/DXF/PDF vector & spatial text decoder
│   ├── cadComponentExtractor.ts # Dynamic signal, tag, turnout & route graph builder
│   ├── extractionService.ts     # Multi-table synthesizer & TOC harmonizer
│   ├── pdfProcessor.ts          # PDF vector operator & layout page renderer
│   └── pdfOcrWorker.py          # Offline PyMuPDF + Tesseract OCR worker
├── src/
│   ├── engine/kavachEngine.ts   # Core RDSO signaling rules, MA derivation & validators
│   ├── spec/kavachSpecSchema.ts # Column schemas, data types & clause references
│   └── components/              # Interactive workspaces (Viewer, Tables, Export, etc.)
└── Reference/                   # Reference layouts and companion TOC validation sheets
```

---

## License

Proprietary engineering software. All rights reserved.
