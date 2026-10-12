/**
 * Projects: the host groups conversations by the folder they ran in. A
 * project is a folder the user named, or a git repository the host found
 * ("auto"). Conversations in no project are in "Home".
 */

import { slimSessionRow } from './cache'
import type { ProjectsTreeResult, ProjectTreeNode } from './gateway/gateway-contract.generated'
import type { SessionRow } from './sessions'

/** The rows of one project come with the tree. This many are asked for. */
export const PROJECT_ROWS = 100

export interface ProjectChoice {
  id: string
  label: string
  /** The folder of the project on the host. The home bucket has none. */
  path: string | null
  count: number
  /** Conversations in no project. */
  home: boolean
}

/** The projects a user can pick: those with a conversation, the most recent first, "Home" last. */
export function projectChoices(tree: ProjectsTreeResult | null | undefined): ProjectChoice[] {
  return (tree?.projects ?? [])
    .filter(node => (node.sessionCount ?? 0) > 0)
    .sort((a, b) => Number(Boolean(a.isNoProject)) - Number(Boolean(b.isNoProject)) || (b.lastActive ?? 0) - (a.lastActive ?? 0))
    .map(node => ({ id: node.id, label: node.label, path: node.path ?? null, count: node.sessionCount ?? 0, home: Boolean(node.isNoProject) }))
}

/** The conversations of a project as rows of the chat list, the newest first. */
export function projectRows(node: ProjectTreeNode | null | undefined): SessionRow[] {
  const seen = new Set<string>()

  return (node?.previewSessions ?? [])
    .filter(row => !seen.has(row.id) && Boolean(seen.add(row.id)))
    .map(row => {
      const profile = (row as { profile?: string | null }).profile ?? null

      // The tree names the profile of a row, but not whether it is the host's own.
      return slimSessionRow({ ...(row as SessionRow), profile, is_default_profile: !profile || profile === 'default' })
    })
    .sort((a, b) => (b.last_active ?? b.started_at ?? 0) - (a.last_active ?? a.started_at ?? 0))
}

/** The folder name of a host path, for a line under the name of a project. */
export function folderLine(path: string | null): string {
  return path ? path.split(/[\\/]/).filter(Boolean).slice(-2).join('/') : ''
}
