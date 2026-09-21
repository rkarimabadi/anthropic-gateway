"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestLogger = exports.Logger = exports.logger = exports.LogLevel = void 0;
// Structured logger with levels and timestamps
var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
const levelNames = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
};
const levelColors = {
    [LogLevel.DEBUG]: '\x1b[90m', // gray
    [LogLevel.INFO]: '\x1b[36m', // cyan
    [LogLevel.WARN]: '\x1b[33m', // yellow
    [LogLevel.ERROR]: '\x1b[31m', // red
};
const RESET = '\x1b[0m';
class Logger {
    level;
    prefix;
    constructor(prefix = 'adapter') {
        this.prefix = prefix;
        // Default to INFO, can be overridden by LOG_LEVEL env var
        const envLevel = process.env.LOG_LEVEL?.toUpperCase();
        this.level = this.parseLevel(envLevel) ?? LogLevel.INFO;
    }
    parseLevel(level) {
        switch (level) {
            case 'DEBUG':
                return LogLevel.DEBUG;
            case 'INFO':
                return LogLevel.INFO;
            case 'WARN':
                return LogLevel.WARN;
            case 'ERROR':
                return LogLevel.ERROR;
            default:
                return undefined;
        }
    }
    formatTimestamp() {
        return new Date().toISOString();
    }
    log(level, message, meta) {
        if (level < this.level)
            return;
        let output;
        const color = levelColors[level];
        // Use simple format for INFO in non-debug mode
        if (level === LogLevel.INFO && this.level > LogLevel.DEBUG) {
            output = `${color}${message}${RESET}`;
            if (meta && Object.keys(meta).length > 0) {
                output += ` ${color}${JSON.stringify(meta)}${RESET}`;
            }
        }
        else {
            // Full format with timestamp for DEBUG or when in debug mode
            const levelName = levelNames[level].padEnd(5);
            const timestamp = this.formatTimestamp();
            output = `${color}[${timestamp}] [${this.prefix}] ${levelName}${RESET} ${message}`;
            if (meta && Object.keys(meta).length > 0) {
                output += ` ${JSON.stringify(meta)}`;
            }
        }
        if (level === LogLevel.ERROR) {
            console.error(output);
        }
        else {
            console.log(output);
        }
    }
    debug(message, meta) {
        this.log(LogLevel.DEBUG, message, meta);
    }
    info(message, meta) {
        this.log(LogLevel.INFO, message, meta);
    }
    warn(message, meta) {
        this.log(LogLevel.WARN, message, meta);
    }
    error(message, error, meta) {
        const errorMeta = error ? { error: error.message, ...meta } : meta;
        this.log(LogLevel.ERROR, message, errorMeta);
    }
    print(message) {
        console.log(message);
    }
    setLevel(level) {
        this.level = level;
    }
    /**
     * Create a child logger with request context
     */
    withRequestId(requestId) {
        return new RequestLogger(this, requestId);
    }
}
exports.Logger = Logger;
/**
 * Logger bound to a specific request ID for tracing
 */
class RequestLogger {
    parent;
    requestId;
    constructor(parent, requestId) {
        this.parent = parent;
        this.requestId = requestId;
    }
    addContext(meta) {
        return { requestId: this.requestId, ...meta };
    }
    debug(message, meta) {
        this.parent.debug(message, this.addContext(meta));
    }
    info(message, meta) {
        this.parent.info(message, this.addContext(meta));
    }
    warn(message, meta) {
        this.parent.warn(message, this.addContext(meta));
    }
    error(message, error, meta) {
        this.parent.error(message, error, this.addContext(meta));
    }
    print(message) {
        this.parent.print(message);
    }
}
exports.RequestLogger = RequestLogger;
// Export singleton instance
exports.logger = new Logger();
//# sourceMappingURL=logger.js.map