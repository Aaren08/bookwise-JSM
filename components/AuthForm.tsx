"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  DefaultValues,
  FieldValues,
  Path,
  SubmitHandler,
  useForm,
} from "react-hook-form";
import { ZodType } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { FIELD_NAMES, FIELD_TYPES } from "@/constants";
import FileUpload from "./FileUpload";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, CheckCircle } from "lucide-react";
import { showErrorToast, showSuccessToast } from "@/lib/essentials/toast-utils";

interface Props<T extends FieldValues> {
  schema: ZodType<T>;
  defaultValues: T;
  onSubmit: (data: T) => Promise<{ success: boolean; error?: string }>;
  type: "SIGN_IN" | "SIGN_UP";
}

const AuthForm = <T extends FieldValues>({
  type,
  schema,
  defaultValues,
  onSubmit,
}: Props<T>) => {
  const isSignIn = type === "SIGN_IN";
  const [uploadError, setUploadError] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [signUpSuccess, setSignUpSuccess] = useState<boolean>(false);
  const router = useRouter();

  const form = useForm({
    // @ts-expect-error - Zod v4 type incompatibility with @hookform/resolvers
    resolver: zodResolver(schema),
    defaultValues: defaultValues as DefaultValues<T>,
  });

  const handleSubmit: SubmitHandler<T> = async (data) => {
    const normalizeError = (error: unknown): string => {
      if (error instanceof Error) {
        return error.message;
      }
      if (typeof error === "string") {
        return error;
      }
      try {
        return JSON.stringify(error);
      } catch {
        return "An unexpected error occurred";
      }
    };

    try {
      // Reset signup success state before submitting
      setSignUpSuccess(false);

      const result = await onSubmit(data);

      if (result.success) {
        if (isSignIn) {
          showSuccessToast("Login successful");
          router.push("/");
        } else {
          showSuccessToast("Account created successfully");
          setSignUpSuccess(true);
        }
      } else {
        const errorMessage = result.error || "An error occurred";
        showErrorToast(errorMessage);
      }
    } catch (error) {
      console.log(error);
      const errorMessage = normalizeError(error);
      showErrorToast(errorMessage);
    }
  };

  // ── Confirmation screen shown after successful sign-up ──
  if (signUpSuccess) {
    return (
      <div className="confirmation-wrapper">
        {/* Animated envelope icon */}
        <div className="confirmation-icon-ring">
          <div className="confirmation-icon-bg">
            <Mail className="confirmation-icon" />
          </div>
        </div>

        {/* Check badge */}
        <div className="confirmation-badge">
          <CheckCircle className="confirmation-badge-icon" />
        </div>

        {/* Copy */}
        <h1 className="confirmation-title">Check your inbox</h1>

        <p className="confirmation-subtitle">Account created successfully</p>

        <div className="confirmation-divider" />

        <p className="confirmation-body">
          We&apos;ve sent a confirmation email to your registered Gmail address.
          Please open your inbox and click the verification link to activate
          your library account.
        </p>

        <div className="confirmation-hint-box">
          <p className="confirmation-hint">
            Didn&apos;t receive the email? Check your{" "}
            <span className="confirmation-hint-accent">Spam</span> or{" "}
            <span className="confirmation-hint-accent">Promotions</span> folder.
          </p>
        </div>

        {/* Back to login */}
        <Link href="/sign-in" className="confirmation-link-btn">
          Back to Login
        </Link>
      </div>
    );
  }

  // ── Standard auth form ──
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-white">
        {isSignIn ? "Welcome back to BookWise" : "Create your library account"}
      </h1>

      <p className="text-light-100">
        {isSignIn
          ? "Access the vast collection of resources, and stay updated"
          : "Please complete all fields and upload a valid university card to gain access to the library"}
      </p>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="space-y-6 w-full"
        >
          {Object.keys(defaultValues).map((field) => (
            <FormField
              key={field}
              control={form.control}
              name={field as Path<T>}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="capitalize">
                    {FIELD_NAMES[field.name as keyof typeof FIELD_NAMES]}
                  </FormLabel>
                  <FormControl>
                    {field.name === "universityCard" ? (
                      <FileUpload
                        type="image"
                        accept="image/*"
                        placeholder="Upload your ID"
                        folder="users/ids"
                        variant="dark"
                        onUploadComplete={(url) => {
                          field.onChange(url);
                          setUploadError("");
                        }}
                        onUploadError={(error) => {
                          setUploadError(error);
                          field.onChange("");
                        }}
                        value={field.value}
                      />
                    ) : field.name === "password" ? (
                      <div className="relative">
                        <Input
                          required
                          type={showPassword ? "text" : "password"}
                          {...field}
                          className="form-input pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="password-toggle"
                          aria-label={
                            showPassword ? "Hide password" : "Show password"
                          }
                        >
                          {showPassword ? (
                            <EyeOff className="h-5 w-5" />
                          ) : (
                            <Eye className="h-5 w-5" />
                          )}
                        </button>
                      </div>
                    ) : (
                      <Input
                        required
                        type={
                          FIELD_TYPES[field.name as keyof typeof FIELD_TYPES]
                        }
                        {...field}
                        className="form-input"
                      />
                    )}
                  </FormControl>
                  {field.name === "universityCard" && uploadError && (
                    <p className="text-sm text-red-500 mt-1">{uploadError}</p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}

          <Button
            type="submit"
            className="form-btn"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting && <div className="loader mr-2" />}
            {isSignIn ? "Login" : "Sign Up"}
          </Button>
        </form>
      </Form>

      <p className="text-center text-base font-medium">
        {isSignIn ? "Don't have an account?" : "Already have an account?"}

        <Link
          href={isSignIn ? "/sign-up" : "/sign-in"}
          className="font-bold text-primary pl-2"
        >
          {isSignIn ? "Register here" : "Login"}
        </Link>
      </p>
    </div>
  );
};

export default AuthForm;
