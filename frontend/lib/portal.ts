export type PortalRole = 'patient' | 'nutritionist' | 'admin';

const portalHosts: Record<PortalRole, string> = {
  patient: 'nutriplusapp.store',
  nutritionist: 'pro.nutriplusapp.store',
  admin: 'admin.nutriplusapp.store',
};

export function portalForLocation(location: Pick<Location, 'hostname' | 'search'>): PortalRole {
  const hostname = location.hostname.toLowerCase();
  if (hostname === portalHosts.admin || hostname.startsWith('admin.')) return 'admin';
  if (hostname === portalHosts.nutritionist || hostname.startsWith('pro.')) return 'nutritionist';

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const requested = new URLSearchParams(location.search).get('portal');
    if (requested === 'admin' || requested === 'nutritionist' || requested === 'patient') return requested;
  }

  return 'patient';
}

export function portalUrl(role: PortalRole) {
  if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return `${window.location.origin}/?portal=${role}`;
  }
  return `https://${portalHosts[role]}`;
}

export const portalLabels: Record<PortalRole, string> = {
  patient: 'Paciente',
  nutritionist: 'Nutricionista',
  admin: 'Administração',
};
