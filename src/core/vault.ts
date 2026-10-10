/**
 * The vault: the logins, cards and addresses the agent may use when it works
 * in its own browser. The phone adds and removes items and never reads a
 * secret back: the backend lists metadata only.
 */

export type VaultKind = 'login' | 'payment' | 'address'

export interface VaultEntry {
  id: string
  kind: string
  label: string
  origin?: string | null
  identifier?: string | null
  has_otp?: boolean | null
  /** `local` for the Hermes vault, else the name of a password manager. */
  backend: string
}

export type VaultFieldKey =
  | 'label'
  | 'origin'
  | 'identifier'
  | 'password'
  | 'otpSecret'
  | 'cardNumber'
  | 'cardName'
  | 'expMonth'
  | 'expYear'
  | 'cvc'
  | 'postal'
  | 'line1'
  | 'line2'
  | 'city'
  | 'state'
  | 'country'

export type VaultForm = { kind: VaultKind } & Record<VaultFieldKey, string>

export interface VaultField {
  key: VaultFieldKey
  label: string
  /** What the keyboard and the system autofill should treat it as. */
  input: 'text' | 'url' | 'email' | 'password' | 'number' | 'name'
  required?: boolean
  /** An example of a value. It shows in the empty field. */
  example?: string
  /** A sentence under the field, for a field a person may not know. */
  hint?: string
  /** Fields with the same row number share a line. */
  row?: number
}

export const VAULT_KINDS: readonly { kind: VaultKind; label: string; plural: string }[] = [
  { kind: 'login', label: 'Login', plural: 'Logins' },
  { kind: 'payment', label: 'Card', plural: 'Cards' },
  { kind: 'address', label: 'Address', plural: 'Addresses' }
]

const FIELDS: Readonly<Record<VaultKind, readonly VaultField[]>> = {
  login: [
    { key: 'origin', label: 'Website', input: 'url', required: true, example: 'github.com' },
    { key: 'identifier', label: 'Email, username or phone', input: 'email', required: true },
    { key: 'password', label: 'Password', input: 'password', required: true },
    { key: 'otpSecret', label: 'Two-factor setup key', input: 'text', hint: 'The key behind the QR code, not a 6-digit code.' },
    { key: 'label', label: 'Name', input: 'text', hint: 'The website is used when this is empty.' }
  ],
  payment: [
    { key: 'label', label: 'Name', input: 'text', required: true, example: 'Personal Visa' },
    { key: 'cardNumber', label: 'Card number', input: 'number', required: true },
    { key: 'cardName', label: 'Name on the card', input: 'name', required: true },
    { key: 'expMonth', label: 'Month', input: 'number', required: true, example: 'MM', row: 1 },
    { key: 'expYear', label: 'Year', input: 'number', required: true, example: 'YYYY', row: 1 },
    { key: 'cvc', label: 'Security code', input: 'password', required: true, row: 1 },
    { key: 'postal', label: 'Billing postcode', input: 'text' }
  ],
  address: [
    { key: 'label', label: 'Name', input: 'text', required: true, example: 'Home' },
    { key: 'line1', label: 'Address line 1', input: 'text', required: true },
    { key: 'line2', label: 'Address line 2', input: 'text' },
    { key: 'city', label: 'City', input: 'text', required: true, row: 1 },
    { key: 'state', label: 'State or county', input: 'text', row: 1 },
    { key: 'postal', label: 'Postcode', input: 'text', required: true, row: 2 },
    { key: 'country', label: 'Country', input: 'text', required: true, row: 2 }
  ]
}

export function vaultFields(kind: VaultKind): readonly VaultField[] {
  return FIELDS[kind]
}

export function emptyVaultForm(kind: VaultKind = 'login'): VaultForm {
  return {
    kind,
    label: '',
    origin: '',
    identifier: '',
    password: '',
    otpSecret: '',
    cardNumber: '',
    cardName: '',
    expMonth: '',
    expYear: '',
    cvc: '',
    postal: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    country: ''
  }
}

