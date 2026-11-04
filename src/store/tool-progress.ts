/**
 * How far a long call of a tool is, by the id of the call: an MCP server
 * reports it while it works (`tool.progress`, at most twice a second). It has
 * its own small atom so that only the line under the tool draws again.
 */

import { map } from 'nanostores'

import { progressWords } from '@/core/tools'

import { onGatewayEvent } from './link'

export const $toolProgress = map<Record<string, string | undefined>>({})

onGatewayEvent(event => {
  if (event.type === 'tool.progress') {
    const payload = event.payload as { tool_id?: unknown } | undefined
    const id = typeof payload?.tool_id === 'string' ? payload.tool_id : ''
    const words = progressWords(event.payload as Parameters<typeof progressWords>[0])

    if (id && words) {
      $toolProgress.setKey(id, words)
    }
  } else if (event.type === 'tool.complete') {
    const id = (event.payload as { tool_id?: unknown } | undefined)?.tool_id

    if (typeof id === 'string' && $toolProgress.get()[id] !== undefined) {
      // No value: the key goes, and the line with it.
      $toolProgress.setKey(id, undefined)
    }
  }
})
