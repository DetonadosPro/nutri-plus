'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, KeyRound, MailCheck } from 'lucide-react';
import { api } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Brand } from './brand';

type Flow = { type: 'activate' } | { type: 'verify'; token: string } | { type: 'reset'; token: string };

type InvitedRole = 'patient' | 'nutritionist';
const roleLabel: Record<InvitedRole, string> = { patient: 'Paciente', nutritionist: 'Nutricionista' };

export function AccountAccessScreen({ flow, onBack }: { flow: Flow; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(flow.type === 'verify');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [identifiedRole, setIdentifiedRole] = useState<InvitedRole | null>(null);

  useEffect(() => {
    if (flow.type !== 'verify') return;
    api<{ message: string }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token: flow.token }),
    })
      .then((result) => setMessage(result.message))
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível confirmar.'))
      .finally(() => setLoading(false));
  }, [flow]);

  async function identifyCode() {
    if (!code.trim()) return setError('Informe o código de convite.');
    setLoading(true);
    setError('');
    try {
      const result = await api<{ role: InvitedRole }>('/auth/activation-code/identify', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setIdentifiedRole(result.role);
    } catch (reason) {
      setIdentifiedRole(null);
      setError(reason instanceof Error ? reason.message : 'Não foi possível identificar o código.');
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (password.length < 8) return setError('A senha deve ter pelo menos 8 caracteres.');
    if (password !== confirmation) return setError('As senhas não coincidem.');
    setLoading(true);
    setError('');
    try {
      if (flow.type === 'activate') {
        if (!identifiedRole) throw new Error('Identifique o código antes de continuar.');
        if (!email.trim()) throw new Error('Informe o seu e-mail.');
        const result = await api<{ message: string; previewUrl: string | null }>('/auth/activate', {
          method: 'POST',
          body: JSON.stringify({ code, email: email.trim(), password }),
        });
        setMessage(result.message);
        setPreviewUrl(result.previewUrl);
      } else if (flow.type === 'reset') {
        const result = await api<{ message: string }>('/auth/password-reset', {
          method: 'POST',
          body: JSON.stringify({ token: flow.token, password }),
        });
        setMessage(result.message);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível concluir.');
    } finally {
      setLoading(false);
    }
  }

  const title = flow.type === 'activate'
    ? 'Ative seu acesso'
    : flow.type === 'reset' ? 'Crie uma nova senha' : 'Confirmando seu e-mail';
  return (
    <main className="login-shell grid min-h-dvh place-items-center px-5 py-8">
      <section className="login-card w-full max-w-md">
        <Brand />
        <p className="mt-3 text-sm font-semibold text-primary">Acesso Nutri+</p>
        <button type="button" onClick={onBack} className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-primary">
          <ArrowLeft className="size-4" /> Voltar para entrar
        </button>
        <div className="mt-7 grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
          {flow.type === 'verify' ? <MailCheck /> : <KeyRound />}
        </div>
        <h1 className="font-display mt-4 text-3xl font-semibold tracking-[-0.04em]">{title}</h1>
        {message ? (
          <div className="mt-6 space-y-4">
            <p className="flex gap-2 rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm leading-relaxed text-primary">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" /> {message}
            </p>
            {previewUrl && (
              <a href={previewUrl} className="block rounded-xl border px-4 py-3 text-center text-sm font-semibold text-primary">
                Abrir confirmação local de teste
              </a>
            )}
            <Button className="w-full" onClick={onBack}>Ir para o acesso</Button>
          </div>
        ) : flow.type === 'verify' && loading ? (
          <p className="mt-5 text-sm text-muted-foreground">Validando o link…</p>
        ) : (
          <div className="mt-6 space-y-4">
            {flow.type === 'activate' && (
              <>
                <div className="space-y-2"><Label htmlFor="activation-code">Código de convite</Label><Input id="activation-code" value={code} onChange={(event) => { setCode(event.target.value.toUpperCase()); setIdentifiedRole(null); }} placeholder="XXXXX-XXXXX" autoCapitalize="characters" /></div>
                {!identifiedRole ? (
                  <Button variant="outline" className="w-full" onClick={identifyCode} disabled={loading}>{loading ? 'Identificando…' : 'Continuar'}</Button>
                ) : (
                  <>
                    <p className="rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm text-primary">Convite identificado: conta de <strong>{roleLabel[identifiedRole]}</strong>.</p>
                    <div className="space-y-2"><Label htmlFor="activation-email">Seu e-mail</Label><Input id="activation-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></div>
                  </>
                )}
              </>
            )}
            {(flow.type !== 'activate' || identifiedRole) && <>
              <div className="space-y-2"><Label htmlFor="account-password">Nova senha</Label><Input id="account-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} /></div>
              <div className="space-y-2"><Label htmlFor="account-confirmation">Confirmar senha</Label><Input id="account-confirmation" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={8} /></div>
            </>}
            {error && <p role="alert" className="rounded-xl bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>}
            {(flow.type !== 'activate' || identifiedRole) && <Button className="w-full" onClick={submit} disabled={loading}>{loading ? 'Enviando…' : flow.type === 'activate' ? 'Cadastrar e confirmar e-mail' : 'Salvar nova senha'}</Button>}
          </div>
        )}
        {flow.type === 'verify' && error && <p role="alert" className="mt-5 rounded-xl bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>}
      </section>
    </main>
  );
}
