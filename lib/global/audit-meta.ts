import { NextRequest } from "next/server";
import crypto from "crypto";

export function buildAuditMeta(
  req: NextRequest,
  source: AuditMeta["source"],
): AuditMeta {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const correlationId =
    req.headers.get("x-correlation-id") ?? crypto.randomUUID();

  return {
    requestId,
    correlationId,
    ipAddress:
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown",
    userAgent: req.headers.get("user-agent") ?? "unknown",
    sessionId: "", // populated by auth layer after hashing
    source,
  };
}
