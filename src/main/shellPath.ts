import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MARKER = '__EXECUTOR_PATH__'
const COMMON_FOLDERS = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin'), join(homedir(), '.cargo/bin')]

let resolved: Promise<string> | undefined

function readShellPath() {
  const shell = process.env.SHELL || '/bin/zsh'
  return new Promise<string>((resolve) => {
    execFile(shell, ['-ilc', `echo "${MARKER}$PATH"`], { timeout: 5000 }, (_error, stdout) => {
      resolve(stdout.split(MARKER)[1]?.split('\n')[0] ?? '')
    })
  })
}

export function mergePaths(...paths: string[]) {
  const entries = paths.flatMap((path) => path.split(':')).filter(Boolean)
  return [...new Set(entries)].join(':')
}

// Apps opened from Finder get a bare PATH, so tools from nvm, Homebrew or uv would not be found.
export function shellPath() {
  resolved ??= readShellPath().then((path) =>
    mergePaths(process.env.PATH ?? '', path, COMMON_FOLDERS.join(':'))
  )
  return resolved
}
