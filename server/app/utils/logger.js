import fs from 'fs';
import path from 'path';

const logDir = path.resolve('./logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
const logFile = path.join(logDir, 'app.log');

const redact = (key, val) => {
  const k = String(key).toLowerCase();
  if (['authorization', 'cookie', 'token', 'jwt', 'password'].includes(k)) {
    if (typeof val === 'string') return val.slice(0, 12) + '…';
    return '[redacted]';
  }
  return val;
};

const serializeArg = (arg) => {
  if (arg instanceof Error) {
    return JSON.stringify({ name: arg.name, message: arg.message, stack: arg.stack?.split('\n').slice(0, 5).join('\n') });
  }
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg, redact);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
};

const writeToFile = (level, args) => {
  const line = `${new Date().toISOString()} [${level}] ${args.map(serializeArg).join(' ')}\n`;
  fs.appendFileSync(logFile, line);
};

function make(level, con) {
  return (...args) => {
    // console prints objects nicely
    con(new Date().toISOString(), '[app]', ...args);
    // file gets safe JSON strings
    writeToFile(level, args);
  };
}

export const logger = {
  info: make('INFO', console.log),
  warn: make('WARN', console.warn),
  error: make('ERROR', console.error),
};

export const childLogger = (scope) => ({
  info: (...a) => logger.info(`[${scope}]`, ...a),
  warn: (...a) => logger.warn(`[${scope}]`, ...a),
  error: (...a) => logger.error(`[${scope}]`, ...a),
});