import nodemailer from 'nodemailer';

type MailPayload = { to: string; subject: string; text: string; html: string };

const smtpConfigured = Boolean(
  process.env.NUTRI_SMTP_HOST &&
    process.env.NUTRI_SMTP_USER &&
    process.env.NUTRI_SMTP_PASSWORD &&
    process.env.NUTRI_EMAIL_FROM,
);

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.NUTRI_SMTP_HOST,
      port: Number(process.env.NUTRI_SMTP_PORT || 587),
      secure: Number(process.env.NUTRI_SMTP_PORT || 587) === 465,
      auth: {
        user: process.env.NUTRI_SMTP_USER,
        pass: process.env.NUTRI_SMTP_PASSWORD,
      },
    })
  : null;

export async function sendMail(payload: MailPayload) {
  if (!transporter) return { delivered: false as const };
  try {
    await transporter.sendMail({
      from: process.env.NUTRI_EMAIL_FROM,
      replyTo: process.env.NUTRI_EMAIL_REPLY_TO || undefined,
      ...payload,
    });
    return { delivered: true as const };
  } catch (error) {
    console.error('Não foi possível enviar o e-mail transacional:', error instanceof Error ? error.message : error);
    return { delivered: false as const };
  }
}

export function appUrlForRequest(headers: { [key: string]: unknown }) {
  const configured = process.env.NUTRI_APP_URL?.replace(/\/$/, '');
  if (configured) return configured;
  const forwardedHost = String(headers['x-forwarded-host'] || 'localhost:3000');
  return `https://${forwardedHost}`;
}
