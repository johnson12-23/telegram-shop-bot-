function write(level, event, meta = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...meta
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }

  console.log(line);
}

const logger = {
  info(event, meta) {
    write('info', event, meta);
  },
  warn(event, meta) {
    write('warn', event, meta);
  },
  error(event, meta) {
    write('error', event, meta);
  }
};

module.exports = { logger };
