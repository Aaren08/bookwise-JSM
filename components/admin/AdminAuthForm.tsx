"use client";

import { FormEvent, useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ImageCropper from "@/components/ImageCropper";
import {
  AvatarUploadResult,
  useAvatarUpload,
} from "@/lib/global/essentials/use-avatar-upload";
import { showErrorToast } from "@/lib/essentials/toast-utils";

const adminAuthFormSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  avatarUrl: z.url("Avatar image is required"),
});

interface AdminAuthFormProps {
  onSubmit: (
    values: AdminAuthFormValues,
  ) =>
    | Promise<{ success: boolean; error?: string }>
    | { success: boolean; error?: string };
}

interface AdminAvatar {
  url: string;
  fileId?: string;
}

type AdminAuthFormField =
  | "firstName"
  | "lastName"
  | "email"
  | "password"
  | "avatarUrl";

const AdminAuthForm = ({ onSubmit }: AdminAuthFormProps) => {
  const [values, setValues] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
  });
  const [avatar, setAvatar] = useState<AdminAvatar | null>(null);
  const [errors, setErrors] = useState<
    Partial<Record<AdminAuthFormField, string>>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const avatarUpload = useAvatarUpload({
    fallbackAvatar: "/icons/user.svg",
    onUploadComplete(result: AvatarUploadResult) {
      setAvatar({
        url: result.url,
        fileId: result.fileId,
      });
      setErrors((currentErrors) => ({
        ...currentErrors,
        avatarUrl: undefined,
      }));
    },
  });

  const avatarErrorId = useMemo(() => "admin-avatar-error", []);

  const updateField =
    (field: keyof typeof values) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setValues((currentValues) => ({
        ...currentValues,
        [field]: event.target.value,
      }));

      setErrors((currentErrors) => ({
        ...currentErrors,
        [field]: undefined,
      }));
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsed = adminAuthFormSchema.safeParse({
      ...values,
      avatarUrl: avatar?.url,
    });

    if (!parsed.success) {
      const fieldErrors: Partial<Record<AdminAuthFormField, string>> = {};

      parsed.error.issues.forEach((issue) => {
        const field = issue.path[0] as AdminAuthFormField | undefined;

        if (field) {
          fieldErrors[field] = issue.message;
        }
      });

      setErrors(fieldErrors);
      showErrorToast("Please complete all required fields");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await onSubmit({
        ...values,
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.email.trim(),
        avatarUrl: avatar?.url as string,
        avatarFileId: avatar?.fileId,
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to create admin account");
      }
    } catch (error) {
      showErrorToast(
        error instanceof Error
          ? error.message
          : "Failed to create admin account",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="admin-main">
      <section className="admin-section">
        <form onSubmit={handleSubmit} className="admin-card" noValidate>
          <div className="admin-avatar-wrapper">
            <div className="admin-avatar-inner">
              <ImageCropper
                avatarUpload={avatarUpload}
                fallbackAvatar="/icons/user.svg"
                ariaLabel="Upload admin avatar"
                avatarClassName="admin-avatar-cropper"
                hoverOverlayClassName="admin-avatar-hover"
              />
            </div>
          </div>

          <div className="mb-8 text-center">
            <h1 className="text-3xl font-semibold text-dark-400">
              Create An Account
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Create the administrator profile for BookWise.
            </p>
            {errors.avatarUrl && (
              <p
                id={avatarErrorId}
                className="mt-3 text-sm font-medium text-red-500"
              >
                {errors.avatarUrl}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="firstName" className="sr-only">
                First Name
              </label>
              <Input
                id="firstName"
                name="firstName"
                required
                value={values.firstName}
                onChange={updateField("firstName")}
                placeholder="First name"
                aria-invalid={!!errors.firstName}
                aria-describedby={
                  errors.firstName ? "firstName-error" : undefined
                }
                className="admin-input"
              />
              {errors.firstName && (
                <p id="firstName-error" className="mt-1 text-xs text-red-500">
                  {errors.firstName}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="lastName" className="sr-only">
                Last Name
              </label>
              <Input
                id="lastName"
                name="lastName"
                required
                value={values.lastName}
                onChange={updateField("lastName")}
                placeholder="Last name"
                aria-invalid={!!errors.lastName}
                aria-describedby={
                  errors.lastName ? "lastName-error" : undefined
                }
                className="admin-input"
              />
              {errors.lastName && (
                <p id="lastName-error" className="mt-1 text-xs text-red-500">
                  {errors.lastName}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="email" className="sr-only">
              Email
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              value={values.email}
              onChange={updateField("email")}
              placeholder="Email"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "email-error" : undefined}
              className="admin-input"
            />
            {errors.email && (
              <p id="email-error" className="mt-1 text-xs text-red-500">
                {errors.email}
              </p>
            )}
          </div>

          <div className="mt-4">
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                value={values.password}
                onChange={updateField("password")}
                placeholder="Enter your password"
                aria-invalid={!!errors.password}
                aria-describedby={
                  errors.password ? "password-error" : undefined
                }
                className="admin-password-input"
              />
              <button
                type="button"
                onClick={() => setShowPassword((isVisible) => !isVisible)}
                className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {errors.password && (
              <p id="password-error" className="mt-1 text-xs text-red-500">
                {errors.password}
              </p>
            )}
          </div>

          <Button
            type="submit"
            disabled={isSubmitting || avatarUpload.isUploading}
            className="mt-7 w-full admin-btn-primary"
          >
            {(isSubmitting || avatarUpload.isUploading) && (
              <div className="loader mr-2" />
            )}
            Create Account
          </Button>
        </form>
      </section>
    </main>
  );
};

export default AdminAuthForm;
