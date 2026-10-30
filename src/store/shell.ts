/**
 * The shells of the terminal on the host (the phone-shell plugin). The list
 * is read when the terminal or the Workspace tab shows. One socket is open
 * while the terminal is on screen, and none after: the shell itself keeps
 * running on the host.
 */

import { atom } from 'nanostores'

import { bytesBase64 } from '@/core/live-voice'
import { resizeFrame, SHELL_ENDED, type ShellInfo, shellsFrom, shellSocketPath } from '@/core/shell'

import { currentApi, openSiblingSocket } from './link'

export const $shells = atom<ShellInfo[]>([])

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

export async function loadShells(): Promise<ShellInfo[]> {
  const shells = shellsFrom(await api().request({ path: '/api/plugins/phone-shell/shells' }))

  $shells.set(shells)

  return shells
}

/** End a shell and every program in it. */
export async function closeShell(id: string): Promise<void> {
  await api().request({ path: `/api/plugins/phone-shell/shells/${encodeURIComponent(id)}/close`, method: 'POST' })
  $shells.set($shells.get().filter(shell => shell.id !== id))
}

export type ShellEnd = 'ended' | 'lost' | 'refused'

export interface ShellLink {
  send: (text: string) => void
  resize: (cols: number, rows: number) => void
  close: () => void
}

/**
 * Open the socket of one shell. Output comes to `onOutput` as base64, the
 * form the web view of the terminal takes. `onEnd` says why the socket
 * closed: the shell ended, the link was lost, or the host refused it (no
 * plugin, or the sign-in failed).
 */
export async function connectShell(
  shell: Pick<ShellInfo, 'id' | 'cwd'>,
  size: { cols: number; rows: number },
  onOutput: (base64: string) => void,
  onEnd: (end: ShellEnd) => void
): Promise<ShellLink> {
  const socket = await openSiblingSocket(shellSocketPath(shell.id, shell.cwd, size))
  const encoder = new TextEncoder()
  let opened = false
  let closedByUs = false

  socket.binaryType = 'arraybuffer'
  socket.onopen = () => {
    opened = true
  }
  socket.onmessage = event => {
    const bytes = typeof event.data === 'string' ? encoder.encode(event.data) : new Uint8Array(event.data as ArrayBuffer)

    onOutput(bytesBase64(bytes))
  }
  socket.onclose = event => {
    if (!closedByUs) {
      onEnd(event.code === SHELL_ENDED ? 'ended' : opened ? 'lost' : 'refused')
    }
  }

  const send = (text: string) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(text)
    }
  }

  return {
    send,
    resize: (cols, rows) => send(resizeFrame(cols, rows)),
    close: () => {
      closedByUs = true
      socket.close()
    }
  }
}
