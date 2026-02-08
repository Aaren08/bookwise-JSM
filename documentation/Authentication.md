# Authentication

## Overview

BookWise uses NextAuth.js v5 (Auth.js) for authentication, implementing a credentials-based authentication system with JWT sessions. The system is designed for a university library context, requiring users to verify their identity with a university ID.

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
        // Authentication logic
      },
    }),
  ],
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    jwt({ token, user }) { /* ... */ },
    session({ session, token }) { /* ... */ },
  },
});
```

### Session Strategy

The application uses **JWT-based sessions** (`strategy: "jwt"`):
- Tokens are stored in HTTP-only cookies
- No server-side session storage required
- Stateless and scalable

## Authentication Flow

### Sign Up Process

1. **User submits registration form** with:
   - Full name
   - Email
   - University ID
   - Password
   - University ID card (image upload)

2. **Validation** via Zod schema (`signUpSchema`):
   ```typescript
   export const signUpSchema = z.object({
     fullName: z.string().min(3),
     email: z.email(),
     universityId: z.string().min(1),
     password: z.string().min(8),
     universityCard: z.string().nonempty(),
   });
   ```

3. **Rate limiting check** (5 requests per minute per IP)

4. **Duplicate check** - Verify email doesn't already exist

5. **Password hashing** with bcrypt (cost factor: 10)

6. **User creation** in database with `PENDING` status

7. **Welcome email trigger** via Upstash Workflow

8. **Auto sign-in** after successful registration

### Sign In Process

1. **User submits credentials** (email + password)

2. **Rate limiting check**

3. **User lookup** by email

4. **Timing attack prevention**:
   ```typescript
   // Always perform bcrypt comparison to prevent timing-based enumeration
   const DUMMY_HASH = "$2b$10$...";
   const userPassword = existingUser.length > 0 
     ? existingUser[0].password 
     : DUMMY_HASH;
   const isPasswordCorrect = await bcrypt.compare(password, userPassword);
   ```

5. **Generic error messages** - Same error for invalid email or password

6. **JWT token generation** with user data

### Sign Out

```typescript
export const handleSignOut = async () => {
  await signOut();
};
```

## JWT Callbacks

### Token Callback

Enriches the JWT token with user data:

```typescript
async jwt({ token, user, trigger, session }) {
  if (user) {
    token.id = user.id;
    token.name = user.name;
    token.picture = user.image;
    token.role = user.role;
  }
  // Handle session updates (e.g., avatar change)
  if (trigger === "update" && session?.user?.image) {
    token.picture = session.user.image;
  }
  return token;
}
```

### Session Callback

Maps token data to the session object:

```typescript
async session({ session, token }) {
  if (session.user) {
    session.user.id = token.id as string;
    session.user.name = token.name as string;
    session.user.image = token.picture as string;
    session.user.role = token.role as string;
  }
  return session;
}
```

## Type Extensions

Custom session types are defined in `next-auth.d.ts`:

```typescript
declare module "next-auth" {
  interface User {
    role?: string;
  }
  interface Session {
    user: {
      id: string;
      role: string;
      // ... other fields
    };
  }
}
```

## Security Features

### Password Security
- Bcrypt hashing with cost factor 10
- Minimum 8 characters required
- Timing attack prevention in login

### Rate Limiting
- 5 authentication attempts per minute per IP
- Redirects to `/too-fast` when exceeded

### Session Security
- JWT stored in HTTP-only cookies
- Secure flag in production
- SameSite cookie policy

### User Enumeration Prevention
- Generic error messages for auth failures
- Constant-time password comparison
- Dummy hash for non-existent users

## API Routes

### NextAuth Handler
`/api/auth/[...nextauth]/route.ts`

Handles all NextAuth.js endpoints:
- `/api/auth/signin`
- `/api/auth/signout`
- `/api/auth/session`
- `/api/auth/csrf`

### ImageKit Auth
`/api/auth/imagekit/route.ts`

Provides authentication parameters for client-side uploads:

```typescript
export async function GET() {
  return NextResponse.json({
    ...imagekit.getAuthenticationParameters(),
    publicKey,
  });
}
```

## User Status Flow

```
Sign Up → PENDING → Admin Approval → APPROVED → Full Access
                  → Admin Rejection → REJECTED
```

Users start with `PENDING` status and require admin approval to access full library features.

## Form Components

### AuthForm Component

The reusable authentication form (`components/AuthForm.tsx`):
- Supports both sign-in and sign-up modes
- Dynamic field rendering based on schema
- Password visibility toggle
- File upload for university card
- Success confirmation screen after sign-up

```typescript
interface Props<T extends FieldValues> {
  schema: ZodType<T>;
  defaultValues: T;
  onSubmit: (data: T) => Promise<{ success: boolean; error?: string }>;
  type: "SIGN_IN" | "SIGN_UP";
}
```

## Related Files

- `auth.ts` - NextAuth configuration
- `lib/actions/auth.ts` - Server actions
- `lib/validations.ts` - Zod schemas
- `components/AuthForm.tsx` - Form component
- `app/(auth)/layout.tsx` - Auth layout
- `app/(auth)/sign-in/page.tsx` - Sign in page
- `app/(auth)/sign-up/page.tsx` - Sign up page
