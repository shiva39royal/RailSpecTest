/**
 * Complete official 256-color AutoCAD Color Index (ACI 0–255) RGB Hex Palette.
 * Ensures DWG/DXF layers, TIN color bands, signals, and RFID tags render with
 * authentic AutoCAD colors rather than synthetic fallbacks.
 */
export const AUTOCAD_ACI_HEX: readonly string[] = [
  '#e2e8f0', // 0: ByBlock (resolved from parent INSERT; fallback neutral)
  '#ff0000', // 1: Red
  '#ffff00', // 2: Yellow
  '#00ff00', // 3: Green
  '#00ffff', // 4: Cyan
  '#0000ff', // 5: Blue
  '#ff00ff', // 6: Magenta
  '#e2e8f0', // 7: White / Black (adapts to Blueprint vs Paper bg)
  '#808080', // 8: Dark Gray
  '#c0c0c0', // 9: Light Gray
  // 10-19 (Red hues)
  '#ff0000', '#ff7f7f', '#cc0000', '#cc6666', '#990000', '#994c4c', '#7f0000', '#7f3f3f', '#4c0000', '#4c2626',
  // 20-29 (Red-Orange)
  '#ff3f00', '#ff9f7f', '#cc3300', '#cc7f66', '#992600', '#995f4c', '#7f1f00', '#7f4f3f', '#4c1300', '#4c2f26',
  // 30-39 (Orange)
  '#ff7f00', '#ffbf7f', '#cc6600', '#cc9966', '#994c00', '#99724c', '#7f3f00', '#7f5f3f', '#4c2600', '#4c3926',
  // 40-49 (Yellow-Orange)
  '#ffbf00', '#ffdf7f', '#cc9900', '#ccb266', '#997200', '#99854c', '#7f5f00', '#7f6f3f', '#4c3900', '#4c4226',
  // 50-59 (Yellow)
  '#ffff00', '#ffff7f', '#cccc00', '#cccc66', '#999900', '#99994c', '#7f7f00', '#7f7f3f', '#4c4c00', '#4c4c26',
  // 60-69 (Yellow-Green)
  '#bfff00', '#dfff7f', '#99cc00', '#b2cc66', '#729900', '#85994c', '#5f7f00', '#6f7f3f', '#394c00', '#424c26',
  // 70-79 (Chartreuse)
  '#7fff00', '#bfff7f', '#66cc00', '#99cc66', '#4c9900', '#72994c', '#3f7f00', '#5f7f3f', '#264c00', '#394c26',
  // 80-89 (Lime Green)
  '#3fff00', '#9fff7f', '#33cc00', '#7fcc66', '#269900', '#5f994c', '#1f7f00', '#4f7f3f', '#134c00', '#2f4c26',
  // 90-99 (Green)
  '#00ff00', '#7fff7f', '#00cc00', '#66cc66', '#009900', '#4c994c', '#007f00', '#3f7f3f', '#004c00', '#264c26',
  // 100-109 (Spring Green)
  '#00ff3f', '#7fff9f', '#00cc33', '#66cc7f', '#009926', '#4c995f', '#007f1f', '#3f7f4f', '#004c13', '#264c2f',
  // 110-119 (Mint Green)
  '#00ff7f', '#7fffbf', '#00cc66', '#66cc99', '#00994c', '#4c9972', '#007f3f', '#3f7f5f', '#004c26', '#264c39',
  // 120-129 (Turquoise)
  '#00ffbf', '#7fffdf', '#00cc99', '#66ccb2', '#009972', '#4c9985', '#007f5f', '#3f7f6f', '#004c39', '#264c42',
  // 130-139 (Cyan)
  '#00ffff', '#7fffff', '#00cccc', '#66cccc', '#009999', '#4c9999', '#007f7f', '#3f7f7f', '#004c4c', '#264c4c',
  // 140-149 (Sky Cyan)
  '#00bfff', '#7fdfff', '#0099cc', '#66b2cc', '#007299', '#4c8599', '#005f7f', '#3f6f7f', '#00394c', '#26424c',
  // 150-159 (Azure Blue)
  '#007fff', '#7fbfff', '#0066cc', '#6699cc', '#004c99', '#4c7299', '#003f7f', '#3f5f7f', '#00264c', '#26394c',
  // 160-169 (Cobalt Blue)
  '#003fff', '#7f9fff', '#0033cc', '#667fcc', '#002699', '#4c5f99', '#001f7f', '#3f4f7f', '#00134c', '#262f4c',
  // 170-179 (Blue)
  '#0000ff', '#7f7fff', '#0000cc', '#6666cc', '#000099', '#4c4c99', '#00007f', '#3f3f7f', '#00004c', '#26264c',
  // 180-189 (Indigo)
  '#3f00ff', '#9f7fff', '#3300cc', '#7f66cc', '#260099', '#5f4c99', '#1f007f', '#4f3f7f', '#13004c', '#2f264c',
  // 190-199 (Violet)
  '#7f00ff', '#bf7fff', '#6600cc', '#9966cc', '#4c0099', '#724c99', '#3f007f', '#5f3f7f', '#26004c', '#39264c',
  // 200-209 (Purple)
  '#bf00ff', '#df7fff', '#9900cc', '#b266cc', '#720099', '#854c99', '#5f007f', '#6f3f7f', '#39004c', '#42264c',
  // 210-219 (Magenta)
  '#ff00ff', '#ff7fff', '#cc00cc', '#cc66cc', '#990099', '#994c99', '#7f007f', '#7f3f7f', '#4c004c', '#4c264c',
  // 220-229 (Pink-Magenta)
  '#ff00bf', '#ff7fdf', '#cc0099', '#cc66b2', '#990072', '#994c85', '#7f005f', '#7f3f6f', '#4c0039', '#4c2642',
  // 230-239 (Rose)
  '#ff007f', '#ff7fbf', '#cc0066', '#cc6699', '#99004c', '#994c72', '#7f003f', '#7f3f5f', '#4c0026', '#4c2639',
  // 240-249 (Crimson)
  '#ff003f', '#ff7f9f', '#cc0033', '#cc667f', '#990026', '#994c5f', '#7f001f', '#7f3f4f', '#4c0013', '#4c262f',
  // 250-255 (Grayscale ramp)
  '#333333', '#505050', '#696969', '#828282', '#bebebe', '#ffffff',
];

export function aciToHex(colorIndex?: number, trueColor?: number): string {
  if (typeof trueColor === 'number' && trueColor > 0 && trueColor <= 0xffffff) {
    return `#${trueColor.toString(16).padStart(6, '0')}`;
  }
  if (typeof colorIndex === 'number') {
    const idx = Math.abs(Math.trunc(colorIndex));
    if (idx >= 1 && idx <= 255) {
      return AUTOCAD_ACI_HEX[idx] || '#e2e8f0';
    }
  }
  return '#e2e8f0';
}
