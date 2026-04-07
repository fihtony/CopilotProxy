/// <reference types="node" />

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ADMIN_API_BASE_URL = process.env.ADMIN_API_BASE_URL ?? "http://localhost:8020/api/admin";
const CLIENT_API_BASE_URL = process.env.CLIENT_API_BASE_URL ?? "http://localhost:8022/api/v1";
const COPILOT_CONNECT_BASE_URL = process.env.COPILOT_CONNECT_BASE_URL ?? process.env.COPILOT_URL ?? "http://127.0.0.1:1288";
const TARGET_AI_MODEL = process.env.CLIENT_API_TEST_MODEL ?? "gpt-5-mini";
const REQUESTED_MODEL_SENT_BY_CLIENT = process.env.CLIENT_API_REQUESTED_MODEL ?? "gpt-4.1";
const PRESET_API_KEY = process.env.CLIENT_API_TEST_API_KEY ?? "";
const TEST_API_KEY_NAME = process.env.CLIENT_API_TEST_API_KEY_NAME ?? "Real Client API Test Key";
const REQUEST_TIMEOUT_MS = Number(process.env.CLIENT_API_TEST_TIMEOUT_MS ?? 900_000);
const REPORT_OUTPUT_DIR = process.env.CLIENT_API_TEST_REPORT_DIR ?? path.resolve(process.cwd(), "..", "test-results");
const LONG_MESSAGE_LENGTHS = [10_000, 20_000, 50_000, 100_000, 120_000, 150_000, 200_000] as const;
const PARALLEL_REQUEST_COUNTS = [2, 4] as const;

const REPORT_MARKDOWN_PATH = path.join(REPORT_OUTPUT_DIR, "client-api-live-report.md");
const REPORT_JSON_PATH = path.join(REPORT_OUTPUT_DIR, "client-api-live-report.json");
const TRAFFIC_JSON_PATH = path.join(REPORT_OUTPUT_DIR, "client-api-live-traffic.json");

type SettingsResponse = {
  copilot_url: string;
  default_model: string;
};

type HealthResponse = {
  ok: boolean;
  status?: string;
  launch_time?: string;
};

type CopilotModeResponse = {
  mode: string;
};

type ApiKeyCreateResponse = {
  item: {
    id: number;
    model: string;
  };
  rawKey: string;
};

type ChatCompletionResponse = {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      role?: string;
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: unknown;
};

type RawHttpResponse = {
  status: number;
  headers: Record<string, string>;
  rawText: string;
};

type RequestLogEntry = {
  requestId: string;
  caseName: string;
  requestName: string;
  requestUrl: string;
  upstreamRequestUrl: string;
  apiKey: string;
  requestedModel: string;
  modelUsed: string;
  startedAt: string;
  finishedAt: string;
  responseTimeMs: number;
  promptLength: number;
  responseStatus: number | null;
  responseHeaders: Record<string, string>;
  totalTokens: number | null;
  clientRequestBody: string;
  forwardedRequestBody: string;
  rawResponseBody: string;
  assistantMessage: string;
  assistantPreview: string;
  outputLength: number;
  success: boolean;
  error?: string;
};

type CaseResult = {
  caseName: string;
  category: string;
  status: "passed" | "failed";
  startedAt: string;
  finishedAt: string;
  caseElapsedMs: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
  avgRequestTimeMs: number;
  maxRequestTimeMs: number;
  messageLength?: number;
  parallelRequests?: number;
  notes: string[];
  requestIds: string[];
};

type RunSummary = {
  generatedAt: string;
  startedAt: string;
  finishedAt: string;
  totalRunTimeMs: number;
  bridgeModeConfirmed: boolean;
  proxyUpstreamConfigured: string;
  adminApiBaseUrl: string;
  clientApiBaseUrl: string;
  copilotConnectBaseUrl: string;
  targetModel: string;
  requestedModelSentByClient: string;
  apiKeySource: string;
  apiKeyUsed: string;
  createdApiKeyId: number | null;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTimeMs: number;
  maxResponseTimeMs: number;
  minResponseTimeMs: number;
  caseResults: CaseResult[];
  artifacts: {
    reportMarkdown: string;
    reportJson: string;
    trafficJson: string;
  };
  fatalError?: string;
};

