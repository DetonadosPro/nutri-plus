import { LogOut } from 'lucide-react';
import { initials } from '@/lib/nutrition-format';

export function UserIdentity({
  name,
  accountType,
  onLogout,
}: {
  name: string;
  accountType: 'Paciente' | 'Nutricionista' | 'Administrador';
  onLogout: () => void;
}) {
  return (
    <section className="user-identity" aria-label="Conta atual">
      <span className="avatar-mark">{initials(name)}</span>
      <div className="min-w-0 flex-1">
        <p className="user-identity-name" title={name}>{name}</p>
        <p className="text-xs text-muted-foreground">{accountType}</p>
      </div>
      <button onClick={onLogout} className="user-logout" aria-label="Sair">
        <LogOut className="size-4" />
      </button>
    </section>
  );
}
