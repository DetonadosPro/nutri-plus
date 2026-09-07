'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LogOut, MailCheck, MoreHorizontal, Plus, ShieldCheck, UserRoundCheck, UserRoundX } from 'lucide-react';
import { api } from '@/lib/client-api';
import type { User } from '../types';
import { Brand } from './brand';
import { UserIdentity } from './user-identity';
import { PageHeader, ContentSkeleton, EmptyState } from './page-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';

type NutritionistAccount = {
  id: number; name: string; email: string | null; crn: string | null; state: string | null; phone: string | null;
  accessStatus: 'pending_activation' | 'pending_verification' | 'active' | 'suspended';
};

const statusLabel: Record<NutritionistAccount['accessStatus'], string> = {
  pending_activation: 'Aguardando ativação', pending_verification: 'Aguardando confirmação', active: 'Acesso ativo', suspended: 'Acesso suspenso',
};

export function AdminApp({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [items, setItems] = useState<NutritionistAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', crn: '', state: '', phone: '' });
  const [activationCode, setActivationCode] = useState('');
  const [resultMessage, setResultMessage] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await api('/admin/nutritionists')); }
    catch { toast.add({ title: 'Não foi possível carregar os nutricionistas.', type: 'error' }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!form.name.trim() || !form.crn.trim() || form.state.trim().length !== 2) return setError('Informe nome, CRN e UF.');
    setError('');
    try {
      const result = await api<{ activationCode: string }>('/admin/nutritionists', { method: 'POST', body: JSON.stringify(form) });
      setActivationCode(result.activationCode);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível cadastrar.'); }
  }

  async function access(account: NutritionistAccount, action: 'activation' | 'verification' | 'password_reset' | 'suspend' | 'reactivate') {
    try {
      const result = await api<{ message?: string; activationCode?: string; previewUrl?: string | null; deliveryStatus?: string }>(`/admin/nutritionists/${account.id}/access`, { method: 'POST', body: JSON.stringify({ action }) });
      if (result.deliveryStatus === 'failed') {
        toast.add({ title: result.message || 'Não foi possível entregar o e-mail.', type: 'error' });
        await load();
        return;
      }
      if (result.activationCode) setActivationCode(result.activationCode);
      setResultMessage(result.message || (result.activationCode ? 'Novo código gerado.' : 'Ação concluída.'));
      setPreviewUrl(result.previewUrl || null);
      setCreateOpen(true);
      toast.add({ title: result.message || 'Ação concluída.', type: 'success' });
      await load();
    } catch (reason) { toast.add({ title: reason instanceof Error ? reason.message : 'Não foi possível concluir.', type: 'error' }); }
  }

  return (
    <main className="app-canvas nutritionist-app-shell pb-5">
      <header className="mobile-topbar lg:hidden"><Brand compact /><button onClick={onLogout} className="icon-button" aria-label="Sair"><LogOut className="size-4" /></button></header>
      <div className="app-frame lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
        <aside className="app-sidebar hidden lg:flex"><Brand /><div className="mt-10 rounded-xl bg-white px-3 py-3 text-sm font-semibold text-primary"><ShieldCheck className="mr-2 inline size-4" />Administração</div><div className="mt-auto border-t pt-5"><UserIdentity name={user.name} accountType="Administrador" onLogout={onLogout} /></div></aside>
        <section className="content-shell">
          <PageHeader eyebrow="Administração" title="Nutricionistas" description="Gerencie exclusivamente as contas profissionais. Nenhum dado de paciente é exibido nesta área." action={<Button onClick={() => setCreateOpen(true)}><Plus />Cadastrar nutricionista</Button>} />
          {loading ? <ContentSkeleton rows={5} /> : items.length === 0 ? <EmptyState icon={UserRoundCheck} title="Nenhum nutricionista cadastrado" description="Cadastre o primeiro profissional para gerar seu código de ativação." /> : (
            <div className="patient-list">
              {items.map((item) => <div key={item.id} className="patient-row">
                <div className="patient-row-open">
                  <span className="avatar-mark">{item.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span>
                  <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.name}</strong><small className="block truncate text-muted-foreground">{item.crn ? `${item.crn} · ${item.state}` : 'Registro profissional não informado'}</small></span>
                  <span className="patient-cell"><small>E-mail</small><strong>{item.email || 'Ainda não cadastrado'}</strong></span>
                  <span className="patient-cell"><small>Situação</small><strong>{statusLabel[item.accessStatus]}</strong></span>
                </div>
                <DropdownMenu><DropdownMenuTrigger className="icon-button subtle size-9" aria-label={`Ações de ${item.name}`}><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end">
                  {item.accessStatus === 'pending_activation' && <DropdownMenuItem onClick={() => access(item, 'activation')}><KeyRound />Gerar novo código</DropdownMenuItem>}
                  {item.accessStatus === 'pending_verification' && <DropdownMenuItem onClick={() => access(item, 'verification')}><MailCheck />Reenviar confirmação</DropdownMenuItem>}
                  {item.accessStatus === 'active' && <><DropdownMenuItem onClick={() => access(item, 'password_reset')}><KeyRound />Enviar restauração</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => access(item, 'suspend')}><UserRoundX />Suspender acesso</DropdownMenuItem></>}
                  {item.accessStatus === 'suspended' && <DropdownMenuItem onClick={() => access(item, 'reactivate')}><UserRoundCheck />Reativar acesso</DropdownMenuItem>}
                </DropdownMenuContent></DropdownMenu>
              </div>)}
            </div>
          )}
        </section>
      </div>
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) { setActivationCode(''); setResultMessage(''); setPreviewUrl(null); setError(''); } }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{activationCode ? 'Código de ativação' : resultMessage ? 'Ação concluída' : 'Cadastrar nutricionista'}</DialogTitle><DialogDescription>{activationCode ? 'Entregue este código ao profissional. Ele poderá cadastrar o próprio e-mail e senha.' : resultMessage ? 'O acesso profissional foi atualizado.' : 'Esta área registra somente a conta profissional.'}</DialogDescription></DialogHeader>
        {activationCode || resultMessage ? <div className="space-y-4">{activationCode && <div className="rounded-2xl border border-primary/15 bg-primary/5 p-5 text-center"><strong className="font-mono text-3xl tracking-[.12em] text-primary">{activationCode}</strong><p className="mt-2 text-xs text-muted-foreground">Válido por 7 dias e uma única utilização.</p></div>}{resultMessage && <p className="rounded-xl border border-primary/15 bg-primary/5 p-3 text-sm text-primary">{resultMessage}</p>}{activationCode && <Button className="w-full" onClick={() => navigator.clipboard.writeText(activationCode)}>Copiar código</Button>}{previewUrl && <a href={previewUrl} className="block rounded-xl border p-3 text-center text-sm font-semibold text-primary">Abrir link local de teste</a>}<Button variant="outline" className="w-full" onClick={() => { setActivationCode(''); setResultMessage(''); setPreviewUrl(null); setCreateOpen(false); }}>Concluir</Button></div> : <div className="space-y-4"><div className="space-y-2"><Label>Nome completo</Label><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div><div className="grid grid-cols-[1fr_90px] gap-3"><div className="space-y-2"><Label>CRN</Label><Input value={form.crn} onChange={(event) => setForm({ ...form, crn: event.target.value })} /></div><div className="space-y-2"><Label>UF</Label><Input maxLength={2} value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })} /></div></div><div className="space-y-2"><Label>Telefone (opcional)</Label><Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button className="w-full" onClick={create}>Cadastrar e gerar código</Button></div>}
      </DialogContent></Dialog>
    </main>
  );
}
