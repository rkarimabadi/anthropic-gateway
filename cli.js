#!/usr/bin/env node
"use strict";
/*
 * anthropic-gateway CLI
 *
 *   node cli.js setup  [--provider kilo|openai|custom] [--base-url ..] [--api-key ..]
 *                      [--model ..] [--port ..] [--token ..] [--config path] [--yes]
 *   node cli.js start  [--config path]
 *   node cli.js stop   [--config path]
 *   node cli.js status [--config path]
 *   node cli.js autostart on|off  [--config path]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const APP_DIR = __dirname;
const HOME_DIR =
  process.env.ANTHROPIC_GATEWAY_HOME || path.join(os.homedir(), '.anthropic-gateway');
const DEFAULT_CONFIG = path.join(HOME_DIR, 'config.json');
const PID_FILE = path.join(HOME_DIR, 'gateway.pid');
const LOG_FILE = path.join(HOME_DIR, 'gateway.log');
const STARTUP_CMD = path.join(
  os.homedir(),
  'AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/anthropic-gateway.cmd'
);

function ensureHomeDir() {
  fs.mkdirSync(HOME_DIR, { recursive: true });
}

const PRESETS = {
  kilo: { name: 'kilo.imedata.ir', baseUrl: 'https://kilo.imedata.ir/v1', model: 'kilo-auto/free', needsKey: true },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '', needsKey: true },
  custom: { name: 'custom', baseUrl: '', model: '', needsKey: true },
};

function fail(msg) {
  console.error('error: ' + msg);
  process.exit(1);
}

function getVersion() {
  try {
    return require(path.join(APP_DIR, 'package.json')).version;
  } catch {
    return 'unknown';
  }
}

function formatUptime(sec) {
  if (!Number.isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const parts = [];
  if (d) parts.push(d + 'd');
  if (h) parts.push(h + 'h');
  if (m) parts.push(m + 'm');
  parts.push(s + 's');
  return parts.join(' ');
}

function maskKey(key) {
  const k = String(key || '');
  if (k.length <= 8) return k ? k[0] + '…' : '—';
  return k.slice(0, 4) + '…' + k.slice(-4);
}

function ask(rl, q, def) {
  return new Promise((resolve) => {
    rl.question(q + (def ? ' [' + def + '] ' : ' '), (a) => resolve(a.trim() === '' ? (def || '') : a.trim()));
  });
}

function randomToken() {
  return 'ag-' + require('crypto').randomBytes(24).toString('base64url');
}

/**
 * Load the top-level config and return the selected profile object merged with
 * defaults. If `profileName` is omitted, `defaultProfile` in the config is used;
 * if none/defaultProfile points at a non-existent one, the first profile wins.
 */
function loadProfile(cfgPath, profileName) {
  if (!fs.existsSync(cfgPath)) fail('no config at ' + cfgPath + ' — run "anthropic-gateway setup" first');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

  // Backwards compatibility: old single-profile config.json (flat fields).
  if (Array.isArray(cfg.profiles) && cfg.profiles.length > 0) {
    const profiles = cfg.profiles;
    if (!profileName) profileName = cfg.defaultProfile;
    let idx;
    if (profileName) {
      idx = profiles.findIndex((p) => p.providerName === profileName);
      if (idx === -1) fail('profile "' + profileName + '" not found in ' + cfgPath + ' (available: ' + profiles.map((p) => p.providerName).join(', ') + ')');
    } else {
      idx = 0; // first profile is the default when none specified
    }
    return { ...profiles[idx], _profiles: profiles, _configPath: cfgPath, _defaultProfile: cfg.defaultProfile };
  }

  // Legacy flat config
  return { ...cfg, _profiles: null, _configPath: cfgPath, _defaultProfile: undefined };
}

async function testUpstream(baseUrl, apiKey, model) {
  const OpenAI = require('openai');
  const client = new OpenAI({ baseURL: baseUrl, apiKey });
  const started = Date.now();
  try {
    await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      max_tokens: 16,
    });
    console.log('  connectivity: OK (' + (Date.now() - started) + ' ms) via ' + model);
    return true;
  } catch (e) {
    console.log('  connectivity FAILED: ' + (e && e.message ? String(e.message).slice(0, 300) : e));
    return false;
  }
}

