/**
 * benduffey.com — Cloudflare Worker
 *
 * Routes:
 *   POST /api/chat  → proxy to Google AI Generative Language API (Gemini 2.5 Flash, streaming)
 *   *               → fall through to static assets (the SPA shell + js/css/assets)
 *
 * Secret required:
 *   GOOGLE_AI_API_KEY — set via `wrangler secret put GOOGLE_AI_API_KEY`
 *
 * Bindings (see wrangler.jsonc):
 *   CHAT_RATE_LIMITER — Cloudflare native per-IP rate limiter for /api/chat
 *   RATE_LIMIT_KV     — KV namespace backing the daily global request cap
 */

const MODEL = 'gemini-2.5-flash';
const GOOGLE_HOST = 'https://generativelanguage.googleapis.com';

// Daily global cap on /api/chat — a backstop against distributed abuse of the
// shared Gemini key. Real-time per-IP throttling is handled by CHAT_RATE_LIMITER.
const DAILY_REQUEST_CAP = 1000;

// System prompt — Gemini knows about Ben + NICE so visitors can ask about either,
// but answers any general question naturally without forcing the bio in.
const SYSTEM_PROMPT = `You are the ship's computer for benduffey.com — visitors address you as "Computer," in the Star Trek tradition. If asked your name, you are simply "Computer." benduffey.com is the personal site of Ben Duffey, the founder and Chief Engineer of NICE SPACESHIP.

Your job is to be a helpful, accurate, concise AI assistant — answer any question naturally. You're powered by Google Gemini 2.5 Flash. Don't be theatrical about the Star Trek framing; it's just your name, not a personality to perform.

When visitors ask about Ben, NICE, his work, or how to reach him, use the context below. Don't volunteer this info unless it's relevant to the conversation.

About Ben Duffey:
- Solo technical founder and Chief Engineer of NICE SPACESHIP
- Built NICE end-to-end as a one-person team
- Stack: vanilla JS SPA frontend (no build step), Postgres with row-level security, 15+ Supabase edge functions, Cloudflare edge, Stripe billing pipeline, OAuth flows, MCP gateway
- Specialties: agentic AI workflows, multi-LLM integration, system architecture, design systems, founder-grade execution
- Based in Las Vegas, NV
- Open to: technical-founder collaborations, agentic AI conversations, contract engineering work

About NICE SPACESHIP (NICE = Neural Intelligence Command Engine):
- Product: nicespaceship.ai (the app — launch a fleet of AI agents without touching an API key)
- Company: nicespaceship.com (marketing site)
- GitHub: github.com/nicespaceship/nice (open source, MIT license)
- Free tier: Gemini 2.5 Flash, unlimited
- Premium tiers: Claude (Anthropic), GPT (OpenAI), Grok (xAI), Llama (Meta via Groq)
- 500+ pre-built agent and spaceship blueprints
- Native MCP integrations with major SaaS tools (Google, Microsoft 365, HubSpot, GitHub, Slack, Linear, Notion, Stripe, Atlassian, and more)

Contact:
- Email: ben@nicespaceship.com

Style: direct, knowledgeable, concise. No fluff. Use markdown for formatting. Mention links naturally where useful (e.g., "you can try NICE at nicespaceship.ai"). If asked something about Ben you don't know, say so honestly.`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleChat(request, env, ctx);
    }

    // Static assets. wrangler.jsonc sets not_found_handling: "none", so a
    // missing file 404s cleanly instead of silently returning the app shell
    // with a 200. Unknown routes *without* a file extension still fall back
    // to index.html so a mistyped or bookmarked path still shows the app.
    const assetRes = await env.ASSETS.fetch(request);
    if (assetRes.status === 404 && !url.pathname.slice(1).includes('.')) {
      return env.ASSETS.fetch(new Request(new URL('/', url), request));
    }
    return assetRes;
  },
};

async function handleChat(request, env, ctx) {
  if (!env.GOOGLE_AI_API_KEY) {
    return jsonError(503, 'GOOGLE_AI_API_KEY not configured. Set via `wrangler secret put GOOGLE_AI_API_KEY`.');
  }

  // Per-IP rate limit — Cloudflare's native limiter. Stops a single client
  // from hammering the shared Gemini key; a real conversation never gets close.
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success: withinIPLimit } = await env.CHAT_RATE_LIMITER.limit({ key: clientIP });
  if (!withinIPLimit) {
    return jsonError(429, 'Too many requests — slow down and try again in a minute.');
  }

  // Daily global cap — a KV counter keyed by UTC date. KV has no atomic
  // increment, so the count can lag slightly under concurrency; that's fine
  // for a soft ceiling. Reads fail open so a transient KV blip never takes
  // the chat down — the per-IP limiter above is the real-time guard.
  const dayKey = `daily:${new Date().toISOString().slice(0, 10)}`;
  let dailyCount = 0;
  try {
    dailyCount = parseInt(await env.RATE_LIMIT_KV.get(dayKey), 10) || 0;
  } catch {
    dailyCount = 0;
  }
  if (dailyCount >= DAILY_REQUEST_CAP) {
    return jsonError(429, "The site has hit today's request limit. Please try again tomorrow.");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return jsonError(400, 'Body must include { messages: [{role, content}, ...] }');
  }

  // Cap conversation length to prevent runaway token cost / abuse.
  const MAX_TURNS = 40;
  const trimmed = messages.slice(-MAX_TURNS);

  // Convert OpenAI-style {role, content} array → Gemini contents array.
  const contents = trimmed
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  if (contents.length === 0) {
    return jsonError(400, 'No valid user/assistant messages found');
  }

  // Valid request — count it against the daily cap. The write-back is
  // non-blocking so it never adds latency to the response.
  ctx.waitUntil(
    env.RATE_LIMIT_KV.put(dayKey, String(dailyCount + 1), { expirationTtl: 172800 }).catch(() => {}),
  );

  const upstream = `${GOOGLE_HOST}/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${env.GOOGLE_AI_API_KEY}`;

  const upstreamRes = await fetch(upstream, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    }),
  });

  if (!upstreamRes.ok) {
    const errText = await upstreamRes.text().catch(() => '');
    return jsonError(upstreamRes.status, `Upstream error: ${errText.slice(0, 500) || upstreamRes.statusText}`);
  }

  // Re-emit upstream SSE as plain text/event-stream chunks.
  // The client reads `text` deltas off each `data: {...}` line.
  return new Response(upstreamRes.body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
