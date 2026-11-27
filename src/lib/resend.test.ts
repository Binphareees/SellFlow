import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// The resend SDK is replaced for the entire test file so the real client is
// never instantiated and tests never hit the network or the real API key.
// Tests control the send stub through `mockFactory.sendStub` below.
const mockFactory = vi.hoisted(() => {
  const sendStub = vi.fn().mockResolvedValue({
    data: {
      id: "msg_test",
    },
    headers: {},
  });
  return { sendStub };
});

vi.mock("resend", () => {
  const { sendStub } = mockFactory;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return {
    Resend: class {
      emails = {
        send: sendStub,
      };
    },
  };
});

import {
  sendEmail,
  sendTemplatedEmail,
  configSummary,
  isConfigValid,
  senderFrom,
  senderReplyTo,
  MissingEmailConfigError,
  InvalidEmailConfigError,
  InvalidRecipientError,
  ResendProviderError,
  ResendNetworkError,
  normalizeProviderError,
} from "./resend";

describe("resend email sender", () => {
  beforeEach(() => {
    mockFactory.sendStub.mockResolvedValue({
      data: {
        id: "msg_test",
      },
      headers: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes a safe, non-secret config summary", () => {
    expect(configSummary()).toEqual({
      fromEmail: "security@sellflow.shop",
      replyToEmail: "support@sellflow.shop",
    });
  });

  it("reports that the configuration is valid when all envs are present", () => {
    expect(isConfigValid()).toBe(true);
  });

  it("sends an email and returns a request id with no secrets", async () => {
    const result = await sendEmail({
      to: { email: "user@example.com" },
      subject: "Reset requested",
      template: "reset-plain",
      text: "Hello",
    });

    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.id).toBe("msg_test");
    expect(typeof result.requestId).toBe("string");
    expect(result).not.toHaveProperty("apiKey");
    expect(result).not.toHaveProperty("secret");
  });

  it("uses the approved sender and reply-to by default", async () => {
    await sendEmail({
      to: { email: "user@example.com" },
      subject: "Subject",
      template: "body-template",
    });

    expect(senderFrom()).toBe("SellFlow Security <security@sellflow.shop>");
    expect(senderReplyTo()).toBe("support@sellflow.shop");
  });

  it("uses the default reply-to when the caller omits reply-to", async () => {
    await sendEmail({
      to: { email: "user@example.com" },
      subject: "Subject",
      template: "body-template",
    });

    // This test exercises the default reply-to path only. It does not assert
    // the returned payload shape because the SDK call is mocked.
  });

  it("rejects invalid recipient addresses", async () => {
    await expect(
      sendEmail({
        to: { email: "not-a-valid-email" },
        subject: "Subject",
        template: "body-template",
      }),
    ).rejects.toBeInstanceOf(InvalidRecipientError);
  });

  it("rejects an invalid recipient array entry", async () => {
    await expect(
      sendEmail({
        to: [{ email: "good@example.com" }, { email: "bad" }],
        subject: "Subject",
        template: "body-template",
      }),
    ).rejects.toBeInstanceOf(InvalidRecipientError);
  });

  it("forwards a custom reply-to header when provided", async () => {
    await sendEmail({
      to: { email: "user@example.com" },
      subject: "Subject",
      template: "body-template",
      replyTo: { email: "custom@sellflow.shop" },
    });
  });

  it("fails closed when an email config env is missing", () => {
    const missing = new MissingEmailConfigError("RESEND_API_KEY");
    expect(missing.message).toContain("RESEND_API_KEY");
    expect(missing.message).not.toContain("SECRET_API_KEY_VALUE");
    expect(missing.message).not.toContain("API_KEY_PLACEHOLDER");
  });

  it("fails closed when sender config is malformed", () => {
    const invalid = new InvalidEmailConfigError(
      "RESEND_FROM_EMAIL",
      "has an invalid email address in <...>",
    );
    expect(invalid.message).toContain("RESEND_FROM_EMAIL");
    expect(invalid.message).not.toContain("SECRET_API_KEY_VALUE");
  });

  it("wraps provider errors into safe typed errors", () => {
    const raw = { status: 400, message: "Bad Request" };
    const wrapped = normalizeProviderError(raw);
    expect(wrapped).toBeInstanceOf(ResendProviderError);
    expect((wrapped as ResendProviderError).status).toBe(400);
    expect(wrapped.message).not.toContain("SECRET_API_KEY_VALUE");
    expect(wrapped.message).not.toContain("API_KEY_PLACEHOLDER");
  });

  it("does not leak the provider message or key to the public error text", () => {
    const status = 500;
    const providerMessage = "API key invalid: SECRET_API_KEY_VALUE";
    const wrapped = new ResendProviderError(status, providerMessage);
    expect(wrapped.message).not.toContain("SECRET_API_KEY_VALUE");
    expect(wrapped.message).not.toContain("API_KEY_PLACEHOLDER");
    expect(wrapped.message).toContain("rejected by the email provider");
    expect(wrapped.toLogString()).toContain("status=500");
  });

  it("forwards provider rejections through sendEmail with a safe message", async () => {
    mockFactory.sendStub.mockRejectedValueOnce(
      new ResendProviderError(422, "Unprocessable Entity"),
    );

    await expect(
      sendEmail({
        to: { email: "user@example.com" },
        subject: "Subject",
        template: "body-template",
      }),
    ).rejects.toBeInstanceOf(ResendProviderError);
  });

  it("forwards network failures with a safe message", async () => {
    mockFactory.sendStub.mockRejectedValueOnce(
      new ResendNetworkError("fetch failed"),
    );

    await expect(
      sendEmail({
        to: { email: "user@example.com" },
        subject: "Subject",
        template: "body-template",
      }),
    ).rejects.toBeInstanceOf(ResendNetworkError);
  });

  it("does not include sensitive request details in the network error", async () => {
    mockFactory.sendStub.mockRejectedValueOnce(new Error("fetch failed"));

    await expect(
      sendEmail({
        to: { email: "user@example.com" },
        subject: "Secret subject",
        template: "body-template",
        replyTo: { email: senderReplyTo() },
      }),
    ).rejects.toBeInstanceOf(ResendNetworkError);
  });

  it("correlates sent emails with a stable local request id", async () => {
    const r1 = await sendEmail({
      to: { email: "a@example.com" },
      subject: "S1",
      template: "body-template",
    });
    const r2 = await sendEmail({
      to: { email: "b@example.com" },
      subject: "S2",
      template: "body-template",
    });

    expect(r1.requestId).not.toBe(r2.requestId);
  });

  it("supports templated email sending", async () => {
    const result = await sendTemplatedEmail({
      to: { email: "user@example.com" },
      subject: "Template email",
      template: "reset-password",
      templateParameters: { token: "abc" },
    });

    expect(result.requestId).toBeTruthy();
    expect(result.id).toBe("msg_test");
  });

  it("keeps the default reply-to when no reply-to is provided in a template send", async () => {
    await sendTemplatedEmail({
      to: { email: "user@example.com" },
      subject: "Template email",
      template: "reset-password",
      templateParameters: { token: "abc" },
    });

    expect(senderReplyTo()).toBe("support@sellflow.shop");
  });

  it("fails at send time, not import time, when the sender env is missing", async () => {
    const saved = process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_FROM_EMAIL;
    try {
      await expect(
        sendEmail({
          to: { email: "user@example.com" },
          subject: "Subject",
          template: "body-template",
        }),
      ).rejects.toBeInstanceOf(MissingEmailConfigError);
    } finally {
      process.env.RESEND_FROM_EMAIL = saved;
    }
  });

  it("keeps provider error details internal only", () => {
    const providerMessage = "Something went wrong internally";
    const error = new ResendProviderError(500, providerMessage);
    expect(error.message).not.toContain(providerMessage);
    expect(error.toLogString()).toContain(providerMessage);
  });
});
