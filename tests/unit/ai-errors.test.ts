import { describe, expect, it } from "vitest";
import OpenAI from "openai";
import { classifyError, describeError } from "@/lib/ai/provider";

const httpError = (status: number, body: object = {}) => OpenAI.APIError.generate(status, { error: body }, "error", new Headers({ "x-request-id": "req_123" }));
const connectionError = (code: string) => new OpenAI.APIConnectionError({ cause: Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("x"), { code }) }) });

describe("OpenAI error classification", () => {
  it("separates transport failures from HTTP errors", () => {
    expect(classifyError(connectionError("UNABLE_TO_GET_ISSUER_CERT_LOCALLY")).code).toBe("tls_untrusted_certificate");
    expect(classifyError(connectionError("SELF_SIGNED_CERT_IN_CHAIN")).code).toBe("tls_untrusted_certificate");
    expect(classifyError(connectionError("ENOTFOUND")).code).toBe("dns_error");
    expect(classifyError(connectionError("ECONNREFUSED")).code).toBe("connection_error");
    expect(classifyError(new OpenAI.APIConnectionTimeoutError()).code).toBe("timeout");
    expect(classifyError(httpError(401)).code).toBe("invalid_api_key");
    expect(classifyError(httpError(403)).code).toBe("permission_denied");
    expect(classifyError(httpError(404)).code).toBe("model_unavailable");
    expect(classifyError(httpError(429, { code: "insufficient_quota", type: "insufficient_quota" }))).toEqual({ code: "quota_exhausted", rateLimited: true });
    expect(classifyError(httpError(429, { code: "rate_limit_exceeded" }))).toEqual({ code: "rate_limited", rateLimited: true });
    expect(classifyError(httpError(500)).code).toBe("http_500");
  });

  it("describes errors with safe fields only", () => {
    const d = describeError(httpError(401));
    expect(d).toMatchObject({ code: "invalid_api_key", errorClass: "AuthenticationError", status: 401, requestId: "req_123", causeCode: null });
    expect(d.hint).toMatch(/401/);
    const t = describeError(connectionError("UNABLE_TO_GET_ISSUER_CERT_LOCALLY"));
    expect(t).toMatchObject({ code: "tls_untrusted_certificate", errorClass: "APIConnectionError", status: null, causeCode: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" });
    expect(Object.keys(t).sort()).toEqual(["causeCode", "code", "errorClass", "hint", "requestId", "status"]);
  });
});
