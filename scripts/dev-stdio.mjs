// Keep application and dependency diagnostics off the MCP wire, including setup.
console.log = console.info = console.debug = console.error.bind(console);
await import('tsx/esm');
await import('../src/dev/stdio.ts');
