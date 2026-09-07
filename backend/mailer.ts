import nodemailer from 'nodemailer';
import { appConfig } from './config';
import { mailDeliveryResult } from './security-policy';

type MailPayload = { to: string; subject: string; text: string; html: string };

const smtpConfigured = Boolean(
  appConfig.email.host &&
    appConfig.email.user &&
    appConfig.email.password &&
    appConfig.email.from,
);

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: appConfig.email.host,
      port: appConfig.email.port,
      secure: appConfig.email.port === 465,
      requireTLS: appConfig.email.port !== 465,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      auth: {
        user: appConfig.email.user,
        pass: appConfig.email.password,
      },
    })
  : null;

export async function sendMail(payload: MailPayload) {
  if (!transporter) return { delivered: false as const };
  try {
    await transporter.sendMail({
      from: appConfig.email.from,
      replyTo: appConfig.email.replyTo || undefined,
      ...payload,
    });
    return { delivered: true as const };
  } catch {
    console.error('Não foi possível entregar o e-mail transacional.');
    return { delivered: false as const };
  }
}

export function deliveryResult(delivered: boolean, url: string, successMessage: string) {
  return mailDeliveryResult(delivered, url, successMessage, appConfig.security.allowEmailPreview);
}

export function appUrlForRequest(headers: { [key: string]: unknown }) {
  const configured = appConfig.appUrl;
  if (configured) return configured;
  return 'http://localhost:3000';
}
