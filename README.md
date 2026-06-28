<p align="center">
  <img src="https://github.com/drvova/pi-mcp-deferred/raw/master/pi-logo-animated.svg" alt="pi-windsurf" width="200">
</p>

<h1 align="center">pi-windsurf</h1>

<p align="center">Use Windsurf/Cognition models in <a href="https://github.com/earendil-works/pi">Pi</a> — Claude, GPT, Gemini, Kimi, DeepSeek, SWE, and more. All via your existing Windsurf subscription. No separate API keys.</p>

## How it works

Runs a local proxy at `127.0.0.1:42100` that speaks standard OpenAI Chat Completions API. Translates requests to Windsurf's proprietary Connect-RPC wire format. Pi talks to the proxy via `api: "openai-completions"` — no custom streaming code needed.

**No Windsurf IDE needed.** Cloud-direct mode talks straight to Cognition's servers over HTTPS. No Windsurf installation, no background processes. The local proxy adds negligible overhead — ~15MB memory, sub-millisecond latency.

```
Pi → proxy (localhost:42100) → Cognition Cloud
```

## Install

**Option A — Git (recommended):**

```bash
pi install git:github.com/drvova/pi-windsurf
```

**Option B — npm:**

```bash
pi install npm:pi-windsurf
```

**Option C — Local dev:**

```bash
git clone https://github.com/drvova/pi-windsurf.git ~/developer/pi-windsurf
pi -e ~/developer/pi-windsurf/index.ts
```

## Setup

### 1. Sign in

```
/login windsurf
```

Browser opens to windsurf.com. Sign in with your Windsurf account. Token captured automatically.

### 2. Pick a model

```
/model windsurf/<model-id>
```

Models shown are whatever your Windsurf plan enables. The extension fetches the live catalog from Cognition at startup — new models appear automatically.

### 3. Chat

Use Pi as normal. Your Windsurf subscription covers API costs.

## Commands

| Command | Does |
|---------|------|
| `/login windsurf` | Sign in (browser-based OAuth) |
| `/windsurf-status` | Show auth state |
| `/windsurf-logout` | Sign out |
| `/windsurf-refresh` | Refresh model list from Cognition |

## How models work

On startup (and after `/login`), the extension fetches from three Cognition endpoints in parallel:

1. **`GetCliModelConfigs`** — same endpoint the Devin CLI uses. Returns model labels, UIDs, pricing, promos, context windows, and capabilities.
2. **`GetCliTeamSettings`** — returns the 96 model UIDs your plan allows. Models not in this list are filtered out.
3. **`GetCascadeModelConfigs`** — full metadata fallback with context windows, promo statuses, and descriptions.

### Dynamic tags

Model names include tags derived from live API data:

- **`[Free]`** — no pricing info (field 32 absent) = free on your plan
- **`[Promo]`** — active promotional pricing (from `promo_status` field)
- **`[New]`** — recently added model

Example: `GLM-5.2 High [Free Promo] (200K)`, `Kimi K2.6 [Free Promo] (262K)`

### Zero hardcoding

- No hardcoded model lists — catalog is fetched live from Cognition
- No hardcoded context windows — from API field 18 only
- No hardcoded model fallbacks — empty array when catalog unavailable
- New models appear automatically on next restart

## What models?

Depends on your Windsurf plan. Typically includes:

- **Claude** — Opus 4.8/4.7/4.6, Sonnet 4.6/4.5, Haiku 4.5
- **GPT** — 5.5, 5.4, 5.3, 5.2, Codex variants
- **Gemini** — 3.5 Flash, 3.1 Pro
- **GLM** — 5.2 (High/Max/No Thinking), 5.1, 4.7-Flash
- **Kimi** — K2.6, K2.7
- **SWE** — 1.6, 1.5
- **DeepSeek** — V4
- And more — BYOK models, enterprise deployments, experimental releases

## Endpoints

All traffic goes to `server.self-serve.windsurf.com`:

| Endpoint | Purpose |
|----------|---------|
| `GetUserJwt` | Mint JWT from API key |
| `GetChatMessage` | Streaming chat completions |
| `GetCliModelConfigs` | Live model catalog (same as Devin CLI) |
| `GetCliTeamSettings` | Allowed model UIDs per plan |
| `GetCascadeModelConfigs` | Full model metadata with promos |

## Files

```
index.ts       Pi extension entry (provider registration + model building)
proxy.ts       HTTP server (OpenAI API → gRPC translation)
chat.ts        Connect-RPC streaming (proto encode/decode)
catalog.ts     Live model catalog from three Cognition endpoints
models.ts      Minimal pass-through (catalog is single source of truth)
auth.ts        JWT minting via GetUserJwt
metadata.ts    Proto metadata builder
wire.ts        Proto wire format helpers
oauth.ts       Login loopback + RegisterUser
```

## Requirements

- Pi (any recent version)
- Node.js >= 18 or Bun
- Windsurf account (free or paid)

No npm dependencies. Uses only Node built-ins and Pi's own types.

## License

MIT
