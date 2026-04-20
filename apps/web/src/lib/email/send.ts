import nodemailer, { type Transporter } from "nodemailer";

let cachedTransporter: Transporter | null = null;
let smtpConfiguredCached: boolean | null = null;

function isSmtpConfigured(): boolean {
  if (smtpConfiguredCached !== null) return smtpConfiguredCached;
  const ok = Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT);
  smtpConfiguredCached = ok;
  return ok;
}

function getTransporter(): Transporter | null {
  if (!isSmtpConfigured()) return null;
  if (cachedTransporter) return cachedTransporter;

  const port = Number(process.env.SMTP_PORT || 587);
  const secureEnv = (process.env.SMTP_SECURE || "").toLowerCase();
  const secure =
    secureEnv === "true" || secureEnv === "1" || secureEnv === "yes" || port === 465;

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
  return cachedTransporter;
}

function fromAddress(): string {
  return process.env.SMTP_FROM || "Backslash <no-reply@localhost>";
}

interface SendArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

async function sendMail({ to, subject, text, html }: SendArgs): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    // Dev fallback: write the message to stdout so testers can grab the link.
    console.log(
      `\n[email:dev] SMTP not configured; printing email instead:\n` +
        `  to: ${to}\n  subject: ${subject}\n  body:\n${text}\n`,
    );
    return;
  }
  await transporter.sendMail({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
): Promise<void> {
  const subject = "Reset your Backslash password";
  const text =
    `Someone (hopefully you) requested a password reset for your Backslash account.\n\n` +
    `Open this link within 30 minutes to choose a new password:\n${resetUrl}\n\n` +
    `If you did not request this, you can ignore this email.`;
  const html =
    `<p>Someone (hopefully you) requested a password reset for your Backslash account.</p>` +
    `<p><a href="${resetUrl}">Reset your password</a> (valid for 30 minutes).</p>` +
    `<p>If you did not request this, you can ignore this email.</p>`;
  await sendMail({ to, subject, text, html });
}
