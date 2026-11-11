import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parsePersisted } from '../shared/persisted'
import type { LoadedState } from '../shared/types'

export async function writeAtomic(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await writeFile(temp, text)
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

// A saved file the app cannot read is moved aside, never overwritten, so nothing is lost for good.
export async function loadStateFile(path: string, now = Date.now()): Promise<LoadedState> {
  let json: string
  try {
    json = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { json: null }
    throw error
  }
  if (parsePersisted(json)) return { json }

  const backup = path.replace(/(\.json)?$/, `.unreadable-${now}.json`)
  await rename(path, backup)
  return { json: null, backup }
}
