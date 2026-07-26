export interface ContactFields {
  name: string;
  email: string;
  message: string;
}

export interface Web3FormsPayload {
  access_key: string;
  name: string;
  email: string;
  message: string;
  subject: string;
  from_name: string;
  /** Honeypot: must be empty for genuine submissions. */
  botcheck: string;
}

export function buildPayload(fields: ContactFields, accessKey: string): Web3FormsPayload {
  return {
    access_key: accessKey,
    name: fields.name,
    email: fields.email,
    message: fields.message,
    subject: `Inbound transmission from ${fields.name}`,
    from_name: fields.name,
    botcheck: "",
  };
}

/** Fallback channel: keeps everything the visitor typed when the relay fails. */
export function buildMailto(fields: ContactFields, to: string): string {
  const q = new URLSearchParams({
    subject: `Inbound transmission from ${fields.name}`,
    body: `${fields.message}\n\n— ${fields.name} <${fields.email}>`,
  });
  return `mailto:${to}?${q.toString()}`;
}

/**
 * Web3Forms' docs describe `{message, status}` while the live API also returns
 * `success` — so "ok" requires an ok response AND success not explicitly false.
 * Thrown errors (abort, DNS failure, offline) never reach here: fetch rejects,
 * and the caller maps that to "unreachable" directly.
 */
export function classifyResponse(
  res: { ok: boolean; status: number },
  json: { success?: boolean; message?: string }
): "ok" | "rejected" | "unreachable" {
  if (res.ok && json?.success !== false) return "ok";
  if (res.status >= 500) return "unreachable";
  return "rejected";
}
