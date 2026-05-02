import "server-only";
import redis from "@/database/redis";

export const ROLE_CHANGE_CHANNEL = "admin:role-change";

export type RoleChangeEvent = {
  userId: string;
  newRole: "USER" | "ADMIN";
  sessionVersion: number;
  publishedAt: string;
};

export const publishRoleChangeEvent = async (
  payload: Omit<RoleChangeEvent, "publishedAt">,
) => {
  const event: RoleChangeEvent = {
    ...payload,
    publishedAt: new Date().toISOString(),
  };
  await redis.publish(ROLE_CHANGE_CHANNEL, JSON.stringify(event));
};

export const isRoleChangeEvent = (value: unknown): value is RoleChangeEvent => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    typeof v.newRole === "string" &&
    typeof v.sessionVersion === "number" &&
    typeof v.publishedAt === "string"
  );
};
