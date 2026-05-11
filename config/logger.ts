import { createLogger, format, transports } from 'winston';
import LokiTransport from 'winston-loki';

const normalizeEnvValue = (value?: string): string => {
  if (!value) return '';
  return value.trim().replace(/^['"]+|['"]+$/g, '');
};

const customJobName = normalizeEnvValue(process.env.LOKI_JOB_NAME) || 'Solar_Inventory';
const lokiHostip = normalizeEnvValue(process.env.LOKI_HOST_IP);

const isValidUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};



// Safe stringify formatter for Loki
const safeStringify = format((info: any) => {
  if (typeof info.message === 'object') {
    try {
      info.message = JSON.stringify(info.message);
    } catch (err) {
      info.message = 'Unserializable message object';
    }
  }

  for (const key of Object.keys(info)) {
    if (typeof info[key] === 'object' && key !== 'message') {
      try {
        info[key] = JSON.stringify(info[key]);
      } catch (err) {
        info[key] = 'Unserializable meta object';
      }
    }
  }

  return info;
});

const transportArray: any[] = [];

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  transportArray.push(
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [${level}]: ${message} ${
            Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
          }`;
        })
      )
    })
  );
}

// Add Loki transport if host is configured
if (lokiHostip) {
  if (isValidUrl(lokiHostip)) {
    transportArray.push(
      new LokiTransport({
        host: lokiHostip,
        labels: { job: customJobName },
        json: true,
        batching: true,
        interval: 5 // push logs every 5 seconds
      })
    );
  } else {
    console.warn(`Skipping Loki transport due to invalid LOKI_HOST_IP: ${lokiHostip}`);
  }
}

// If no transports configured, add console as fallback
if (transportArray.length === 0) {
  transportArray.push(
    new transports.Console({
      format: format.combine(
        format.timestamp(),
        format.simple()
      )
    })
  );
}

const options = {
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    safeStringify(), // 👈 ensures objects are safe for Loki
    format.json()
  ),
  transports: transportArray,
  level: normalizeEnvValue(process.env.LOG_LEVEL) || 'info'
};

const logger = createLogger(options);

export default logger;

