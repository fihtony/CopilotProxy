import axios from "axios";
import type { Readable } from "stream";

/**
 * Returns the upstream request timeout in milliseconds.
 * Read from process.env at call-time so tests can override it without module reload.
 * Default: 300 000 ms (5 minutes). Each received data chunk resets the Node.js socket
 * idle timer, so long but active streaming responses are not affected.
 */
export function getProxyTimeoutMs(): number {
  const fromEnv = Number(process.env.PROXY_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 300_000;
}

// Forwards to the provided baseURL (real Copilot Connect :1288 in bridge or echo mode).
// The proxy itself has no knowledge of whether the upstream is real or mocked.
export async function proxyRequest(baseURL: string, path: string, body: Record<string, unknown> | undefined, modelOverride: string) {
  const payload = body ? { ...body, model: modelOverride } : undefined;
  const response = await axios.request({
    baseURL,
    url: path,
    method: path === "/v1/models" ? "GET" : "POST",
    data: payload,
    headers: { "Content-Type": "application/json" },
    maxRedirects: 0,
    validateStatus: () => true,
    timeout: getProxyTimeoutMs(),
  });
  return { status: response.status, data: response.data };
}

/**
 * Streaming variant — returns an SSE-compatible Node.js Readable instead of buffering.
 * Automatically injects stream_options.include_usage so the upstream includes token
 * counts in the final chunk, enabling stats recording without buffering.
 */
export async function proxyRequestStreaming(
  baseURL: string,
  path: string,
  body: Record<string, unknown>,
  modelOverride: string,
): Promise<{ status: number; stream: Readable }> {
  const payload = {
    ...body,
    model: modelOverride,
    // Ask the upstream to emit a final chunk with usage stats so we can record tokens.
    stream_options: { include_usage: true },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await axios.request<any>({
    baseURL,
    url: path,
    method: "POST",
    data: payload,
    headers: { "Content-Type": "application/json" },
    maxRedirects: 0,
    responseType: "stream",
    validateStatus: () => true,
    timeout: getProxyTimeoutMs(),
  });
  return { status: response.status as number, stream: response.data as Readable };
}
