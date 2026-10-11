import { answerFiles } from '../host-files'

describe('answerFiles', () => {
  it('shows a host picture as a file and keeps only its name in the words', () => {
    const { text, files } = answerFiles('The screenshot is saved to /Users/me/.hermes/cache/images/computer_use_ab12.png.')

    expect(text).toBe('The screenshot is saved to computer_use_ab12.png.')
    expect(files).toEqual([{ name: 'computer_use_ab12.png', kind: 'image', path: '/Users/me/.hermes/cache/images/computer_use_ab12.png' }])
  })

  it('reads a path in code marks, with spaces, and keeps the marks', () => {
    const { text, files } = answerFiles('Report: `/Users/me/My Documents/q3 report.pdf`')

    expect(text).toBe('Report: `q3 report.pdf`')
    expect(files[0]).toMatchObject({ name: 'q3 report.pdf', kind: 'pdf', path: '/Users/me/My Documents/q3 report.pdf' })
  })

  it('removes the delivery mark of the backend', () => {
    const { text, files } = answerFiles('Here it is.\n\nMEDIA:/tmp/out/chart.png\n\nDone.')

    expect(text).toBe('Here it is.\n\nDone.')
    expect(files.map(file => file.path)).toEqual(['/tmp/out/chart.png'])
  })

  it('reads a Windows path', () => {
    expect(answerFiles('Saved to C:\\Users\\me\\shot.png').files[0]).toMatchObject({ name: 'shot.png', path: 'C:\\Users\\me\\shot.png' })
  })

  it('lists a file once', () => {
    expect(answerFiles('/tmp/a/x.png and again /tmp/a/x.png').files).toHaveLength(1)
  })

  it('leaves web addresses, routes, fractions and code blocks alone', () => {
    for (const answer of [
      'See https://example.com/docs/page.html for more.',
      'The route is /api.json and the ratio is 1/2.5 today.',
      'Run this:\n```\ncat /var/log/app/server.log\n```',
      'Use the relative path src/core/format.ts.'
    ]) {
      expect(answerFiles(answer)).toEqual({ text: answer, files: [] })
    }
  })
})
