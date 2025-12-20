import { db } from "@/database/drizzle";
import { users } from "@/database/schema";
import { sendEmail } from "@/lib/emailjs";
import config from "@/lib/config";
import { serve } from "@upstash/workflow/nextjs";
import { eq } from "drizzle-orm";

type UserState = "non-active" | "active";

type InitialData = {
  email: string;
  fullName: string;
};

const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
const THREE_DAYS_IN_MS = ONE_DAY_IN_MS * 3;
const ONE_MONTH_IN_MS = ONE_DAY_IN_MS * 30;

const getUserState = async (email: string): Promise<UserState> => {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (user.length === 0) {
    return "non-active";
  }

  // Guard against null/undefined lastActivityDate
  if (!user[0].lastActivityDate) {
    return "non-active";
  }

  const lastActivityDate = new Date(user[0].lastActivityDate);

  // Validate the date is not Invalid Date
  if (isNaN(lastActivityDate.getTime())) {
    return "non-active";
  }

  const now = new Date();
  const timeDifference = now.getTime() - lastActivityDate.getTime();

  if (timeDifference > THREE_DAYS_IN_MS && timeDifference <= ONE_MONTH_IN_MS) {
    return "non-active";
  }
  return "active";
};

export const { POST } = serve<InitialData>(async (context) => {
  const { email, fullName } = context.requestPayload;

  // Get template IDs
  const welcomeTemplateId = config.env.emailjs.templateId.welcome;
  const reEngagementTemplateId = config.env.emailjs.templateId.reEngagement;

  // Welcome email
  await context.run("new-signup", async () => {
    await sendEmail(welcomeTemplateId, {
      from_name: "BookWise Team",
      user_email: email,
      user_name: fullName,
      message: `Welcome ${fullName}! We're excited to have you on board.`,
    });
  });

  await context.sleep("wait-for-3-days", 60 * 60 * 24 * 3);

  let i = 0;

  while (true) {
    i++;
    const state = await context.run(`check-user-state-${i}`, async () => {
      return await getUserState(email);
    });

    // Only send reengagement email if user is non-active
    if (state === "non-active") {
      await context.run(`send-email-non-active-${i}`, async () => {
        await sendEmail(reEngagementTemplateId, {
          from_name: "BookWise Team",
          user_email: email,
          user_name: fullName,
          message: `Hey ${fullName}, we miss you! Come back and discover new books.`,
        });
      });
    }
    // If user is active, no email is sent, just continue the loop

    await context.sleep(`wait-for-1-month-${i}`, 60 * 60 * 24 * 30);
  }
});
