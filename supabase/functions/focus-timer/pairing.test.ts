import { assertEquals } from 'jsr:@std/assert@1';
import { TimerDeviceSchema } from '../_shared/contracts/focus-timer.contract.ts';
import { callerAddress, normalizePairingCode } from './pairing.ts';

Deno.test('a code reads the same however it is typed', () => {
  assertEquals(normalizePairingCode('PXA0PK8S'), 'PXA0PK8S');
  assertEquals(normalizePairingCode('pxa0-pk8s'), 'PXA0PK8S');
  assertEquals(normalizePairingCode(' PXA0 PK8S '), 'PXA0PK8S');
});

Deno.test('look-alike letters read as the digits the code holds', () => {
  assertEquals(normalizePairingCode('PXAOPK8S'), 'PXA0PK8S');
  assertEquals(normalizePairingCode('il234567'), '11234567');
});

Deno.test('anything that cannot be a code is turned away before it costs a try', () => {
  assertEquals(normalizePairingCode(''), null);
  assertEquals(normalizePairingCode('PXA0PK8'), null);
  assertEquals(normalizePairingCode('PXA0PK8SX'), null);
  assertEquals(normalizePairingCode('PXA0PK8U'), null);
  assertEquals(normalizePairingCode('PXA0PK8!'), null);
});

Deno.test('the caller is the first address the proxy saw', () => {
  assertEquals(callerAddress(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })), '203.0.113.7');
  assertEquals(callerAddress(new Headers()), 'unknown');
});

Deno.test('a device name is trimmed to what Settings shows; a blank one is none', () => {
  const id = 'dddddddd-0000-4000-8000-000000000001';
  assertEquals(TimerDeviceSchema.parse({ id, name: '  Galaxy Tab S9  ' }), { id, name: 'Galaxy Tab S9' });
  assertEquals(TimerDeviceSchema.parse({ id, name: '   ' }), { id, name: null });
  assertEquals(TimerDeviceSchema.parse({ id }), { id, name: null });
  assertEquals(TimerDeviceSchema.parse({ id, name: 'x'.repeat(80) }).name?.length, 60);
});
