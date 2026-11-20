const API_KEY_LINE = /^[A-Za-z0-9._~+/=:@!-]{8,512}$/

/** First stdin line is the Ludus API key. The rest is the guest command. */
export function guestAnsibleStdin(apiKey: string, command: string): string {
  const key = apiKey.trim()
  if (!API_KEY_LINE.test(key)) {
    throw new Error("This Ludus API key cannot be passed to the host helper.")
  }
  return `${key}\n${command}`
}
