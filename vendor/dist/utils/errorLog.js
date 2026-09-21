"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordError = recordError;
// Error logging utility
const path_1 = require("path");
const fileStorage_1 = require("./fileStorage");
const ERROR_DIR = (0, path_1.join)((0, fileStorage_1.getBaseDir)(), 'error_logs');
/**
 * Get the file path for a given date
 */
function getErrorFilePath(dateStr) {
    return (0, path_1.join)(ERROR_DIR, `${dateStr}.jsonl`);
}
/**
 * Extract error details from various error types
 */
function extractErrorDetails(error) {
    const details = {
        message: error.message,
    };
    // Extract OpenAI SDK error properties
    if ('status' in error) {
        details.status = error.status;
    }
    if ('code' in error) {
        details.code = error.code;
    }
    if ('type' in error) {
        details.type = error.type;
    }
    return details;
}
/**
 * Error codes that should not be logged (user errors, not API issues)
 */
const SKIP_ERROR_CODES = [401, 402, 404, 429];
/**
 * Record error to the daily file
 * Non-blocking, fails silently on errors
 * Skips common user errors like auth failures and rate limits
 */
function recordError(error, context) {
    try {
        // Skip logging for common user-related errors
        if ('status' in error && SKIP_ERROR_CODES.includes(error.status)) {
            return;
        }
        (0, fileStorage_1.ensureDirExists)(ERROR_DIR);
        const record = {
            timestamp: new Date().toISOString(),
            ...context,
            error: extractErrorDetails(error),
        };
        const filePath = getErrorFilePath((0, fileStorage_1.getTodayDateString)());
        (0, fileStorage_1.appendJsonLine)(filePath, record);
    }
    catch {
        // Fail silently - don't interrupt API flow for error logging
    }
}
//# sourceMappingURL=errorLog.js.map