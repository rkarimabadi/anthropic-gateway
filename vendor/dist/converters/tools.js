"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertToolsToOpenAI = convertToolsToOpenAI;
exports.convertToolChoiceToOpenAI = convertToolChoiceToOpenAI;
exports.generateToolUseId = generateToolUseId;
/**
 * Convert Anthropic tool definitions to OpenAI function format
 */
function convertToolsToOpenAI(tools) {
    return tools.map(tool => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
        },
    }));
}
/**
 * Convert Anthropic tool choice to OpenAI format
 */
function convertToolChoiceToOpenAI(toolChoice) {
    switch (toolChoice.type) {
        case 'auto':
            return 'auto';
        case 'any':
            return 'required'; // OpenAI's equivalent - forces tool use
        case 'tool':
            if (toolChoice.name) {
                return {
                    type: 'function',
                    function: { name: toolChoice.name },
                };
            }
            return 'auto';
        default:
            return 'auto';
    }
}
/**
 * Generate a unique tool use ID in Anthropic format
 */
function generateToolUseId() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'toolu_';
    for (let i = 0; i < 24; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
//# sourceMappingURL=tools.js.map