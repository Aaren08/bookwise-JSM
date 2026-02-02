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
import { Eye, EyeOff } from "lucide-react";
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
  const router = useRouter();

  const form = useForm({
    // @ts-expect-error - Zod v4 type incompatibility with @hookform/resolvers
    resolver: zodResolver(schema),
    defaultValues: defaultValues as DefaultValues<T>,
  });

  const handleSubmit: SubmitHandler<T> = async (data) => {
    // Helper function to normalize error values into user-friendly strings
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
      const result = await onSubmit(data);

      if (result.success) {
        showSuccessToast(isSignIn ? "Login successful" : "Sign up successful");
        router.push("/");
      } else {
        // Handle the case when result.success is false
        const errorMessage = result.error || "An error occurred";
        showErrorToast(errorMessage);
      }
    } catch (error) {
      console.log(error);
      const errorMessage = normalizeError(error);
      showErrorToast(errorMessage);
    }
  };

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
