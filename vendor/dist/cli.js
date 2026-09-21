#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// CLI entry point for claude-adapter
const commander_1 = require("commander");
const inquirer_1 = __importDefault(require("inquirer"));
const path_1 = require("path");
const config_1 = require("./utils/config");
const server_1 = require("./server");
const ui_1 = require("./utils/ui");
const update_1 = require("./utils/update");
const metadata_1 = require("./utils/metadata");
const fileStorage_1 = require("./utils/fileStorage");
const package_json_1 = require("../package.json");
const program = new commander_1.Command();
program
    .name('claude-adapter')
    .description('Proxy adapter to use OpenAI API with Claude Code')
    .version(package_json_1.version);
program
    .option('-p, --port <port>', 'Port to run the proxy server on', '3080')
    .option('-r, --reconfigure', 'Force reconfiguration even if config exists')
    .option('--no-claude-settings', 'Skip updating Claude Code settings files')
    .action(async (options) => {
    ui_1.UI.banner();
    ui_1.UI.header('Adapt any model for Claude Code');
    try {
        (0, fileStorage_1.repairPrivateStoragePermissions)();
        // Initialize metadata (creates metadata.json on first run)
        (0, metadata_1.getMetadata)();
        // Step 1: Update ~/.claude.json for onboarding skip (if enabled)
        if (options.claudeSettings) {
            (0, config_1.updateClaudeJson)();
            ui_1.UI.statusDone(true, 'Initialized Claude Adapter');
        }
        else {
            ui_1.UI.info('Skipping Claude settings update (--no-claude-settings)');
        }
        // Step 2: Load or create configuration
        let config = (0, config_1.loadConfig)();
        if (!config || options.reconfigure) {
            ui_1.UI.log(''); // Spacing
            config = (0, config_1.preserveProxyAuthToken)(await promptForConfiguration(), config);
            (0, config_1.saveConfig)(config);
            console.log(`\x1b[2m✔\x1b[0m Tool Format: ${ui_1.UI.dim(`[${config.toolFormat?.toUpperCase() || 'NATIVE'}]`)}`);
            ui_1.UI.info('Creating Claude Adapter API...');
        }
        else if (config.toolFormat === undefined) {
            // Existing config missing toolFormat - prompt only for that
            ui_1.UI.log(''); // Spacing
            const toolStyle = await promptForToolCallingStyle();
            config.toolFormat = toolStyle;
            (0, config_1.saveConfig)(config);
            console.log(`\x1b[2m✔\x1b[0m Tool Format: ${ui_1.UI.dim(`[${config.toolFormat.toUpperCase()}]`)}`);
            ui_1.UI.info('Tool calling preference saved');
        }
        else {
            ui_1.UI.info('Using existing configuration');
            console.log(`\x1b[2m✔\x1b[0m Tool Format: ${ui_1.UI.dim(`[${config.toolFormat.toUpperCase()}]`)}`);
        }
        // Migrate legacy configurations to a stable, private proxy token.
        const activeConfig = (0, config_1.ensureProxyAuthToken)(config);
        // Step 3: Find available port and start server
        const preferredPort = parseInt(options.port, 10) || 3080;
        const port = await (0, server_1.findAvailablePort)(preferredPort);
        const server = (0, server_1.createServer)(activeConfig);
        const proxyUrl = await server.start(port);
        ui_1.UI.statusDone(true, `Claude Adapter running at ${ui_1.UI.newUrl(proxyUrl)}`);
        // Step 4: Update Claude Code settings (if enabled)
        if (options.claudeSettings) {
            (0, config_1.updateClaudeSettings)(proxyUrl, activeConfig.models, activeConfig.proxyAuthToken);
            ui_1.UI.statusDone(true, 'Models configured:');
            // Display configured models
            ui_1.UI.table([
                { label: 'Opus', value: config.models.opus },
                { label: 'Sonnet', value: config.models.sonnet },
                { label: 'Haiku', value: config.models.haiku },
            ]);
        }
        else {
            ui_1.UI.info('Claude Code settings not updated (use manual configuration)');
            ui_1.UI.hint(`Set ANTHROPIC_BASE_URL=${proxyUrl} in your Claude Code settings`);
            ui_1.UI.hint(`Copy proxyAuthToken from ${(0, path_1.join)((0, config_1.getConfigDir)(), 'config.json')} into ANTHROPIC_AUTH_TOKEN`);
        }
        ui_1.UI.success('Claude Adapter is ready!');
        ui_1.UI.info('Open a new terminal tab and run Claude Code.');
        ui_1.UI.hint('Press Ctrl+C to stop the proxy server.');
        // Non-blocking update check
        (0, update_1.checkForUpdates)().then((update) => {
            if (update?.hasUpdate) {
                ui_1.UI.updateNotify(update.current, update.latest);
            }
            ui_1.UI.log('');
        });
        // Keep the process running
        process.on('SIGINT', async () => {
            ui_1.UI.log('');
            await server.stop();
            ui_1.UI.success('Claude Adapter stopped');
            process.exit(0);
        });
    }
    catch (error) {
        ui_1.UI.statusDone(false, 'An error occurred');
        ui_1.UI.error('Setup failed', error);
        process.exit(1);
    }
});
/**
 * Prompt user for configuration
 */
