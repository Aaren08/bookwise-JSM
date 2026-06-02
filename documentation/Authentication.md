# Authentication

## Overview

BookWise uses NextAuth.js v5 (Auth.js) for authentication, implementing a credentials-based authentication system with JWT sessions. The system is designed for a university library context, requiring users to verify their identity with a university ID card during registration.

## Configuration

### NextAuth Setup

The authentication configuration is located in `auth.ts`:

```typescript
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      async authorize(credentials) {
        // Authentication logic — see Sign In Process below
      },
    }),
  ],
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) { /* ... */ },
    async session({ session, token }) { /* ... */ },
  },
});
```

### Session Strategy

The application uses **JWT-based sessions** (`strategy: "jwt"`):

- Tokens are stored in secure HTTP-only cookies
- No server-side session storage required
- Stateless and compatible with serverless deployment
- Token contains all data needed for authorization checks

---

## Authentication Flow

### Sign Up Process

1. **User submits registration form** with:
   - Full name
   - Email address
   - University ID
   - Password
   - University ID card (image upload via ImageKit)

2. **Validation** via Zod schema (`signUpSchema`):

   ```typescript
   export const signUpSchema = z.object({
     fullName:       z.string().min(3),
     email:          z.string().email(),
     universityId:   z.string().min(1),
     password:       z.string().min(8),
     universityCard: z.string().nonempty(),
   });
   ```

3. **Rate limiting check** — 5 requests per minute per IP (token bucket)

4. **Duplicate check** — verify email and university ID are not already registered

5. **Password hashing** with bcrypt (cost factor 12)

6. **User creation** in database with `status: "PENDING"` and `role: "USER"`

7. **Welcome email** triggered via Upstash Workflow (fire-and-forget)

8. **Auto sign-in** after successful registration

### Sign In Process

1. **User submits credentials** (email + password)

2. **Rate limiting check**

3. **User lookup** by email

4. **Timing attack prevention:**

   ```typescript
   // Always run bcrypt to prevent user-enumeration via response timing
   const DUMMY_HASH = "$2b$10$...";
   const userPassword = existingUser.length > 0
     ? existingUser[0].password
     : DUMMY_HASH;
   const isPasswordCorrect = await bcrypt.compare(password, userPassword);
   ```

5. **Generic error messages** — identical error returned for invalid email or wrong password

6. **JWT generation** with all user fields (see Token Callback below)

### Sign Out

```typescript
export const handleSignOut = async () => {
  await signOut();
};
```

---

## JWT Callbacks

### Token Callback

Enriches the JWT with user data at sign-in. All fields stored in the token are listed below — this is the complete set.

```typescript
async jwt({ token, user, trigger, session }) {
  if (user) {
    // Populated once at sign-in from the authorize() return value
    token.id             = user.id;
    token.name           = user.name;           // fullName
    token.picture        = user.image;          // userAvatar CDN URL
    token.role           = user.role;           // "USER" | "ADMIN"
    token.sessionVersion = user.sessionVersion; // incremented on ADMIN → USER downgrade
  }

  // Handle session updates triggered by update() — e.g. after avatar change
  if (trigger === "update" && session?.user?.image) {
    token.picture = session.user.image;
  }

  return token;
}
```

**`sessionVersion`** is critical for real-time session invalidation. When an admin is downgraded to `USER`, the database increments `users.session_version` and publishes a `RoleChangeEvent` to Redis. The active admin's SSE connection (`/api/admin/session/realtime`) receives this event and compares `event.sessionVersion > token.sessionVersion`. If the token is stale, the user is signed out immediately without waiting for the JWT to expire naturally.

See [Admin Session Invalidation](Admin_Session_Invalidation.md) for the complete flow.

### Session Callback

Maps token fields to the `session.user` object consumed by client and server components:

```typescript
async session({ session, token }) {
  if (session.user) {
    session.user.id             = token.id as string;
    session.user.name           = token.name as string;
    session.user.image          = token.picture as string;
    session.user.role           = token.role as string;
    session.user.sessionVersion = token.sessionVersion as number;
  }
  return session;
}
```

---

## Type Extensions