async function cmdSetup(args) {
  ensureHomeDir();
  let cfgPath = DEFAULT_CONFIG;
  let provider = args.provider || '';
  let baseUrl = args['base-url'] || '';
  let apiKey = args['api-key'] || '';
  let model = args.model || '';
  let port = args.port ? Number(args.port) : NaN;
  let token = args.token || '';
  const yes = !!args.yes;

  if (args.config) cfgPath = path.resolve(args.config);

  const interactive = !yes;
  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  const q = async (prompt, def) => (interactive ? ask(rl, prompt, def) : def || '');

  if (!provider) provider = await q('Provider preset (kilo | openai | custom):', 'kilo');
  provider = provider.toLowerCase();
  const preset = PRESETS[provider] || PRESETS.custom;
  if (provider !== 'custom') console.log('Using preset: ' + preset.name);
  // If user supplied a custom profile name (e.g., via --profile-name), use that as providerName
  const customProfileName = args['profile-name'] || '';

  if (!baseUrl) baseUrl = await q('Upstream base URL (OpenAI-compatible, e.g. https://host/v1):', preset.baseUrl);
  if (!apiKey) apiKey = await q('API key:', '');
  if (!model) model = await q('Upstream model id (all requests are sent to this model):', preset.model);
  if (!Number.isFinite(port)) {
    const p = await q('Local port:', '3080');
    port = Number(p);
  }
  if (!token) {
    const want = await q('Proxy token (client auth; enter to auto-generate):', '');
    token = want || randomToken();
  }
  const adv = await q('Advertised model ids (comma separated, shown to Claude Code):', 'claude-sonnet-4-5,claude-haiku-4-5,claude-opus-4-5,sonnet,haiku,opus');
  if (interactive) rl.close();

  if (!baseUrl || !apiKey || !model) fail('base URL, API key and model are required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('invalid port');

  const advertisedModels = adv.split(',').map((s) => s.trim()).filter(Boolean);
  const fullLoggingFlag = args['full-logging'];
  const fullLogging = fullLoggingFlag !== undefined && String(fullLoggingFlag) !== 'false';

  // Load existing config if any
  let existingConfig = null;
  if (fs.existsSync(cfgPath)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (e) {
      fail('failed to parse existing config at ' + cfgPath);
    }
  }

  // Determine if we are dealing with legacy flat config or new profiles format
  const isLegacy = existingConfig && (!Array.isArray(existingConfig.profiles));
  let profiles = [];
  let defaultProfile = undefined;

  if (isLegacy) {
    // Convert legacy flat config to a profile
    const legacyProfile = {
      providerName: existingConfig.providerName || 'legacy',
      upstreamBaseUrl: existingConfig.upstreamBaseUrl.replace(/\/+$/, ''),
      upstreamApiKey: existingConfig.upstreamApiKey,
      upstreamModel: existingConfig.upstreamModel,
      port: existingConfig.port || 3080,
      proxyTokens: Array.isArray(existingConfig.proxyTokens) ? existingConfig.proxyTokens : [existingConfig.proxyTokens],
      toolFormat: existingConfig.toolFormat || 'native',
      advertisedModels: Array.isArray(existingConfig.advertisedModels) ? existingConfig.advertisedModels : [],
      fullLogging: !!existingConfig.fullLogging,
      logFile: existingConfig.logFile || 'gateway.log',
    };
    profiles.push(legacyProfile);
    defaultProfile = legacyProfile.providerName;
  } else if (existingConfig) {
    // Already in new format
    profiles = Array.isArray(existingConfig.profiles) ? existingConfig.profiles : [];
    defaultProfile = existingConfig.defaultProfile;
  }

  // Find index of profile with same providerName as the one we are setting up
  const newProfileName = (provider === 'custom') && args['profile-name'] ? args['profile-name'] : preset.name;
  const profileIndex = profiles.findIndex(p => p.providerName === newProfileName);
  const newProfile = {
    providerName: newProfileName,
    upstreamBaseUrl: baseUrl.replace(/\/+$/, ''),
    upstreamApiKey: apiKey,
    upstreamModel: model,
    port,
    proxyTokens: [token],
    toolFormat: 'native',
    advertisedModels,
    fullLogging,
    logFile: 'gateway.log',
  };

  if (profileIndex >= 0) {
    // Update existing profile
    profiles[profileIndex] = newProfile;
  } else {
    // Add new profile
    profiles.push(newProfile);
  }

  // If defaultProfile is not set, set it to the providerName of the profile we just set up
  if (!defaultProfile) {
    defaultProfile = newProfile.providerName;
  }

  const configOut = {
    defaultProfile,
    profiles,
  };

  console.log('Testing upstream connectivity...');
  const ok = await testUpstream(newProfile.upstreamBaseUrl, newProfile.upstreamApiKey, newProfile.upstreamModel);
  if (!ok && !yes) {
    const c = await ask(readline.createInterface({ input: process.stdin, output: process.stdout }), 'Connectivity test failed. Save anyway? (y/N):', 'N');
    if (c.toLowerCase() !== 'y') fail('aborted — nothing written');
  }
  fs.writeFileSync(cfgPath, JSON.stringify(configOut, null, 2));
  console.log('Config written to ' + cfgPath);
  console.log('Proxy token (use as API key / x-api-key / Bearer in the client): ' + token);
  console.log('Next: anthropic-gateway start   (or: anthropic-gateway autostart on)');
}

async function cmdStart(args) {
  ensureHomeDir();
  const cfgPath = args.config ? path.resolve(args.config) : DEFAULT_CONFIG;
  const profileArg = args.profile;
  const cfg = loadProfile(cfgPath, profileArg); // loadProfile now takes profileName
  if (cfg.logFile && !path.isAbsolute(cfg.logFile)) cfg.logFile = path.join(HOME_DIR, cfg.logFile);
  const { makeServer } = require('./lib/server');
  const server = makeServer(cfg);
  let started;
  try {
    started = await server.start();
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      fail(`Port ${cfg.port} is already in use. Another process might be running on this port.\n` +
        `To resolve:\n` +
        `  1. Stop the existing gateway: anthropic-gateway stop\n` +
        `  2. Or change the port in your config (or use a different profile with a different port).\n` +
        `Underlying error: ${err.message}`);
    }
    throw err; // re-throw if we didn't handle it
  }
  fs.writeFileSync(PID_FILE, String(process.pid));
  // Also write the active profile to a file
  const activeProfilePath = path.join(HOME_DIR, 'active_profile');
  fs.writeFileSync(activeProfilePath, profileArg || cfg._defaultProfile || (cfg._profiles && cfg._profiles[0]?.providerName));
  console.log('pid ' + process.pid + ' written to ' + PID_FILE);
  console.log('Health: http://127.0.0.1:' + started + '/health');
  const shutdown = async () => {
    await server.stop();
    try { fs.unlinkSync(PID_FILE); } catch {}
    try { fs.unlinkSync(activeProfilePath); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function cmdStop() {
  ensureHomeDir();
  if (!fs.existsSync(PID_FILE)) fail('no pid file (was it started with "anthropic-gateway start"? or already stopped)');
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8'));
  try {
    process.kill(pid);
    console.log('stopped pid ' + pid);
  } catch (e) {
    console.log('pid ' + pid + ' not running (' + e.message + ')');
  }
  try { fs.unlinkSync(PID_FILE); } catch {}
}

async function cmdStatus(args) {
  ensureHomeDir();
  const cfgPath = args.config ? path.resolve(args.config) : DEFAULT_CONFIG;
  let cfg;
  try { cfg = loadConfig(cfgPath); } catch (e) { console.log('down (no config — run "anthropic-gateway setup")'); return; }
  try {
    const res = await fetch('http://127.0.0.1:' + cfg.port + '/health');
    const h = await res.json();
    const t = h.totals || { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const rows = [
      ['Status', 'UP'],
      ['Version', h.version || getVersion()],
      ['PID', String(h.pid || '—')],
      ['Listen', '127.0.0.1:' + (h.port || cfg.port)],
      ['Upstream model', h.upstream || cfg.upstreamModel],
      ['Upstream URL', h.provider || cfg.upstreamBaseUrl],
      ['API key', maskKey(cfg.upstreamApiKey)],
      ['Tool format', h.toolFormat || cfg.toolFormat || 'native'],
      ['Full logging', h.fullLogging ? 'ON' : 'off'],
      ['Uptime', formatUptime(h.uptimeSec)],
      ['Requests', String(t.requests)],
      ['Tokens (in/out/total)', t.inputTokens + ' / ' + t.outputTokens + ' / ' + t.totalTokens],
    ];
    const w = Math.max(...rows.map((r) => r[0].length));
    for (const [k, v] of rows) console.log(k.padEnd(w) + '  ' + v);
  } catch {
    console.log('DOWN — nothing listening on 127.0.0.1:' + cfg.port);
    console.log('Start it with: anthropic-gateway start');
  }
}

async function cmdFullLogging(mode, args) {
  const m = String(mode || '').toLowerCase();
  if (m !== 'on' && m !== 'off') fail('usage: node cli.js fulllogging on|off');
  const cfgPath = args && args.config ? path.resolve(args.config) : DEFAULT_CONFIG;
  const cfg = loadConfig(cfgPath);
  cfg.fullLogging = m === 'on';
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  console.log('fullLogging = ' + cfg.fullLogging + '  (saved to ' + cfgPath + ')');
  console.log('Restart the gateway to apply: anthropic-gateway stop, then anthropic-gateway start');
  if (cfg.fullLogging && cfg.logFile) console.log('Full request/response bodies will be appended to ' + cfg.logFile);
}

function startupCmdContents() {
  const node = process.execPath;
  return [
    '@echo off',
    'start "" /min "' + node + '" "' + path.join(APP_DIR, 'cli.js') + '" start',
    '',
  ].join('\r\n');
}

async function cmdAutostart(mode) {
  ensureHomeDir();
  if (mode === 'on') {
    if (!fs.existsSync(DEFAULT_CONFIG)) fail('config.json missing — run setup first');
    fs.writeFileSync(STARTUP_CMD, startupCmdContents());
    console.log('Autostart enabled: ' + STARTUP_CMD);
  } else if (mode === 'off') {
    if (fs.existsSync(STARTUP_CMD)) {
      fs.unlinkSync(STARTUP_CMD);
      console.log('Autostart disabled');
    } else {
      console.log('Autostart was not enabled');
    }
  } else {
    fail('usage: node cli.js autostart on|off');
  }
}

async function cmdSelect(profileName, args) {
  ensureHomeDir();
  const cfgPath = args && args.config ? path.resolve(args.config) : DEFAULT_CONFIG;
  if (!fs.existsSync(cfgPath)) fail('no config at ' + cfgPath + ' — run "anthropic-gateway setup" first');
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    fail('failed to parse config at ' + cfgPath);
  }
  // Ensure we are dealing with the new profiles format
  if (!Array.isArray(cfg.profiles)) {
    fail('config is in legacy format; please run setup again to migrate to profiles format');
  }
  const profileIndex = cfg.profiles.findIndex(p => p.providerName === profileName);
  if (profileIndex === -1) {
    fail('profile "' + profileName + '" not found in ' + cfgPath + ' (available: ' + cfg.profiles.map(p => p.providerName).join(', ') + ')');
  }
  cfg.defaultProfile = profileName;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  console.log('defaultProfile set to "' + profileName + '" in ' + cfgPath);
}

async function cmdListProfiles(args) {
  ensureHomeDir();
  const cfgPath = args && args.config ? path.resolve(args.config) : DEFAULT_CONFIG;
  if (!fs.existsSync(cfgPath)) fail('no config at ' + cfgPath + ' — run "anthropic-gateway setup" first');
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    fail('failed to parse config at ' + cfgPath);
  }
  // Handle legacy config
  if (!Array.isArray(cfg.profiles)) {
    // Legacy single profile
    if (cfg.providerName) {
      console.log('Profiles (legacy format):');
      console.log('  * ' + cfg.providerName + ' (default)');
    } else {
      console.log('No profiles found in legacy config.');
    }
    return;
  }
  if (cfg.profiles.length === 0) {
    console.log('No profiles defined.');
    return;
  }
  console.log('Profiles:');
  for (const p of cfg.profiles) {
    const marker = (p.providerName === cfg.defaultProfile) ? ' (default)' : '';
    console.log('  * ' + p.providerName + marker);
  }
}

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith('--')) {
        out[k] = v;
        i++;
      } else {
        out[k] = true;
      }
    } else {
      out._ = out._ || [];
      out._.push(a);
    }
  }
  return out;
}

