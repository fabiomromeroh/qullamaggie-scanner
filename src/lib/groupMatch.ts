/**
 * Match a scan idea to a Finviz industry by normalized name equality.
 * Lowercase, then strip every non-alphanumeric so "Oil & Gas" and "oilgas" compare equal.
 * Substring matches are intentionally not used.
 */
export function normalizeGroupKey(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function ideaMatchesFinvizGroup(
  idea: { groupId: string; groupName: string },
  group: { id: string; name: string; slug?: string },
): boolean {
  const targets = new Set<string>()
  for (const raw of [group.id, group.slug, group.name]) {
    if (!raw) continue
    const key = normalizeGroupKey(raw)
    if (key) targets.add(key)
  }
  if (targets.size === 0) return false
  for (const raw of [idea.groupName, idea.groupId]) {
    const key = normalizeGroupKey(raw)
    if (key && targets.has(key)) return true
  }
  return false
}