/** "GitHub.com/login" and "https://github.com" both become "https://github.com". Null when it is not a site. */
export function vaultOrigin(input: string): string | null {
  const trimmed = input.trim()

  if (!trimmed) {
    return null
  }

  const match = /^(https?:\/\/)?([a-z0-9-]+(\.[a-z0-9-]+)+)(:\d+)?(\/.*)?$/i.exec(trimmed)

  return match ? `${(match[1] ?? 'https://').toLowerCase()}${match[2].toLowerCase()}${match[4] ?? ''}` : null
}

function identifierType(identifier: string): 'email' | 'phone' | 'username' {
  return identifier.includes('@') ? 'email' : /^\+?[\d\s()-]{7,}$/.test(identifier) ? 'phone' : 'username'
}

/** Why the form cannot be saved, as a sentence, or null. */
export function vaultFormProblem(form: VaultForm): string | null {
  const missing = vaultFields(form.kind).find(field => field.required && !form[field.key].trim())

  if (missing) {
    return `${missing.label} is needed.`
  }

  if (form.kind === 'login' && !vaultOrigin(form.origin)) {
    return 'The website must be an address like github.com.'
  }

  if (form.kind === 'payment') {
    const digits = form.cardNumber.replace(/\s+/g, '')
    const month = Number(form.expMonth)

    if (!/^\d{12,19}$/.test(digits)) {
      return 'The card number must be 12 to 19 digits.'
    }

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return 'The month must be 01 to 12.'
    }

    if (!/^\d{4}$/.test(form.expYear.trim())) {
      return 'The year must have four digits.'
    }
  }

  return null
}

export interface VaultAddRequest {
  kind: VaultKind
  label: string
  origin?: string
  secret: Record<string, string>
}

/** The `vault.add` request for a form with no problem. The field names are the backend's. */
export function vaultAddRequest(form: VaultForm): VaultAddRequest {
  const value = (key: VaultFieldKey) => form[key].trim()
  const optional = (name: string, key: VaultFieldKey) => (value(key) ? { [name]: value(key) } : {})

  if (form.kind === 'login') {
    const origin = vaultOrigin(form.origin) ?? ''

    return {
      kind: 'login',
      label: value('label') || origin.replace(/^https?:\/\//, ''),
      origin,
      secret: {
        identifier_type: identifierType(value('identifier')),
        identifier: value('identifier'),
        // A password can start or end with a space. It goes as typed.
        password: form.password,
        ...optional('otp_secret', 'otpSecret')
      }
    }
  }

  if (form.kind === 'payment') {
    return {
      kind: 'payment',
      label: value('label'),
      secret: {
        card_number: form.cardNumber.replace(/\s+/g, ''),
        cardholder_name: value('cardName'),
        exp_month: value('expMonth').padStart(2, '0'),
        exp_year: value('expYear'),
        cvc: form.cvc,
        ...optional('billing_postal_code', 'postal')
      }
    }
  }

  return {
    kind: 'address',
    label: value('label'),
    secret: {
      address_line1: value('line1'),
      city: value('city'),
      postal_code: value('postal'),
      country: value('country'),
      ...optional('address_line2', 'line2'),
      ...optional('state', 'state')
    }
  }
}

export interface VaultSection {
  title: string
  data: VaultEntry[]
}

/** The items by kind, in the order of `VAULT_KINDS`, each group by name. A kind this app does not know goes last. */
export function vaultSections(items: readonly VaultEntry[]): VaultSection[] {
  const known = VAULT_KINDS.map(({ kind, plural }) => ({ title: plural, data: items.filter(item => item.kind === kind) }))
  const other = items.filter(item => !VAULT_KINDS.some(({ kind }) => kind === item.kind))

  return [...known, { title: 'Other', data: other }]
    .filter(section => section.data.length > 0)
    .map(section => ({ ...section, data: [...section.data].sort((a, b) => a.label.localeCompare(b.label)) }))
}

/** The second line of a row: who signs in and where. Never a secret; the backend sends none. */
export function vaultSummary(item: VaultEntry): string {
  return [item.identifier, item.origin?.replace(/^https?:\/\//, ''), item.has_otp ? 'two-factor' : null, item.backend !== 'local' ? item.backend : null]
    .filter(Boolean)
    .join(' · ')
}
