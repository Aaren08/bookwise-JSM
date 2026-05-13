"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Globe2,
  LifeBuoy,
  Mail,
  Pencil,
} from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  initialSetupAnswers,
  setupQuestions,
  SetupAnswers,
  SetupQuestion,
  SetupQuestionId,
} from "@/lib/global/essentials/setup-questions";
import { showErrorToast, showSuccessToast } from "@/lib/essentials/toast-utils";
import { useSystemConfigStore } from "@/lib/store/system-config-store";

const SETUP_OWNER_STORAGE_KEY = "bookwise:setup-owner";
const REVIEW_WARNING =
  "From this stage onward, these settings cannot be changed later. Please review carefully before continuing.";

type SetupErrors = Partial<Record<SetupQuestionId, string>>;

type SetupMode = "questions" | "review";

const setupFieldSchemas: Record<SetupQuestionId, z.ZodType<string>> = {
  universityName: z.string().trim().min(1, "Institute name is required"),
  websiteUrl: z.url("Enter a valid website URL"),
  supportEmail: z.email("Enter a valid support email"),
  borrowDurationDays: z
    .string()
    .trim()
    .min(1, "Borrow duration is required")
    .refine((value) => Number.isInteger(Number(value)), {
      message: "Borrow duration must be a whole number",
    })
    .refine((value) => Number(value) >= 1 && Number(value) <= 365, {
      message: "Borrow duration must be between 1 and 365 days",
    }),
};

const reviewLabels: Record<SetupQuestionId, string> = {
  universityName: "Institute name",
  websiteUrl: "Website URL",
  supportEmail: "Support email",
  borrowDurationDays: "Borrow duration",
};

const questionIcons: Record<SetupQuestionId, typeof Building2> = {
  universityName: Building2,
  websiteUrl: Globe2,
  supportEmail: Mail,
  borrowDurationDays: LifeBuoy,
};

const primaryButtonClassName = "admin-btn-primary";

const editButtonClassName = "admin-btn-secondary";

const validateField = (field: SetupQuestionId, value: string) => {
  const parsed = setupFieldSchemas[field].safeParse(value);

  if (!parsed.success) {
    return parsed.error.issues[0]?.message || "This field is required";
  }

  return null;
};

const readOwnerDraft = (): SetupOwnerDraft | null => {
  const rawDraft = window.sessionStorage.getItem(SETUP_OWNER_STORAGE_KEY);

  if (!rawDraft) {
    return null;
  }

  try {
    return JSON.parse(rawDraft) as SetupOwnerDraft;
  } catch {
    return null;
  }
};

