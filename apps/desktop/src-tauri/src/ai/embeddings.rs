//! OpenAI-compatible embeddings adapter (`POST {base}/v1/embeddings`). Covers
//! OpenAI, Ollama (its OpenAI-compat endpoint at the server root, e.g.
//! `http://localhost:11434`), and LM Studio. Reuses the chat adapter's base-URL
//! normalization and the shared error mapping in [`super`] so embedding errors
//! produce the same `aiAuth/aiRateLimit/aiBadRequest/aiServer/aiNetwork` kinds
//! the frontend already branches on.
//!
//! Note: this sends note text to the configured endpoint. That is fine because
//! the feature is opt-in and the endpoint is whatever the user configured
//! (commonly a local model) — but it IS a network call, so it lives entirely on
//! the async runtime, never under the engine lock.

use serde::Deserialize;
use serde_json::json;

use super::openai_compat::base_url;
use crate::engine::CommandError;

/// Conservative default batch size. Many endpoints accept an array `input`; some
/// older Ollama builds accept only a single string — [`embed_batch`] falls back
/// to one-per-request on a 4xx, so this is just an efficiency knob.
const BATCH: usize = 16;

#[derive(Deserialize)]
struct EmbeddingsResponse {
    data: Vec<EmbeddingRow>,
}

#[derive(Deserialize)]
struct EmbeddingRow {
    embedding: Vec<f32>,
    #[serde(default)]
    index: Option<usize>,
}

fn bad_request(msg: impl Into<String>) -> CommandError {
    CommandError {
        kind: "aiBadRequest".to_string(),
        message: msg.into(),
    }
}

/// Embed `inputs` in chunks of [`BATCH`], returning one vector per input in the
/// same order. On a per-batch `aiBadRequest` (the only kind that signals "this
/// endpoint won't take an array"), retries that chunk one input at a time.
pub async fn embed_batch(
    client: &reqwest::Client,
    base: Option<&str>,
    api_key: Option<&str>,
    model: &str,
    inputs: &[String],
) -> Result<Vec<Vec<f32>>, CommandError> {
    let mut out: Vec<Vec<f32>> = Vec::with_capacity(inputs.len());
    for chunk in inputs.chunks(BATCH) {
        match embed_request(client, base, api_key, model, chunk).await {
            Ok(mut vecs) => out.append(&mut vecs),
            Err(e) if e.kind == "aiBadRequest" && chunk.len() > 1 => {
                // Single-input fallback for endpoints that reject array `input`.
                for one in chunk {
                    let mut v =
                        embed_request(client, base, api_key, model, std::slice::from_ref(one))
                            .await?;
                    out.push(
                        v.pop()
                            .ok_or_else(|| bad_request("embeddings: empty response"))?,
                    );
                }
            }
            Err(e) => return Err(e),
        }
    }
    Ok(out)
}

/// One `/v1/embeddings` request. Validates count, dimension consistency, and
/// finiteness so a malformed response can't poison cosine math downstream.
async fn embed_request(
    client: &reqwest::Client,
    base: Option<&str>,
    api_key: Option<&str>,
    model: &str,
    inputs: &[String],
) -> Result<Vec<Vec<f32>>, CommandError> {
    let body = json!({ "model": model, "input": inputs });
    let resp = client
        .post(format!("{}/v1/embeddings", base_url(base)))
        // Empty bearer is harmless for OpenAI/LM Studio and required-absent for
        // local Ollama; mirrors the chat adapter exactly.
        .bearer_auth(api_key.unwrap_or_default())
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| super::net_err("embeddings", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(super::map_status_error(
            status.as_u16(),
            &text,
            "embeddings",
        ));
    }

    let parsed: EmbeddingsResponse = resp
        .json()
        .await
        .map_err(|e| super::net_err("embeddings", e))?;

    validate_rows(parsed.data, inputs.len())
}

