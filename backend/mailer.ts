import nodemailer from 'nodemailer';
import { appConfig } from './config';
import { mailDeliveryResult } from './security-policy';

type MailPayload = { to: string; subject: string; text: string; html: string };

type AccountMailTemplate = {
  name: string;
  eyebrow: string;
  title: string;
  message: string;
  actionLabel: string;
  actionUrl: string;
  expiration: string;
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!,
  );
}

export function accountMailHtml(template: AccountMailTemplate) {
  const name = escapeHtml(template.name);
  const eyebrow = escapeHtml(template.eyebrow);
  const title = escapeHtml(template.title);
  const message = escapeHtml(template.message);
  const actionLabel = escapeHtml(template.actionLabel);
  const actionUrl = escapeHtml(template.actionUrl);
  const expiration = escapeHtml(template.expiration);

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f7f5;font-family:Arial,Helvetica,sans-serif;color:#173d34;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${message}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7f5;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #dfe9e4;border-radius:24px;overflow:hidden;box-shadow:0 10px 30px rgba(23,61,52,.08);">
            <tr>
              <td style="padding:28px 32px;background:#176b52;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td align="center" width="46" height="46" style="width:46px;height:46px;border-radius:15px;background:#ffffff;color:#176b52;font-size:25px;font-weight:700;">♡</td>
                    <td style="padding-left:14px;color:#ffffff;font-size:25px;font-weight:700;letter-spacing:-.5px;">Nutri+</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 32px;">
                <p style="margin:0 0 12px;color:#4b8d78;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">${eyebrow}</p>
                <h1 style="margin:0 0 22px;color:#173d34;font-size:28px;line-height:1.2;letter-spacing:-.6px;">${title}</h1>
                <p style="margin:0 0 12px;color:#34584e;font-size:16px;line-height:1.6;">Olá, <strong>${name}</strong>.</p>
                <p style="margin:0 0 28px;color:#34584e;font-size:16px;line-height:1.6;">${message}</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td align="center" style="border-radius:14px;background:#2f9f78;">
                      <a href="${actionUrl}" style="display:block;padding:16px 24px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:14px;">${actionLabel}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;color:#71877f;font-size:13px;line-height:1.5;">${expiration}</p>
                <p style="margin:8px 0 0;color:#71877f;font-size:13px;line-height:1.5;">Se você não solicitou este acesso, pode ignorar esta mensagem.</p>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0;color:#81918c;font-size:12px;line-height:1.5;">Nutri+ · Cuidado simples, todos os dias.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

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
