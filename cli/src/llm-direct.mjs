// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli llm-direct — BYOK direct call to an OpenAI-compatible
 * provider (POST {base_url}/chat/completions) using the end user's own API key.
 *
 * SECURITY:
 *  - The api_key is sent ONLY in the Authorization header. It is NEVER logged
 *    and NEVER placed in a returned `error` string (errors carry HTTP status +
 *    provider body, which providers do not echo the key into).
 *  - No service-role token, no X-Internal-Call, no Vault access. This path is
 *    entirely the user's own credential against a third-party endpoint.
 */

const DEFAULT_TIMEOUT_MS = 90_000;

/** True for statuses worth one retry: 429 (rate limit) and 5xx (provider hiccup). */
function isRetryable(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Calls a provider's /chat/completions with the user's key.
 *
 * @param {object} providerConf - from getProvider(): { api_key, base_url, default_model, name }.
 * @param {object} opts
 * @param {string} opts.model        - model slug (falls back to providerConf.default_model).
 * @param {string} [opts.system]     - system prompt (omitted from messages when empty).
 * @param {string} opts.user         - user prompt.
 * @param {number} [opts.temperature=0]
 * @param {number} [opts.maxTokens=2048]
 * @returns {Promise<{ok:boolean,status:number,text:string,error:(string|null)}>}
 *   ok/status reflect the HTTP call; text = choices[0].message.content; error
 *   is a short message on failure (never contains the api_key).
 */
export async function callDirect(providerConf, { model, system, user, temperature = 0, maxTokens = 2048 } = {}) {
  if (!providerConf || !providerConf.api_key || !providerConf.base_url) {
    return { ok: false, status: 0, text: "", error: "provider not configured (missing api_key/base_url)" };
  }

  const resolvedModel = model || providerConf.default_model;
  if (!resolvedModel) {
    return {
      ok: false,
      status: 0,
      text: "",
      error: `no model given — pass --model <slug> or set a default_model for provider "${providerConf.name}"`,
    };
  }
  if (!user || !String(user).trim()) {
    return { ok: false, status: 0, text: "", error: "empty user prompt" };
  }

  const url = `${String(providerConf.base_url).replace(/\/+$/, "")}/chat/completions`;
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ].filter((m) => m.content && String(m.content).length > 0);

  const body = JSON.stringify({
    model: resolvedModel,
    messages,
    temperature,
    max_tokens: maxTokens,
  });

  const doFetch = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${providerConf.api_key}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      });
      const rawText = await response.text();
      return { response, rawText };
    } finally {
      clearTimeout(timer);
    }
  };

  let response;
  let rawText;
  try {
    ({ response, rawText } = await doFetch());
    // One retry on transient failure (429/5xx).
    if (isRetryable(response.status)) {
      ({ response, rawText } = await doFetch());
    }
  } catch (err) {
    // Abort/timeout/network — never leak the key; err.message here is fetch/abort text.
    const reason = err && err.name === "AbortError" ? `timeout after ${DEFAULT_TIMEOUT_MS}ms` : err?.message || "network error";
    return { ok: false, status: 0, text: "", error: reason };
  }

  if (!response.ok) {
    const snippet = rawText ? rawText.slice(0, 300) : `HTTP ${response.status}`;
    return { ok: false, status: response.status, text: "", error: snippet };
  }

  let text = "";
  try {
    const payload = rawText ? JSON.parse(rawText) : null;
    text =
      (payload &&
        Array.isArray(payload.choices) &&
        payload.choices[0] &&
        payload.choices[0].message &&
        typeof payload.choices[0].message.content === "string" &&
        payload.choices[0].message.content) ||
      "";
  } catch {
    text = "";
  }

  return { ok: true, status: response.status, text, error: null };
}
