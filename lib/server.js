"use strict";
/*
 * anthropic-gateway server core.
 * Speaks the Anthropic Messages API locally (/v1/messages, /v1/models, /health)
 * and forwards every request to any OpenAI-compatible upstream, always using
 * the configured upstreamModel.
 *
 * config fields:
 *   upstreamBaseUrl   e.g. https://kilo.imedata.ir/v1
 *   upstreamApiKey    provider key
 *   upstreamModel     model id sent upstream (all requests use it)
 *   port              local listen port (default 3080)
 *   proxyTokens       string[] — accepted client auth tokens (Bearer or x-api-key)
 *   toolFormat        'native' (default) or 'xml'
 *   advertisedModels  model ids returned by GET /v1/models (for GUI discovery)
 *   fullLogging       boolean — when true, full request/response bodies are
 *                     appended to logFile (log-only, not console)
 *   logFile           optional path to append logs to (default: none, console only)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fastify = require('fastify');
const OpenAI = require('openai');
const { convertRequestToOpenAI } = require('../vendor/dist/converters/request');
const { convertResponseToAnthropic, createErrorResponse } = require('../vendor/dist/converters/response');
const { streamOpenAIToAnthropic } = require('../vendor/dist/converters/streaming');
const { validateAnthropicRequest, formatValidationErrors } = require('../vendor/dist/utils/validation');

const DEFAULTS = {
  port: 3080,
  toolFormat: 'native',
  advertisedModels: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'],
};

function readVersion() {
  try {
    return require('../package.json').version;
  } catch {
    return 'unknown';
  }
}
const VERSION = readVersion();

function matchesToken(value, expected) {
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function makeServer(rawCfg) {
  const cfg = { ...DEFAULTS, ...rawCfg };
  if (!Array.isArray(cfg.proxyTokens) || cfg.proxyTokens.length === 0) {
    throw new Error('config needs at least one proxyTokens entry');
  }
  if (!cfg.upstreamBaseUrl || !cfg.upstreamApiKey || !cfg.upstreamModel) {
    throw new Error('config needs upstreamBaseUrl, upstreamApiKey and upstreamModel');
  }

  let logStream = null;
  if (cfg.logFile) {
    logStream = fs.createWriteStream(cfg.logFile, { flags: 'a' });
  }
  function log(line) {
    const s = '[' + new Date().toISOString() + '] ' + line;
    console.log(s);
    if (logStream) logStream.write(s + '\n');
  }

  // Per-session stats for the lifetime of this gateway process (reset on restart).
  const totals = { requests: 0, input: 0, output: 0, cached: 0 };
  const startedAt = Date.now();
  const fullLogging = !!cfg.fullLogging;
  function recordUsage(input, output, cached) {
    totals.requests += 1;
    totals.input += input;
    totals.output += output;
    totals.cached += cached;
  }
  function usageSummary() {
    return 'session ' + totals.requests + ' req  in=' + totals.input + ' out=' + totals.output + ' total=' + (totals.input + totals.output);
  }
  function uptimeSeconds() {
    return Math.floor((Date.now() - startedAt) / 1000);
  }

  // Full request/response capture, appended to the log file only (not console,
  // so streaming stdout stays clean). Off unless fullLogging is set in config.
  function logFull(kind, data) {
    if (!fullLogging || !logStream) return;
    const header = '[FULL ' + kind + '] ' + new Date().toISOString();
    let body;
    try {
      body = typeof data === 'string' ? data : JSON.stringify(data);
    } catch {
      body = String(data);
    }
    logStream.write('\n' + header + '\n' + body + '\n');
  }

  const app = fastify({ logger: false });
  const isAzure = cfg.upstreamBaseUrl.includes('.openai.azure.com');
  const openai = new OpenAI({ baseURL: cfg.upstreamBaseUrl, apiKey: cfg.upstreamApiKey });

  const modelsPayload = { data: (cfg.advertisedModels || []).map((id) => ({ id, display_name: id + ' (via ' + cfg.upstreamModel + ')' })) };

  app.get('/health', async () => ({
    status: 'ok',
    gateway: 'anthropic-gateway',
    version: VERSION,
    pid: process.pid,
    port: cfg.port,
    upstream: cfg.upstreamModel,
    provider: cfg.providerName || cfg.upstreamBaseUrl,
    toolFormat: cfg.toolFormat,
    uptimeSec: uptimeSeconds(),
    fullLogging,
    totals: {
      requests: totals.requests,
      inputTokens: totals.input,
      outputTokens: totals.output,
      totalTokens: totals.input + totals.output,
    },
  }));
  app.get('/v1/models', async () => modelsPayload);

  app.post('/v1/messages', async (request, reply) => {
    const isAuthed = (() => {
      const h = request.headers;
      let candidate = null;
      if (typeof h.authorization === 'string' && h.authorization.startsWith('Bearer ')) {
        candidate = h.authorization.slice('Bearer '.length);
      } else if (typeof h['x-api-key'] === 'string') {
        candidate = h['x-api-key'];
      }
      return candidate !== null && cfg.proxyTokens.some((t) => matchesToken(candidate, t));
    })();
    if (!isAuthed) {
      const h = request.headers;
      log('AUTH-FAIL (auth header present: ' + (!!h.authorization) + ', x-api-key present: ' + (!!h['x-api-key']) + ')');
      const err = createErrorResponse(new Error('Invalid proxy authentication token'), 401);
      reply.code(401).send({ error: err.error });
      return;
    }
    const validation = validateAnthropicRequest(request.body);
    if (!validation.valid) {
      const err = createErrorResponse(new Error(formatValidationErrors(validation.errors)), 400);
      reply.code(400).send({ error: err.error });
      return;
    }
    const anthropicRequest = request.body;
    const clientModel = anthropicRequest.model || 'sonnet';
    const isStreaming = anthropicRequest.stream ?? false;
    log('-> ' + clientModel + ' (upstream ' + cfg.upstreamModel + ') stream=' + isStreaming);

    try {
      const openaiRequest = convertRequestToOpenAI(anthropicRequest, cfg.upstreamModel, cfg.toolFormat, isAzure);
      logFull('IN request (anthropic)', anthropicRequest);
      logFull('IN request (openai)', openaiRequest);
      if (isStreaming) {
        const stream = await openai.chat.completions.create({ ...openaiRequest, stream: true, stream_options: { include_usage: true } });
        // Capture token usage from the stream without altering what the vendored
        // converter sees — it just iterates chunks, so a pass-through works.
        const usage = { input: 0, output: 0, cached: 0 };
        let outText = '';
        let outTools = [];
        const wrapped = (async function* () {
          for await (const chunk of stream) {
            if (chunk && chunk.usage) {
              usage.input = chunk.usage.prompt_tokens ?? usage.input;
              usage.output = chunk.usage.completion_tokens ?? usage.output;
              usage.cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? usage.cached;
            }
            const choice = chunk && chunk.choices && chunk.choices[0];
            if (choice && choice.delta) {
              if (choice.delta.content) outText += choice.delta.content;
              if (choice.delta.tool_calls) {
                for (const tc of choice.delta.tool_calls) {
                  const rec = outTools[tc.index] || (outTools[tc.index] = { id: tc.id || '', name: '', arguments: '' });
                  if (tc.id) rec.id = tc.id;
                  if (tc.function && tc.function.name) rec.name += tc.function.name;
                  if (tc.function && tc.function.arguments) rec.arguments += tc.function.arguments;
                }
              }
            }
            yield chunk;
          }
        })();
        reply.hijack();
        await streamOpenAIToAnthropic(wrapped, reply, clientModel, cfg.upstreamBaseUrl);
        recordUsage(usage.input, usage.output, usage.cached);
        logFull('OUT response (streamed)', { model: clientModel, text: outText, tool_calls: outTools.filter(Boolean), usage });
        log('<- ' + clientModel + ' ok  in=' + usage.input + ' out=' + usage.output + ' total=' + (usage.input + usage.output) + '  | ' + usageSummary());
      } else {
        const response = await openai.chat.completions.create({ ...openaiRequest, stream: false });
        const anthropicResponse = convertResponseToAnthropic(response, clientModel);
        reply.send(anthropicResponse);
        logFull('OUT response (anthropic)', anthropicResponse);
        const u = anthropicResponse.usage || {};
        recordUsage(u.input_tokens || 0, u.output_tokens || 0, u.cache_read_input_tokens || 0);
        log('<- ' + clientModel + ' ok  in=' + (u.input_tokens || 0) + ' out=' + (u.output_tokens || 0) + ' total=' + ((u.input_tokens || 0) + (u.output_tokens || 0)) + '  | ' + usageSummary());
      }
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      const rawStatus = caught && typeof caught === 'object' && 'status' in caught ? caught.status : undefined;
      const statusCode = typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
      log('<- upstream error ' + statusCode + ' ' + String(error.message).slice(0, 400));
      const err = createErrorResponse(error, statusCode);
      reply.code(err.status).send({ error: err.error });
    }
  });

  return {
    start: async () => {
      await app.listen({ port: cfg.port, host: '127.0.0.1' });
      log('anthropic-gateway listening on http://127.0.0.1:' + cfg.port + ' (upstream ' + cfg.upstreamModel + ')');
      return cfg.port;
    },
    stop: async () => {
      try { await app.close(); } catch {}
      if (logStream) logStream.end();
    },
  };
}

module.exports = { makeServer, DEFAULTS };
