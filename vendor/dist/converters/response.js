"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpstreamResponseError = void 0;
exports.convertResponseToAnthropic = convertResponseToAnthropic;
exports.createErrorResponse = createErrorResponse;
/** An upstream response was structurally unusable for Anthropic conversion. */
class UpstreamResponseError extends Error {
    status = 502;
    constructor(message) {
        super(message);
        this.name = 'UpstreamResponseError';
    }
}
exports.UpstreamResponseError = UpstreamResponseError;
/**
 * Convert OpenAI Chat Completion response to Anthropic Messages format
 */
function convertResponseToAnthropic(openaiResponse, originalModelRequested) {
    const choice = openaiResponse.choices?.[0];
    if (!choice?.message) {
        throw new UpstreamResponseError('Upstream response did not include a completion choice');
    }
    const message = choice.message;
    // Build content blocks
    const content = [];
    // Add text content if present
    if (message.content) {
        content.push({
            type: 'text',
            text: message.content,
        });
    }
    // Add tool use blocks if present
    if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
            content.push(convertToolCallToToolUse(toolCall));
        }
    }
    // Map finish reason
    const stopReason = mapFinishReason(choice.finish_reason);
    // Build usage
    const upstreamUsage = openaiResponse.usage;
    const usage = {
        input_tokens: upstreamUsage?.prompt_tokens ?? 0,
        output_tokens: upstreamUsage?.completion_tokens ?? 0,
        cache_read_input_tokens: upstreamUsage?.prompt_tokens_details?.cached_tokens,
    };
    return {
        id: `msg_${openaiResponse.id}`,
        type: 'message',
        role: 'assistant',
        content,
        model: originalModelRequested,
        stop_reason: stopReason,
        stop_sequence: null,
        usage,
    };
}
/**
 * Convert OpenAI tool call to Anthropic tool_use block
 */
function convertToolCallToToolUse(toolCall) {
    let input;
    try {
        input = JSON.parse(toolCall.function.arguments);
    }
    catch {
        input = { raw: toolCall.function.arguments };
    }
    return {
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function.name,
        input,
    };
}
/**
 * Map OpenAI finish_reason to Anthropic stop_reason
 */
function mapFinishReason(finishReason) {
    if (!finishReason)
        return null;
    switch (finishReason) {
        case 'stop':
            return 'end_turn';
        case 'length':
            return 'max_tokens';
        case 'tool_calls':
            return 'tool_use';
        case 'content_filter':
            return 'end_turn'; // Map to end_turn as closest equivalent
        default:
            return 'end_turn';
    }
}
/**
 * Create an error response in Anthropic format
 */
function createErrorResponse(error, statusCode = 500) {
    return {
        error: {
            type: mapErrorType(statusCode),
            message: error.message,
        },
        status: statusCode,
    };
}
function mapErrorType(statusCode) {
    switch (statusCode) {
        case 400:
            return 'invalid_request_error';
        case 401:
            return 'authentication_error';
        case 403:
            return 'permission_error';
        case 404:
            return 'not_found_error';
        case 429:
            return 'rate_limit_error';
        case 500:
        default:
            return 'api_error';
    }
}
//# sourceMappingURL=response.js.map