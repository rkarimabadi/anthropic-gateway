"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTodayDateString = getTodayDateString;
exports.ensureDirExists = ensureDirExists;
exports.getBaseDir = getBaseDir;
exports.repairPrivateStoragePermissions = repairPrivateStoragePermissions;
exports.hardenPrivateFile = hardenPrivateFile;
exports.appendJsonLine = appendJsonLine;
exports.writePrivateJsonFile = writePrivateJsonFile;
// Shared file storage utilities for daily JSON files
const fs_1 = require("fs");
const crypto_1 = require("crypto");
const os_1 = require("os");
const path_1 = require("path");
// Base directory for all claude-adapter data
const BASE_DIR = (0, path_1.join)((0, os_1.homedir)(), '.claude-adapter');
/**
 * Get today's date as YYYY-MM-DD
 */
function getTodayDateString() {
    return new Date().toISOString().split('T')[0];
}
/**
 * Ensure a directory exists, creating it if necessary
 */
function ensureDirExists(dirPath) {
    if (!(0, fs_1.existsSync)(dirPath)) {
        (0, fs_1.mkdirSync)(dirPath, { recursive: true, mode: 0o700 });
    }
    // Windows relies on the current user's profile ACL. POSIX modes protect
    // configuration, metadata, usage, and error logs from other local users.
    if (process.platform !== 'win32') {
        (0, fs_1.chmodSync)(dirPath, 0o700);
    }
}
/**
 * Get the base storage directory
 */
function getBaseDir() {
    return BASE_DIR;
}
/** Repair all existing adapter-owned storage permissions during startup. */
function repairPrivateStoragePermissions(baseDir = BASE_DIR) {
    if (process.platform === 'win32') {
        return;
    }
    ensureDirExists(baseDir);
    for (const entry of (0, fs_1.readdirSync)(baseDir, { withFileTypes: true })) {
        const entryPath = (0, path_1.join)(baseDir, entry.name);
        const stats = (0, fs_1.lstatSync)(entryPath);
        // Never follow symlinks from the private storage tree.
        if (stats.isSymbolicLink()) {
            continue;
        }
        if (stats.isDirectory()) {
            repairPrivateStoragePermissions(entryPath);
        }
        else if (stats.isFile()) {
            (0, fs_1.chmodSync)(entryPath, 0o600);
        }
    }
}
/** Repair permissions on an existing private file. */
function hardenPrivateFile(filePath) {
    if (process.platform !== 'win32' && (0, fs_1.existsSync)(filePath)) {
        (0, fs_1.chmodSync)(filePath, 0o600);
    }
}
/**
 * Append a JSON record to a file (one JSON object per line)
 * This is atomic on most filesystems and avoids race conditions
 */
function appendJsonLine(filePath, record) {
    ensureDirExists((0, path_1.dirname)(filePath));
    const line = JSON.stringify(record) + '\n';
    (0, fs_1.appendFileSync)(filePath, line, { encoding: 'utf-8', mode: 0o600 });
    hardenPrivateFile(filePath);
}
/**
 * Atomically replace a JSON file with a private file in the same directory.
 * Keeping the temporary file adjacent to the destination makes rename atomic
 * on the filesystems supported by this CLI.
 */
function writePrivateJsonFile(filePath, data, secureParentDirectory = true) {
    const parentDirectory = (0, path_1.dirname)(filePath);
    if (secureParentDirectory) {
        ensureDirExists(parentDirectory);
    }
    else if (!(0, fs_1.existsSync)(parentDirectory)) {
        (0, fs_1.mkdirSync)(parentDirectory, { recursive: true });
    }
    const tempPath = `${filePath}.${process.pid}.${(0, crypto_1.randomBytes)(8).toString('hex')}.tmp`;
    let descriptor;
    try {
        descriptor = (0, fs_1.openSync)(tempPath, 'w', 0o600);
        (0, fs_1.writeFileSync)(descriptor, JSON.stringify(data, null, 2), 'utf-8');
        (0, fs_1.closeSync)(descriptor);
        descriptor = undefined;
        if (process.platform !== 'win32') {
            (0, fs_1.chmodSync)(tempPath, 0o600);
        }
        (0, fs_1.renameSync)(tempPath, filePath);
        hardenPrivateFile(filePath);
    }
    finally {
        if (descriptor !== undefined) {
            (0, fs_1.closeSync)(descriptor);
        }
        if ((0, fs_1.existsSync)(tempPath)) {
            (0, fs_1.unlinkSync)(tempPath);
        }
    }
}
//# sourceMappingURL=fileStorage.js.map