const caseResults: CaseResult[] = [];
const requestLogs: RequestLogEntry[] = [];

let requestCounter = 0;
let clientApiKey = PRESET_API_KEY;
let createdApiKeyId: number | null = null;
let originalSettings: SettingsResponse | null = null;
let restoreCopilotUrl = false;
let bridgeModeConfirmed = false;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function headersToObject(headers: Headers): Record<string, string> {
  const values: Record<string, string> = {};
  headers.forEach((value, key) => {
    values[key] = value;
  });
  return values;
}

function safeParseJson<T>(value: string): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function truncate(value: string, maxLength = 160): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function escapeMarkdownCell(value: string | number | undefined): string {
  if (value == null || value === "") {
    return "-";
  }

  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function buildBasePrompt(): string {
  return [
    "You are testing a live OpenAI-compatible proxy backed by a real model.",
    "Explain in 2 short bullet points what the proxy is expected to do for external clients.",
    "Mention authentication and model binding.",
  ].join("\n");
}

function buildShortPrompt(): string {
  return [
    "Analyze this short operational note and respond in 3 sentences.",
    "Operational note: The queue backlog grew 12 percent in the last 15 minutes, but error rate remained below 0.2 percent and p95 latency stayed under 800 ms.",
    "Include one risk and one immediate follow-up action.",
  ].join("\n");
}

function buildParallelPrompt(index: number, total: number): string {
  return [
    `This is parallel request ${index} of ${total}.`,
    "Provide a 2-sentence summary of why concurrency tests matter for an API gateway.",
    "Keep the answer concise and specific.",
  ].join("\n");
}

function buildLongPrompt(targetLength: number): string {
  const prefix = [
    `Real long-payload test. Declared payload length=${targetLength}.`,
    "Read the payload and respond with compact JSON containing keys summary, risk, and declared_length.",
    "Do not echo the full payload.",
    "Payload follows:",
  ].join("\n");
  const suffix = [
    "",
    "End of payload.",
    `Your JSON must include declared_length=${targetLength}.`,
  ].join("\n");
  const remainingLength = targetLength - prefix.length - suffix.length;

  if (remainingLength <= 0) {
    return `${prefix}${suffix}`.slice(0, targetLength);
  }

  const fillerChunk = " LONG_PAYLOAD_SEGMENT_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const filler = fillerChunk.repeat(Math.ceil(remainingLength / fillerChunk.length)).slice(0, remainingLength);
  return `${prefix}${filler}${suffix}`;
}

function createChatRequestBody(prompt: string, requestedModel = REQUESTED_MODEL_SENT_BY_CLIENT) {
  return {
    model: requestedModel,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  };
}

async function fetchRaw(url: string, init?: RequestInit): Promise<RawHttpResponse> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    return {
      status: response.status,
      headers: headersToObject(response.headers),
      rawText: await response.text(),
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T; headers: Record<string, string>; rawText: string }> {
  const response = await fetchRaw(url, init);
  const body = safeParseJson<T>(response.rawText);

  if (body == null) {
    throw new Error(`Expected JSON response from ${url}, got: ${truncate(response.rawText, 240)}`);
  }

  return {
    status: response.status,
    body,
    headers: response.headers,
    rawText: response.rawText,
  };
}

async function ensureServiceHealth(): Promise<void> {
  const adminHealthUrl = new URL("/health", ADMIN_API_BASE_URL).toString();
  const clientHealthUrl = new URL("/health", CLIENT_API_BASE_URL).toString();
  const copilotHealthUrl = new URL("/health", COPILOT_CONNECT_BASE_URL).toString();

  const [adminHealth, clientHealth, copilotHealth] = await Promise.all([
    fetchJson<HealthResponse>(adminHealthUrl),
    fetchJson<HealthResponse>(clientHealthUrl),
    fetchJson<HealthResponse>(copilotHealthUrl),
  ]);

  if (adminHealth.status !== 200 || adminHealth.body.ok !== true) {
    throw new Error(`Admin API health check failed at ${adminHealthUrl}`);
  }

  if (clientHealth.status !== 200 || clientHealth.body.ok !== true) {
    throw new Error(`Client API health check failed at ${clientHealthUrl}`);
  }

  if (copilotHealth.status !== 200 || (copilotHealth.body.ok !== true && copilotHealth.body.status !== "ok")) {
    throw new Error(`CopilotConnect health check failed at ${copilotHealthUrl}`);
  }
}

async function switchCopilotToBridgeMode(): Promise<void> {
  const response = await fetchJson<CopilotModeResponse>(`${COPILOT_CONNECT_BASE_URL}/v1/mode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mode: "bridge" }),
  });

  if (response.status !== 200 || response.body.mode !== "bridge") {
    throw new Error(`Unable to switch CopilotConnect to bridge mode at ${COPILOT_CONNECT_BASE_URL}`);
  }

  bridgeModeConfirmed = true;
}

async function ensureProxyUsesRealUpstream(): Promise<void> {
  const currentSettings = await fetchJson<SettingsResponse>(`${ADMIN_API_BASE_URL}/settings`);
  if (currentSettings.status !== 200) {
    throw new Error(`Unable to read proxy settings from ${ADMIN_API_BASE_URL}/settings`);
  }

  originalSettings = currentSettings.body;

  if (currentSettings.body.copilot_url !== COPILOT_CONNECT_BASE_URL) {
    const update = await fetchJson<SettingsResponse>(`${ADMIN_API_BASE_URL}/settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        copilot_url: COPILOT_CONNECT_BASE_URL,
      }),
    });

    if (update.status !== 200 || update.body.copilot_url !== COPILOT_CONNECT_BASE_URL) {
      throw new Error(`Unable to point proxy settings to real CopilotConnect at ${COPILOT_CONNECT_BASE_URL}`);
    }

    restoreCopilotUrl = true;
  }
}

