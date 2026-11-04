import { Feather } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import type { ApprovalChoice } from '@/core/gateway/gateway-contract.generated'
import type { AgentAnswer, AgentRequest } from '@/core/requests'
import { fade, MONO, radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { Button } from './ui'

const CHOICE_LABEL: Record<ApprovalChoice, string> = {
  once: 'Allow once',
  session: 'Allow for this chat',
  always: 'Always allow',
  deny: 'Deny'
}

interface Props {
  request: AgentRequest
  onAnswer: (answer: AgentAnswer) => void
}

/** One thing the agent needs from the user, with the controls to answer it. */
export function RequestCard({ request, onAnswer }: Props) {
  const t = useTheme()

  // A question is a form to fill in, not an alarm: a plain box, with no colour of its own.
  if (request.kind === 'clarify') {
    return (
      <View style={[styles.form, { backgroundColor: t.paper, borderColor: fade(t.ink, 0.15) }]}>
        <Clarify onAnswer={onAnswer} request={request} />
      </View>
    )
  }

  return (
    <View style={[styles.card, { backgroundColor: t.accentBg, borderColor: t.accent }]}>
      <View style={styles.head}>
        <Feather color={t.accent} name="shield" size={16} />
        <Text style={[type.small, { color: t.accent, fontWeight: '700' }]}>Hermes needs you</Text>
      </View>
      {request.kind === 'approval' ? <Approval onAnswer={onAnswer} request={request} /> : null}
      {request.kind === 'value' ? <Value onAnswer={onAnswer} request={request} /> : null}
      {request.kind === 'login' ? <Login onAnswer={onAnswer} request={request} /> : null}
    </View>
  )
}

type Of<K extends AgentRequest['kind']> = { request: Extract<AgentRequest, { kind: K }>; onAnswer: Props['onAnswer'] }

function Approval({ request, onAnswer }: Of<'approval'>) {
  const t = useTheme()
  // "Always" stays for every chat of the bot: it asks once more. "Deny" can carry words for the agent.
  const [step, setStep] = useState<'choose' | 'always' | 'tell'>('choose')
  const [words, setWords] = useState('')

  return (
    <>
      {request.smartDenied ? (
        <Text style={[type.small, { color: t.ink }]}>Smart approvals judged this risky and stopped it. You can still allow it this once.</Text>
      ) : null}
      {request.description ? <Text style={[type.body, { color: t.ink }]}>{request.description}</Text> : null}
      {request.command ? (
        <Text selectable style={[styles.code, { backgroundColor: t.paper, color: t.ink }]}>
          {request.command}
        </Text>
      ) : null}

      {step === 'always' ? (
        <View style={styles.block}>
          <Text style={[type.small, { color: t.ink }]}>Always allow commands like this one? Hermes then runs them in every chat of this bot without asking.</Text>
          <View style={styles.actions}>
            <Button label="Back" onPress={() => setStep('choose')} style={styles.action} />
            <Button label="Always allow" onPress={() => onAnswer({ kind: 'approval', choice: 'always' })} style={styles.action} tone="primary" />
          </View>
        </View>
      ) : step === 'tell' ? (
        <View style={styles.block}>
          <TextInput
            accessibilityLabel="What Hermes must do instead"
            autoFocus
            multiline
            onChangeText={setWords}
            placeholder="What Hermes must do instead"
            placeholderTextColor={t.muted}
            style={[type.body, styles.tell, { color: t.ink, backgroundColor: t.paper, borderColor: t.line }]}
            value={words}
          />
          <View style={styles.actions}>
            <Button label="Back" onPress={() => setStep('choose')} style={styles.action} />
            <Button disabled={!words.trim()} label="Deny and tell Hermes" onPress={() => onAnswer({ kind: 'approval', choice: 'deny', tell: words })} style={styles.action} tone="danger" />
          </View>
        </View>
      ) : (
        <>
          <View style={styles.actions}>
            {request.choices.map(choice => (
              <Button
                key={choice}
                label={CHOICE_LABEL[choice]}
                onPress={() => (choice === 'always' ? setStep('always') : onAnswer({ kind: 'approval', choice }))}
                style={styles.action}
                tone={choice === 'once' ? 'primary' : choice === 'deny' ? 'danger' : 'plain'}
              />
            ))}
          </View>
          {request.choices.includes('deny') ? (
            <Pressable accessibilityRole="button" hitSlop={6} onPress={() => setStep('tell')}>
              <Text style={[type.small, { color: t.ink, textDecorationLine: 'underline' }]}>No, and tell Hermes what to do instead</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </>
  )
}

function Clarify({ request, onAnswer }: Of<'clarify'>) {
  const t = useTheme()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const complete = request.questions.every(q => answers[q.qid]?.trim())

  const toggle = (qid: string, choice: string, multi: boolean, choices: readonly string[]) =>
    setAnswers(current => {
      if (!multi) {
        return { ...current, [qid]: choice }
      }

      // A typed answer gives way to the choices: the two do not mix.
      const picked = new Set((current[qid] ?? '').split(', ').filter(part => choices.includes(part)))

      if (!picked.delete(choice)) {
        picked.add(choice)
      }

      return { ...current, [qid]: [...picked].join(', ') }
    })

  return (
    <>
      {request.questions.map(question => (
        <View key={question.qid} style={styles.block}>
          <Text style={[styles.question, { color: t.muted }]}>{question.question}</Text>
          {question.choices.length ? (
            <View style={styles.choices}>
              {question.choices.map(choice => {
                const on = (answers[question.qid] ?? '').split(', ').includes(choice)

                return (
                  <Pressable
                    accessibilityRole={question.multiSelect ? 'checkbox' : 'radio'}
                    accessibilityState={{ checked: on }}
                    key={choice}
                    hitSlop={8}
                    onPress={() => toggle(question.qid, choice, question.multiSelect, question.choices)}
                    style={styles.choice}
                  >
                    <View style={[styles.circle, question.multiSelect && styles.square, { borderColor: on ? t.ink : t.muted }]}>
                      {on ? <View style={[styles.dot, question.multiSelect && styles.squareDot, { backgroundColor: t.ink }]} /> : null}
                    </View>
                    <Text style={[type.body, styles.choiceWords, { color: t.ink }]}>{choice}</Text>
                  </Pressable>
                )
              })}
            </View>
          ) : null}
          {/* An answer in the user's own words, also when the question has choices: it takes their place. */}
          <Input
            accessibilityLabel={`Your answer: ${question.question}`}
            onChangeText={value => setAnswers(current => ({ ...current, [question.qid]: value }))}
            placeholder={question.choices.length ? 'Or type your answer' : 'Your answer'}
            returnKeyType="done"
            value={typed(question, answers[question.qid])}
          />
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !complete }}
        disabled={!complete}
        onPress={() => onAnswer({ kind: 'clarify', answers })}
        style={({ pressed }) => [styles.send, { backgroundColor: t.ink }, (pressed || !complete) && styles.dim]}
      >
        <Text style={[type.label, { color: t.bg }]}>Send answer</Text>
      </Pressable>
    </>
  )
}

/** The answer as the user typed it. An answer that is only choices of the question shows in the circles, not in the field. */
function typed(question: { choices: string[] }, answer: string | undefined): string {
  const value = answer ?? ''

  return value.split(', ').every(part => question.choices.includes(part)) ? '' : value
}

function Value({ request, onAnswer }: Of<'value'>) {
  const t = useTheme()
  const [value, setValue] = useState('')

  return (
    <>
      <Text style={[type.body, { color: t.ink, fontWeight: '600' }]}>{request.title}</Text>
      {request.detail ? <Text style={[type.small, { color: t.muted }]}>{request.detail}</Text> : null}
      <Input
        keyboardType={request.numeric ? 'number-pad' : 'default'}
        onChangeText={setValue}
        placeholder={request.placeholder}
        // A code is read off another screen, so it stays visible. Everything else is a secret.
        secureTextEntry={!request.numeric}
        value={value}
      />
      <View style={styles.actions}>
        <Button
          disabled={!value}
          label="Send"
          onPress={() => onAnswer({ kind: 'value', value })}
          style={styles.action}
          tone="primary"
        />
        <Button label="Skip" onPress={() => onAnswer({ kind: 'value', value: '' })} style={styles.action} />
      </View>
    </>
  )
}

function Login({ request, onAnswer }: Of<'login'>) {
  const t = useTheme()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')

  return (
    <>
      <Text style={[type.body, { color: t.ink, fontWeight: '600' }]}>Save a login for {request.site}</Text>
      <Text style={[type.small, { color: t.muted }]}>Hermes stores it in your vault and uses it on this site.</Text>
      <Input onChangeText={setIdentifier} placeholder="Email or username" value={identifier} />
      <Input onChangeText={setPassword} placeholder="Password" secureTextEntry value={password} />
      <Button
        disabled={!identifier || !password}
        label="Save login"
        onPress={() => onAnswer({ kind: 'login', identifier, password })}
        tone="primary"
      />
    </>
  )
}

function Input(props: React.ComponentProps<typeof TextInput>) {
  const t = useTheme()

  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      placeholderTextColor={t.muted}
      style={[styles.input, type.body, { backgroundColor: t.paper, borderColor: t.line, color: t.ink }]}
      {...props}
    />
  )
}

const styles = StyleSheet.create({
  tell: { minHeight: 72, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, textAlignVertical: 'top' },
  card: { gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  block: { gap: space.sm },
  code: { fontFamily: MONO, fontSize: 13, padding: space.md, borderRadius: radius.sm, overflow: 'hidden' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: { flexGrow: 1 },
  form: { gap: space.lg, padding: 20, borderRadius: 18, borderWidth: 1 },
  question: { fontSize: 15 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xl, rowGap: space.md },
  choice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 },
  choiceWords: { flexShrink: 1 },
  circle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  square: { borderRadius: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  squareDot: { borderRadius: 2 },
  send: { height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  dim: { opacity: 0.5 },
  input: { minHeight: TOUCH + 4, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1 }
})
