import axios from "axios";
import { config } from "../config.js";

// Always forwards to config.copilotUrl (real Copilot Connect :1288 or mock :1289).
// The proxy itself has no knowledge of whether the upstream is real or mocked.
export async function proxyRequest(path: string, body: Record<string, unknown> | undefined, modelOverride: string) {
  const payload = body ? { ...body, model: modelOverride } : undefined;
  const response = await axios.request({
    baseURL: config.copilotUrl,
    url: path,
    method: path === "/v1/models" ? "GET" : "POST",
    data: payload,
    headers: {
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });

  return {
    status: response.status,
    data: response.data,
  };
}