async function restoreOriginalProxySettings(): Promise<void> {
  if (!restoreCopilotUrl || originalSettings == null) {
    return;
  }

  await fetchJson<SettingsResponse>(`${ADMIN_API_BASE_URL}/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      copilot_url: originalSettings.copilot_url,
    }),
  });
}

async function createApiKey(): Promise<void> {
  const response = await fetchJson<ApiKeyCreateResponse>(`${ADMIN_API_BASE_URL}/keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `${TEST_API_KEY_NAME} ${Date.now()}`,
      model: TARGET_AI_MODEL,
    }),
  });

  if (response.status !== 201) {
    throw new Error(`API key creation failed with HTTP ${response.status}`);
  }

  createdApiKeyId = response.body.item.id;
  clientApiKey = response.body.rawKey;
}

async function deleteApiKey(): Promise<void> {
  if (createdApiKeyId == null) {
    return;
  }

  await fetchJson<{ ok: boolean }>(`${ADMIN_API_BASE_URL}/keys/${createdApiKeyId}`, {
    method: "DELETE",
  });
}

async function runLoggedRequest(caseName: string, requestName: string, prompt: string): Promise<RequestLogEntry> {
  requestCounter += 1;
  const requestId = `req-${String(requestCounter).padStart(3, "0")}`;

  const requestUrl = `${CLIENT_API_BASE_URL}/chat/completions`;
  const upstreamRequestUrl = new URL("/v1/chat/completions", COPILOT_CONNECT_BASE_URL).toString();
  const clientRequestBodyObject = createChatRequestBody(prompt);
  const forwardedRequestBodyObject = { ...clientRequestBodyObject, model: TARGET_AI_MODEL };
  const clientRequestBody = JSON.stringify(clientRequestBodyObject, null, 2);
  const forwardedRequestBody = JSON.stringify(forwardedRequestBodyObject, null, 2);
  const startedAt = new Date();
  const startedMs = Date.now();

  try {
    const response = await fetchRaw(requestUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientApiKey}`,
        "Content-Type": "application/json",
      },
      body: clientRequestBody,
    });

    const parsed = safeParseJson<ChatCompletionResponse>(response.rawText);
    const assistantMessage = parsed?.choices?.[0]?.message?.content ?? "";
    const responseModel = parsed?.model ?? TARGET_AI_MODEL;
    const success =
      response.status === 200 &&
      parsed?.object === "chat.completion" &&
      assistantMessage.trim().length > 0 &&
      !assistantMessage.trim().startsWith("[Echo]");

    const entry: RequestLogEntry = {
      requestId,
      caseName,
      requestName,
      requestUrl,
      upstreamRequestUrl,
      apiKey: clientApiKey,
      requestedModel: REQUESTED_MODEL_SENT_BY_CLIENT,
      modelUsed: responseModel,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      responseTimeMs: Date.now() - startedMs,
      promptLength: prompt.length,
      responseStatus: response.status,
      responseHeaders: response.headers,
      totalTokens: parsed?.usage?.total_tokens ?? null,
      clientRequestBody,
      forwardedRequestBody,
      rawResponseBody: response.rawText,
      assistantMessage,
      assistantPreview: truncate(assistantMessage),
      outputLength: assistantMessage.length,
      success,
      error: success ? undefined : `HTTP ${response.status}; raw response preview=${truncate(response.rawText, 240)}`,
    };

    requestLogs.push(entry);
    return entry;
  } catch (error) {
    const entry: RequestLogEntry = {
      requestId,
      caseName,
      requestName,
      requestUrl,
      upstreamRequestUrl,
      apiKey: clientApiKey,
      requestedModel: REQUESTED_MODEL_SENT_BY_CLIENT,
      modelUsed: TARGET_AI_MODEL,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      responseTimeMs: Date.now() - startedMs,
      promptLength: prompt.length,
      responseStatus: null,
      responseHeaders: {},
      totalTokens: null,
      clientRequestBody,
      forwardedRequestBody,
      rawResponseBody: "",
      assistantMessage: "",
      assistantPreview: "",
      outputLength: 0,
      success: false,
      error: toErrorMessage(error),
    };

    requestLogs.push(entry);
    return entry;
  }
}

function recordCase(
  caseName: string,
  category: string,
  startedAt: Date,
  requestEntries: RequestLogEntry[],
  details: { messageLength?: number; parallelRequests?: number },
  notes: string[],
): void {
  const requestTimes = requestEntries.map((entry) => entry.responseTimeMs);
  const successCount = requestEntries.filter((entry) => entry.success).length;
  const result: CaseResult = {
    caseName,
    category,
    status: successCount === requestEntries.length ? "passed" : "failed",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    caseElapsedMs: Date.now() - startedAt.getTime(),
    requestCount: requestEntries.length,
    successCount,
    failureCount: requestEntries.length - successCount,
    avgRequestTimeMs: average(requestTimes),
    maxRequestTimeMs: Math.max(...requestTimes),
    messageLength: details.messageLength,
    parallelRequests: details.parallelRequests,
    notes,
    requestIds: requestEntries.map((entry) => entry.requestId),
  };

  caseResults.push(result);
}

async function runSingleRequestCase(caseName: string, category: string, prompt: string, details: { messageLength?: number } = {}, notes: string[] = []): Promise<void> {
  const startedAt = new Date();
  const entry = await runLoggedRequest(caseName, caseName, prompt);
  recordCase(caseName, category, startedAt, [entry], details, notes);
}

async function runParallelCase(parallelRequests: number): Promise<void> {
  const caseName = `parallel requests x${parallelRequests}`;
  const startedAt = new Date();
  const entries = await Promise.all(
    Array.from({ length: parallelRequests }, (_unused, index) => runLoggedRequest(caseName, `parallel request ${index + 1}`, buildParallelPrompt(index + 1, parallelRequests))),
  );

  recordCase(caseName, "parallel", startedAt, entries, { parallelRequests }, [
    "Requests were dispatched concurrently through the real proxy.",
    `Individual timings: ${entries.map((entry) => `${entry.requestName}=${entry.responseTimeMs}ms`).join(", ")}`,
  ]);
}

function buildRunSummary(startedAt: Date, fatalError?: string): RunSummary {
  const responseTimes = requestLogs.map((entry) => entry.responseTimeMs);
  const successfulRequests = requestLogs.filter((entry) => entry.success).length;
  const passedCases = caseResults.filter((entry) => entry.status === "passed").length;

  return {
    generatedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    totalRunTimeMs: Date.now() - startedAt.getTime(),
    bridgeModeConfirmed,
    proxyUpstreamConfigured: COPILOT_CONNECT_BASE_URL,
    adminApiBaseUrl: ADMIN_API_BASE_URL,
    clientApiBaseUrl: CLIENT_API_BASE_URL,
    copilotConnectBaseUrl: COPILOT_CONNECT_BASE_URL,
    targetModel: TARGET_AI_MODEL,
    requestedModelSentByClient: REQUESTED_MODEL_SENT_BY_CLIENT,
    apiKeySource: PRESET_API_KEY ? "environment override" : "created through Admin API",
    apiKeyUsed: clientApiKey,
    createdApiKeyId,
    totalCases: caseResults.length,
    passedCases,
    failedCases: caseResults.length - passedCases,
    totalRequests: requestLogs.length,
    successfulRequests,
    failedRequests: requestLogs.length - successfulRequests,
    averageResponseTimeMs: average(responseTimes),
    maxResponseTimeMs: responseTimes.length > 0 ? Math.max(...responseTimes) : 0,
    minResponseTimeMs: responseTimes.length > 0 ? Math.min(...responseTimes) : 0,
    caseResults,
    artifacts: {
      reportMarkdown: REPORT_MARKDOWN_PATH,
      reportJson: REPORT_JSON_PATH,
      trafficJson: TRAFFIC_JSON_PATH,
    },
    fatalError,
  };
}

async function writeArtifacts(summary: RunSummary): Promise<void> {
  const requestResultLines = requestLogs.map(
    (entry) =>
      `| ${escapeMarkdownCell(entry.requestName)} | ${escapeMarkdownCell(entry.caseName)} | ${escapeMarkdownCell(entry.success ? "passed" : "failed")} | ${escapeMarkdownCell(entry.responseStatus ?? "timeout/error")} | ${escapeMarkdownCell(entry.modelUsed)} | ${escapeMarkdownCell(entry.promptLength)} | ${escapeMarkdownCell(entry.outputLength)} | ${escapeMarkdownCell(entry.totalTokens ?? undefined)} | ${escapeMarkdownCell(entry.responseTimeMs)} | ${escapeMarkdownCell(entry.assistantPreview || entry.error)} |`,
  );

  const caseResultLines = caseResults.map(
    (entry) =>
      `| ${escapeMarkdownCell(entry.caseName)} | ${escapeMarkdownCell(entry.category)} | ${escapeMarkdownCell(entry.status)} | ${escapeMarkdownCell(entry.requestCount)} | ${escapeMarkdownCell(entry.successCount)} | ${escapeMarkdownCell(entry.failureCount)} | ${escapeMarkdownCell(entry.caseElapsedMs)} | ${escapeMarkdownCell(entry.avgRequestTimeMs)} | ${escapeMarkdownCell(entry.maxRequestTimeMs)} | ${escapeMarkdownCell(entry.messageLength)} | ${escapeMarkdownCell(entry.parallelRequests)} | ${escapeMarkdownCell(entry.notes.join(" / "))} |`,
  );

  const markdown = [
    "# Client API Live Real-Traffic Report",
    "",
    `Generated at: ${summary.generatedAt}`,
    `Run started at: ${summary.startedAt}`,
    `Run finished at: ${summary.finishedAt}`,
    `Real upstream mode: bridge (${summary.bridgeModeConfirmed ? "confirmed" : "not confirmed"})`,
    `Admin API base URL: ${ADMIN_API_BASE_URL}`,
    `Client API base URL: ${CLIENT_API_BASE_URL}`,
    `CopilotConnect base URL: ${COPILOT_CONNECT_BASE_URL}`,
    `Target model bound to API key: ${TARGET_AI_MODEL}`,
    `Model sent by client request body: ${REQUESTED_MODEL_SENT_BY_CLIENT}`,
    `API key source: ${summary.apiKeySource}`,
    `API key used: ${summary.apiKeyUsed}`,
    "",
    "## Summary",
    "",
    `- No mock traffic was used. The runner explicitly switched CopilotConnect to bridge mode before issuing requests.`,
    `- The proxy was configured to forward to ${summary.proxyUpstreamConfigured}.`,
    `- Total cases: ${summary.totalCases}`,
    `- Passed cases: ${summary.passedCases}`,
    `- Failed cases: ${summary.failedCases}`,
    `- Total requests: ${summary.totalRequests}`,
    `- Successful requests: ${summary.successfulRequests}`,
    `- Failed requests: ${summary.failedRequests}`,
    `- Average response time: ${summary.averageResponseTimeMs} ms`,
    `- Fastest response time: ${summary.minResponseTimeMs} ms`,
    `- Slowest response time: ${summary.maxResponseTimeMs} ms`,
    `- Total run time: ${summary.totalRunTimeMs} ms`,
    summary.fatalError ? `- Fatal error: ${summary.fatalError}` : "- Fatal error: none",
    "",
    "## Case Results",
    "",
    "| Case | Category | Status | Requests | Success | Failed | Case Elapsed (ms) | Avg Request (ms) | Max Request (ms) | Message Length | Parallel Requests | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...caseResultLines,
    "",
    "## Request Results",
    "",
    "| Request | Case | Status | HTTP | Model Used | Prompt Chars | Output Chars | Total Tokens | Response Time (ms) | Assistant Preview |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...requestResultLines,
    "",
    "## Detailed Traffic Logs",
    "",
    `- Full raw request/response traffic: ${TRAFFIC_JSON_PATH}`,
    `- Machine-readable summary: ${REPORT_JSON_PATH}`,
    `- Each traffic record includes request URL, upstream URL, API key, requested model, forwarded request body, raw AI response body, headers, status, and response time.`,
    "",
  ].join("\n");

  await mkdir(REPORT_OUTPUT_DIR, { recursive: true });
  await writeFile(REPORT_MARKDOWN_PATH, `${markdown}\n`, "utf8");
  await writeFile(REPORT_JSON_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(TRAFFIC_JSON_PATH, `${JSON.stringify(requestLogs, null, 2)}\n`, "utf8");
}

async function runSuite(): Promise<void> {
  await runSingleRequestCase("base chat completion", "base", buildBasePrompt(), {}, [
    "Validates that the external client API returns a real OpenAI-compatible response body.",
    "Fails if the response still looks like echo mode.",
  ]);

  await runSingleRequestCase("short message analysis", "short", buildShortPrompt(), {}, [
    "Checks a short real analysis request through the client API.",
  ]);

  for (const messageLength of LONG_MESSAGE_LENGTHS) {
    await runSingleRequestCase(`long message analysis ${messageLength}`, "long", buildLongPrompt(messageLength), { messageLength }, [
      `Real long-payload request with exactly ${messageLength} characters in the user message.`,
    ]);
  }

  for (const parallelRequests of PARALLEL_REQUEST_COUNTS) {
    await runParallelCase(parallelRequests);
  }
}

async function main(): Promise<void> {
  const startedAt = new Date();
  let fatalError: string | undefined;

  try {
    await ensureServiceHealth();
    await switchCopilotToBridgeMode();
    await ensureProxyUsesRealUpstream();

    if (!clientApiKey) {
      await createApiKey();
    }

    await runSuite();
  } catch (error) {
    fatalError = toErrorMessage(error);
  } finally {
    const summary = buildRunSummary(startedAt, fatalError);
    await writeArtifacts(summary);
    await deleteApiKey();
    await restoreOriginalProxySettings();
  }

  if (fatalError || caseResults.some((entry) => entry.status === "failed")) {
    process.exitCode = 1;
  }
}

void main();