Custom session and token types are declared in `types.d.ts` (or `next-auth.d.ts`):

```typescript
declare module "next-auth" {
  interface User {
    role?: string;
    sessionVersion?: number;
  }

  interface Session {
    user: {
      id: string;
      name: string;
      image: string;
      role: string;
      sessionVersion: number;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    sessionVersion: number;
  }
}
```

---

## Security Features

### Password Security

- bcrypt hashing with cost factor **12**
- Minimum 8 characters required
- Constant-time comparison prevents timing-based enumeration

### Rate Limiting

- Token bucket: 3 auth attempts per 10 minutes, burst of 6
- Excess requests redirected to `/too-fast`

### Session Security

- JWT stored in HTTP-only cookies (inaccessible to JavaScript)
- `Secure` flag set in production
- `SameSite` cookie policy enforced

### User Enumeration Prevention

- Generic error messages for all authentication failures
- Dummy bcrypt hash used when user does not exist (same computation time as a real comparison)

### Real-Time Session Invalidation

For admin users, JWT expiry is supplemented by active invalidation:

- Each admin browser tab holds an open SSE connection to `/api/admin/session/realtime`
- When `users.session_version` is incremented server-side (on ADMIN → USER downgrade), a `RoleChangeEvent` is published to Redis
- The SSE route filters events by `userId` and compares `event.sessionVersion > token.sessionVersion`
- Matching tabs receive a `session:invalidated` event and call `signOut()` immediately
- This closes the privilege window between role change and natural JWT expiry

---

## API Routes

### NextAuth Handlers

`/api/auth/[...nextauth]/route.ts`

Handles all built-in NextAuth endpoints:

- `GET/POST /api/auth/signin`
- `GET/POST /api/auth/signout`
- `GET      /api/auth/session`
- `GET      /api/auth/csrf`

### ImageKit Authentication

`GET /api/auth/imagekit`

Provides signed authentication parameters for client-side ImageKit uploads:

```typescript
export async function GET() {
  return NextResponse.json({
    ...imagekit.getAuthenticationParameters(),
    publicKey: config.env.imagekit.publicKey,
  });
}
```

This endpoint is called by `useAvatarUpload` before every upload. It returns a short-lived `signature`, `expire`, and `token` that ImageKit validates server-side.

---

## User Status Flow

```
Sign Up → PENDING → Admin Approval → APPROVED → Full Library Access
                  → Admin Rejection → REJECTED
```

Users start with `PENDING` status and cannot borrow books until an admin approves their account. Approved users receive an email notification. The approval flow uses optimistic concurrency (version check) and distributed row locking to prevent two admins from processing the same account simultaneously.

---

## Form Components

### AuthForm Component

The reusable authentication form (`components/AuthForm.tsx`) supports both sign-in and sign-up modes:

```typescript
interface Props<T extends FieldValues> {
  schema: ZodType<T>;
  defaultValues: T;
  onSubmit: (data: T) => Promise<{ success: boolean; error?: string }>;
  type: "SIGN_IN" | "SIGN_UP";
}
```

**Features:**

- Dynamic field rendering based on mode
- Password visibility toggle
- ImageKit file upload for university card (sign-up only)
- Success confirmation screen after sign-up

---

## Related Files

- `auth.ts` — NextAuth v5 configuration and callbacks
- `lib/actions/auth.ts` — `signUpWithCredentials`, `signInWithCredentials` server actions
- `lib/validations.ts` — Zod schemas (`signUpSchema`, `signInSchema`)
- `components/AuthForm.tsx` — Reusable auth form component
- `app/(auth)/layout.tsx` — Auth layout (redirects authenticated users)
- `app/(auth)/sign-in/page.tsx` — Sign-in page
- `app/(auth)/sign-up/page.tsx` — Sign-up page
- `types.d.ts` — NextAuth type extensions
- `lib/admin/realtime/session/roleChangePublisher.ts` — Publishes role-change events to Redis
- `app/api/admin/session/realtime/route.ts` — SSE stream for session invalidation
- `lib/admin/realtime/session/useSessionInvalidation.ts` — Client hook
- `components/admin/SessionGuard.tsx` — Mounts the invalidation hook in admin layouts
