import { readFileSync } from 'node:fs';
export default new WebAssembly.Module(readFileSync(new URL('../../node_modules/@hyzyla/pdfium/dist/pdfium.wasm', import.meta.url)));
