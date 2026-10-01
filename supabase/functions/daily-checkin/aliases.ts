// Short handles in place of UUIDs.
//
// A model asked to copy "3f2c9a1e-7b4d-4c1a-9e8f-…" back out of a list of a
// hundred rows gets it wrong often enough to matter: one flipped character and
// the statement is dropped as a hallucination, silently, with nothing on the
// student's screen to say that "Carnot setini bitirdim" went nowhere. "T12"
// cannot be half-copied, and it costs a tenth of the tokens.
//
// The prompt speaks only in handles; the answer is translated back here,
// before the planner — which still sees real ids and still drops anything it
// does not recognise — ever looks at it.

/** T = görev, K = konu, D = ders, S = sınav, H = hata defteri. */
export type AliasPrefix = 'T' | 'K' | 'D' | 'S' | 'H';

/** Fields that carry one id or a list of ids, whatever object they sit in. */
const ID_KEY = /Id$/;
const ID_LIST_KEY = /Ids$/;

export class Aliases {
  private readonly idByAlias = new Map<string, string>();
  private readonly aliasById = new Map<string, string>();
  private readonly counters = new Map<AliasPrefix, number>();

  /** The handle for an id, minted on first sight: T1, T2… per prefix. */
  of(prefix: AliasPrefix, id: string): string {
    const known = this.aliasById.get(id);
    if (known) return known;
    const next = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, next);
    const alias = `${prefix}${next}`;
    this.idByAlias.set(alias, id);
    this.aliasById.set(id, alias);
    return alias;
  }

  /** The id behind a handle; anything unknown comes back untouched for the planner to reject. */
  idOf(value: string): string {
    const key = value.trim().toUpperCase();
    return this.idByAlias.get(key) ?? value;
  }

  /**
   * Translates every id field of a model answer back to real ids.
   *
   * Walks the structure rather than naming fields, so a field added to the
   * schema tomorrow is covered without anyone remembering to add it here:
   * `taskId`, `topicId`, `examId`… and `replacesTaskIds`, `courseIds`… alike.
   */
  resolve<T>(value: T): T {
    return this.walk(value) as T;
  }

  private walk(node: unknown, key = ''): unknown {
    if (Array.isArray(node)) {
      return node.map((item) =>
        typeof item === 'string' && ID_LIST_KEY.test(key) ? this.idOf(item) : this.walk(item),
      );
    }
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(node)) {
        out[field] = typeof value === 'string' && ID_KEY.test(field) ? this.idOf(value) : this.walk(value, field);
      }
      return out;
    }
    return node;
  }
}
