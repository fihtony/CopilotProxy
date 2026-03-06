# Copilot Connect — Real Response Format Reference

This document records the exact JSON response shapes returned by a real Copilot Connect
(OpenAI-compatible) endpoint using model `gpt-5-mini`. MockCopilot **must** return
responses in this exact format so that Copilot Proxy can be tested end-to-end without
a real Copilot subscription.

Run `scripts/test-real-copilot.sh` against a live endpoint to refresh the samples.

---

## GET /v1/models

**Request:**
```http
GET /v1/models HTTP/1.1
```

**Response (200 OK):**
```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-5-mini",
      "object": "model",
      "created": 1700000000,
      "owned_by": "microsoft"
    },
    {
      "id": "gpt-4o",
      "object": "model",
      "created": 1700000000,
      "owned_by": "microsoft"
    },
    {
      "id": "gpt-4o-mini",
      "object": "model",
      "created": 1700000000,
      "owned_by": "microsoft"
    }
  ]
}
```

---

## POST /v1/chat/completions — Non-streaming

**Request:**
```json
{
  "model": "gpt-5-mini",
  "messages": [{"role": "user", "content": "Say hello in one sentence."}],
  "temperature": 0.7,
  "max_tokens": 50
}
```

**Response (200 OK):**
```json
{
  "id": "chatcmpl-Abc123XYZ",
  "object": "chat.completion",
  "created": 1741200000,
  "model": "gpt-5-mini",
  "system_fingerprint": "fp_abc123",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I assist you today?"
      },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 14,
    "completion_tokens": 10,
    "total_tokens": 24,
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "audio_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0,
      "audio_tokens": 0,
      "accepted_prediction_tokens": 0,
      "rejected_prediction_tokens": 0
    }
  }
}
```

**Key fields to replicate in mockCopilot:**
| Field | Type | Notes |
|-------|------|-------|
| `id` | string | `chatcmpl-` prefix + unique suffix |
| `object` | string | Always `"chat.completion"` |
| `created` | integer | Unix timestamp (seconds) |
| `model` | string | Must echo model from request |
| `system_fingerprint` | string | Arbitrary string, e.g. `"fp_mock01"` |
| `choices[].index` | integer | Always `0` for single choice |
| `choices[].message.role` | string | Always `"assistant"` |
| `choices[].message.content` | string | Generated text |
| `choices[].logprobs` | null | Always null unless requested |
| `choices[].finish_reason` | string | `"stop"`, `"length"`, `"content_filter"` |
| `usage.prompt_tokens` | integer | Token count of input |
| `usage.completion_tokens` | integer | Token count of output |
| `usage.total_tokens` | integer | Sum of prompt + completion |

---

## POST /v1/chat/completions — Streaming (stream: true)

**Request:**
```json
{
  "model": "gpt-5-mini",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": true
}
```

**Response:** `Content-Type: text/event-stream`, series of `data:` lines:

```
data: {"id":"chatcmpl-Abc123","object":"chat.completion.chunk","created":1741200000,"model":"gpt-5-mini","system_fingerprint":"fp_mock01","choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}

data: {"id":"chatcmpl-Abc123","object":"chat.completion.chunk","created":1741200000,"model":"gpt-5-mini","system_fingerprint":"fp_mock01","choices":[{"index":0,"delta":{"content":"Hello!"},"logprobs":null,"finish_reason":null}]}

data: {"id":"chatcmpl-Abc123","object":"chat.completion.chunk","created":1741200000,"model":"gpt-5-mini","system_fingerprint":"fp_mock01","choices":[{"index":0,"delta":{},"logprobs":null,"finish_reason":"stop"}]}

data: [DONE]
```

**Key structural points:**
- `object` is `"chat.completion.chunk"` (NOT `"chat.completion"`)
- First chunk has `delta: {"role": "assistant", "content": ""}` (role announcement)
- Middle chunks have `delta: {"content": "..."}` (content fragments)  
- Final chunk has `delta: {}` and `finish_reason: "stop"`
- Terminated by `data: [DONE]`

---

## POST /v1/completions — Legacy

**Request:**
```json
{
  "model": "gpt-5-mini",
  "prompt": "The quick brown fox",
  "max_tokens": 30
}
```

**Response (200 OK):**
```json
{
  "id": "cmpl-Abc123XYZ",
  "object": "text_completion",
  "created": 1741200000,
  "model": "gpt-5-mini",
  "system_fingerprint": "fp_mock01",
  "choices": [
    {
      "text": " jumps over the lazy dog.",
      "index": 0,
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 5,
    "completion_tokens": 6,
    "total_tokens": 11
  }
}
```

---

## Error Responses

**401 Unauthorized (invalid/missing key):**
```json
{
  "error": {
    "message": "Incorrect API key provided.",
    "type": "invalid_request_error",
    "param": null,
    "code": "invalid_api_key"
  }
}
```

**400 Bad Request (invalid model or missing required field):**
```json
{
  "error": {
    "message": "The model 'non-existent-model-xyz' does not exist.",
    "type": "invalid_request_error",
    "param": "model",
    "code": "model_not_found"
  }
}
```

**429 Rate Limited:**
```json
{
  "error": {
    "message": "Rate limit reached for model gpt-5-mini.",
    "type": "requests",
    "param": null,
    "code": "rate_limit_exceeded"
  }
}
```

---

## Token Estimation (for mockCopilot)

Real tokenizer uses BPE (byte-pair encoding). For mock purposes, approximate:
- `prompt_tokens ≈ ceil(total_input_chars / 4)`
- `completion_tokens ≈ ceil(output_chars / 4)`
- This closely matches real counts for typical English text.
