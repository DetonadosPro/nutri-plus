import { z } from 'zod';

export const bootTelemetrySchema = z
  .object({
    buildId: z.string().trim().min(1).max(80),
    stage: z.enum([
      'html-loaded',
      'dom-ready',
      'bundle-start',
      'react-entry',
      'providers-mounted',
      'session-check-start',
      'session-check-complete',
      'first-ui-rendered',
      'asset-error',
      'js-error',
      'unhandled-rejection',
      'boot-timeout',
      'chunk-recovery',
      'boot-error',
    ]),
    elapsedMs: z.number().finite().min(0).max(300_000),
    detail: z.string().trim().max(180).optional(),
    device: z.enum(['mobile', 'desktop', 'unknown']),
    online: z.boolean(),
  })
  .strict();

export type BootTelemetry = z.infer<typeof bootTelemetrySchema>;

export function bootTelemetryLog(value: BootTelemetry) {
  const detail = value.detail ? `; detail=${value.detail.replace(/[\r\n;]/g, ' ')}` : '';
  return `build=${value.buildId}; stage=${value.stage}; ms=${Math.round(value.elapsedMs)}; device=${value.device}; online=${value.online}${detail}`;
}
