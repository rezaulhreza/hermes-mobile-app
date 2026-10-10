#!/usr/bin/env node
/**
 * Press buttons and type in the app that runs in the iOS Simulator.
 *
 *   node scripts/drive.mjs 'h.labels()'
 *   node scripts/drive.mjs 'h.type("/he")' 'h.wait(800)' 'h.texts().slice(-20)'
 *   node scripts/drive.mjs 'h.press("Send")'
 *
 * Each argument is one JavaScript expression. `h` is the helper object from
 * `src/dev/driver.ts`. The app (development build only) dials this script on
 * a loopback port, so the script waits for that connection first.
 */

import { createRequire } from 'node:module'

const { WebSocketServer } = createRequire(import.meta.url)('ws')

const PORT = 8099
const steps = process.argv.slice(2)

if (!steps.length) {
  console.error("Usage: node scripts/drive.mjs '<expression>' ...")
  process.exit(2)
}

const server = new WebSocketServer({ host: '127.0.0.1', port: PORT })
const timer = setTimeout(() => {
  console.error('The app did not connect. Is the development build running in the Simulator?')
  process.exit(1)
}, 15_000)

// One app, one run: a second connection would repeat every step.
server.once('connection', socket => {
  clearTimeout(timer)

  let index = 0
  const next = () => {
    if (index === steps.length) {
      socket.close()
      // A stale copy of the app's driver may still hold a connection open.
      process.exit(0)
    }

    socket.send(JSON.stringify({ id: index, code: steps[index] }))
  }

  socket.on('message', data => {
    const { value, error } = JSON.parse(String(data))

    if (error || value !== null) {
      console.log(error ? `ERROR ${error}` : typeof value === 'string' ? value : JSON.stringify(value, null, 1))
    }
    index += 1
    next()
  })

  next()
})
