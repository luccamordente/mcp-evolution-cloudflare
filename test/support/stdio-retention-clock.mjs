const setTimeout = globalThis.setTimeout;
const now = Date.now;
const retentionInterval = 60_000;

// Keep the real Timeout handle and advance only the minute timer on demand.
globalThis.setTimeout = (callback, delay, ...args) => {
  const timer = setTimeout(callback, delay, ...args);
  if (delay === retentionInterval) {
    process.once('SIGUSR2', () => {
      clearTimeout(timer);
      Date.now = () => now() + retentionInterval;
      callback(...args);
      process.stderr.write('Retention clock advanced\n');
    });
  }
  return timer;
};
