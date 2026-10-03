import type { FocusTimerDevice } from '@entities/focus-timer';
import { deviceThatUsed, displayCode, type OpenCode } from '../pairing-code.model';

const device = (id: string, label: string | null = null): FocusTimerDevice => ({
  id,
  label,
  linkedAt: '2026-10-02T10:00:00Z',
  lastUsedAt: null,
});

const open: OpenCode = {
  code: { code: 'PXA0PK8S', expiresAt: '2026-10-02T10:10:00Z' },
  known: new Set(['phone']),
};

describe('displayCode', () => {
  it('kodu ikiye böler', () => {
    expect(displayCode('PXA0PK8S')).toBe('PXA0-PK8S');
  });
});

describe('deviceThatUsed', () => {
  it('kod alınırken zaten bağlı olan cihazları saymaz', () => {
    expect(deviceThatUsed([device('phone')], open)).toBeUndefined();
  });

  it('sonradan beliren bağlantıyı kodu kullanan cihaz sayar', () => {
    expect(deviceThatUsed([device('tablet', 'Galaxy Tab'), device('phone')], open)?.label).toBe('Galaxy Tab');
  });

  it('açık kod ya da liste yokken kimseyi göstermez', () => {
    expect(deviceThatUsed([device('tablet')], null)).toBeUndefined();
    expect(deviceThatUsed(undefined, open)).toBeUndefined();
  });
});
