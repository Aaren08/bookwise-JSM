/**
 * setup.ts — Integration test global setup.
 *
 * All vi.mock factories that need to reference mock instances import them
 * inline to avoid vitest's hoisting restrictions.
 */

import { vi } from "vitest";

// external-only modules (no application logic)
vi.mock("server-only", () => ({}));

vi.mock("@/auth", async () => {
  const { mockAuth, mockSignIn, mockSignOut } = await import("./helpers/instances");
  return {
    auth: mockAuth,
    signIn: mockSignIn,
    signOut: mockSignOut,
  };
});

vi.mock("next/headers", async () => {
  const { mockHeaders } = await import("./helpers/instances");
  return { headers: mockHeaders };
});

vi.mock("next/cache", async () => {
  const { mockRevalidatePath, mockRevalidateTag } = await import("./helpers/instances");
  return {
    revalidatePath: mockRevalidatePath,
    revalidateTag: mockRevalidateTag,
  };
});

vi.mock("next/navigation", async () => {
  const { mockRedirect } = await import("./helpers/instances");
  return { redirect: mockRedirect };
});

vi.mock("@/database/redis", async () => {
  const { mockRedisGet, mockRedisSet, mockRedisEval, mockRedisPublish, mockRedisMget, mockRedisDel } =
    await import("./helpers/instances");
  return {
    default: {
      get: mockRedisGet,
      set: mockRedisSet,
      eval: mockRedisEval,
      publish: mockRedisPublish,
      mget: mockRedisMget,
      del: mockRedisDel,
    },
  };
});

vi.mock("@/database/drizzle", async () => {
  const { mockDb } = await import("./helpers/instances");
  return { db: mockDb };
});

vi.mock(
  "@/lib/admin/realtime/broadcast/dashboardSocketServer",
  async () => {
    const { mockBroadcastAdminDashboard, mockBroadcastBookAvailability } =
      await import("./helpers/instances");
    return {
      broadcastAdminDashboardUpdate: mockBroadcastAdminDashboard,
      broadcastBookAvailabilityUpdate: mockBroadcastBookAvailability,
    };
  },
);

vi.mock(
  "@/lib/admin/realtime/concurrency/rowConcurrency",
  async () => {
    const actual = await vi.importActual<
      typeof import("@/lib/admin/realtime/concurrency/rowConcurrency")
    >("@/lib/admin/realtime/concurrency/rowConcurrency");
    const { mockPublishEvent } = await import("./helpers/instances");
    return {
      ...actual,
      publishEvent: mockPublishEvent,
    };
  },
);

vi.mock(
  "@/lib/admin/realtime/session/roleChangePublisher",
  async () => {
    const { mockPublishRoleChangeEvent } = await import("./helpers/instances");
    return {
      publishRoleChangeEvent: mockPublishRoleChangeEvent,
      ROLE_CHANGE_CHANNEL: "admin:role-change",
    };
  },
);

vi.mock("@/lib/workflow", async () => {
  const { mockWorkflowTrigger } = await import("./helpers/instances");
  return {
    workflowClient: {
      trigger: mockWorkflowTrigger,
    },
  };
});

vi.mock("@/lib/config", () => ({
  default: {
    env: {
      apiEndpoint: "http://localhost:3000",
      prodApiEndpoint: "http://localhost:3000",
      databaseUrl: "postgres://mock:mock@localhost:5432/test",
      imagekit: {
        publicKey: "test-public",
        privateKey: "test-private",
        urlEndpoint: "https://ik.test.com",
      },
      upstash: {
        redisUrl: "http://localhost:6379",
        restToken: "test-token",
        qstashUrl: "http://localhost:8080",
        qstashToken: "test-qstash-token",
        qstashCurrentSigningKey: "test-current-key",
        qstashNextSigningKey: "test-next-key",
      },
      emailjs: {
        privateKey: "test-email-private",
        publicKey: "test-email-public",
        serviceId: "test-service",
        templateId: {
          welcome: "template-welcome",
          reEngagement: "template-reengagement",
        },
      },
    },
  },
}));

vi.mock("@/lib/essentials/rateLimit", async () => {
  // We keep all exports except safeRateLimit — we replace it with a controllable mock.
  // The mock always returns success=true by default so rate limiting never interferes.
  // Tests that need rate-limit-blocked behaviour override via
  //   vi.mocked(safeRateLimit).mockResolvedValueOnce({ success: false, ... }).
  const actual = await vi.importActual<
    typeof import("@/lib/essentials/rateLimit")
  >("@/lib/essentials/rateLimit");
  return {
    ...actual,
    safeRateLimit: vi.fn(
      async (...args: [unknown, string, unknown?]) => {
        void args;
        return {
        success: true,
        limit: Number.MAX_SAFE_INTEGER,
        remaining: Number.MAX_SAFE_INTEGER,
        reset: Date.now() + 60000,
        pending: Promise.resolve(),
        };
      },
    ),
  };
});
