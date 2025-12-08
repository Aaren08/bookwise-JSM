"use server";

import { signIn } from "@/auth";
import { db } from "@/database/drizzle";
import { users } from "@/database/schema";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

export const signInWithCredentials = async (
  credentials: Pick<AuthCredentials, "email" | "password">
) => {
  const { email, password } = credentials;

  try {
    // Check if user exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Dummy hash for timing attack prevention when user doesn't exist
    const dummyHash =
      "$2a$10$YourDummyHashHereToPreventTimingAttacks1234567890";

    // Always perform bcrypt comparison to prevent timing-based enumeration
    const userPassword =
      existingUser.length > 0 ? existingUser[0].password : dummyHash;
    const isPasswordCorrect = await bcrypt.compare(password, userPassword);

    // Return generic error message for both cases to prevent user enumeration
    if (existingUser.length === 0 || !isPasswordCorrect) {
      return {
        success: false,
        error: "Invalid credentials",
      };
    }

    // Sign in
    await signIn("credentials", { email, password, redirect: false });
    return {
      success: true,
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error: "Something went wrong",
    };
  }
};

export const signUp = async (credentials: AuthCredentials) => {
  const { fullName, email, password, universityId, universityCard } =
    credentials;

  try {
    // Check if user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existingUser.length > 0) {
      return {
        success: false,
        error: "User already exists",
      };
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    await db.insert(users).values({
      fullName,
      email,
      universityId,
      password: hashedPassword,
      universityCard,
    });

    await signInWithCredentials({ email, password });
    return {
      success: true,
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      error: "Something went wrong",
    };
  }
};
