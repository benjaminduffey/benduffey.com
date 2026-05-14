/**
 * benduffey.com — Cloudflare Worker
 *
 * Routes:
 *   POST /api/chat  → proxy to Google AI Generative Language API (Gemini 2.5 Flash, streaming)
 *   *               → fall through to static assets (the SPA shell + js/css/assets)
 *
 * Secret required:
 *   GOOGLE_AI_API_KEY — set via `wrangler secret put GOOGLE_AI_API_KEY`
 */

const MODEL = 'gemini-2.5-flash';
const GOOGLE_HOST = 'https://generativelanguage.googleapis.com';

// System prompt — Gemini knows about Ben + NICE so visitors can ask about either,
// but answers any general question naturally without forcing the bio in.
const SYSTEM_PROMPT = `You are an AI assistant on benduffey.com, the personal site of Ben Duffey, the founder and Chief Engineer of NICE SPACESHIP.

Your job is to be a helpful, accurate, concise AI assistant — answer any question naturally. You're powered by Google Gemini 2.5 Flash.

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

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      return handleChat(request, env);
    }

    if (url.pathname === '/api/chat') {
      return new Response('Method not allowed', { status: 405 });
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleChat(request, env) {
  if (!env.GOOGLE_AI_API_KEY) {
    return jsonError(503, 'GOOGLE_AI_API_KEY not configured. Set via `wrangler secret put GOOGLE_AI_API_KEY`.');
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
