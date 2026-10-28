// Test cases for lux-secret-in-command-string (run: semgrep --test .semgrep/).
declare function sshExec(cmd: string, creds?: unknown, opts?: { stdin?: string }): Promise<unknown>
declare function shellQuote(s: string): string
declare function listTemplates(apiKey: string): string[]
declare const conn: { exec(cmd: string, cb: () => void): void }

export async function cases(apiKey: string, user: string, pass: string, url: string) {
  // ruleid: lux-secret-in-command-string
  await sshExec(`LUDUS_API_KEY=${apiKey} ludus templates rm -n x`)

  const auth = Buffer.from(`${user}:${pass}`).toString("base64")
  // ruleid: lux-secret-in-command-string
  await sshExec(`curl -H ${shellQuote(`Authorization: Basic ${auth}`)} ${shellQuote(url)}`)

  const cmd = `export LUDUS_API_KEY='${apiKey}'; goad`
  // ruleid: lux-secret-in-command-string
  conn.exec(cmd, () => undefined)

  // ok: lux-secret-in-command-string
  await sshExec(`curl -H @- ${shellQuote(url)}`, undefined, { stdin: `Authorization: Basic ${auth}\n` })

  for (const name of listTemplates(apiKey)) {
    // ok: lux-secret-in-command-string
    await sshExec(`ludus templates rm -n ${shellQuote(name)}`, undefined, { stdin: `${apiKey}\n` })
  }

  // ok: lux-secret-in-command-string
  const m = /Template ([^:]+):/.exec(`Template ${apiKey}:`)
  return m
}
