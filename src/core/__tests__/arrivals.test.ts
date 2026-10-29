import { arrivalLine, arrivalOf } from '../arrivals'
import { pageMessages } from '../history-page'
import { turnWork } from '../rounds'
import { EMPTY_TRANSCRIPT, reduceTranscript, transcriptFromHistory } from '../transcript'

describe('what comes into a chat and is not from the user', () => {
  it('is nothing for the words of the user', () => {
    expect(arrivalOf('Are you able to test a message to @reviewer?')).toBeNull()
    expect(arrivalOf('Message from me: hello')).toBeNull()
    expect(arrivalOf('[IMPORTANT: The user has invoked the "notes" skill]')).toBeNull()
  })

  it('knows the message of another bot', () => {
    expect(arrivalOf('Message from 🤖 Reviewer (@reviewer): Shrike here.\n\nAll good.')).toEqual({ kind: 'bot', name: 'Reviewer', handle: 'reviewer', text: 'Shrike here.\n\nAll good.' })
    expect(arrivalOf('Message from 🤖 hermes (@hermes): go')).toMatchObject({ kind: 'bot', handle: 'hermes' })
  })

  it('knows the output of a schedule', () => {
    const stored = '[Cronjob "Branch check" output — scheduled job, not the user. Review it, act on anything that needs action, and summarize for the chat.]\n\nOne commit clashes.\nFiles: a.ts'

    expect(arrivalOf(stored)).toEqual({ kind: 'schedule', name: 'Branch check', text: 'One commit clashes.\nFiles: a.ts' })
  })

  it('says in plain words how a background task ended', () => {
    const end = (status: string, code: string, command: string) => `[IMPORTANT: Background process proc_1 ${status} (exit code ${code}).\nCommand: ${command}\nOutput:\nline one\nline two]`

    expect(arrivalOf(end('completed normally', '0', 'npm test'))).toEqual({ kind: 'event', title: 'Background task finished', tone: 'done', detail: 'Command: npm test\nOutput:\nline one\nline two' })
    expect(arrivalOf(end('exited', '2', 'npm test'))).toMatchObject({ title: 'Background task exited', tone: 'failed' })
    expect(arrivalOf(end('exited', '143, SIGTERM', 'npm test'))).toMatchObject({ tone: 'failed' })
    // The host wrote a line for a screen.
    expect(arrivalOf(end('completed normally', '0', 'npm test'), 'Process Finished: npm test')).toMatchObject({ title: 'Process Finished: npm test' })
  })

  it('says who a message was for when the task carried a message to a bot', () => {
    const command = "/h/bin/python3 /h/tools/bot_mode_dm.py --run-delivery --author '{\"id\":\"bot:default\"}' query-file /tmp/dm.txt --profile-home /h/profiles/qa /h/bin/hermes -p qa chat --in '~' -c 'Bot Chat' -Q"
    const stored = (code: string) => `[IMPORTANT: Background process proc_2 completed normally (exit code ${code}).\nCommand: ${command}\nOutput:\nnoise]`

    expect(arrivalOf(stored('0'), 'Process Finished')).toMatchObject({ title: 'Message delivered to @qa', tone: 'done' })
    expect(arrivalOf(stored('1'))).toMatchObject({ title: 'Message to @qa was not delivered', tone: 'failed' })
  })

  it('knows the other notes of a background task', () => {
    expect(arrivalOf('[IMPORTANT: Background process p matched watch pattern "ready".\nCommand: run\nMatched output:\nready]')).toMatchObject({ title: 'Background task wrote "ready"', tone: 'info' })
    expect(arrivalOf('[Background process p heartbeat #3 — still running after 5m (next in 60s when there is new output; you will also be told when it exits).\nCommand: run\nOutput since last heartbeat:\n]')).toMatchObject({ title: 'Background task still runs after 5m' })
    expect(arrivalOf('[IMPORTANT: 3 background processes completed. Details follow.]')).toMatchObject({ title: '3 background tasks finished' })
    expect(arrivalOf('A background subagent you dispatched earlier has finished.\nResult: ok')).toMatchObject({ title: 'An agent finished its task' })
  })

  it('has one line for a list', () => {
    expect(arrivalLine({ kind: 'bot', name: 'QA', handle: 'qa', text: 'done' })).toBe('QA: done')
    expect(arrivalLine({ kind: 'event', title: 'Background task finished', tone: 'done', detail: '' })).toBe('Background task finished')
  })

  it('is its own row in a chat, not a message of the user', () => {
    const rows = [
      { id: 1, role: 'user', content: 'say hello to @qa' },
      { id: 2, role: 'user', content: 'Message from 🤖 QA (@qa): hello' },
      { id: 3, role: 'assistant', content: 'QA says hello.' },
      { id: 4, role: 'user', content: '[IMPORTANT: Background process p completed normally (exit code 0).\nCommand: run\nOutput:\nok]', display_kind: 'process_complete', display_metadata: { display_text: 'Process Finished: run' } }
    ]
    const items = transcriptFromHistory(pageMessages(rows)).items

    expect(items.map(item => item.kind)).toEqual(['user', 'arrival', 'assistant', 'arrival'])
    expect(items[3]).toMatchObject({ arrival: { title: 'Process Finished: run' } })
  })

  it('shows the line of Hermes when it saved a skill or a memory on its own', () => {
    const after = reduceTranscript(EMPTY_TRANSCRIPT, { type: 'review.summary', session_id: 's', payload: { text: '💾 Self-improvement review: Skill created: weekly-report' } } as never)

    expect(after.items).toEqual([{ kind: 'arrival', key: 'i0', arrival: { kind: 'event', title: 'Self-improvement review: Skill created: weekly-report', tone: 'saved', detail: '' } }])
    expect(reduceTranscript(EMPTY_TRANSCRIPT, { type: 'review.summary', session_id: 's', payload: { text: ' 💾 ' } } as never).items).toEqual([])
  })

  it('keeps a bot that was removed readable', () => {
    // The app no longer has the bot: the name it gave itself stays on the message.
    expect(arrivalOf('Message from 🤖 Old Helper (@old-helper): done')).toMatchObject({ kind: 'bot', name: 'Old Helper', handle: 'old-helper' })
  })

  it('stays in the work of a turn in a group chat, for the sheet of that turn', () => {
    const rows = [
      { id: 1, role: 'user', content: '[Discussion: "Ideas"] Your turn.' },
      { id: 2, role: 'user', content: 'Message from 🤖 QA (@qa): checked' },
      { id: 3, role: 'assistant', content: 'QA checked it.' }
    ]

    expect(turnWork(transcriptFromHistory(pageMessages(rows)).items).map(item => item.kind)).toEqual(['arrival', 'assistant'])
  })
})
