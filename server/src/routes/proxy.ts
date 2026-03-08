import { Router, type Request, type Response } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { proxyRequest, proxyRequestStreaming } from "../services/proxyService.js";
import { recordRequest } from "../services/statsService.js";
import { getCachedSettings } from "../services/settingsService.js";

const router = Router();

/** Extract client IP and Host from a request (reused in both handlers). */
function extractClientInfo(req: Request) {
  const clientIp =
    (typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"].split(",")[0].trim() : null) ??
    req.socket.remoteAddress ??
    null;
  const clientHost = (req.headers["host"] as string | undefined) ?? null;
  return { clientIp, clientHost };
}

/**
 * Scan the tail bytes of an SSE response for a final chunk that carries usage stats.
 * OpenAI emits this when stream_options.include_usage is true.
 */
function parseUsageFromTail(tail: string): { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null {
  const lines = tail.split("\n").reverse();
  for (const line of lines) {
    if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
    try {
      const chunk = JSON.parse(line.slice(6)) as {
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      if (chunk.usage?.total_tokens != null) return chunk.usage;
    } catch {
      /* skip malformed lines */
    }
  }
  return null;
}

/** Handle requests with stream:true — pipes upstream SSE directly to the client. */
async function handleStreamingProxy(req: Request, res: Response, path: string) {
  const startedAt = Date.now();
  const requestedModel = typeof req.body?.model === "string" ? req.body.model : null;
  const modelUsed = req.apiKey?.model ?? "gpt-5-mini";
  const copilotUrl = getCachedSettings().copilot_url;
  const { clientIp, clientHost } = extractClientInfo(req);

  let upstream: Awaited<ReturnType<typeof proxyRequestStreaming>>;
  try {
    upstream = await proxyRequestStreaming(copilotUrl, path, req.body as Record<string, unknown>, modelUsed);
  } catch (error) {
    const totalElapsed = Date.now() - startedAt;
    recordRequest({
      apiKeyId: req.apiKey!.id,
      method: req.method,
      path,
      statusCode: 502,
      success: 0,
      responseTimeMs: totalElapsed,
      proxyTimeMs: totalElapsed,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      modelRequested: requestedModel,
      modelUsed,
      errorMessage: error instanceof Error ? error.message : "Upstream connection failed",
      ipAddress: clientIp,
      host: clientHost,
    });
    return res.status(502).json({ error: { message: "Upstream connection failed" } });
  }

  // Non-200 upstream errors are JSON, not SSE — forward them as-is.
  if (upstream.status !== 200) {
    let errorBody = "";
    upstream.stream.on("data", (chunk: Buffer) => (errorBody += chunk.toString("utf8")));
    upstream.stream.on("end", () => {
      const totalElapsed = Date.now() - startedAt;
      recordRequest({
        apiKeyId: req.apiKey!.id,
        method: req.method,
        path,
        statusCode: upstream.status,
        success: 0,
        responseTimeMs: totalElapsed,
        proxyTimeMs: 0,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        modelRequested: requestedModel,
        modelUsed,
        errorMessage: errorBody,
        ipAddress: clientIp,
        host: clientHost,
      });
      try {
        res.status(upstream.status).json(JSON.parse(errorBody));
      } catch {
        res.status(upstream.status).send(errorBody);
      }
    });
    return;
  }

  // ----- SSE pass-through -----
  const preUpstreamMs = Date.now() - startedAt; // our overhead before the upstream responded
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // tell nginx not to buffer

  // Keep a rolling tail to find the usage chunk (last ~2 KB is plenty).
  let tailBuffer = "";

  upstream.stream.on("data", (chunk: Buffer) => {
    res.write(chunk);
    tailBuffer = (tailBuffer + chunk.toString("utf8")).slice(-2048);
  });

  upstream.stream.on("end", () => {
    res.end();
    const totalElapsed = Date.now() - startedAt;
    const usage = parseUsageFromTail(tailBuffer);
    recordRequest({
      apiKeyId: req.apiKey!.id,
      method: req.method,
      path,
      statusCode: 200,
      success: 1,
      responseTimeMs: totalElapsed,
      proxyTimeMs: preUpstreamMs,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      modelRequested: requestedModel,
      modelUsed,
      errorMessage: null,
      ipAddress: clientIp,
      host: clientHost,
    });
  });

  upstream.stream.on("error", (err: Error) => {
    res.end();
    const totalElapsed = Date.now() - startedAt;
    recordRequest({
      apiKeyId: req.apiKey!.id,
      method: req.method,
      path,
      statusCode: 502,
      success: 0,
      responseTimeMs: totalElapsed,
      proxyTimeMs: preUpstreamMs,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      modelRequested: requestedModel,
      modelUsed,
      errorMessage: err.message,
      ipAddress: clientIp,
      host: clientHost,
    });
  });

  // Clean up the upstream stream if the client disconnects early.
  res.on("close", () => upstream.stream.destroy());
}

async function handleProxy(req: Request, res: Response, path: string) {
  // Route streaming requests to the dedicated SSE handler.
  if (req.method !== "GET" && req.body?.stream === true) {
    return handleStreamingProxy(req, res, path);
  }

  const startedAt = Date.now();
  const requestedModel = typeof req.body?.model === "string" ? req.body.model : null;
  const modelUsed = req.apiKey?.model ?? "gpt-5-mini";
  const copilotUrl = getCachedSettings().copilot_url;
  const { clientIp, clientHost } = extractClientInfo(req);

  try {
    const upstreamStart = Date.now();
    const upstream = await proxyRequest(copilotUrl, path, req.method === "GET" ? undefined : req.body, modelUsed);
    const upstreamElapsed = Date.now() - upstreamStart;
    const totalElapsed = Date.now() - startedAt;
    const proxyTimeMs = Math.max(0, totalElapsed - upstreamElapsed);

    const usage =
      typeof upstream.data === "object" && upstream.data && "usage" in upstream.data
        ? (upstream.data as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage
        : undefined;

    recordRequest({
      apiKeyId: req.apiKey!.id,
      method: req.method,
      path,
      statusCode: upstream.status,
      success: upstream.status >= 200 && upstream.status < 400 ? 1 : 0,
      responseTimeMs: totalElapsed,
      proxyTimeMs,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      modelRequested: requestedModel,
      modelUsed,
      errorMessage: upstream.status >= 400 ? JSON.stringify(upstream.data) : null,
      ipAddress: clientIp,
      host: clientHost,
    });

    return res.status(upstream.status).json(upstream.data);
  } catch (error) {
    const totalElapsed = Date.now() - startedAt;
    recordRequest({
      apiKeyId: req.apiKey!.id,
      method: req.method,
      path,
      statusCode: 502,
      success: 0,
      responseTimeMs: totalElapsed,
      proxyTimeMs: totalElapsed,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      modelRequested: requestedModel,
      modelUsed,
      errorMessage: error instanceof Error ? error.message : "Unknown proxy error",
      ipAddress: clientIp,
      host: clientHost,
    });

    return res.status(502).json({ error: { message: "Upstream request failed" } });
  }
}

router.use(apiKeyAuth);
router.get("/models", (req, res) => handleProxy(req, res, "/v1/models"));
router.post("/chat/completions", (req, res) => handleProxy(req, res, "/v1/chat/completions"));
router.post("/completions", (req, res) => handleProxy(req, res, "/v1/completions"));

export default router;