(async () => {
  const argv = process.argv.slice(2);
  if (argv.includes('--version') || argv.includes('-v')) {
    console.log('anthropic-gateway ' + getVersion());
    process.exit(0);
  }
  const flags = parseFlags(argv);
  const cmd = flags._ && flags._[0];
  if (!cmd) {
    console.log(
      [
        'anthropic-gateway — Anthropic-compatible gateway for OpenAI-compatible providers',
        '',
        'usage:',
        '  anthropic-gateway setup [--provider kilo|openai|custom] [--base-url URL] [--api-key KEY] [--model ID] [--port N] [--token TOK] [--full-logging] [--yes]',
        '  anthropic-gateway start [profile]   # if profile omitted, uses defaultProfile',
        '  anthropic-gateway stop',
        '  anthropic-gateway status',
        '  anthropic-gateway fulllogging on|off   # log full request/response bodies to the log file (restart to apply)',
        '  anthropic-gateway autostart on|off',
        '  anthropic-gateway select <profile>  # set defaultProfile for future start commands',
        '  anthropic-gateway profiles        # list all defined profiles',
        '  anthropic-gateway version        # or: --version, -v',
      ].join('\n')
    );
    process.exit(0);
  }
  if (cmd === 'version') {
    console.log('anthropic-gateway ' + getVersion());
    process.exit(0);
  }
  if (cmd === 'setup') await cmdSetup(flags);
  else if (cmd === 'start') {
    // If a profile name is provided as the second argument (after 'start'), use it
    const profileName = flags._ && flags._.length > 1 ? flags._[1] : undefined;
    flags.profile = profileName;
    await cmdStart(flags);
  }
  else if (cmd === 'stop') await cmdStop();
  else if (cmd === 'status') await cmdStatus(flags);
  else if (cmd === 'fulllogging') await cmdFullLogging(flags._[1], flags);
  else if (cmd === 'autostart') await cmdAutostart(flags._[1]);
  else if (cmd === 'select') await cmdSelect(flags._[1], flags);
  else if (cmd === 'profiles') await cmdListProfiles(flags);
  else fail('unknown command: ' + cmd);
})();
