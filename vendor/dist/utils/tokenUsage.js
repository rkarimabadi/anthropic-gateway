"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordUsage = recordUsage;
// Token usage storage utility
const path_1 = require("path");
const fileStorage_1 = require("./fileStorage");
const USAGE_DIR = (0, path_1.join)((0, fileStorage_1.getBaseDir)(), 'token_usage');
/**
 * Get the file path for a given date
 */
function getUsageFilePath(dateStr) {
    return (0, path_1.join)(USAGE_DIR, `${dateStr}.jsonl`);
}
/**
 * Record token usage to the daily file
 * Non-blocking, fails silently on errors
 */
function recordUsage(data) {
    try {
        (0, fileStorage_1.ensureDirExists)(USAGE_DIR);
        const record = {
            timestamp: new Date().toISOString(),
            ...data
        };
        const filePath = getUsageFilePath((0, fileStorage_1.getTodayDateString)());
        (0, fileStorage_1.appendJsonLine)(filePath, record);
    }
    catch {
        // Fail silently - don't interrupt API flow for usage tracking
    }
}
//# sourceMappingURL=tokenUsage.js.map