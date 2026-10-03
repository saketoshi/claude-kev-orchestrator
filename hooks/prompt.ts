const MARKER = "[kev]"

const GUIDANCE = `
<kev-orchestration>
Before delegating implementation:
- keep architecture and contract decisions in the strongest appropriate model;
- decompose implementation into independently verifiable closed work packages where practical;
- give each delegated package explicit boundaries and acceptance criteria;
- do not force a package smaller merely to make it suitable for a weaker model;
- parallelize only packages whose dependencies are already decided.
Kev will select the execution model for each spawned subagent at runtime.
</kev-orchestration>
`.trim()

export function rewriteKevPrompt(text: string): string | undefined {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith(MARKER)) return undefined

  const markerIndex = text.indexOf(MARKER)
  const withoutMarker =
    text.slice(0, markerIndex) + text.slice(markerIndex + MARKER.length)

  return `${withoutMarker.trim()}\n\n${GUIDANCE}`
}