async function promptForConfiguration() {
    const prefix = ui_1.UI.dim('?');
    // Required configuration prompts
    const requiredAnswers = await inquirer_1.default.prompt([
        {
            type: 'input',
            name: 'baseUrl',
            prefix,
            message: 'OpenAI-compatible base URL:',
            default: 'https://api.openai.com/v1',
            transformer: (input) => ui_1.UI.highlight(input),
            validate: (input) => {
                try {
                    new URL(input);
                    return true;
                }
                catch {
                    return 'Please enter a valid URL';
                }
            },
        },
        {
            type: 'password',
            name: 'apiKey',
            prefix,
            message: 'API Key:',
            mask: '*',
            transformer: (input) => ui_1.UI.highlight('*'.repeat(input.length)),
            validate: (input) => {
                if (!input || input.trim() === '') {
                    return 'API key is required';
                }
                return true;
            },
        },
        {
            type: 'input',
            name: 'opusModel',
            prefix,
            message: 'Alternative model for Opus:',
            transformer: (input) => ui_1.UI.highlight(input),
            validate: (input) => {
                if (!input || input.trim() === '') {
                    return 'Model name is required for Opus';
                }
                return true;
            },
        },
    ]);
    const opusModel = requiredAnswers.opusModel.trim();
    // Sonnet prompt
    const sonnetAnswer = await inquirer_1.default.prompt([
        {
            type: 'input',
            name: 'sonnetModel',
            prefix,
            message: 'Alternative model for Sonnet:',
            transformer: (input) => (input ? ui_1.UI.highlight(input) : ''),
        },
    ]);
    const sonnetModel = sonnetAnswer.sonnetModel.trim() || opusModel;
    // If skipped, replace blank line with fallback display
    if (!sonnetAnswer.sonnetModel.trim()) {
        process.stdout.write('\x1b[1A\x1b[2K');
        console.log(`${prefix} Alternative model for Sonnet: ${ui_1.UI.dim(`[${opusModel}]`)}`);
    }
    // Haiku prompt
    const haikuAnswer = await inquirer_1.default.prompt([
        {
            type: 'input',
            name: 'haikuModel',
            prefix,
            message: 'Alternative model for Haiku:',
            transformer: (input) => (input ? ui_1.UI.highlight(input) : ''),
        },
    ]);
    const haikuModel = haikuAnswer.haikuModel.trim() || sonnetModel;
    // If skipped, replace blank line with fallback display
    if (!haikuAnswer.haikuModel.trim()) {
        process.stdout.write('\x1b[1A\x1b[2K');
        console.log(`${prefix} Alternative model for Haiku: ${ui_1.UI.dim(`[${sonnetModel}]`)}`);
    }
    // Tool calling support prompt (after all models are entered)
    const toolSupportAnswer = await inquirer_1.default.prompt([
        {
            type: 'list',
            name: 'supportsTools',
            prefix,
            message: 'Do your models support tool/function calling?',
            choices: [
                { name: 'Yes', value: true },
                { name: 'No', value: false },
            ],
            default: true,
        },
    ]);
    let toolFormat;
    if (toolSupportAnswer.supportsTools) {
        // User selected "Yes" - ask for tool type
        const toolTypeAnswer = await inquirer_1.default.prompt([
            {
                type: 'list',
                name: 'toolType',
                prefix,
                message: 'Select tool/function type:',
                choices: [
                    { name: 'XML (Recommended)', value: 'xml' },
                    { name: 'Native (Openai Format)', value: 'native' },
                ],
                default: 'xml',
            },
        ]);
        toolFormat = toolTypeAnswer.toolType;
    }
    else {
        // User selected "No" - auto-select xml
        console.log(`\x1b[32m✔\x1b[0m Tool Format: ${ui_1.UI.dim('[XML]')}`);
        toolFormat = 'xml';
    }
    return {
        baseUrl: requiredAnswers.baseUrl.trim(),
        apiKey: requiredAnswers.apiKey.trim(),
        models: {
            opus: opusModel,
            sonnet: sonnetModel,
            haiku: haikuModel,
        },
        toolFormat,
    };
}
/**
 * Prompt only for tool calling style (for existing configs missing this field)
 */
async function promptForToolCallingStyle() {
    const prefix = ui_1.UI.dim('?');
    const toolSupportAnswer = await inquirer_1.default.prompt([
        {
            type: 'list',
            name: 'supportsTools',
            prefix,
            message: 'Do your models support tool/function calling?',
            choices: [
                { name: 'Yes', value: true },
                { name: 'No', value: false },
            ],
            default: true,
        },
    ]);
    if (toolSupportAnswer.supportsTools) {
        // User selected "Yes" - ask for tool type
        const toolTypeAnswer = await inquirer_1.default.prompt([
            {
                type: 'list',
                name: 'toolType',
                prefix,
                message: 'Select tool/function type:',
                choices: [
                    { name: 'XML (Recommended)', value: 'xml' },
                    { name: 'Native (Openai Format)', value: 'native' },
                ],
                default: 'xml',
            },
        ]);
        return toolTypeAnswer.toolType;
    }
    else {
        // User selected "No" - auto-select xml
        console.log(`\x1b[32m✔\x1b[0m Tool Format: ${ui_1.UI.dim('[XML]')}`);
        return 'xml';
    }
}
// Run the CLI
program.parse();
//# sourceMappingURL=cli.js.map