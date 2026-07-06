//! Anthropic Messages API adapter — builds the streaming `/v1/messages`
//! request. Response parsing lives in `novalis_core::ai::sse`.

use serde_json::json;

use super::{role_str, AiRequest};

const DEFAULT_BASE: &str = "https://api.anthropic.com";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_TOKENS: u32 = 16000;

fn base_url(req: &AiRequest) -> String {
    let base = req
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_BASE);
    base.trim_end_matches('/').to_string()
}

/// Model-id prefixes known to accept `thinking: {"type": "adaptive"}` — the
/// Claude 4.6+ families. Older models (including `claude-haiku-4-5` from our
/// own [`super::catalog`]) reject the parameter with a 400, and the model field
/// is free text, so anything unrecognized omits it: omission is accepted by
/// every model, while a wrong `thinking` value fails the whole run.
const ADAPTIVE_THINKING_MODELS: &[&str] = &[
    "claude-opus-4-6",
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-sonnet-4-6",
    "claude-sonnet-5",
    "claude-fable-5",
    "claude-mythos-5",
];

fn supports_adaptive_thinking(model: &str) -> bool {
    ADAPTIVE_THINKING_MODELS
        .iter()
        .any(|m| model.starts_with(m))
}

/// The JSON body of the streaming completion request (pure; unit-tested).
fn request_body(req: &AiRequest) -> serde_json::Value {
    let messages: Vec<_> = req
        .prompt
        .messages
        .iter()
        .map(|m| json!({ "role": role_str(m.role), "content": m.content }))
        .collect();

    let mut body = json!({
        "model": req.model,
        "max_tokens": MAX_TOKENS,
        "system": req.prompt.system,
        "stream": true,
        "messages": messages,
    });
    // Adaptive thinking is the on-mode for current Claude models (the raw
    // reasoning is never returned and we only render text deltas) — but only
    // models that support it may be sent the field.
    if supports_adaptive_thinking(&req.model) {
        body["thinking"] = json!({ "type": "adaptive" });
    }
    body
}

/// Build the streaming completion request.
pub fn build_request(client: &reqwest::Client, req: &AiRequest) -> reqwest::RequestBuilder {
    let body = request_body(req);

    client
        .post(format!("{}/v1/messages", base_url(req)))
        .header("x-api-key", req.api_key.clone().unwrap_or_default())
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
}

/// A key-only auth check: list models (no tokens spent).
pub fn build_test(
    client: &reqwest::Client,
    base: Option<&str>,
    api_key: Option<&str>,
) -> reqwest::RequestBuilder {
    let base = base
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_BASE)
        .trim_end_matches('/');
    client
        .get(format!("{base}/v1/models"))
        .header("x-api-key", api_key.unwrap_or_default())
        .header("anthropic-version", ANTHROPIC_VERSION)
}

#[cfg(test)]
mod tests {
    use super::*;
    use novalis_core::ai::BuiltPrompt;
    use novalis_core::models::AiProviderKind;

    fn req(model: &str) -> AiRequest {
        AiRequest {
            kind: AiProviderKind::Anthropic,
            base_url: None,
            model: model.to_string(),
            api_key: None,
            prompt: BuiltPrompt {
                system: "sys".to_string(),
                messages: Vec::new(),
            },
            agentic: false,
            workdir: None,
        }
    }

    #[test]
    fn adaptive_thinking_sent_for_supporting_models() {
        for model in [
            "claude-opus-4-8",
            "claude-sonnet-4-6",
            "claude-sonnet-5",
            "claude-fable-5",
        ] {
            let body = request_body(&req(model));
            assert_eq!(
                body["thinking"]["type"], "adaptive",
                "expected adaptive thinking for {model}"
            );
        }
    }

    #[test]
    fn adaptive_thinking_omitted_for_unsupported_or_unknown_models() {
        // claude-haiku-4-5 is in our own catalog and rejects adaptive thinking;
        // unknown free-text ids must omit the field too (omission is safe).
        for model in ["claude-haiku-4-5", "claude-3-5-sonnet-20241022", "my-model"] {
            let body = request_body(&req(model));
            assert!(
                body.get("thinking").is_none(),
                "expected no thinking field for {model}"
            );
        }
    }

    #[test]
    fn request_body_keeps_core_fields() {
        let body = request_body(&req("claude-haiku-4-5"));
        assert_eq!(body["model"], "claude-haiku-4-5");
        assert_eq!(body["system"], "sys");
        assert_eq!(body["stream"], true);
        assert_eq!(body["max_tokens"], MAX_TOKENS);
    }
}
