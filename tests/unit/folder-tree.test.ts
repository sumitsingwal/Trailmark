import { describe, expect, it } from 'vitest'
import { buildFolderTree, descendantFolderIds, flattenTree } from '../../src/shared/folder-tree.ts'
import type { FolderDto } from '../../src/shared/library.ts'

const f = (id: string, name: string, parentId: string): FolderDto => ({
  id,
  name,
  parentId,
  recordingCount: 0
})

describe('buildFolderTree', () => {
  it('nests children under their parent and sorts by name', () => {
    const tree = buildFolderTree([
      f('root', 'Library', ''),
      f('b', 'Release B', 'root'),
      f('a', 'Release A', 'root'),
      f('a1', 'Checkout', 'a')
    ])

    expect(tree.map((n) => n.name)).toEqual(['Release A', 'Release B'])
    expect(tree[0]?.children.map((n) => n.name)).toEqual(['Checkout'])
    expect(tree[0]?.depth).toBe(0)
    expect(tree[0]?.children[0]?.depth).toBe(1)
  })

  it('excludes the root itself', () => {
    const tree = buildFolderTree([f('root', 'Library', '')])
    expect(tree).toEqual([])
  })

  it('shows a folder whose parent has vanished rather than losing it', () => {
    const tree = buildFolderTree([f('root', 'Library', ''), f('orphan', 'Orphan', 'gone')])
    expect(tree.map((n) => n.name)).toEqual(['Orphan'])
  })

  it('terminates on a cycle instead of recursing forever', () => {
    const tree = buildFolderTree([f('root', 'Library', ''), f('a', 'A', 'b'), f('b', 'B', 'a')])
    // Neither is reachable from the root, so both are surfaced once, at the top.
    expect(
      flattenTree(tree)
        .map((n) => n.id)
        .sort()
    ).toEqual(['a', 'b'])
  })

  it('handles an empty library', () => {
    expect(buildFolderTree([])).toEqual([])
  })
})

describe('flattenTree', () => {
  it('flattens depth-first, which is the render order', () => {
    const tree = buildFolderTree([
      f('root', 'Library', ''),
      f('a', 'A', 'root'),
      f('a1', 'A1', 'a'),
      f('b', 'B', 'root')
    ])
    expect(flattenTree(tree).map((n) => n.id)).toEqual(['a', 'a1', 'b'])
  })
})

describe('descendantFolderIds', () => {
  const folders = [
    f('root', 'Library', ''),
    f('a', 'A', 'root'),
    f('a1', 'A1', 'a'),
    f('a1x', 'A1X', 'a1'),
    f('b', 'B', 'root')
  ]

  it('includes the folder itself and everything beneath it', () => {
    expect(descendantFolderIds(folders, 'a').sort()).toEqual(['a', 'a1', 'a1x'])
  })

  it('returns deepest first, so deletion never leaves a dangling parent', () => {
    const order = descendantFolderIds(folders, 'a')
    expect(order.indexOf('a1x')).toBeLessThan(order.indexOf('a1'))
    expect(order.indexOf('a1')).toBeLessThan(order.indexOf('a'))
  })

  it('returns just the folder when it has no children', () => {
    expect(descendantFolderIds(folders, 'b')).toEqual(['b'])
  })

  it('does not reach into a sibling branch', () => {
    expect(descendantFolderIds(folders, 'a')).not.toContain('b')
  })

  it('terminates on a cycle', () => {
    const cyclic = [f('root', 'Library', ''), f('x', 'X', 'y'), f('y', 'Y', 'x')]
    expect(descendantFolderIds(cyclic, 'x').sort()).toEqual(['x', 'y'])
  })
})