interface QuestionRendererProps {
  currentIndex: number;
  question: SetupQuestion;
  value: string;
  error?: string;
  canGoBack: boolean;
  submitLabel: "Continue" | "Apply";
  onBack: () => void;
  onChange: (field: SetupQuestionId, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const QuestionRenderer = ({
  currentIndex,
  question,
  value,
  error,
  canGoBack,
  submitLabel,
  onBack,
  onChange,
  onSubmit,
}: QuestionRendererProps) => {
  const Icon = questionIcons[question.id];

  return (
    <form onSubmit={onSubmit} className="space-y-8" noValidate>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
          Question {currentIndex + 1}/{setupQuestions.length}
        </p>

        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          className="setup-back-btn"
          aria-label="Go back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>

      <div>
        <div className="setup-icon-box">
          <Icon className="h-5 w-5" />
        </div>

        <label
          htmlFor={question.id}
          className="block text-3xl font-semibold leading-tight text-dark-400"
        >
          {question.question}
        </label>
      </div>

      <div>
        <Input
          id={question.id}
          name={question.id}
          type={question.type}
          inputMode={question.type === "number" ? "numeric" : undefined}
          min={question.min}
          max={question.max}
          required
          autoComplete={question.autoComplete}
          value={value}
          onChange={(event) => onChange(question.id, event.target.value)}
          placeholder={question.placeholder}
          aria-invalid={!!error}
          aria-describedby={error ? `${question.id}-error` : undefined}
          className="setup-input"
        />

        {error && (
          <p id={`${question.id}-error`} className="mt-2 text-sm text-red-500">
            {error}
          </p>
        )}
      </div>

      <Button type="submit" className={`${primaryButtonClassName} w-full`}>
        {submitLabel}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </form>
  );
};

interface ReviewScreenProps {
  answers: SetupAnswers;
  isEditableReview: boolean;
  isSubmitting: boolean;
  onEdit: () => void;
  onSubmit: () => void;
}

const ReviewScreen = ({
  answers,
  isEditableReview,
  isSubmitting,
  onEdit,
  onSubmit,
}: ReviewScreenProps) => {
  const reviewItems = useMemo(
    () =>
      setupQuestions.map((question) => ({
        id: question.id,
        label: reviewLabels[question.id],
        value:
          question.id === "borrowDurationDays"
            ? `${answers[question.id]} days`
            : answers[question.id],
      })),
    [answers],
  );

  return (
    <div className="space-y-7">
      <div className="flex items-start gap-4">
        <div className="setup-success-icon-box">
          <CheckCircle2 className="h-6 w-6" />
        </div>

        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Final review
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-dark-400">
            Verify your setup
          </h1>
        </div>
      </div>

      <div className="grid gap-3">
        {reviewItems.map((item) => (
          <div key={item.id} className="setup-review-box">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              {item.label}
            </p>
            <p className="mt-1 break-words text-base font-semibold text-slate-900">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <p className="setup-warning-box">{REVIEW_WARNING}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Button
          type="button"
          onClick={onSubmit}
          disabled={isSubmitting}
          className={primaryButtonClassName}
        >
          {isSubmitting && <div className="loader mr-2" />}
          {isEditableReview ? "Apply" : "Continue"}
          <ArrowRight className="h-4 w-4" />
        </Button>

        <Button
          type="button"
          onClick={onEdit}
          disabled={isSubmitting}
          className={editButtonClassName}
        >
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
      </div>
    </div>
  );
};

const SetupPage = () => {
  const router = useRouter();
  const [answers, setAnswers] = useState<SetupAnswers>(initialSetupAnswers);
  const [errors, setErrors] = useState<SetupErrors>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mode, setMode] = useState<SetupMode>("questions");
  const [isEditableReview, setIsEditableReview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const setSystemConfig = useSystemConfigStore(
    (state) => state.setSystemConfig,
  );

  const currentQuestion = setupQuestions[currentIndex];
  const isLastQuestion = currentIndex === setupQuestions.length - 1;

  const handleAnswerChange = (field: SetupQuestionId, value: string) => {
    setAnswers((currentAnswers) => ({
      ...currentAnswers,
      [field]: value,
    }));
    setErrors((currentErrors) => ({
      ...currentErrors,
      [field]: undefined,
    }));
  };

  const validateAllAnswers = () => {
    const nextErrors: SetupErrors = {};

    setupQuestions.forEach((question) => {
      const error = validateField(question.id, answers[question.id]);

      if (error) {
        nextErrors[question.id] = error;
      }
    });

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleQuestionSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const error = validateField(
      currentQuestion.id,
      answers[currentQuestion.id],
    );

    if (error) {
      setErrors((currentErrors) => ({
        ...currentErrors,
        [currentQuestion.id]: error,
      }));
      return;
    }

    if (!isLastQuestion) {
      setCurrentIndex((index) => index + 1);
      return;
    }

    setMode("review");
  };

  const handleBack = () => {
    setCurrentIndex((index) => Math.max(0, index - 1));
  };

  const handleEdit = () => {
    setMode("questions");
    setCurrentIndex(0);
    setIsEditableReview(true);
  };

  const handleFinalSubmit = async () => {
    if (!validateAllAnswers()) {
      setMode("questions");
      const firstInvalidIndex = setupQuestions.findIndex(
        (question) => validateField(question.id, answers[question.id]) !== null,
      );
      setCurrentIndex(Math.max(0, firstInvalidIndex));
      return;
    }

    const ownerDraft = readOwnerDraft();

    if (!ownerDraft) {
      showErrorToast("Create the admin account before completing setup");
      router.push("/account");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...ownerDraft,
          userAvatarFileId: ownerDraft.userAvatarFileId ?? null,
          borrowDurationDays: Number(answers.borrowDurationDays),
          supportEmail: answers.supportEmail.trim(),
          websiteUrl: answers.websiteUrl.trim(),
          universityName: answers.universityName.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to complete setup");
      }

      const signInResult = await signIn("credentials", {
        email: ownerDraft.email,
        password: ownerDraft.password,
        redirect: false,
      });

      if (signInResult?.error) {
        window.sessionStorage.removeItem(SETUP_OWNER_STORAGE_KEY);
        router.push("/sign-in");
        router.refresh();
        return;
      }

      setSystemConfig({
        instituteName: answers.universityName.trim(),
        supportEmail: answers.supportEmail.trim(),
        websiteUrl: answers.websiteUrl.trim(),
        borrowDurationDays: Number(answers.borrowDurationDays),
      });
      showSuccessToast("Setup completed successfully");
      router.push("/admin");
      router.refresh();
    } catch (error) {
      showErrorToast(
        error instanceof Error ? error.message : "Failed to complete setup",
      );
    } finally {
      window.sessionStorage.removeItem(SETUP_OWNER_STORAGE_KEY);
      setIsSubmitting(false);
    }
  };

  return (
    <main className="admin-main">
      <section className="admin-section">
        <div className="setup-card">
          {mode === "questions" ? (
            <QuestionRenderer
              key={currentQuestion.id}
              currentIndex={currentIndex}
              question={currentQuestion}
              value={answers[currentQuestion.id]}
              error={errors[currentQuestion.id]}
              canGoBack={currentIndex > 0}
              submitLabel={
                isEditableReview && isLastQuestion ? "Apply" : "Continue"
              }
              onBack={handleBack}
              onChange={handleAnswerChange}
              onSubmit={handleQuestionSubmit}
            />
          ) : (
            <ReviewScreen
              answers={answers}
              isEditableReview={isEditableReview}
              isSubmitting={isSubmitting}
              onEdit={handleEdit}
              onSubmit={handleFinalSubmit}
            />
          )}
        </div>
      </section>
    </main>
  );
};

export default SetupPage;
