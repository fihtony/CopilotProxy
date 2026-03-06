import { Router, type Request, type Response } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { proxyRequest } from "../services/proxyService.js";
import { recordRequest } from "../services/statsService.js";

const router = Router();

async function handleProxy(req: Request, res: Response, path: string) {
  const startedAt = Date.now();
  const requestedModel = typeof req.body?.model === "string" ? req.body.model : null;
  const modelUsed = req.apiKey?.model ?? "gpt-5-mini";

  try {
    const upstream = await proxyRequest(path, req.method === "GET" ? undefined : req.body, modelUsed);
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
      responseTimeMs: Date.now() - startedAt,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      modelRequested: requestedModel,
      modelUsed,
      errorMessage: upstream.status >= 400 ? JSON.stringify(upstream.data) : null,
    });

    return res.status(upstream.status).json(upstream.data);
  } catch (error) {
    recordRequest({
      apiKeyId: req.apiKey!.id,
      method: req.method,
      path,
      statusCode: 502,
      success: 0,
      responseTimeMs: Date.now() - startedAt,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      modelRequested: requestedModel,
      modelUsed,
      errorMessage: error instanceof Error ? error.message : "Unknown proxy error",
    });

    return res.status(502).json({ error: { message: "Upstream request failed" } });
  }
}

router.use(apiKeyAuth);
router.get("/models", (req, res) => handleProxy(req, res, "/v1/models"));
router.post("/chat/completions", (req, res) => handleProxy(req, res, "/v1/chat/completions"));
router.post("/completions", (req, res) => handleProxy(req, res, "/v1/completions"));

export default router;
