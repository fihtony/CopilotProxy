export function buildMockChatCompletion(body: Record<string, unknown>, model: string) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const userPrompt = messages
    .map((message) =>
      typeof message === "object" && message && "content" in message ? String((message as { content: unknown }).content) : "",
    )
    .join(" ")
    .trim();

  return {
    id: `chatcmpl_mock_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: userPrompt ? `Mock response for: ${userPrompt}` : "Mock response from Copilot Proxy.",
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 32,
      completion_tokens: 48,
      total_tokens: 80,
    },
  };
}

export function buildMockModels() {
  return {
    object: "list",
    data: [
      { id: "gpt-5-mini", object: "model", owned_by: "openai" },
      { id: "gpt-4o-mini", object: "model", owned_by: "openai" },
    ],
  };
}
