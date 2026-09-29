export interface LoggerLike {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

function emit(
  level: 'debug' | 'info' | 'warn' | 'error',
  service: string,
  message: string,
  fields?: Record<string, unknown>,
): void {
  const payload = {
    level,
    service,
    message,
    ts: new Date().toISOString(),
    ...fields,
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    process.stderr.write(`${line}\n`);
    return;
  }

  process.stdout.write(`${line}\n`);
}

export function createLogger(service: string): LoggerLike {
  return {
    debug: (message, fields) => emit('debug', service, message, fields),
    info: (message, fields) => emit('info', service, message, fields),
    warn: (message, fields) => emit('warn', service, message, fields),
    error: (message, fields) => emit('error', service, message, fields),
  };
}
