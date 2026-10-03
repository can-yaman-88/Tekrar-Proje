/** Crockford base32, as issue_focus_timer_code writes it: no I, L, O or U. */
const CODE_SHAPE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/**
 * The code as it was issued, from what the student typed: case, spaces and
 * dashes do not matter, and the look-alikes O, I and L read as 0, 1 and 1.
 * Null when it cannot be a code at all, so a typo never costs a try.
 */
export function normalizePairingCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return CODE_SHAPE.test(code) ? code : null;
}

/**
 * Who is guessing, for the per-caller cap on pairing codes: the first address
 * the platform's proxy saw. A caller can forge it, which is why a cap across
 * all callers stands behind it.
 */
export function callerAddress(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
