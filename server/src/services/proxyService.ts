import axios from "axios";
import type { Readable } from "stream";

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
    validateStatus: () => true,
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
    responseType: "stream",
    validateStatus: () => true,
  });
  return { status: response.status as number, stream: response.data as Readable };
}
