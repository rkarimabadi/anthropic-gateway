"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMetadata = getMetadata;
exports.updateLatestVersion = updateLatestVersion;
exports.getCachedLatestVersion = getCachedLatestVersion;
// Metadata storage utility
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const crypto_1 = require("crypto");
const package_json_1 = require("../../package.json");
const fileStorage_1 = require("./fileStorage");
const METADATA_DIR = (0, path_1.join)((0, os_1.homedir)(), '.claude-adapter');
const METADATA_FILE = (0, path_1.join)(METADATA_DIR, 'metadata.json');
/**
 * Generate a unique user ID
 */
function generateUserId() {
    return (0, crypto_1.randomBytes)(16).toString('hex');
}
/**
 * Get OS name
 */
function getOsName() {
    return (0, os_1.platform)();
}
/**
 * Ensure metadata directory exists
 */
function ensureMetadataDir() {
    (0, fileStorage_1.ensureDirExists)(METADATA_DIR);
}
let cachedMetadata = null;
/**
 * Load metadata from file
 */
function loadMetadata() {
    if (cachedMetadata) {
        return cachedMetadata;
    }
    try {
        if ((0, fs_1.existsSync)(METADATA_FILE)) {
            ensureMetadataDir();
            (0, fileStorage_1.hardenPrivateFile)(METADATA_FILE);
            const data = (0, fs_1.readFileSync)(METADATA_FILE, 'utf-8');
            cachedMetadata = JSON.parse(data);
            return cachedMetadata;
        }
    }
    catch {
        // Ignore read errors
    }
    return null;
}
/**
 * Save metadata to file
 */
function saveMetadata(metadata) {
    try {
        ensureMetadataDir();
        (0, fileStorage_1.writePrivateJsonFile)(METADATA_FILE, metadata);
        cachedMetadata = metadata;
    }
    catch {
        // Ignore write errors
    }
}
/**
 * Get or create metadata
 * Creates new metadata on first run, updates currentVersion on subsequent runs
 */
function getMetadata() {
    let metadata = loadMetadata();
    if (!metadata) {
        // First run - create new metadata
        metadata = {
            userId: generateUserId(),
            platform: getOsName(),
            platformRelease: (0, os_1.release)(),
            currentVersion: package_json_1.version,
            createdAt: new Date().toISOString(),
        };
        saveMetadata(metadata);
    }
    else {
        // Update current version if changed
        if (metadata.currentVersion !== package_json_1.version) {
            metadata.currentVersion = package_json_1.version;
            saveMetadata(metadata);
        }
    }
    return metadata;
}
/**
 * Update latest version in metadata (called after npm registry check)
 */
function updateLatestVersion(version) {
    try {
        const metadata = loadMetadata();
        if (metadata) {
            metadata.latestVersion = version;
            metadata.latestVersionTimestamp = Date.now();
            saveMetadata(metadata);
        }
    }
    catch {
        // Ignore errors
    }
}
/**
 * Get cached latest version info
 */
function getCachedLatestVersion() {
    try {
        const metadata = loadMetadata();
        if (metadata?.latestVersion && metadata?.latestVersionTimestamp) {
            return {
                version: metadata.latestVersion,
                timestamp: metadata.latestVersionTimestamp,
            };
        }
    }
    catch {
        // Ignore errors
    }
    return null;
}
//# sourceMappingURL=metadata.js.map