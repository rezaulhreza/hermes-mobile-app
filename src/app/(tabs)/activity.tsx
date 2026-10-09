import { useStore } from '@nanostores/react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { RequestCard } from '@/components/request-card'
import { Notice } from '@/components/ui'
import { $requests, answerRequest } from '@/store/requests'
import { space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { TAB_BAR_CLEARANCE } from './_layout'

/** Everything that waits for the user, from every conversation, in one place. */
export default function Activity() {
  const t = useTheme()
  const requests = useStore($requests)

  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.title, { color: t.ink }]}>Activity</Text>
        {requests.length ? (
          requests.map(request => (
            <RequestCard key={request.id} onAnswer={answer => answerRequest(request.id, answer)} request={request} />
          ))
        ) : (
          <Notice detail="Approvals, questions and credential requests appear here." icon="check-circle" title="Nothing needs you" />
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    padding: space.lg,
    gap: space.lg,
    paddingBottom: TAB_BAR_CLEARANCE,
    flexGrow: 1,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center'
  }
})
