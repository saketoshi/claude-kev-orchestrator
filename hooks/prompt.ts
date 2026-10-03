const MARKER = "[kev]"

const GUIDANCE = `
<kev-orchestration>
You are the parent architect/orchestrator for this turn.

Execution contract:
- first understand the task and make architecture/contract decisions;
- decompose implementation into independently verifiable closed work packages where practical;
- delegate implementation work through the Agent tool instead of directly editing files;
- give each delegated package explicit boundaries and acceptance criteria;
- do not force a package smaller merely to make it suitable for a weaker model;
- parallelize only packages whose dependencies are already decided;
- after delegated work returns, integrate and verify the result.

The runtime enforces the initial delegation boundary: direct parent Edit/Write operations can be denied until implementation has been delegated.
Kev selects the execution model for each spawned subagent at runtime.
</kev-orchestration>
`.trim()

export function isKevPrompt(text: string): boolean {
  return text.trimStart().startsWith(MARKER)
}

export function rewriteKevPrompt(text: string): string | undefined {
  if (!isKevPrompt(text)) return undefined

  const markerIndex = text.indexOf(MARKER)
  const withoutMarker =
    text.slice(0, markerIndex) + text.slice(markerIndex + MARKER.length)

  return `${withoutMarker.trim()}\n\n${GUIDANCE}`
}
