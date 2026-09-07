export function securityPolicy(env: Record<string, string | undefined>) {
  const environment = env.NUTRI_ENV || env.NODE_ENV || 'development';
  const production = environment === 'production' || env.NODE_ENV === 'production';
  const localMode = ['development', 'test'].includes(environment) && !production;
  return {
    production,
    allowEmailPreview: localMode && env.NUTRI_ALLOW_EMAIL_PREVIEW === 'true',
    allowDemoSeed: localMode && env.NUTRI_ALLOW_DEMO_SEED === 'true',
    cookieSecure: production || env.NUTRI_APP_URL?.startsWith('https://') === true,
  };
}

export function mailDeliveryResult(delivered: boolean, url: string, successMessage: string, allowPreview: boolean) {
  if (delivered) return { message: successMessage, previewUrl: null, deliveryStatus: 'sent' as const };
  if (allowPreview) return { message: 'Envio indisponível. Use o link de teste deste ambiente local.', previewUrl: url, deliveryStatus: 'preview' as const };
  return {
    message: 'Não foi possível entregar o e-mail. A confirmação ou restauração continua pendente; solicite um novo envio ao responsável pelo seu cadastro.',
    previewUrl: null,
    deliveryStatus: 'failed' as const,
  };
}
