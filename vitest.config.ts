import { defineConfig } from 'vitest/config';
export default defineConfig({ resolve: { alias: { '@hyzyla/pdfium/pdfium.wasm': new URL('./test/support/pdfium-wasm.ts', import.meta.url).pathname } }, test: { environment: 'node', include: ['test/**/*.test.ts'], server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } } } });
