import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import type { SentAttachment } from '@/core/attachments'
import { answerFiles } from '@/core/host-files'
import { hostFilesThatExist } from '@/store/preview'
import { space } from '@/theme/tokens'

import type { ViewerTarget } from './attachment-viewer'
import { SentAttachments } from './attachments'
import { Markdown } from './markdown'

/**
 * The words of the agent. A file on the host that the words name shows under
 * them as a picture or a file row, because a host path opens nothing on a
 * phone. The text is read for paths only when it is complete.
 */
export function Answer({ text, streaming, onOpen }: { text: string; streaming: boolean; onOpen: (target: ViewerTarget) => void }) {
  const shown = useMemo(() => (streaming ? { text, files: [] } : answerFiles(text)), [streaming, text])
  // A row shows only for a file that is on the host: the agent can name a path it never wrote.
  const [files, setFiles] = useState<SentAttachment[]>([])

  useEffect(() => {
    if (!shown.files.length) {
      return
    }

    let cancelled = false

    hostFilesThatExist(shown.files)
      .then(found => !cancelled && setFiles(found))
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [shown.files])

  if (!shown.files.length || !files.length) {
    return <Markdown text={shown.text} />
  }

  return (
    <View style={styles.files}>
      <Markdown text={shown.text} />
      <SentAttachments items={files} onOpen={index => onOpen({ items: files, index })} />
    </View>
  )
}

const styles = StyleSheet.create({
  files: { gap: space.sm }
})
