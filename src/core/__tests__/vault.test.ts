import { emptyVaultForm, vaultAddRequest, vaultFormProblem, vaultOrigin, vaultSections, vaultSummary } from '../vault'

describe('vaultOrigin', () => {
  it('makes a site address from what a person types', () => {
    expect(vaultOrigin('GitHub.com/login')).toBe('https://github.com')
    expect(vaultOrigin(' http://Intranet.example.org:8080 ')).toBe('http://intranet.example.org:8080')
    expect(vaultOrigin('not a site')).toBeNull()
    expect(vaultOrigin('')).toBeNull()
  })
})

describe('a login', () => {
  const form = { ...emptyVaultForm('login'), origin: 'github.com', identifier: ' me@example.com ', password: ' pass word ' }

  it('needs a website, an identifier and a password', () => {
    expect(vaultFormProblem(emptyVaultForm('login'))).toBe('Website is needed.')
    expect(vaultFormProblem({ ...form, origin: 'my site' })).toBe('The website must be an address like github.com.')
    expect(vaultFormProblem(form)).toBeNull()
  })

  it('goes to the backend with its fields, the password as typed', () => {
    expect(vaultAddRequest(form)).toEqual({
      kind: 'login',
      label: 'github.com',
      origin: 'https://github.com',
      secret: { identifier_type: 'email', identifier: 'me@example.com', password: ' pass word ' }
    })
    expect(vaultAddRequest({ ...form, identifier: '+44 7700 900123', otpSecret: 'ABCD', label: 'Work' })).toMatchObject({
      label: 'Work',
      secret: { identifier_type: 'phone', otp_secret: 'ABCD' }
    })
    expect(vaultAddRequest({ ...form, identifier: 'me' }).secret.identifier_type).toBe('username')
  })
})

describe('a card', () => {
  const form = { ...emptyVaultForm('payment'), label: 'Visa', cardNumber: '4242 4242 4242 4242', cardName: 'A Person', expMonth: '3', expYear: '2031', cvc: '123' }

  it('checks the number and the date', () => {
    expect(vaultFormProblem({ ...form, cardNumber: '4242' })).toBe('The card number must be 12 to 19 digits.')
    expect(vaultFormProblem({ ...form, expMonth: '13' })).toBe('The month must be 01 to 12.')
    expect(vaultFormProblem({ ...form, expYear: '31' })).toBe('The year must have four digits.')
    expect(vaultFormProblem(form)).toBeNull()
  })

  it('sends the digits without spaces and a two-digit month', () => {
    expect(vaultAddRequest(form).secret).toEqual({ card_number: '4242424242424242', cardholder_name: 'A Person', exp_month: '03', exp_year: '2031', cvc: '123' })
  })
})

describe('an address', () => {
  it('sends the optional lines only when they have text', () => {
    const form = { ...emptyVaultForm('address'), label: 'Home', line1: '1 High St', city: 'Leeds', postal: 'LS1 1AA', country: 'UK' }

    expect(vaultFormProblem(form)).toBeNull()
    expect(vaultAddRequest(form).secret).toEqual({ address_line1: '1 High St', city: 'Leeds', postal_code: 'LS1 1AA', country: 'UK' })
    expect(vaultAddRequest({ ...form, state: 'West Yorkshire' }).secret.state).toBe('West Yorkshire')
  })
})

describe('the list', () => {
  const items = [
    { id: '1', kind: 'payment', label: 'Visa', backend: 'local' },
    { id: '2', kind: 'login', label: 'github.com', origin: 'https://github.com', identifier: 'me@example.com', has_otp: true, backend: 'local' },
    { id: '3', kind: 'login', label: 'Apple', identifier: 'me', backend: 'bitwarden' }
  ]

  it('groups by kind and sorts by name', () => {
    expect(vaultSections(items).map(section => [section.title, section.data.map(item => item.id)])).toEqual([
      ['Logins', ['3', '2']],
      ['Cards', ['1']]
    ])
  })

  it('says who signs in and where', () => {
    expect(vaultSummary(items[1])).toBe('me@example.com · github.com · two-factor')
    expect(vaultSummary(items[2])).toBe('me · bitwarden')
  })
})
