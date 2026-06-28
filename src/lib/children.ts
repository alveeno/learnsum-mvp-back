// Shared validation + shaping for a parent's child_profiles rows.
// Used by POST /api/children (create) and PATCH /api/children/[id] (edit).
// Canonical input forms mirror the rest of the edit API: interests are
// subcategory UUIDs, preferred_districts are SUBDISTRICT slugs (0021), languages
// are lowercase tokens.

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const MAX_CHILDREN = 6

// Subdistrict slug shape, e.g. "causeway_bay".
const SUBDISTRICT_SLUG_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/
const VALID_LEVELS = new Set(['kindergarten', 'primary', 'middle', 'high', 'university', 'adult'])
const VALID_FORMATS = new Set(['online', 'in_person', 'both'])
const VALID_TYPES = new Set(['individual', 'group', 'both'])

function normLanguages(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return [
    ...new Set(
      input
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
    ),
  ]
}

export type ChildFieldsResult =
  | { error: string }
  | { updates: Record<string, unknown>; interestIds?: string[] }

// Validates and shapes the editable child fields.
//   partial=false (create): `name` is required.
//   partial=true  (edit):   every field optional; `name` if present must be non-empty.
// `interestIds` is returned only when interest_subcategory_ids was provided, so
// callers can distinguish "leave interests alone" from "set interests to []".
export function buildChildFields(
  src: Record<string, unknown>,
  { partial }: { partial: boolean }
): ChildFieldsResult {
  const updates: Record<string, unknown> = {}

  if (src.name !== undefined) {
    if (typeof src.name !== 'string' || !src.name.trim()) {
      return { error: 'name must be a non-empty string' }
    }
    updates.name = src.name.trim()
  } else if (!partial) {
    return { error: 'name is required' }
  }

  if (src.school_level !== undefined) {
    if (src.school_level !== null && !VALID_LEVELS.has(src.school_level as string)) {
      return { error: `school_level must be one of: ${[...VALID_LEVELS].join(', ')}` }
    }
    updates.school_level = src.school_level
  }
  if (src.tutoring_format_pref !== undefined) {
    if (src.tutoring_format_pref !== null && !VALID_FORMATS.has(src.tutoring_format_pref as string)) {
      return { error: `tutoring_format_pref must be one of: ${[...VALID_FORMATS].join(', ')}` }
    }
    updates.tutoring_format_pref = src.tutoring_format_pref
  }
  if (src.tutoring_type_pref !== undefined) {
    if (src.tutoring_type_pref !== null && !VALID_TYPES.has(src.tutoring_type_pref as string)) {
      return { error: `tutoring_type_pref must be one of: ${[...VALID_TYPES].join(', ')}` }
    }
    updates.tutoring_type_pref = src.tutoring_type_pref
  }
  if (src.budget_max_per_hour !== undefined) {
    const b = src.budget_max_per_hour
    if (b === null) updates.budget_max_per_hour = null
    else if (!Number.isInteger(b) || (b as number) < 0) {
      return { error: 'budget_max_per_hour must be a non-negative whole number' }
    } else updates.budget_max_per_hour = b
  }
  if (src.preferred_languages !== undefined) {
    updates.preferred_languages = normLanguages(src.preferred_languages)
  }
  if (src.preferred_districts !== undefined) {
    if (!Array.isArray(src.preferred_districts)) {
      return { error: 'preferred_districts must be an array of subdistrict slugs' }
    }
    const bad = (src.preferred_districts as unknown[]).filter((d) => typeof d !== 'string' || !SUBDISTRICT_SLUG_RE.test(d))
    if (bad.length) return { error: `preferred_districts has invalid subdistrict slugs: ${bad.join(', ')}` }
    updates.preferred_districts = [...new Set(src.preferred_districts as string[])]
  }

  let interestIds: string[] | undefined
  if (src.interest_subcategory_ids !== undefined) {
    if (!Array.isArray(src.interest_subcategory_ids)) {
      return { error: 'interest_subcategory_ids must be an array of subcategory UUIDs' }
    }
    const bad = (src.interest_subcategory_ids as unknown[]).filter((id) => typeof id !== 'string' || !UUID_REGEX.test(id))
    if (bad.length) return { error: 'interest_subcategory_ids must all be valid UUIDs' }
    interestIds = [...new Set(src.interest_subcategory_ids as string[])]
  }

  return interestIds !== undefined ? { updates, interestIds } : { updates }
}
