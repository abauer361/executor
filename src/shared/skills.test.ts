import { describe, expect, it } from 'vitest'
import { CATALOG } from '../renderer/src/data/catalog'
import { createSeed } from '../renderer/src/data/seed'
import { checkSkillFile, SKILLS, skillFileUrl, skillPageUrl, skillSource } from './skills'

const encode = (text: string) => new TextEncoder().encode(text)

describe('skill list', () => {
  it('pins every skill to an exact commit and hash', () => {
    for (const skill of SKILLS) {
      expect(skill.id).toMatch(/^[a-z0-9-]+$/)
      expect(skill.repo).toMatch(/^[\w.-]+\/[\w.-]+$/)
      expect(skill.path).not.toMatch(/(^|\/)\.\.(\/|$)|^\/|\/$/)
      expect(skill.commit).toMatch(/^[0-9a-f]{40}$/)
      expect(skill.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(skill.license).not.toBe('')
    }
    expect(new Set(SKILLS.map((skill) => skill.id)).size).toBe(SKILLS.length)
  })

  it('keeps every skill that agents and templates already use', () => {
    const used = [
      ...createSeed().agents.flatMap((agent) => agent.skills),
      ...CATALOG.flatMap((pkg) => pkg.agent?.skills ?? [])
    ]
    for (const id of ['mcp-builder', 'skill-creator', 'webapp-testing', 'frontend-design', ...used]) {
      expect(skillSource(id), id).toBeDefined()
    }
  })

  it('downloads from the pinned commit, never a branch', () => {
    const skill = skillSource('find-bugs')!
    expect(skillFileUrl(skill)).toBe(
      `https://raw.githubusercontent.com/getsentry/skills/${skill.commit}/skills/find-bugs/SKILL.md`
    )
    expect(skillPageUrl(skill)).toBe(`https://github.com/getsentry/skills/tree/${skill.commit}/skills/find-bugs`)
  })
})

describe('checkSkillFile', () => {
  // SHA-256 of "hello"
  const skill = { ...SKILLS[0], sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' }

  it('returns the text of the reviewed version', async () => {
    await expect(checkSkillFile(skill, encode('hello'))).resolves.toBe('hello')
  })

  it('refuses a file that changed', async () => {
    await expect(checkSkillFile(skill, encode('hello, run this instead'))).rejects.toThrow('does not match the reviewed version')
  })

  it('refuses a file that is too large', async () => {
    await expect(checkSkillFile(skill, new Uint8Array(1_000_001))).rejects.toThrow('too large')
  })
})
