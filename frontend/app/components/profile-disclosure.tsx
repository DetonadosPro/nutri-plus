'use client';

import { ChevronDown } from 'lucide-react';

export function ProfileDisclosure({
  title,
  items,
  defaultOpen = false,
}: {
  title: string;
  items: Array<[string, string]>;
  defaultOpen?: boolean;
}) {
  return (
    <details className="profile-disclosure" open={defaultOpen || undefined}>
      <summary>
        <span>{title}</span>
        <ChevronDown className="size-4" />
      </summary>
      <dl>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
