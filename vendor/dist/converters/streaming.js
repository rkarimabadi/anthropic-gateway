"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BoundedToolIdRegistry = void 0;
exports.streamOpenAIToAnthropic = streamOpenAIToAnthropic;
const tools_1 = require("./tools");
const tokenUsage_1 = require("../utils/tokenUsage");
const errorLog_1 = require("../utils/errorLog");
// Global counter and bounded registry for unique tool IDs within this process.
let toolIdCounter = 0;
class BoundedToolIdRegistry {
    maxEntries;
    pruneCount;
    ids = new Set();
    constructor(maxEntries = 10000, pruneCount = 5000) {
        this.maxEntries = maxEntries;
        this.pruneCount = pruneCount;
    }
    has(id) {
        return this.ids.has(id);
    }
    /** Reserve an ID and return whether it had not been seen before. */
    claim(id) {
        if (this.ids.has(id)) {
            return false;
        }
        this.ids.add(id);
        if (this.ids.size > this.maxEntries) {
            const idsToRemove = Math.min(this.pruneCount, this.ids.size);
            const iterator = this.ids.values();
            for (let i = 0; i < idsToRemove; i++) {
                const oldest = iterator.next().value;
                if (oldest === undefined)
                    break;
                this.ids.delete(oldest);
            }
        }
        return true;
    }
    get size() {
        return this.ids.size;
    }
}
exports.BoundedToolIdRegistry = BoundedToolIdRegistry;
const usedToolIds = new BoundedToolIdRegistry();
function generateUniqueToolId() {
    let id;
    do {
        toolIdCounter++;
        const timestamp = Date.now().toString(36);
        const counter = toolIdCounter.toString(36).padStart(4, '0');
        const random = Math.random().toString(36).substring(2, 10);
        id = `call_${timestamp}_${counter}_${random}`;
    } while (usedToolIds.has(id));
    usedToolIds.claim(id);
    return id;
}
/**
 * Transform OpenAI streaming response to Anthropic SSE format
 */
async function streamOpenAIToAnthropic(openaiStream, reply, originalModel, provider = '') {
    const state = {
        messageId: `msg_${Date.now().toString(36)}`,
        model: originalModel,
        responseModel: '',
        provider,
        contentBlockIndex: 0,
        currentToolCalls: new Map(),
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        hasStarted: false,
        textContent: '',
        textBlockOpen: false,
    };
    // Access the underlying Node.js response for SSE streaming
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
        // Send final events
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
    // Capture response model from chunk
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
    const delta = choice.delta;
    // Handle text content
    if (delta.content) {
        if (!state.textBlockOpen) {
            sendContentBlockStart(state.contentBlockIndex, 'text', '', raw);
            state.textBlockOpen = true;
        }
        state.textContent += delta.content;
        sendTextDelta(state.contentBlockIndex, delta.content, raw);
    }
    // Handle tool calls
    if (delta.tool_calls) {
        for (const toolCall of delta.tool_calls) {
            processToolCallDelta(toolCall, state, raw);
        }
    }
    // Handle finish reason
    if (choice.finish_reason) {
        if (state.textBlockOpen) {
            sendContentBlockStop(state.contentBlockIndex, raw);
            state.textBlockOpen = false;
            state.textContent = '';
            state.contentBlockIndex++;
        }
        for (const toolCall of state.currentToolCalls.values()) {
            sendContentBlockStop(toolCall.blockIndex, raw);
        }
    }
}
function processToolCallDelta(toolCall, state, raw) {
    const index = toolCall.index;
    // Check if this is a new tool call
    if (!state.currentToolCalls.has(index)) {
        if (state.textBlockOpen) {
            sendContentBlockStop(state.contentBlockIndex, raw);
            state.textBlockOpen = false;
            state.textContent = '';
            state.contentBlockIndex++;
        }
        // IMPORTANT: Use the original OpenAI tool ID to maintain consistency
        // This ID must match when tool results are sent back
        // If OpenAI doesn't provide an ID, generate a guaranteed unique one
        let toolId;
        if (toolCall.id && usedToolIds.claim(toolCall.id)) {
            toolId = toolCall.id;
        }
        else {
            toolId = generateUniqueToolId();
        }
        const blockIndex = state.contentBlockIndex + index;
        const newToolCall = {
            id: toolId,
            name: toolCall.function?.name || '',
            arguments: '',
            blockIndex,
        };
        state.currentToolCalls.set(index, newToolCall);
        sendContentBlockStart(blockIndex, 'tool_use', newToolCall.name, raw, newToolCall.id);
    }
    // Update tool call data
    const currentCall = state.currentToolCalls.get(index);
    if (toolCall.function?.name) {
        currentCall.name = toolCall.function.name;
    }
    if (toolCall.function?.arguments) {
        currentCall.arguments += toolCall.function.arguments;
        sendInputJsonDelta(currentCall.blockIndex, toolCall.function.arguments, raw);
    }
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
function sendContentBlockStart(index, type, textOrName, raw, id) {
    let contentBlock;
    if (type === 'text') {
        contentBlock = { type: 'text', text: '' };
    }
    else {
        contentBlock = {
            type: 'tool_use',
            id: id || (0, tools_1.generateToolUseId)(),
            name: textOrName,
            input: {},
        };
    }
    const event = {
        type: 'content_block_start',
        index,
        content_block: contentBlock,
    };
    sendSSE(event, raw);
}
function sendTextDelta(index, text, raw) {
    const event = {
        type: 'content_block_delta',
        index,
        delta: {
            type: 'text_delta',
            text,
        },
    };
    sendSSE(event, raw);
}
function sendInputJsonDelta(index, partialJson, raw) {
    const event = {
        type: 'content_block_delta',
        index,
        delta: {
            type: 'input_json_delta',
            partial_json: partialJson,
        },
    };
    sendSSE(event, raw);
}
function sendContentBlockStop(index, raw) {
    const event = {
        type: 'content_block_stop',
        index,
    };
    sendSSE(event, raw);
}
function finishStream(state, raw) {
    // Determine stop reason
    const hasToolCalls = state.currentToolCalls.size > 0;
    const stopReason = hasToolCalls ? 'tool_use' : 'end_turn';
    // Record token usage
    (0, tokenUsage_1.recordUsage)({
        provider: state.provider,
        modelName: state.model,
        model: state.responseModel || undefined,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        cachedInputTokens: state.cachedInputTokens || undefined,
        streaming: true,
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
        streaming: true,
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
//# sourceMappingURL=streaming.js.map