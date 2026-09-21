"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAzureOpenAIEndpoint = isAzureOpenAIEndpoint;
function isAzureOpenAIEndpoint(baseUrl) {
    try {
        const url = new URL(baseUrl);
        const hostname = url.hostname.toLowerCase();
        return hostname.endsWith('.openai.azure.com') || hostname.includes('.services.ai.azure.com');
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=provider.js.map