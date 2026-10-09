/** Physical per-record persistence shared by the existing recovery owners. */
export type RecordVersion = { raw: string | null; legacy: string | null };

export function createRecordStorage<T>(options: {
  key: string;
  parse: (raw: string | null) => T[];
  serialize: (records: T[]) => string;
  id: (record: T) => string;
}) {
  const prefix = `${options.key}:record:`;
  const physicalKey = (id: string) => `${prefix}${encodeURIComponent(id)}`;
  const legacyRecords = () => options.parse(window.localStorage.getItem(options.key));
  const read = () => {
    const records = new Map<string, T>();
    const versions = new Map<string, RecordVersion>();
    for (const row of legacyRecords()) {
      const id = options.id(row);
      if (records.has(id)) throw new Error("Duplicate recovery record identity.");
      records.set(id, row);
      versions.set(id, { raw: null, legacy: options.serialize([row]) });
    }
    const keys = Object.keys(window.localStorage).filter((key) => key.startsWith(prefix));
    for (const key of keys) {
      const id = decodeURIComponent(key.slice(prefix.length));
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;
      const rows = options.parse(raw);
      if (rows.length > 1 || (rows[0] && options.id(rows[0]) !== id))
        throw new Error("Recovery record identity changed.");
      if (rows[0]) records.set(id, rows[0]);
      else records.delete(id); // A durable tombstone suppresses its legacy entry.
      versions.set(id, { raw, legacy: versions.get(id)?.legacy ?? null });
    }
    return { records: [...records.values()], versions };
  };
  const write = (id: string, row: T | null, expected: RecordVersion): RecordVersion => {
    if (row && options.id(row) !== id) throw new Error("Recovery record identity changed.");
    const key = physicalKey(id);
    const next = options.serialize(row ? [row] : []);
    const raw = window.localStorage.getItem(key);
    // Retrying an exact write whose readback failed is safe and idempotent.
    if (raw === next) return { raw: next, legacy: expected.legacy };
    if (raw !== expected.raw)
      throw new Error("The saved submission changed. Preserve its recovery record.");
    if (raw === null) {
      const legacy = legacyRecords().find((entry) => options.id(entry) === id);
      if ((legacy ? options.serialize([legacy]) : null) !== expected.legacy)
        throw new Error("The saved submission changed. Preserve its recovery record.");
    }
    window.localStorage.setItem(key, next);
    if (window.localStorage.getItem(key) !== next)
      throw new Error("Recovery storage did not retain the record.");
    return { raw: next, legacy: expected.legacy };
  };
  return { read, write };
}
