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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateClaudeSettings = exports.updateClaudeJson = exports.configExists = exports.preserveProxyAuthToken = exports.ensureProxyAuthToken = exports.saveConfig = exports.loadConfig = exports.findAvailablePort = exports.createServer = void 0;
// Main library exports
__exportStar(require("./types"), exports);
__exportStar(require("./converters"), exports);
var server_1 = require("./server");
Object.defineProperty(exports, "createServer", { enumerable: true, get: function () { return server_1.createServer; } });
Object.defineProperty(exports, "findAvailablePort", { enumerable: true, get: function () { return server_1.findAvailablePort; } });
var config_1 = require("./utils/config");
Object.defineProperty(exports, "loadConfig", { enumerable: true, get: function () { return config_1.loadConfig; } });
Object.defineProperty(exports, "saveConfig", { enumerable: true, get: function () { return config_1.saveConfig; } });
Object.defineProperty(exports, "ensureProxyAuthToken", { enumerable: true, get: function () { return config_1.ensureProxyAuthToken; } });
Object.defineProperty(exports, "preserveProxyAuthToken", { enumerable: true, get: function () { return config_1.preserveProxyAuthToken; } });
Object.defineProperty(exports, "configExists", { enumerable: true, get: function () { return config_1.configExists; } });
Object.defineProperty(exports, "updateClaudeJson", { enumerable: true, get: function () { return config_1.updateClaudeJson; } });
Object.defineProperty(exports, "updateClaudeSettings", { enumerable: true, get: function () { return config_1.updateClaudeSettings; } });
//# sourceMappingURL=index.js.map