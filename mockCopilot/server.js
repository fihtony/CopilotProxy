import express from "express";
import { randomUUID } from "crypto";

const app = express();
const PORT = Number(process.env.PORT ?? 1289);

app.use(express.json({ limit: "10mb" }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

const AVAILABLE_MODELS = [
  { id: "gpt-5-mini", object: "model", created: 1700000000, owned_by: "microsoft" },
  { id: "gpt-4o", object: "model", created: 1700000000, owned_by: "microsoft" },
  { id: "gpt-4o-mini", object: "model", created: 1700000000, owned_by: "microsoft" },
  { id: "claude-3.5-sonnet", object: "model", created: 1700000000, owned_by: "anthropic" },
];

// Approximate BPE token count: ~4 chars per token (good enough for testing).
function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text ?? "").length / 4));
}

// GET /v1/models
app.get("/v1/models", (_req, res) => {
  res.json({ object: "list", data: AVAILABLE_MODELS });
});

// POST /v1/chat/completions
app.post("/v1/chat/completions", (req, res) => {
  const { model = "gpt-5-mini", messages = [], stream = false, stream_options } = req.body;
  const includeUsage = stream && stream_options?.include_usage === true;

  const completionId = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  // Build a simple deterministic response so tests can assert on content.
  const lastMessage = Array.isArray(messages) && messages.length > 0 ? messages[messages.length - 1] : null;
  const responseContent = lastMessage
    ? `[Mock/${model}] Echo: ${String(lastMessage.content ?? "").slice(0, 120)}`
    : `[Mock/${model}] Hello from Mock Copilot Connect.`;

  const promptTokens = Array.isArray(messages) ? messages.reduce((sum, m) => sum + estimateTokens(m.content), 0) : 0;
  const completionTokens = estimateTokens(responseContent);

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const base = { id: completionId, object: "chat.completion.chunk", created, model, system_fingerprint: "fp_mock01" };

    // First chunk: role announcement
    const roleChunk = {
      ...base,
      choices: [{ index: 0, delta: { role: "assistant", content: "" }, logprobs: null, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);

    // Content chunk
    const contentChunk = {
      ...base,
      choices: [{ index: 0, delta: { content: responseContent }, logprobs: null, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(contentChunk)}\n\n`);

    // Stop chunk
    const stopChunk = {
      ...base,
      choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: "stop" }],
    };
    res.write(`data: ${JSON.stringify(stopChunk)}\n\n`);

    // Usage chunk (only when stream_options.include_usage is requested)
    if (includeUsage) {
      const usageChunk = {
        ...base,
        choices: [],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };
      res.write(`data: ${JSON.stringify(usageChunk)}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    return res.end();
  }

  // Non-streaming — matches real Copilot Connect response shape exactly.
  res.json({
    id: completionId,
    object: "chat.completion",
    created,
    model,
    system_fingerprint: "fp_mock01",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: responseContent },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
      completion_tokens_details: {
        reasoning_tokens: 0,
        audio_tokens: 0,
        accepted_prediction_tokens: 0,
        rejected_prediction_tokens: 0,
      },
    },
  });
});

// POST /v1/completions (legacy text completion)
app.post("/v1/completions", (req, res) => {
  const { model = "gpt-5-mini", prompt = "" } = req.body;
  const text = `[Mock/${model}] Completion: ${String(prompt).slice(0, 120)}`;
  const promptTokens = estimateTokens(prompt);
  const completionTokens = estimateTokens(text);

  res.json({
    id: `cmpl-${randomUUID()}`,
    object: "text_completion",
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: "fp_mock01",
    choices: [{ text, index: 0, logprobs: null, finish_reason: "stop" }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  });
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "mock-copilot-connect", port: PORT });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[MockCopilotConnect] running on http://localhost:${PORT}`);
  console.log("  Port 1289 = mock (dev/test) | Port 1288 = real Copilot Connect (production)");
  console.log("Endpoints: GET /health  GET /v1/models  POST /v1/chat/completions  POST /v1/completions");
});
