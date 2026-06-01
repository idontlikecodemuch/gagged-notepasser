# GAGGED Notepasser

Minimal Cloudflare Worker for GAGGED AI generation.

The app owns prompt construction, provider payload construction, response validation, deck creation, and credit burn rules. This Worker only keeps provider API keys off the phone and forwards allowed requests to the configured AI provider.

Production Worker:

```text
https://gagged-notepasser.square-thunder-8ed0.workers.dev
```

## Privacy Posture

This Worker:

- does not store prompts
- does not store responses
- does not store generated decks
- does not rewrite prompts
- does not validate model output content
- does not use a database
- does not intentionally log request or response bodies
- does not emit application logs

Cloudflare and the upstream AI provider still process requests in transit. Cloudflare may also provide platform-level service metrics. Do not claim that no third party sees prompts.

## Routes

```text
GET  /health
GET  /
POST /build
```

Provider selection is intentionally not in the URL. The app chooses the lane with the `x-gagged-lane` header:

```text
x-gagged-lane: standard
x-gagged-lane: edge
```

`standard` routes to Gemini. `edge` routes to xAI.

## Cloudflare Secrets / Variables

Required:

```text
GEMINI_API_KEY
XAI_API_KEY
GEMINI_URL
XAI_URL
```

Suggested values:

```text
GEMINI_URL=https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent
XAI_URL=https://api.x.ai/v1/chat/completions
```

Set them with Wrangler:

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put XAI_API_KEY
npx wrangler secret put GEMINI_URL
npx wrangler secret put XAI_URL
```

Or add them in the Cloudflare dashboard:

```text
Workers & Pages -> gagged-notepasser -> Settings -> Variables and Secrets
```

## Local Development

Create a local `.dev.vars` file only on your machine:

```text
GEMINI_API_KEY=...
XAI_API_KEY=...
GEMINI_URL=...
XAI_URL=...
```

Then run:

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run deploy
```

Cloudflare Git integration can deploy this repo directly. The build command can stay as Cloudflare's default:

```bash
npx wrangler deploy
```

## App Contract

The iPhone app sends a provider-compatible JSON body to `/build`. The Worker forwards that body unchanged and injects the correct provider auth header.

Standard lane:

```text
POST /build
x-gagged-lane: standard
```

Adds:

```text
x-goog-api-key: GEMINI_API_KEY
```

Edge lane:

```text
POST /build
x-gagged-lane: edge
```

Adds:

```text
authorization: Bearer XAI_API_KEY
```

The Worker rejects non-JSON requests and bodies larger than 20 KB.

## Future Hardening

Before broad TestFlight or App Store launch, add Apple App Attest:

- challenge route
- attestation registration
- signed request assertions
- per-install rate/credit enforcement

Until then, use Cloudflare WAF/rate limits and provider spend caps.
