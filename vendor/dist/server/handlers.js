"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMessagesHandler = createMessagesHandler;
const openai_1 = __importDefault(require("openai"));
const crypto_1 = require("crypto");
const request_1 = require("../converters/request");
const provider_1 = require("../utils/provider");
const response_1 = require("../converters/response");
const streaming_1 = require("../converters/streaming");
const xmlStreaming_1 = require("../converters/xmlStreaming");
const validation_1 = require("../utils/validation");
const logger_1 = require("../utils/logger");
const tokenUsage_1 = require("../utils/tokenUsage");
const errorLog_1 = require("../utils/errorLog");
// Request ID counter for unique identification
let requestIdCounter = 0;
function generateRequestId() {
    requestIdCounter++;
    const timestamp = Date.now().toString(36);
    const counter = requestIdCounter.toString(36).padStart(4, '0');
    return `req_${timestamp}_${counter}`;
}
function matchesProxyToken(value, expectedToken) {
    if (typeof value !== 'string') {
        return false;
    }
    const received = Buffer.from(value);
    const expected = Buffer.from(expectedToken);
    return received.length === expected.length && (0, crypto_1.timingSafeEqual)(received, expected);
}
function isAuthenticated(request, expectedToken) {
    const authorization = request.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
        return matchesProxyToken(authorization.slice('Bearer '.length), expectedToken);
    }
    return matchesProxyToken(request.headers['x-api-key'], expectedToken);
}
/**
 * Handle POST /v1/messages requests
 */
function createMessagesHandler(config) {
    const isAzure = (0, provider_1.isAzureOpenAIEndpoint)(config.baseUrl);
    const openai = new openai_1.default({
        baseURL: config.baseUrl,
        apiKey: config.apiKey,
    });
    return async (request, reply) => {
        const requestId = generateRequestId();
        const log = logger_1.logger.withRequestId(requestId);
        // Add request ID to response headers for client tracing
        reply.header('X-Request-Id', requestId);
        if (!isAuthenticated(request, config.proxyAuthToken)) {
            const errorResponse = (0, response_1.createErrorResponse)(new Error('Invalid proxy authentication token'), 401);
            reply.code(401).send({ error: errorResponse.error });
            return;
        }
        try {
            // Validate request before processing
            const validation = (0, validation_1.validateAnthropicRequest)(request.body);
            if (!validation.valid) {
                const errorMessage = (0, validation_1.formatValidationErrors)(validation.errors);
                log.warn('Invalid request', { errors: validation.errors });
                const errorResponse = (0, response_1.createErrorResponse)(new Error(errorMessage), 400);
                reply.code(400).send({ error: errorResponse.error });
                return;
            }
            const anthropicRequest = request.body;
            const targetModel = anthropicRequest.model;
            const isStreaming = anthropicRequest.stream ?? false;
            log.info(`→ ${targetModel} [sent]`);
            // Determine tool calling style from config
            const toolStyle = config.toolFormat || 'native';
            // Convert request to OpenAI format
            const openaiRequest = (0, request_1.convertRequestToOpenAI)(anthropicRequest, targetModel, toolStyle, isAzure);
            // Log tool calling mode when tools are present
            if (toolStyle === 'xml' && anthropicRequest.tools?.length) {
                log.info(`Using XML tool calling mode (${anthropicRequest.tools.length} tools)`);
            }
            if (isStreaming) {
                if (toolStyle === 'xml') {
                    await handleXmlStreamingRequest(openai, openaiRequest, reply, anthropicRequest.model, config.baseUrl, log);
                }
                else {
                    await handleStreamingRequest(openai, openaiRequest, reply, anthropicRequest.model, config.baseUrl, log);
                }
            }
            else {
                await handleNonStreamingRequest(openai, openaiRequest, reply, anthropicRequest.model, config.baseUrl, log);
            }
            log.info(`← ${targetModel} [received]`);
        }
        catch (error) {
            const body = request.body;
            handleError(error, reply, log, {
                requestId,
                provider: config.baseUrl,
                modelName: body?.model ?? 'unknown',
                streaming: body?.stream ?? false,
            });
        }
    };
}
/**
 * Handle non-streaming API request
 */
async function handleNonStreamingRequest(openai, openaiRequest, reply, originalModel, provider, log) {
    log.debug('Making non-streaming request');
    const response = await openai.chat.completions.create({
        ...openaiRequest,
        stream: false,
    });
    log.debug('Response received', {
        finishReason: response.choices[0]?.finish_reason,
        usage: response.usage,
    });
    // Record token usage
    if (response.usage) {
        (0, tokenUsage_1.recordUsage)({
            provider,
            modelName: originalModel,
            model: response.model,
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            cachedInputTokens: response.usage.prompt_tokens_details?.cached_tokens,
            streaming: false,
        });
    }
    const anthropicResponse = (0, response_1.convertResponseToAnthropic)(response, originalModel);
    reply.send(anthropicResponse);
}
/**
 * Handle streaming API request
 */
async function handleStreamingRequest(openai, openaiRequest, reply, originalModel, provider, log) {
    log.debug('Making streaming request');
    const stream = await openai.chat.completions.create({
        ...openaiRequest,
        stream: true,
    });
    reply.hijack();
    await (0, streaming_1.streamOpenAIToAnthropic)(stream, reply, originalModel, provider);
    log.debug('Streaming completed');
}
/**
 * Handle XML streaming API request (for models without native tool calling)
 */
async function handleXmlStreamingRequest(openai, openaiRequest, reply, originalModel, provider, log) {
    log.debug('Making XML streaming request (experimental)');
    const stream = await openai.chat.completions.create({
        ...openaiRequest,
        stream: true,
    });
    reply.hijack();
    await (0, xmlStreaming_1.streamXmlOpenAIToAnthropic)(stream, reply, originalModel, provider);
    log.debug('XML streaming completed');
}
/**
 * Handle errors and send appropriate response
 */
function handleError(caughtError, reply, log, context) {
    const error = caughtError instanceof Error
        ? caughtError
        : new Error(typeof caughtError === 'string' ? caughtError : 'Unknown request failure');
    const rawStatus = typeof caughtError === 'object' && caughtError !== null && 'status' in caughtError
        ? caughtError.status
        : undefined;
    const statusCode = typeof rawStatus === 'number' &&
        Number.isInteger(rawStatus) &&
        rawStatus >= 400 &&
        rawStatus <= 599
        ? rawStatus
        : 500;
    log.error('Request failed', error, { statusCode });
    // Record error to file if context is available
    if (context) {
        (0, errorLog_1.recordError)(error, context);
    }
    const errorResponse = (0, response_1.createErrorResponse)(error, statusCode);
    reply.code(errorResponse.status).send({ error: errorResponse.error });
}
//# sourceMappingURL=handlers.js.map