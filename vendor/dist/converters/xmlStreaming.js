"use strict";
// XML Streaming Converter: OpenAI text stream → Anthropic SSE with XML tool call detection
// Uses buffered approach: accumulates complete tool calls before emitting
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamXmlOpenAIToAnthropic = streamXmlOpenAIToAnthropic;
const tools_1 = require("./tools");
const tokenUsage_1 = require("../utils/tokenUsage");
const errorLog_1 = require("../utils/errorLog");
// Regex patterns
const THINK_BLOCK_PATTERN = /<think>[\s\S]*?<\/think>/g;
const TOOL_CODE_PATTERN = /<tool_code\s+name\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/\s*tool_code\s*>/i;
const NESTED_TOOL_PATTERN = /<tool\s+name="[^"]*">\s*/g;
const CLOSE_TOOL_PATTERN = /<\/tool>\s*/g;
/**
 * Transform OpenAI streaming response (with XML tool calls) to Anthropic SSE format.
 * Uses BUFFERED approach: waits for complete tool calls before emitting.
 */
async function streamXmlOpenAIToAnthropic(openaiStream, reply, originalModel, provider = '') {
    const state = {
        messageId: `msg_${Date.now().toString(36)}`,
        model: originalModel,
        responseModel: '',
        provider,
        contentBlockIndex: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        hasStarted: false,
        buffer: '',
        toolCallsEmitted: 0,
    };
    const raw = reply.raw;
    // Set SSE headers
    raw.setHeader('Content-Type', 'text/event-stream');
    raw.setHeader('Cache-Control', 'no-cache');
    raw.setHeader('Connection', 'keep-alive');
    raw.setHeader('X-Accel-Buffering', 'no');
    try {
        for await (const chunk of openaiStream) {
            processChunk(chunk, state, raw);
        }
        // Final flush - emit any remaining text
        flushRemainingContent(state, raw);
        finishStream(state, raw);
    }
    catch (error) {
        sendErrorEvent(normalizeStreamingError(error), state, raw);
    }
}
function normalizeStreamingError(error) {
    return error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : 'Unknown streaming failure');
}
function processChunk(chunk, state, raw) {
    // Update usage if present
    if (chunk.usage) {
        state.inputTokens = chunk.usage.prompt_tokens;
        state.outputTokens = chunk.usage.completion_tokens;
        state.cachedInputTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
    }
    // Capture response model
    if (chunk.model && !state.responseModel) {
        state.responseModel = chunk.model;
    }
    const choice = chunk.choices[0];
    if (!choice)
        return;
    // Send message_start on first chunk
    if (!state.hasStarted) {
        sendMessageStart(state, raw);
        state.hasStarted = true;
    }
    const textDelta = choice.delta?.content || '';
    if (!textDelta)
        return;
    // Add to buffer
    state.buffer += textDelta;
    // Process buffer for complete tool calls
    processBuffer(state, raw);
}
function processBuffer(state, raw) {
    // Keep processing until no more complete tool calls are found
    while (true) {
        // Remove <think> blocks from consideration
        const cleanBuffer = state.buffer.replace(THINK_BLOCK_PATTERN, '');
        // Check for complete tool call
        const toolMatch = cleanBuffer.match(TOOL_CODE_PATTERN);
        if (!toolMatch) {
            // No complete tool call found, exit loop
            break;
        }
        const [fullMatch, toolName, rawArgs] = toolMatch;
        const matchStart = cleanBuffer.indexOf(fullMatch);
        // Get text BEFORE the tool call
        const textBeforeTool = cleanBuffer.substring(0, matchStart);
        const cleanText = textBeforeTool.trim();
        // Emit text block if there's content
        if (cleanText.length > 0) {
            emitTextBlock(cleanText, state, raw);
        }
        // Clean and emit tool use block
        const cleanArgs = cleanToolArgs(rawArgs);
        emitToolUseBlock(toolName, cleanArgs, state, raw);
        // Update buffer: remove everything up to and including the tool call
        // We need to find the position in the ORIGINAL buffer (with think blocks)
        const originalMatchEnd = state.buffer.indexOf('</tool_code>') + '</tool_code>'.length;
        state.buffer = state.buffer.substring(originalMatchEnd);
    }
}
function flushRemainingContent(state, raw) {
    // Clean remaining buffer
    const cleanBuffer = state.buffer.replace(THINK_BLOCK_PATTERN, '').trim();
    // Get any remaining text
    const remainingText = cleanBuffer.trim();
    if (remainingText.length > 0) {
        emitTextBlock(remainingText, state, raw);
    }
}
function cleanToolArgs(args) {
    let cleaned = args;
    // Remove nested <tool name="..."> tags
    cleaned = cleaned.replace(NESTED_TOOL_PATTERN, '');
    // Remove </tool> closing tags
    cleaned = cleaned.replace(CLOSE_TOOL_PATTERN, '');
    // Remove any leading ToolName\n pattern
    cleaned = cleaned.replace(/^[A-Za-z_][A-Za-z0-9_]*\s*\n/, '');
    return cleaned.trim();
}
function emitTextBlock(text, state, raw) {
    // Start text block
    const startEvent = {
        type: 'content_block_start',
        index: state.contentBlockIndex,
        content_block: { type: 'text', text: '' },
    };
    sendSSE(startEvent, raw);
    // Send text delta
    const deltaEvent = {
        type: 'content_block_delta',
        index: state.contentBlockIndex,
        delta: { type: 'text_delta', text },
    };
    sendSSE(deltaEvent, raw);
    // Stop text block
    const stopEvent = {
        type: 'content_block_stop',
        index: state.contentBlockIndex,
    };
    sendSSE(stopEvent, raw);
    state.contentBlockIndex++;
}
function emitToolUseBlock(toolName, args, state, raw) {
    const toolId = (0, tools_1.generateToolUseId)();
    // Start tool_use block
    const startEvent = {
        type: 'content_block_start',
        index: state.contentBlockIndex,
        content_block: {
            type: 'tool_use',
            id: toolId,
            name: toolName,
            input: {},
        },
    };
    sendSSE(startEvent, raw);
    // Send complete input as single delta
    const deltaEvent = {
        type: 'content_block_delta',
        index: state.contentBlockIndex,
        delta: {
            type: 'input_json_delta',
            partial_json: args,
        },
    };
    sendSSE(deltaEvent, raw);
    // Stop tool_use block
    const stopEvent = {
        type: 'content_block_stop',
        index: state.contentBlockIndex,
    };
    sendSSE(stopEvent, raw);
    state.contentBlockIndex++;
    state.toolCallsEmitted++;
}
function sendMessageStart(state, raw) {
    const event = {
        type: 'message_start',
        message: {
            id: state.messageId,
            type: 'message',
            role: 'assistant',
            content: [],
            model: state.model,
            stop_reason: null,
            stop_sequence: null,
            usage: {
                input_tokens: state.inputTokens,
                output_tokens: state.outputTokens,
                cache_read_input_tokens: state.cachedInputTokens,
            },
        },
    };
    sendSSE(event, raw);
}
function finishStream(state, raw) {
    // Determine stop reason
    const stopReason = state.toolCallsEmitted > 0 ? 'tool_use' : 'end_turn';
    // Record token usage
    (0, tokenUsage_1.recordUsage)({
        provider: state.provider,
        modelName: state.model,
        model: state.responseModel || undefined,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        cachedInputTokens: state.cachedInputTokens || undefined,
        streaming: true
    });
    // Send message_delta
    const deltaEvent = {
        type: 'message_delta',
        delta: {
            stop_reason: stopReason,
            stop_sequence: null,
        },
        usage: {
            output_tokens: state.outputTokens,
            cache_read_input_tokens: state.cachedInputTokens,
        },
    };
    sendSSE(deltaEvent, raw);
    // Send message_stop
    sendSSE({ type: 'message_stop' }, raw);
    raw.end();
}
function sendErrorEvent(error, state, raw) {
    // Record error to file
    (0, errorLog_1.recordError)(error, {
        requestId: state.messageId,
        provider: state.provider,
        modelName: state.model,
        streaming: true
    });
    const event = {
        type: 'error',
        error: {
            type: 'api_error',
            message: error.message,
        },
    };
    sendSSE(event, raw);
    raw.end();
}
function sendSSE(data, raw) {
    raw.write(`event: ${data.type}\n`);
    raw.write(`data: ${JSON.stringify(data)}\n\n`);
}
//# sourceMappingURL=xmlStreaming.js.map