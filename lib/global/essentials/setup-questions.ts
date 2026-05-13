import { DEFAULT_SYSTEM_CONFIG } from "./system-config";

export type SetupQuestionId =
  | "universityName"
  | "websiteUrl"
  | "supportEmail"
  | "borrowDurationDays";

export type SetupQuestionInputType = "text" | "url" | "email" | "number";

export interface SetupQuestion {
  id: SetupQuestionId;
  question: string;
  placeholder: string;
  type: SetupQuestionInputType;
  autoComplete?: string;
  min?: number;
  max?: number;
}

export type SetupAnswers = Record<SetupQuestionId, string>;

export const setupQuestions: SetupQuestion[] = [
  {
    id: "universityName",
    question: "What is your institute name? (Use abbreviation)",
    placeholder: "Institute name",
    type: "text",
    autoComplete: "organization",
  },
  {
    id: "websiteUrl",
    question: "What is your website URL?",
    placeholder: "https://example.edu",
    type: "url",
    autoComplete: "url",
  },
  {
    id: "supportEmail",
    question: "What is your support email?",
    placeholder: "support@example.edu",
    type: "email",
    autoComplete: "email",
  },
  {
    id: "borrowDurationDays",
    question: "How long can books be borrowed?",
    placeholder: String(DEFAULT_SYSTEM_CONFIG.borrowDurationDays),
    type: "number",
    min: 1,
    max: 365,
  },
];

export const initialSetupAnswers: SetupAnswers = {
  universityName: "",
  websiteUrl: "",
  supportEmail: "",
  borrowDurationDays: "",
};
