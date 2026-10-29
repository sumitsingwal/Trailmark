import type { FolderDto } from './library'

/**
 * Turns the flat folder rows into a tree for the sidebar.
 *
 * Kept pure and out of the components so the awkward cases — a folder whose parent
 * was deleted, or a cycle introduced by a bad move — can be tested directly. The
 * sidebar must render something sensible rather than recursing forever.
 */

export interface FolderNode extends FolderDto {
  depth: number
  children: FolderNode[]
}

export function buildFolderTree(folders: readonly FolderDto[], rootId = 'root'): FolderNode[] {
  const byParent = new Map<string, FolderDto[]>()
  const known = new Set(folders.map((folder) => folder.id))

  for (const folder of folders) {
    if (folder.id === rootId) continue
    // A folder whose parent no longer exists is shown at the top rather than lost.
    const parent = known.has(folder.parentId) ? folder.parentId : rootId
    const siblings = byParent.get(parent) ?? []
    siblings.push(folder)
    byParent.set(parent, siblings)
  }

  const visited = new Set<string>()

  const build = (parentId: string, depth: number): FolderNode[] => {
    const children = [...(byParent.get(parentId) ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name)
    )
    return children
      .filter((folder) => {
        // Guards against a cycle: a folder is placed once, at the first depth found.
        if (visited.has(folder.id)) return false
        visited.add(folder.id)
        return true
      })
      .map((folder) => ({ ...folder, depth, children: build(folder.id, depth + 1) }))
  }

  const tree = build(rootId, 0)

  // Folders caught in a cycle are reachable from neither the root nor each other's
  // ancestors, so the walk above never reaches them. Surfacing them at the top keeps
  // them visible — and deletable — instead of stranding them in the database.
  const stranded = folders
    .filter((folder) => folder.id !== rootId && !visited.has(folder.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const folder of stranded) {
    if (visited.has(folder.id)) continue
    visited.add(folder.id)
    tree.push({ ...folder, depth: 0, children: build(folder.id, 1) })
  }

  return tree
}

/** Depth-first flattening, which is what a nested list actually renders. */
export function flattenTree(nodes: readonly FolderNode[]): FolderNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)])
}

/**
 * A folder and everything nested beneath it, deepest first.
 *
 * `parent_id` carries no foreign key, so the database does not cascade folder
 * deletion. Descendants have to be gathered explicitly — otherwise a child folder
 * outlives its parent and, because orphans are shown at the top level, reappears
 * there as if it had been moved rather than deleted.
 *
 * Deepest first so callers can delete in an order that never leaves a dangling parent.
 */
export function descendantFolderIds(folders: readonly FolderDto[], folderId: string): string[] {
  const childrenOf = new Map<string, string[]>()
  for (const folder of folders) {
    const siblings = childrenOf.get(folder.parentId) ?? []
    siblings.push(folder.id)
    childrenOf.set(folder.parentId, siblings)
  }

  const seen = new Set<string>()
  const out: string[] = []

  const walk = (id: string): void => {
    // Guards against a cycle introduced by a bad parent reference.
    if (seen.has(id)) return
    seen.add(id)
    for (const child of childrenOf.get(id) ?? []) walk(child)
    out.push(id)
  }

  walk(folderId)
  return out
}