/// Order and validate one response's rows against the number of inputs that
/// produced them, returning one vector per input.
fn validate_rows(
    mut data: Vec<EmbeddingRow>,
    expected: usize,
) -> Result<Vec<Vec<f32>>, CommandError> {
    // Honor `index` when every row carries one; otherwise trust positional order.
    if !data.is_empty() && data.iter().all(|d| d.index.is_some()) {
        data.sort_by_key(|d| d.index.unwrap_or(0));
    }

    if data.len() != expected {
        return Err(bad_request(format!(
            "embeddings: expected {} vectors, got {}",
            expected,
            data.len()
        )));
    }

    let vecs: Vec<Vec<f32>> = data.into_iter().map(|d| d.embedding).collect();
    let dim = vecs.first().map(Vec::len).unwrap_or(0);
    if dim == 0 {
        return Err(bad_request("embeddings: empty embedding returned"));
    }
    let mut any_nonzero = false;
    for v in &vecs {
        if v.len() != dim {
            return Err(bad_request("embeddings: inconsistent vector dimensions"));
        }
        if v.iter().any(|x| !x.is_finite()) {
            return Err(bad_request("embeddings: non-finite values in embedding"));
        }
        any_nonzero |= v.iter().any(|x| *x != 0.0);
    }
    if !any_nonzero {
        return Err(bad_request(
            "embeddings: all-zero embeddings (check the model)",
        ));
    }

    Ok(vecs)
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{spawn_server, CannedResponse};
    use super::*;

    fn inputs(texts: &[&str]) -> Vec<String> {
        texts.iter().map(|s| s.to_string()).collect()
    }

    async fn embed(
        base: &str,
        inputs: &[String],
    ) -> Result<Vec<Vec<f32>>, crate::engine::CommandError> {
        let client = reqwest::Client::new();
        embed_batch(&client, Some(base), Some("sk-emb"), "embed-model", inputs).await
    }

    #[tokio::test]
    async fn builds_the_request_and_returns_vectors_in_input_order() {
        // Rows arrive out of order but carry `index` — output must be reordered.
        let (base, captured) = spawn_server(vec![CannedResponse::json(
            200,
            r#"{"data":[
                {"embedding":[0.5,0.5],"index":1},
                {"embedding":[1.0,0.0],"index":0}
            ]}"#,
        )])
        .await;

        let out = embed(&base, &inputs(&["a", "b"])).await.unwrap();
        assert_eq!(out, vec![vec![1.0, 0.0], vec![0.5, 0.5]]);

        let reqs = captured.lock().unwrap();
        assert!(reqs[0].starts_with("POST /v1/embeddings "));
        assert!(reqs[0].contains("authorization: Bearer sk-emb"));
        assert!(reqs[0].contains("\"model\":\"embed-model\""));
        assert!(reqs[0].contains("\"input\":[\"a\",\"b\"]"));
    }

    #[tokio::test]
    async fn rows_without_indices_keep_positional_order() {
        let (base, _) = spawn_server(vec![CannedResponse::json(
            200,
            r#"{"data":[{"embedding":[0.25]},{"embedding":[0.75]}]}"#,
        )])
        .await;

        let out = embed(&base, &inputs(&["a", "b"])).await.unwrap();
        assert_eq!(out, vec![vec![0.25], vec![0.75]]);
    }

    #[tokio::test]
    async fn count_mismatch_is_rejected() {
        // More vectors than inputs; a single input never triggers the
        // array-fallback, so the mismatch surfaces directly.
        let (base, _) = spawn_server(vec![CannedResponse::json(
            200,
            r#"{"data":[{"embedding":[1.0],"index":0},{"embedding":[2.0],"index":1}]}"#,
        )])
        .await;

        let err = embed(&base, &inputs(&["a"])).await.unwrap_err();
        assert_eq!(err.kind, "aiBadRequest");
        assert!(err.message.contains("expected 1 vectors, got 2"));
    }

    #[test]
    fn inconsistent_dimensions_are_rejected() {
        // Multi-row shape errors are checked on the pure validator: over HTTP a
        // multi-input aiBadRequest would (correctly) trigger the single-input
        // fallback rather than surfacing directly.
        let rows = vec![
            EmbeddingRow {
                embedding: vec![1.0, 2.0],
                index: Some(0),
            },
            EmbeddingRow {
                embedding: vec![1.0],
                index: Some(1),
            },
        ];
        let err = validate_rows(rows, 2).unwrap_err();
        assert_eq!(err.kind, "aiBadRequest");
        assert!(err.message.contains("inconsistent vector dimensions"));
    }

    #[tokio::test]
    async fn non_finite_values_are_rejected() {
        // 1e39 overflows f32 to +inf during deserialization.
        let (base, _) = spawn_server(vec![CannedResponse::json(
            200,
            r#"{"data":[{"embedding":[1.0,1e39],"index":0}]}"#,
        )])
        .await;

        let err = embed(&base, &inputs(&["a"])).await.unwrap_err();
        assert_eq!(err.kind, "aiBadRequest");
        assert!(err.message.contains("non-finite"));
    }

    #[tokio::test]
    async fn all_zero_embeddings_are_rejected() {
        let (base, _) = spawn_server(vec![CannedResponse::json(
            200,
            r#"{"data":[{"embedding":[0.0,0.0],"index":0}]}"#,
        )])
        .await;

        let err = embed(&base, &inputs(&["a"])).await.unwrap_err();
        assert_eq!(err.kind, "aiBadRequest");
        assert!(err.message.contains("all-zero"));
    }

    #[tokio::test]
    async fn empty_embedding_is_rejected() {
        let (base, _) = spawn_server(vec![CannedResponse::json(
            200,
            r#"{"data":[{"embedding":[],"index":0}]}"#,
        )])
        .await;

        let err = embed(&base, &inputs(&["a"])).await.unwrap_err();
        assert_eq!(err.kind, "aiBadRequest");
        assert!(err.message.contains("empty embedding"));
    }

    #[tokio::test]
    async fn batch_falls_back_to_single_inputs_on_bad_request() {
        // The endpoint rejects array input (400) → each input is retried alone.
        let (base, captured) = spawn_server(vec![
            CannedResponse::json(400, r#"{"error":{"message":"input must be a string"}}"#),
            CannedResponse::json(200, r#"{"data":[{"embedding":[1.0],"index":0}]}"#),
            CannedResponse::json(200, r#"{"data":[{"embedding":[2.0],"index":0}]}"#),
        ])
        .await;

        let out = embed(&base, &inputs(&["a", "b"])).await.unwrap();
        assert_eq!(out, vec![vec![1.0], vec![2.0]]);

        let reqs = captured.lock().unwrap();
        assert_eq!(reqs.len(), 3);
        assert!(reqs[0].contains("\"input\":[\"a\",\"b\"]"));
        assert!(reqs[1].contains("\"input\":[\"a\"]"));
        assert!(reqs[2].contains("\"input\":[\"b\"]"));
    }

    #[tokio::test]
    async fn auth_errors_are_not_retried_per_input() {
        let (base, captured) = spawn_server(vec![CannedResponse::json(
            401,
            r#"{"error":{"message":"bad key"}}"#,
        )])
        .await;

        let err = embed(&base, &inputs(&["a", "b"])).await.unwrap_err();
        assert_eq!(err.kind, "aiAuth");
        assert_eq!(err.message, "bad key");
        assert_eq!(
            captured.lock().unwrap().len(),
            1,
            "no fallback on auth errors"
        );
    }
}
