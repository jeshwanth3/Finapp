/**
 * Class-name joiner.
 *
 * These primitives mix three sources of class names — the global conventions in
 * `globals.css`, component-scoped CSS-module names, and a caller override — so a
 * joiner that drops falsy values is needed on nearly every element. Eight lines
 * beats a dependency (see the no-new-dependencies constraint).
 */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  const kept: string[] = []
  for (const part of parts) {
    if (typeof part !== 'string') continue
    const trimmed = part.trim()
    if (trimmed !== '') kept.push(trimmed)
  }
  return kept.join(' ')
}
