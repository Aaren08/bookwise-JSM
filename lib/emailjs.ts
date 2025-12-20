import config from "./config";

/**
 * Send an email using EmailJS REST API (for server-side use)
 * @param templateId - The EmailJS template ID to use
 * @param templateParams - Parameters to fill the email template
 * @returns Promise with the response
 */
export const sendEmail = async (
  templateId: string,
  templateParams: EmailParams
) => {
  try {
    const response = await fetch(
      "https://api.emailjs.com/api/v1.0/email/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          service_id: config.env.emailjs.serviceId,
          template_id: templateId,
          user_id: config.env.emailjs.publicKey,
          accessToken: config.env.emailjs.privateKey,
          template_params: templateParams,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`EmailJS API error: ${response.status} - ${errorData}`);
    }

    const data = await response.text();
    console.log("Email sent successfully:", data);
    return { success: true, response: data };
  } catch (error) {
    console.error("Failed to send email:", error);
    return { success: false, error };
  }
};

/**
 * Send an email using EmailJS browser SDK (for client-side use only)
 * This should only be used in client components with "use client" directive
 * @param templateId - The EmailJS template ID to use
 * @param templateParams - Parameters to fill the email template
 */
export const sendEmailClient = async (
  templateId: string,
  templateParams: EmailParams
) => {
  // Dynamic import to prevent server-side errors
  const emailjs = await import("@emailjs/browser");

  try {
    emailjs.default.init(config.env.emailjs.publicKey);

    const response = await emailjs.default.send(
      config.env.emailjs.serviceId,
      templateId,
      templateParams
    );

    console.log("Email sent successfully:", response.status, response.text);
    return { success: true, response };
  } catch (error) {
    console.error("Failed to send email:", error);
    return { success: false, error };
  }
};
