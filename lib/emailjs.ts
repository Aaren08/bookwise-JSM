import emailjs from "@emailjs/browser";
import config from "./config";

// Initialize EmailJS with your public key
emailjs.init(config.env.emailjs.publicKey);

/**
 * Send an email using EmailJS
 * @param templateParams - Parameters to fill the email template
 * @returns Promise with the response
 */
export const sendEmail = async (templateParams: EmailParams) => {
  try {
    const response = await emailjs.send(
      config.env.emailjs.serviceId,
      config.env.emailjs.templateId,
      templateParams
    );

    console.log("Email sent successfully:", response.status, response.text);
    return { success: true, response };
  } catch (error) {
    console.error("Failed to send email:", error);
    return { success: false, error };
  }
};
