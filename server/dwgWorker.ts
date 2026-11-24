/**
 * Isolated out-of-process DWG decoder worker.
 * Runs GNU LibreDWG WebAssembly strictly inside a short-lived child process so
 * WASM traps, OOM, or Emscripten aborts can NEVER crash or leak memory in the main Express server.
 *
 * Usage: tsx server/dwgWorker.ts <mode: "convert" | "dxf"> <inputDwgPath> <outputPath>
 */
import fs from 'fs';
import path from 'path';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

async function main() {
  const [, , mode, inputPath, outputPath] = process.argv;
  if (!mode || !inputPath || !outputPath) {
    process.stderr.write('Missing required arguments: mode, inputPath, outputPath\n');
    process.exit(2);
  }

  const buffer = fs.readFileSync(inputPath);
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);

  const wasmDir = path.resolve(process.cwd(), 'node_modules/@mlightcad/libredwg-web/wasm');
  (LibreDwg as any).instance = null;
  const libredwg = await LibreDwg.create(wasmDir);

  if (mode === 'dxf') {
    if (typeof (libredwg as any).dwg_write_dxf !== 'function') {
      process.stderr.write('dwg_write_dxf not available in LibreDWG WASM\n');
      process.exit(3);
    }
    const dxfBytes: Uint8Array | null = (libredwg as any).dwg_write_dxf(arrayBuffer);
    if (!dxfBytes || dxfBytes.byteLength < 64) {
      process.stderr.write('LibreDWG dwg_write_dxf returned empty output\n');
      process.exit(4);
    }
    fs.writeFileSync(outputPath, Buffer.from(dxfBytes));
    process.exit(0);
  }

  if (mode === 'convert') {
    const dwgPtr = libredwg.dwg_read_data(arrayBuffer, Dwg_File_Type.DWG);
    if (!dwgPtr) {
      process.stderr.write('dwg_read_data returned null pointer\n');
      process.exit(5);
    }

    try {
      const res: any =
        typeof (libredwg as any).convertEx === 'function'
          ? (libredwg as any).convertEx(dwgPtr)
          : { database: libredwg.convert(dwgPtr) };
      const db = res?.database ?? res;

      // Serialize only the geometry, layers, blocks, and header needed for rendering & extraction
      const slimDb = {
        header: {
          ACADVER: db?.header?.ACADVER,
          INSUNITS: db?.header?.INSUNITS,
        },
        tables: {
          LAYER: { entries: db?.tables?.LAYER?.entries || [] },
          BLOCK_RECORD: { entries: db?.tables?.BLOCK_RECORD?.entries || [] },
        },
        entities: db?.entities || [],
      };

      fs.writeFileSync(outputPath, JSON.stringify(slimDb));
      process.exit(0);
    } finally {
      try {
        libredwg.dwg_free(dwgPtr);
      } catch {
        // ignore cleanup failure right before process exit
      }
    }
  }

  process.stderr.write(`Unknown worker mode: ${mode}\n`);
  process.exit(6);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error)?.message || String(err)}\n`);
  process.exit(1);
});
