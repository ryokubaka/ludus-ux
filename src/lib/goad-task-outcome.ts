/** GOAD printed a failure and then exited 0 (REPL `bye` after Log.error). */
const GOAD_FAILURE =
  /git submodule update failed|Extension roles are not available|Error during deployment|Something wrong during the provisioning task/

export function goadLogShowsFailure(text: string): boolean {
  return GOAD_FAILURE.test(text)
}

/** Phase 1 was Ctrl+C'd. Do not treat that PTY close as a successful provide. */
export function goadLogShowsInterrupt(text: string): boolean {
  return /KeyboardInterrupt/.test(text)
}
