"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.ensureProxyAuthToken = ensureProxyAuthToken;
exports.preserveProxyAuthToken = preserveProxyAuthToken;
exports.configExists = configExists;
exports.getConfigDir = getConfigDir;
exports.updateClaudeJson = updateClaudeJson;
exports.updateClaudeSettings = updateClaudeSettings;
exports.getClaudePaths = getClaudePaths;
// Configuration file management utilities
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto_1 = require("crypto");
const fileStorage_1 = require("./fileStorage");
const CONFIG_DIR = path.join(os.homedir(), '.claude-adapter');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
/**
 * Load configuration from ~/.claude-adapter/config.json
 */
function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return null;
        }
        (0, fileStorage_1.ensureDirExists)(CONFIG_DIR);
        (0, fileStorage_1.hardenPrivateFile)(CONFIG_FILE);
        const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
/**
 * Save configuration to ~/.claude-adapter/config.json
 */
function saveConfig(config) {
    (0, fileStorage_1.ensureDirExists)(CONFIG_DIR);
    (0, fileStorage_1.writePrivateJsonFile)(CONFIG_FILE, config);
}
/**
 * Add the proxy credential required by current versions to a legacy config.
 * The value is generated once and then preserved through reconfiguration.
 */
function ensureProxyAuthToken(config) {
    if (typeof config.proxyAuthToken === 'string' && config.proxyAuthToken.trim().length > 0) {
        return config;
    }
    const migratedConfig = {
        ...config,
        proxyAuthToken: (0, crypto_1.randomBytes)(32).toString('base64url'),
    };
    saveConfig(migratedConfig);
    return migratedConfig;
}
/** Preserve the existing proxy token when the provider configuration changes. */
function preserveProxyAuthToken(nextConfig, previousConfig) {
    return previousConfig?.proxyAuthToken
        ? { ...nextConfig, proxyAuthToken: previousConfig.proxyAuthToken }
        : nextConfig;
}
/**
 * Check if configuration exists
 */
function configExists() {
    return fs.existsSync(CONFIG_FILE);
}
/**
 * Get the config directory path
 */
function getConfigDir() {
    return CONFIG_DIR;
}
// Claude settings file paths
const CLAUDE_JSON_PATH = path.join(os.homedir(), '.claude.json');
const CLAUDE_SETTINGS_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS_PATH = path.join(CLAUDE_SETTINGS_DIR, 'settings.json');
/**
 * Update ~/.claude.json to set hasCompletedOnboarding
 */
function updateClaudeJson() {
    let claudeJson = {};
    try {
        if (fs.existsSync(CLAUDE_JSON_PATH)) {
            const content = fs.readFileSync(CLAUDE_JSON_PATH, 'utf-8');
            claudeJson = JSON.parse(content);
        }
    }
    catch {
        // Start fresh if file is corrupted
        claudeJson = {};
    }
    claudeJson.hasCompletedOnboarding = true;
    // Do not change permissions on the user's entire home directory.
    (0, fileStorage_1.writePrivateJsonFile)(CLAUDE_JSON_PATH, claudeJson, false);
}
/**
 * Update ~/.claude/settings.json with proxy environment variables
 */
function updateClaudeSettings(proxyUrl, models, proxyAuthToken) {
    (0, fileStorage_1.ensureDirExists)(CLAUDE_SETTINGS_DIR);
    let settings = {};
    try {
        if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
            const content = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
            settings = JSON.parse(content);
        }
    }
    catch {
        // Start fresh if file is corrupted
        settings = {};
    }
    // Merge env settings
    settings.env = {
        ...(settings.env || {}),
        ANTHROPIC_BASE_URL: proxyUrl,
        ANTHROPIC_AUTH_TOKEN: proxyAuthToken,
        ANTHROPIC_DEFAULT_OPUS_MODEL: models.opus,
        ANTHROPIC_DEFAULT_SONNET_MODEL: models.sonnet,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: models.haiku,
    };
    (0, fileStorage_1.writePrivateJsonFile)(CLAUDE_SETTINGS_PATH, settings);
}
/**
 * Get paths for display purposes
 */
function getClaudePaths() {
    return {
        claudeJson: CLAUDE_JSON_PATH,
        claudeSettings: CLAUDE_SETTINGS_PATH,
    };
}
//# sourceMappingURL=config.js.map