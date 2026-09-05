import nodemailer from 'nodemailer';
import { appConfig } from './config';

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
  } catch (error) {
    console.error('Não foi possível enviar o e-mail transacional:', error instanceof Error ? error.message : error);
    return { delivered: false as const };
  }
}

export function appUrlForRequest(headers: { [key: string]: unknown }) {
  const configured = appConfig.appUrl;
  if (configured) return configured;
  const forwardedHost = String(headers['x-forwarded-host'] || 'localhost:3000');
  return `https://${forwardedHost}`;
}

export function appUrlForRole(role: 'patient' | 'nutritionist' | 'admin', headers: { [key: string]: unknown }) {
  return appConfig.portalUrls[role] || appUrlForRequest(headers);
}
