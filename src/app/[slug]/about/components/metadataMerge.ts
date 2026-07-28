import { isRecord } from "@/lib/formValidation";
import type { JBProjectMetadata } from "@bananapus/nana-sdk-core";

/**
 * Keys the edit-metadata form manages. Everything else on the project's
 * current metadata is passed through untouched so custom fields survive edits.
 */
export const EDITOR_MANAGED_KEYS = [
  "name",
  "description",
  "logoUri",
  "twitter",
  "telegram",
  "discord",
  "infoUri",
  "farcaster",
  "payDisclosure",
] as const;

const OPTIONAL_TEXT_KEYS = ["twitter", "telegram", "discord", "infoUri", "payDisclosure"] as const;

function isManagedKey(key: string): boolean {
  return (EDITOR_MANAGED_KEYS as readonly string[]).includes(key);
}

export type EditableMetadataValues = {
  name: string;
  description: string;
  logoUri?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
  infoUri?: string;
  payDisclosure?: string;
};

/**
 * Merge edited form values on top of the project's CURRENT metadata JSON.
 *
 * The current metadata is spread first so unknown/custom keys (e.g. a custom
 * `leagueID`, `tags`, `payButton`, nested objects) survive an edit that only
 * touches the fields this form knows about. Optional text fields the user
 * cleared are removed rather than written back as empty strings.
 *
 * `customProperties` is the parsed advanced JSON editor. When it is undefined
 * the editor was never loaded/touched and every unmanaged key is preserved.
 * When it is defined it REPLACES the unmanaged key set, so removing a key from
 * the JSON deletes it. Managed keys inside it are ignored; the form wins.
 */
export function mergeProjectMetadata(
  current: unknown,
  values: EditableMetadataValues,
  customProperties?: Record<string, unknown>,
): JBProjectMetadata & Record<string, unknown> {
  const merged: Record<string, unknown> = isRecord(current) ? { ...current } : {};

  if (customProperties) {
    for (const key of Object.keys(merged)) {
      if (!isManagedKey(key)) delete merged[key];
    }
    for (const [key, value] of Object.entries(customProperties)) {
      if (isManagedKey(key)) continue;
      merged[key] = value;
    }
  }

  merged.name = values.name;
  merged.description = values.description;

  // Keep the existing logo unless a new one was uploaded.
  const logoUri = values.logoUri?.trim();
  if (logoUri) merged.logoUri = logoUri;

  for (const key of OPTIONAL_TEXT_KEYS) {
    const value = values[key]?.trim();
    if (value) {
      merged[key] = value;
    } else {
      delete merged[key];
    }
  }

  return merged as JBProjectMetadata & Record<string, unknown>;
}

/**
 * Keys present on the current metadata that the edit form does not manage.
 * Surfaced read-only in the dialog so users know they are preserved.
 */
export function otherMetadataKeys(current: unknown): string[] {
  if (!isRecord(current)) return [];
  return Object.keys(current).filter((key) => !isManagedKey(key));
}

/**
 * The current metadata's unmanaged keys as pretty-printed JSON, ready to
 * prefill the advanced custom-properties editor. Blank when there are none.
 */
export function formatCustomProperties(current: unknown): string {
  if (!isRecord(current)) return "";
  const custom: Record<string, unknown> = {};
  for (const key of otherMetadataKeys(current)) {
    custom[key] = current[key];
  }
  if (Object.keys(custom).length === 0) return "";
  return JSON.stringify(custom, null, 2);
}

export type CustomPropertiesParse =
  { error: string; ok: false } | { ok: true; value: Record<string, unknown> };

/**
 * Parse the advanced editor's text. Blank text means "no custom properties",
 * which is distinct from never having loaded the editor at all.
 */
export function parseCustomProperties(text: string): CustomPropertiesParse {
  if (text.trim().length === 0) return { ok: true, value: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, ok: false };
  }

  if (!isRecord(parsed)) {
    return { error: "Custom properties must be a JSON object", ok: false };
  }

  return { ok: true, value: parsed };
}

/**
 * Custom-property keys the form itself manages. These are dropped on save so
 * the form fields stay authoritative; the dialog notes them to the user.
 */
export function customPropertyCollisions(value: Record<string, unknown> | undefined): string[] {
  if (!value) return [];
  return Object.keys(value).filter(isManagedKey);
}
