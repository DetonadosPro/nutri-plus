import { describe, expect, it } from 'vitest';
import { bootTelemetryLog, bootTelemetrySchema } from './boot-telemetry';

describe('client boot telemetry', () => {
  it('accepts only bounded technical fields', () => {
    const value = bootTelemetrySchema.parse({
      buildId: 'abc123',
      stage: 'first-ui-rendered',
      elapsedMs: 824,
      detail: 'login',
      device: 'mobile',
      online: true,
    });
    expect(bootTelemetryLog(value)).toBe(
      'build=abc123; stage=first-ui-rendered; ms=824; device=mobile; online=true; detail=login',
    );
    expect(bootTelemetrySchema.safeParse({ ...value, patientId: 12 }).success).toBe(false);
  });

  it('rejects oversized or unknown diagnostic payloads', () => {
    expect(
      bootTelemetrySchema.safeParse({
        buildId: 'abc',
        stage: 'unknown',
        elapsedMs: 1,
        device: 'desktop',
        online: true,
      }).success,
    ).toBe(false);
    expect(
      bootTelemetrySchema.safeParse({
        buildId: 'abc',
        stage: 'boot-error',
        elapsedMs: 1,
        detail: 'x'.repeat(181),
        device: 'desktop',
        online: true,
      }).success,
    ).toBe(false);
  });
});
