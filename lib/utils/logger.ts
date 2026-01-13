type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
}

let globalConfig: LoggerConfig = {
  level: 'info',
};

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[globalConfig.level];
}

function formatMessage(level: LogLevel, message: string): string {
  const prefix = globalConfig.prefix ? `[${globalConfig.prefix}] ` : '';
  const icon =
    level === 'warn'
      ? '⚠️'
      : level === 'error'
        ? '❌'
        : level === 'info'
          ? '✓'
          : '';
  return icon ? `${icon} ${prefix}${message}` : `${prefix}${message}`;
}

export const logger = {
  configure(config: Partial<LoggerConfig>): void {
    globalConfig = { ...globalConfig, ...config };
  },

  setLevel(level: LogLevel): void {
    globalConfig.level = level;
  },

  setPrefix(prefix: string | undefined): void {
    globalConfig.prefix = prefix;
  },

  debug(...args: unknown[]): void {
    if (shouldLog('debug')) {
      console.log(...args);
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      console.log(formatMessage('info', message), ...args);
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message), ...args);
    }
  },

  error(message: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message), ...args);
    }
  },

  success(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      console.log(`✓ ${message}`, ...args);
    }
  },

  table(data: unknown): void {
    if (shouldLog('info')) {
      console.table(data);
    }
  },

  group(label: string): void {
    if (shouldLog('debug')) {
      console.group(label);
    }
  },

  groupEnd(): void {
    if (shouldLog('debug')) {
      console.groupEnd();
    }
  },
};

export function createLogger(prefix: string): typeof logger {
  return {
    ...logger,
    debug(...args: unknown[]): void {
      if (shouldLog('debug')) {
        console.log(`[${prefix}]`, ...args);
      }
    },
    info(message: string, ...args: unknown[]): void {
      if (shouldLog('info')) {
        console.log(`✓ [${prefix}] ${message}`, ...args);
      }
    },
    warn(message: string, ...args: unknown[]): void {
      if (shouldLog('warn')) {
        console.warn(`⚠️ [${prefix}] ${message}`, ...args);
      }
    },
    error(message: string, ...args: unknown[]): void {
      if (shouldLog('error')) {
        console.error(`❌ [${prefix}] ${message}`, ...args);
      }
    },
    success(message: string, ...args: unknown[]): void {
      if (shouldLog('info')) {
        console.log(`✓ [${prefix}] ${message}`, ...args);
      }
    },
  };
}
