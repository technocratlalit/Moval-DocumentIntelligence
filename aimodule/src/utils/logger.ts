import pino from 'pino';
import type { TransportTargetOptions } from 'pino';
import { _config } from '../config/config.js';

const isDev = _config.NODE_ENV === 'development' || _config.NODE_ENV === 'dev';

function buildTransport(): pino.LoggerOptions['transport'] | undefined {
  const targets: TransportTargetOptions[] = [];

  if (isDev) {
    targets.push({
      target: 'pino-pretty',
      level: 'debug',
      options: {
        colorize: true,
        translateTime: 'SYS:dd-mm-yyyy HH:MM:ss',
        ignore: 'pid,hostname',
        singleLine: false,
      },
    });
  } else {
    targets.push({
      target: 'pino/file',
      level: 'info',
      options: { destination: 1 },
    });
  }

  if (targets.length === 0) return undefined;
  if (targets.length === 1) {
    const { target, options, level } = targets[0];
    return { target, options, level };
  }
  return { targets };
}

const transport = buildTransport();

export const logger = pino({
  level: isDev ? 'debug' : 'info',
  ...(transport && { transport }),
});
