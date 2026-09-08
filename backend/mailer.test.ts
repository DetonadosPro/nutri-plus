import { expect, test } from 'vitest';
import { accountMailHtml } from './mailer';

test('account email uses the branded layout and escapes dynamic content', () => {
  const html = accountMailHtml({
    name: '<Rafael & família>',
    eyebrow: 'Confirmação de e-mail',
    title: 'Seu acesso está quase pronto',
    message: 'Confirme seu e-mail.',
    actionLabel: 'Confirmar meu e-mail',
    actionUrl: 'https://nutriplusapp.store/?token=a&next=b',
    expiration: 'Este link expira em 24 horas.',
  });

  expect(html).toMatch(/background:#176b52/);
  expect(html).toMatch(/border-radius:24px/);
  expect(html).toMatch(/>Confirmar meu e-mail<\/a>/);
  expect(html).toMatch(/&lt;Rafael &amp; família&gt;/);
  expect(html).toMatch(/token=a&amp;next=b/);
  expect(html).not.toMatch(/<Rafael & família>/);
});
