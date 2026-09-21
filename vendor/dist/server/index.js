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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
exports.findAvailablePort = findAvailablePort;
// Fastify proxy server setup
const fastify_1 = __importDefault(require("fastify"));
const handlers_1 = require("./handlers");
const logger_1 = require("../utils/logger");
// Default graceful shutdown timeout in milliseconds
const DEFAULT_SHUTDOWN_TIMEOUT = 10000;
/**
 * Create the proxy server with configured routes
 */
function createServer(config) {
    if (typeof config.proxyAuthToken !== 'string' || config.proxyAuthToken.length === 0) {
        throw new Error('proxyAuthToken is required to start the Claude Adapter server');
    }
    const app = (0, fastify_1.default)({ logger: false });
    // Health check endpoint
    app.get('/health', async (_request, _reply) => {
        return { status: 'ok', adapter: 'claude-adapter' };
    });
    // Main messages endpoint (matches Anthropic API)
    app.post('/v1/messages', (0, handlers_1.createMessagesHandler)(config));
    return {
        app,
        start: async (port) => {
            try {
                await app.listen({ port, host: '127.0.0.1' });
                const address = app.server.address();
                const actualPort = typeof address === 'object' && address ? address.port : port;
                const url = `http://127.0.0.1:${actualPort}`;
                return url;
            }
            catch (err) {
                if (err.code === 'EADDRINUSE') {
                    throw new Error(`Port ${port} is already in use. Try a different port.`);
                }
                throw err;
            }
        },
        stop: async (timeout = DEFAULT_SHUTDOWN_TIMEOUT) => {
            // Create a timeout promise for force shutdown
            let timeoutId;
            const forceShutdown = new Promise((resolve) => {
                timeoutId = setTimeout(() => {
                    logger_1.logger.warn('Graceful shutdown timeout exceeded, forcing close');
                    resolve();
                }, timeout);
            });
            try {
                // Race between graceful close and timeout
                await Promise.race([app.close(), forceShutdown]);
            }
            finally {
                if (timeoutId)
                    clearTimeout(timeoutId);
            }
        },
    };
}
/**
 * Find an available port starting from the preferred port
 */
async function findAvailablePort(preferredPort) {
    const net = await Promise.resolve().then(() => __importStar(require('net')));
    return new Promise((resolve) => {
        const server = net.createServer();
        server.listen(preferredPort, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : preferredPort;
            server.close(() => resolve(port));
        });
        server.on('error', () => {
            // Port is in use, try next port
            resolve(findAvailablePort(preferredPort + 1));
        });
    });
}
//# sourceMappingURL=index.js.map