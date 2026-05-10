import { NextRequest } from "next/server";
import crypto from "crypto";

// RFC-4122 UUID pattern used to validate inbound trace headers.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the value only when it is a well-formed UUID, otherwise undefined. */
function validUUID(value: string | null): string | undefined {
  return value && UUID_RE.test(value.trim()) ? value.trim() : undefined;
}

export function buildAuditMeta(
  req: NextRequest,
  source: AuditMeta["source"],
): AuditMeta {
  // Validate UUID headers; fall back to a locally-generated UUID if missing or malformed.
  const requestId =
    validUUID(req.headers.get("x-request-id")) ?? crypto.randomUUID();
  const correlationId =
    validUUID(req.headers.get("x-correlation-id")) ?? crypto.randomUUID();

  // Take only the first token of x-forwarded-for, strip whitespace, enforce a
  // 45-char cap (enough for any IPv6 address) and allow only IP-safe characters.
  const MAX_IP_LEN = 45;
  const IP_SAFE_RE = /^[0-9a-fA-F.:]+$/;
  const rawIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ipAddress =
    rawIp.length > 0 && rawIp.length <= MAX_IP_LEN && IP_SAFE_RE.test(rawIp)
      ? rawIp
      : "unknown";

  // Truncate the User-Agent to 512 bytes; default to "unknown" when absent.
  const MAX_UA_LEN = 512;
  const rawUa = req.headers.get("user-agent") ?? "";
  const userAgent = rawUa.length > 0 ? rawUa.slice(0, MAX_UA_LEN) : "unknown";

  return {
    requestId,
    correlationId,
    ipAddress,
    userAgent,
    sessionId: "", // populated by auth layer after hashing
    source,
  };
}
