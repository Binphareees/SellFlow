# STAGE2 Resend SDK Runtime Review

Scope: read-only investigation of the remaining Resend SDK type-safety limitation.
Constraint: no source files, tests, configuration, dependencies, env files, or runtime
behavior were modified. No real emails were sent. No API keys or `.env.local` contents
were read or exposed.

---

## 1. SDK version

- Package: `resend`
- Installed version: `6.37.0`
- Type declarations inspected: `node_modules/resend/dist/index.d.mts`

---

## 2. Relevant SDK type declarations

### 2.1 Emails surface

From `node_modules/resend/dist/index.d.mts` (emails region):

```ts
declare class Emails {
  private readonly resend;
  readonly attachments: Attachments$1;
  readonly receiving: Receiving;
  constructor(resend: Resend);
  send(payload: CreateEmailOptions, requestOptions?: CreateEmailRequestOptions): Promise<CreateEmailResponse>;
  create(payload: CreateEmailOptions, requestOptions?: CreateEmailRequestOptions): Promise<CreateEmailResponse>;
  // ... other methods ...
}
```

Asserted runtime shape confirmed by inspection only (no code change):

- `client.emails.send` is a function at runtime.
- Runtime toString reported: `async send(payload, requestOptions = {}) { return this.create(payload, requestOptions); }`

### 2.2 CreateEmailOptions

From the same declarations file:

```ts
interface EmailRenderOptions$1 {
  react: React$1.ReactNode;
  html: string;
  text: string;
}

interface EmailTemplateOptions {
  template: {
    id: string;
    variables?: Record<string, string | number>;
  };
}

interface CreateEmailBaseOptions {
  attachments?: Attachment[];
  bcc?: string | string[];
  cc?: string | string[];
  from: string;
  headers?: Record<string, string>;
  replyTo?: string | string[];
  subject: string;
  tags?: Tag[];
  to: string | string[];
  topicId?: string | null;
  scheduledAt?: string;
}

interface CreateEmailBaseOptionsWithTemplate extends Omit<CreateEmailBaseOptions, "from" | "subject"> {
  from?: string;
  subject?: string;
}

export type CreateEmailOptions =
  | ((RequireAtLeastOne<EmailRenderOptions$1> & CreateEmailBaseOptions) & { template?: never })
  | ((EmailTemplateOptions & CreateEmailBaseOptionsWithTemplate) & { react?: never; html?: never; text?: never });
```

So `CreateEmailOptions` is a union of:

1. A render-based shape that **requires** at least one of `react/html/text`, with `template` explicitly forbidden.
2. A template shape that requires `template: { id, variables? }`, with `react?: never`, `html?: never`, `text?: never`.

The critical part for this review is the second branch. In that branch, `html` and `text` are `never`, not `optional`.

### 2.3 Response shape

```ts
export interface CreateEmailResponseSuccess {
  id: string;
}

export type CreateEmailResponse = Response<CreateEmailResponseSuccess>;
```

The `Response<T>` type in the same file is a tagged union with `data`/`error` plus `headers`.

---

## 3. Current implementation posture

Current `src/lib/resend.ts` uses:

- `import { Resend } from "resend";`
- A typed reference to the send callable:
  ```ts
  interface ResendSendResponse {
    data?: { id?: string };
  }

  const sendEmailFn = (resend.emails as {
    send: (options: unknown) => Promise<ResendSendResponse>;
  }).send;
  ```
- Two exported send functions, `sendEmail(...)` and `sendTemplatedEmail(...)`, both building an internal `ResendOptions` payload and calling `sendEmailFn(...)`.
- Internal `ResendOptions` shape:
  ```ts
  interface ResendOptions {
    from: string;
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    replyTo?: string | string[];
    headers?: Record<string, string>;
    template: {
      id: string;
      variables?: Record<string, string | number>;
    };
  }
  ```
- Response handling reads `response?.data?.id`.

The module does **not** import or use `CreateEmailOptions` or `CreateEmailRequestOptions` from the SDK.

---

## 4. Runtime compatibility assessment

### 4.1 What the SDK actually expects at runtime

The SDK `Emails.send` implementation is:

```ts
async send(payload, requestOptions = {}) {
  return this.create(payload, requestOptions);
}
```

The runtime implementation is not gated by the TypeScript union annotation. At runtime, it accepts a payload object and forwards it. The SDK’s own documented send-email body parameters include a template variant with:

- `template.id`
- `template.variables`

and optional `from`, `to`, `subject`, `reply_to`, `headers`, and similar fields.

So the current `ResendOptions` payload is **structurally compatible with the SDK’s runtime template-email path** because it contains:

- `from`
- `to`
- `subject`
- `template: { id, variables? }`

which matches the documented template send shape.

### 4.2 Where the type gap is

The type gap is purely on the TypeScript side:

- The SDK’s `Emails.send` is declared to accept `CreateEmailOptions`.
- The template branch of that union types `html` and `text` as `never`.
- The current internal `ResendOptions` types `html` as `string`.

