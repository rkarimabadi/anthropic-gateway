# anthropic-gateway

A local gateway that speaks the **Anthropic Messages API** and forwards every
request to **any OpenAI-compatible provider** (kilo, OpenAI, DeepSeek, Groq,
local servers, ...). It forces every request to a single configured upstream
model, which makes it work with clients that can only talk to Anthropic —
including the **Claude Code GUI (desktop app)** via its custom gateway
(3P / enterprise) mode, Claude Code CLI, or any Anthropic-SDK tool.

```
Claude Code GUI/CLI  ──(Anthropic format)──▶  anthropic-gateway (127.0.0.1:3080)
                                                    │  translate + force model
                                                    ▼
                                        OpenAI-compatible provider (/v1/chat/completions)
```

## Install

```bash
npm install                 # inside this folder, once
npm i -g .                  # optional: real global install (needs an admin shell
                            # if node lives under C:\Program Files)
```

Without admin rights a `C:\Users\<you>\bin\anthropic-gateway.cmd` wrapper is
used instead — both give you the `anthropic-gateway` command (alias: `ag`).
Open a **new** terminal after installing so PATH picks it up.

## Quick start

```bash
anthropic-gateway setup     # interactive wizard (or flags, see below)
anthropic-gateway start     # run the gateway using the default profile
```

Config, pid and log live in `~/.anthropic-gateway/` (`config.json`,
`gateway.pid`, `gateway.log`).

Then point your client at:

- Base URL: `http://127.0.0.1:3080` (or the port you configured)
- API key / `x-api-key` / `Authorization: Bearer`: the **proxy token** printed by `setup`

### Non-interactive setup

```bash
anthropic-gateway setup --provider kilo --api-key YOUR_KILO_KEY --model kilo-auto/free --yes
anthropic-gateway setup --base-url https://api.openai.com/v1 --api-key sk-... --model gpt-5 --port 3090 --token mytoken --yes
```

### Using multiple profiles

After setting up multiple profiles (e.g., one for kilo, one for OpenAI), you can:

- List all defined profiles: `anthropic-gateway profiles`
- Start a specific profile: `anthropic-gateway start openai`
- Set the default profile for future `start` commands: `anthropic-gateway select kilo`
- Then `anthropic-gateway start` will use the kilo profile without specifying it.

## Commands

| Command | Description |
| --- | --- |
| `anthropic-gateway setup` | Create/overwrite `~/.anthropic-gateway/config.json` with a profiles array; tests connectivity (`--full-logging` to enable full-body logging) |
| `anthropic-gateway start [profile]` | Start the gateway using the given profile name; if omitted, uses `defaultProfile` from config |
| `anthropic-gateway stop` | Stop the gateway |
| `anthropic-gateway status` | Pretty status: version, pid, upstream, uptime, request/token totals, full-logging state |
| `anthropic-gateway fulllogging on\|off` | Toggle full request/response logging (restart to apply) |
| `anthropic-gateway autostart on\|off` | Launch at Windows logon (Startup folder) |
| `anthropic-gateway select <profile>` | Set the default profile for future `start` commands |
| `anthropic-gateway profiles` | List all defined profiles in the config file |
| `anthropic-gateway version` | Print the version (also `--version` / `-v`) |

## config.json

See `config.example.json`. The config now contains a `profiles` array and a `defaultProfile`.
Each profile object includes: `providerName`, `upstreamBaseUrl`, `upstreamApiKey`,
`upstreamModel`, `port`, `proxyTokens` (accepts several), `advertisedModels`
(models shown to Claude Code model discovery — must look Anthropic-ish, e.g.
`claude-sonnet-4-5` or `sonnet`), `toolFormat`, `fullLogging`, `logFile`.
Only the profile named by `defaultProfile` (or the first profile if unspecified)
is used by `anthropic-gateway start` unless a profile name is given explicitly.

## Logging

`gateway.log` (in `~/.anthropic-gateway/`) records, per request, the tokens
sent/received and a running session total (input / output / total since the
gateway started).

To also capture the **full request and response bodies** (useful for debugging
upstream mismatches), enable full logging:

```bash
anthropic-gateway fulllogging on     # or: setup --full-logging
anthropic-gateway stop && anthropic-gateway start   # restart to apply
```

Full bodies are written to the log file only (not the console), so streaming
stdout stays clean. Turn it off the same way with `fulllogging off`.

`status` shows the same token totals plus version, pid, uptime and the
full-logging state:

```
Status                 UP
Version                1.2.0
PID                    23628
Listen                 127.0.0.1:3080
Upstream model         Qwen/Qwen3.8-27B
...
Requests               42
Tokens (in/out/total)  118300 / 9210 / 127510
```

## Using it with Claude Code GUI (desktop app)

1. Keep the gateway running (`anthropic-gateway start`, or `autostart on`).
2. In Claude desktop: Settings → custom provider / Claude Code Setup →
   base URL `http://127.0.0.1:<port>`, API key = your proxy token.
3. Run its connection test, restart Claude, open Claude Code — the model
   selector lists the `advertisedModels`, and every chat is served by your
   upstream model.
# anthropic-gateway
