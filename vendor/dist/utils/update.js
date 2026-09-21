"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkForUpdates = checkForUpdates;
exports.getCachedUpdateInfo = getCachedUpdateInfo;
const https_1 = __importDefault(require("https"));
const package_json_1 = require("../../package.json");
const metadata_1 = require("./metadata");
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
/**
 * Compare two semantic versions
 * Returns true if latest is greater than current
 */
function isNewerVersion(latest, current) {
    const parseVersion = (v) => v.split('.').map(n => parseInt(n, 10) || 0);
    const [latestParts, currentParts] = [parseVersion(latest), parseVersion(current)];
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
        const l = latestParts[i] || 0;
        const c = currentParts[i] || 0;
        if (l > c)
            return true;
        if (l < c)
            return false;
    }
    return false;
}
/**
 * Check if cached version is still valid (within 24 hours)
 */
function isCacheValid(timestamp) {
    return Date.now() - timestamp < CACHE_TTL;
}
/**
 * Fetch latest version from npm registry
 */
function fetchLatestVersion() {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 3000); // 3s timeout
        https_1.default.get('https://registry.npmjs.org/claude-adapter/latest', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                clearTimeout(timeout);
                try {
                    const { version } = JSON.parse(data);
                    resolve(version);
                }
                catch {
                    resolve(null);
                }
            });
        }).on('error', () => {
            clearTimeout(timeout);
            resolve(null);
        });
    });
}
/**
 * Check for updates with 24-hour caching
 * Non-blocking, fails silently on errors
 */
async function checkForUpdates() {
    try {
        // Check cache first
        const cache = (0, metadata_1.getCachedLatestVersion)();
        if (cache && isCacheValid(cache.timestamp)) {
            return {
                current: package_json_1.version,
                latest: cache.version,
                hasUpdate: isNewerVersion(cache.version, package_json_1.version)
            };
        }
        // Fetch from registry
        const latest = await fetchLatestVersion();
        if (!latest) {
            return null;
        }
        // Update cache in metadata
        (0, metadata_1.updateLatestVersion)(latest);
        return {
            current: package_json_1.version,
            latest,
            hasUpdate: isNewerVersion(latest, package_json_1.version)
        };
    }
    catch {
        return null;
    }
}
/**
 * Get cached update info synchronously (for use in request converter)
 * Returns null if cache doesn't exist or is expired
 */
function getCachedUpdateInfo() {
    try {
        const cache = (0, metadata_1.getCachedLatestVersion)();
        if (cache && isCacheValid(cache.timestamp)) {
            return {
                current: package_json_1.version,
                latest: cache.version,
                hasUpdate: isNewerVersion(cache.version, package_json_1.version)
            };
        }
    }
    catch {
        // Ignore errors
    }
    return null;
}
//# sourceMappingURL=update.js.map