That means a payload that is `ResendOptions`-shaped is **not** assignable to `CreateEmailOptions` under strict project typechecking, because of the `html`/`text` conflict in the template variant.

The current implementation resolves that by casting the callable:

```ts
(resend.emails as { send: (options: unknown) => Promise<ResendSendResponse> }).send
```

This is a localized escape hatch on the SDK boundary callable only. It does not spread `any` through the module, and it does not assert that `ResendOptions` is a subtype of `CreateEmailOptions`.

### 4.3 What the cast does and does not conceal

What it does conceal:

- It tells TypeScript to stop checking the callable’s declared `CreateEmailOptions` parameter.
- It replaces the declared return type with a minimal `ResendSendResponse` interface chosen for the module’s needs.

What it does not conceal:

- The runtime call is still made to the real `resend.emails.send` function, which is the declared `Emails.send` implementation.
- The response handling is based on the documented success shape (`data.id`), which matches the SDK’s `CreateEmailResponseSuccess`.
- The cast is not concealing a different function, a different runtime contract, or a structural mismatch in the payload fields the SDK actually consumes for template sends.

So the cast is a typing bridge, not a runtime contract rewrite.

### 4.4 Current compatibility verdict

- **Runtime**: The current implementation is compatible with the installed SDK’s template-email functionality. The payload fields used are consistent with the documented template send contract, and the response shape used is consistent with the documented success shape.
- **Type system**: The implementation is **not** fully type-safe against the installed SDK’s exported `CreateEmailOptions` because the SDK union does not accept a template-shaped payload that also types `html`/`text` as a real string in the template branch. The current code works around that with a localized callable cast.
- **Module posture**: The module deliberately avoids pretending that its internal template payload is a subtype of `CreateEmailOptions`. It instead treats the SDK callable as an untyped-in-TypesScript boundary and types only the result shape it cares about.

---

## 5. Evidence supporting the conclusion

1. SDK version confirmed at install time: `resend@6.37.0`.
2. SDK type declaration file is present at `node_modules/resend/dist/index.d.mts` and was inspected directly.
3. The SDK’s `Emails.send` declaration is `send(payload: CreateEmailOptions, requestOptions?: CreateEmailRequestOptions): Promise<CreateEmailResponse>`.
4. The SDK’s `CreateEmailOptions` is a union whose template branch types `html?: never` and `text?: never`.
5. Current `src/lib/resend.ts` builds an internal `ResendOptions` object with `html: string` and calls the SDK through a localized callable cast.
6. The runtime `resend.emails.send` function was inspected and is `async send(payload, requestOptions = {}) { return this.create(payload, requestOptions); }`.
7. The module’s response handling uses `response?.data?.id`, matching the SDK’s `CreateEmailResponseSuccess.id`.
8. A project search found no other non-test production file importing or calling `sendEmail`, `sendTemplatedEmail`, or the resend module. The only references are in:
   - `src/lib/resend.ts`
   - `src/lib/resend.test.ts`
   - `src/lib/email-test-env.ts`

That search evidence matters because it narrows the blast radius: the typing workaround is isolated to the resend module and its test double.

---

## 6. Does an officially supported, type-safe alternative exist?

Based on the installed SDK declarations, **no purely type-safe alternative exists for the current usage pattern without changing what the module sends**.

The SDK exports a single `Emails.send(payload: CreateEmailOptions, ...)`. `CreateEmailOptions` is a union, and the template variant rejects `html`/`text` in its type signature. Because this module calls `resend.emails.send` directly and builds its own shaped payload, it cannot pass a `CreateEmailOptions`-conforming template payload without either:

- conforming to the SDK union exactly, or
- using a cast or similar typing escape hatch.

The practical type-safe options would be to change the module to supply a payload that satisfies the SDK’s declared type, for example by:

- using a render-style call with `react`/`html`/`text`, or
- structuring the template call so TypeScript accepts it under the union, if the SDK ever provides a more permissive template-only type.

Under the current SDK declarations, the existing implementation is the pragmatic middle path: correct runtime contract, narrow typing escape hatch, and no broad `any`.

---

## 7. Recommended next action

**Recommended: keep the current implementation as-is for now, with a documented limitation.**

Rationale:

- The runtime contract is compatible with the installed SDK for template emails.
- The only remaining issue is SDK-side typing, not a behavioral or security defect.
- The current workaround is localized and does not contaminate the module with `any`.
- No other production code depends on the resend sender in this repository, so the typing limitation is contained.

The limitation that should be documented is:

- The module’s internal template payload is intentionally not asserted to be a subtype of the SDK’s `CreateEmailOptions` union.
- The SDK callable is typed through a narrow boundary cast because the SDK’s exported union rejects a template-shaped payload with a real `html` field.
- If the project later wants strict SDK conformance, the correct fix is to align either the payload shape or the SDK usage with the installed SDK’s declared union, not to widen the cast.

---

## 8. Confirmation of read-only constraint

- No files were created, edited, or deleted during this investigation.
- No dependencies were installed or updated.
- No real email was sent.
- No `.env.local` was read or modified.
- No API key value was written to the report.

End of report.
