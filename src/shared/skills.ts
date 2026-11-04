// Skills the Marketplace offers. Each one was read before it was listed, so it is locked to the
// commit it was reviewed at and its SKILL.md must match the recorded hash. A later change upstream
// cannot reach agents until the entry here is updated.
export interface SkillSource {
  id: string
  name: string
  author: string
  summary: string
  tags: string[]
  repo: string
  path: string
  commit: string
  sha256: string
  license: string
}

const MAX_SKILL_BYTES = 1_000_000

export const SKILLS: SkillSource[] = [
  {
    id: 'mcp-builder',
    name: 'MCP Builder',
    author: 'anthropics',
    summary: 'Guides an agent through designing and building a new MCP server.',
    tags: ['mcp', 'development'],
    repo: 'anthropics/skills',
    path: 'skills/mcp-builder',
    commit: 'ca45fc496a3436251f191354091d557da31c15b5',
    sha256: 'b483b56d6673134497e45489c317f26ae0f1429c194db0297e43073e17e6748c',
    license: 'Apache-2.0'
  },
  {
    id: 'skill-creator',
    name: 'Skill Creator',
    author: 'anthropics',
    summary: 'Guides an agent through writing and improving agent skills.',
    tags: ['skills', 'authoring'],
    repo: 'anthropics/skills',
    path: 'skills/skill-creator',
    commit: 'ca45fc496a3436251f191354091d557da31c15b5',
    sha256: 'dcd4803e61e913e6fc27294184cd3a71f09f5e924ff20c8a9a20173e7b3c2bcf',
    license: 'Apache-2.0'
  },
  {
    id: 'webapp-testing',
    name: 'Webapp Testing',
    author: 'anthropics',
    summary: 'Test local web applications with Playwright and capture what happened.',
    tags: ['testing', 'browser'],
    repo: 'anthropics/skills',
    path: 'skills/webapp-testing',
    commit: 'ca45fc496a3436251f191354091d557da31c15b5',
    sha256: '51b7349e77ec63b7744a6f63647e7566a0b4d2e301121cc10e8c2113af6556a2',
    license: 'Apache-2.0'
  },
  {
    id: 'frontend-design',
    name: 'Frontend Design',
    author: 'anthropics',
    summary: 'Guidance for building distinctive, production-grade interfaces.',
    tags: ['ui', 'design'],
    repo: 'anthropics/skills',
    path: 'skills/frontend-design',
    commit: 'ca45fc496a3436251f191354091d557da31c15b5',
    sha256: 'd91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3',
    license: 'Apache-2.0'
  },
  {
    id: 'doc-coauthoring',
    name: 'Doc Co-Authoring',
    author: 'anthropics',
    summary: 'A structured workflow for writing specs, proposals and decision docs with the user.',
    tags: ['writing', 'docs'],
    repo: 'anthropics/skills',
    path: 'skills/doc-coauthoring',
    commit: 'ca45fc496a3436251f191354091d557da31c15b5',
    sha256: '2e47d78846faeea4a56e9809c52700087a15a2155a3f293a3efbaded81398ef4',
    license: 'Not stated'
  },
  {
    id: 'find-bugs',
    name: 'Find Bugs',
    author: 'getsentry',
    summary: 'Reviews the changes on a branch for bugs, security holes and quality issues.',
    tags: ['review', 'security'],
    repo: 'getsentry/skills',
    path: 'skills/find-bugs',
    commit: '0c464f411bdfb8d4c12314b36264d06cb2f60270',
    sha256: '08664c3698f89116a4b04d12f699f95cff1aadb725da353b7f24f8ad73b02003',
    license: 'Apache-2.0'
  },
  {
    id: 'sentry-commit',
    name: 'Commit Messages',
    author: 'getsentry',
    summary: 'Writes conventional commit messages and keeps commits off the main branch.',
    tags: ['git', 'workflow'],
    repo: 'getsentry/skills',
    path: 'skills/commit',
    commit: '0c464f411bdfb8d4c12314b36264d06cb2f60270',
    sha256: '0307d3ecfe3b3e70246cbd88b19dc5853340b624b6ee3cd935c7bffc45b64279',
    license: 'Apache-2.0'
  },
  {
    id: 'django-perf-review',
    name: 'Django Performance Review',
    author: 'getsentry',
    summary: 'Finds proven Django performance problems such as N+1 queries and unbounded querysets.',
    tags: ['django', 'performance'],
    repo: 'getsentry/skills',
    path: 'skills/django-perf-review',
    commit: '0c464f411bdfb8d4c12314b36264d06cb2f60270',
    sha256: '52283bff7b23f06f94bbb413d174fd1cbcf497f8e8a63d4f0d569ba6bfd949d4',
    license: 'Apache-2.0'
  },
  {
    id: 'writing-user-docs',
    name: 'User Docs Style',
    author: 'callstackincubator',
    summary: 'House style for user-facing docs: voice, scope, structure and what to leave out.',
    tags: ['writing', 'docs'],
    repo: 'callstackincubator/agent-skills',
    path: 'skills/writing-user-docs',
    commit: '59e9d17446a248b21d86f078fcd0bd2d36db1ca4',
    sha256: 'b631015f194cae5c40dbadff8d1a67da3124613157c58c033b7a503cbaad59ba',
    license: 'MIT'
  },
  {
    id: 'natural-writing',
    name: 'Natural Writing',
    author: 'flutter',
    summary: 'Rules for plain, natural prose that avoids common AI writing habits.',
    tags: ['writing', 'style'],
    repo: 'flutter/skills',
    path: '.agents/agents/reidbaker-agent/skills/natural-writing',
    commit: '774dc2c1e7fa748b792ef4d12580ca73686f82a5',
    sha256: 'f89735df60461d8ef4013d63b4af11b04de753feec9c9fd34502844f733afa0e',
    license: 'BSD-3-Clause'
  },
  {
    id: 'unix-cli-best-practices',
    name: 'Unix CLI Best Practices',
    author: 'flutter',
    summary: 'Safe, portable shell patterns for macOS tools, ripgrep and fd.',
    tags: ['shell', 'macos'],
    repo: 'flutter/skills',
    path: '.agents/agents/reidbaker-agent/skills/unix-cli-best-practices',
    commit: '774dc2c1e7fa748b792ef4d12580ca73686f82a5',
    sha256: 'c79ffcd766b279abdd1b6166579ca22b320fc3690207310afb15d675d8599fab',
    license: 'BSD-3-Clause'
  },
  {
    id: 'dart-add-unit-test',
    name: 'Dart Unit Tests',
    author: 'flutter',
    summary: 'Writes and organizes Dart unit tests with package:test.',
    tags: ['dart', 'testing'],
    repo: 'flutter/skills',
    path: 'skills/dart-add-unit-test',
    commit: '774dc2c1e7fa748b792ef4d12580ca73686f82a5',
    sha256: '02428fa20c2cb90afcaf17a52c559641b85eb04f2765a54da2bc72ca858c1fce',
    license: 'BSD-3-Clause'
  },
  {
    id: 'flutter-architecture',
    name: 'Flutter Architecture',
    author: 'flutter',
    summary: 'Structures Flutter apps into separate UI, logic and data layers.',
    tags: ['flutter', 'architecture'],
    repo: 'flutter/skills',
    path: 'skills/flutter-apply-architecture-best-practices',
    commit: '774dc2c1e7fa748b792ef4d12580ca73686f82a5',
    sha256: '00497869976a903c83f509a59d4b6a501d409fa711eb8e1f89945921e1983b65',
    license: 'BSD-3-Clause'
  },
  {
    id: 'firebase-security-rules-auditor',
    name: 'Firebase Rules Auditor',
    author: 'firebase',
    summary: 'Audits Firestore and Cloud Storage security rules for bypasses and privilege escalation.',
    tags: ['firebase', 'security'],
    repo: 'firebase/agent-skills',
    path: 'skills/firebase-security-rules-auditor',
    commit: 'b76be96aaf5f152a5fb3112dde85c723c45539e7',
    sha256: '6522cd9e61ca577e80326b7204b69883822e1bdf1846b0c829c43993fdeb3b4a',
    license: 'Apache-2.0'
  },
  {
    id: 'deno-sandbox',
    name: 'Deno Sandbox',
    author: 'denoland',
    summary: 'Runs untrusted or AI-generated code in isolated Deno Sandboxes.',
    tags: ['deno', 'sandbox'],
    repo: 'denoland/skills',
    path: 'skills/deno-sandbox',
    commit: 'd5f6ace6b113aee71ba5286612fa1bde34c7d102',
    sha256: '654d72b18a7b3bc1db3a85ce0978f03319bc75315dadc34f31bc407b0a7aaa7f',
    license: 'MIT'
  },
  {
    id: 'langchain-fundamentals',
    name: 'LangChain Fundamentals',
    author: 'langchain-ai',
    summary: 'Builds LangChain agents with create_agent, tools and middleware.',
    tags: ['langchain', 'agents'],
    repo: 'langchain-ai/langchain-skills',
    path: 'config/skills/langchain-fundamentals',
    commit: '126c384d8552dcb476b226c244172186cc3f4328',
    sha256: '00dc50a19d6eec308e3c4a5b8ca237fdddeb00195e7e29d009049f5d0566f5c2',
    license: 'MIT'
  },
  {
    id: 'langchain-rag',
    name: 'LangChain RAG',
    author: 'langchain-ai',
    summary: 'Builds retrieval-augmented generation pipelines with LangChain.',
    tags: ['langchain', 'rag'],
    repo: 'langchain-ai/langchain-skills',
    path: 'config/skills/langchain-rag',
    commit: '126c384d8552dcb476b226c244172186cc3f4328',
    sha256: '4ebd791aeaaf8a4c3b9fc164404bf51de66e94e8d98cae6f34e73e533df4afb2',
    license: 'MIT'
  },
  {
    id: 'langgraph-human-in-the-loop',
    name: 'LangGraph Human in the Loop',
    author: 'langchain-ai',
    summary: 'Adds approval pauses and error handling to LangGraph workflows.',
    tags: ['langgraph', 'agents'],
    repo: 'langchain-ai/langchain-skills',
    path: 'config/skills/langgraph-human-in-the-loop',
    commit: '126c384d8552dcb476b226c244172186cc3f4328',
    sha256: 'ce56e8ce58548dd1d7cb0d3e524cf546cef0c712e3c35d63fdd4ae354b40d3c1',
    license: 'MIT'
  },
  {
    id: 'terraform-refactor-module',
    name: 'Terraform Module Refactor',
    author: 'hashicorp',
    summary: 'Turns monolithic Terraform into reusable modules, with a plan for migrating state.',
    tags: ['terraform', 'infrastructure'],
    repo: 'hashicorp/agent-skills',
    path: 'plugins/terraform/skills/refactor-module',
    commit: '5e30fa5c867ba6777c37e4206babfd08049c396f',
    sha256: 'da0b9f3599ed0e513a92b57f0c0ff3fad3168ba461215a9197ebbffe4e0d538f',
    license: 'MPL-2.0'
  },
  {
    id: 'upgrade-stripe',
    name: 'Upgrade Stripe',
    author: 'stripe',
    summary: 'Upgrades Stripe API versions, webhook endpoints and SDKs.',
    tags: ['stripe', 'payments'],
    repo: 'stripe/ai',
    path: 'skills/upgrade-stripe',
    commit: '8f4c6295246b771bdfbffd4a50171f75a03507c8',
    sha256: '20f5c98ee2fc65fe5693b1efb0e395f00b302e5334f80f9bbced510ecf92dda3',
    license: 'MIT'
  },
  {
    id: 'huggingface-papers',
    name: 'Hugging Face Papers',
    author: 'huggingface',
    summary: 'Reads and summarizes AI research papers through Hugging Face paper pages.',
    tags: ['research', 'papers'],
    repo: 'huggingface/skills',
    path: 'skills/huggingface-papers',
    commit: '25910b3d0ba31a2ba102f901cdc9e008c278a69c',
    sha256: '985c2d5c7261aba2b157811cde0c2b30134663694a4ab701280de28f941eb3b2',
    license: 'Apache-2.0'
  }
]

export const skillSource = (id: string) => SKILLS.find((skill) => skill.id === id)

export const skillFileUrl = (skill: SkillSource) =>
  `https://raw.githubusercontent.com/${skill.repo}/${skill.commit}/${skill.path}/SKILL.md`

export const skillPageUrl = (skill: SkillSource) => `https://github.com/${skill.repo}/tree/${skill.commit}/${skill.path}`

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Returns the skill's text only when it is exactly the version that was reviewed.
export async function checkSkillFile(skill: Pick<SkillSource, 'name' | 'sha256'>, bytes: Uint8Array<ArrayBuffer>) {
  if (bytes.byteLength > MAX_SKILL_BYTES) throw new Error(`${skill.name} is too large to use.`)
  if ((await sha256Hex(bytes)) !== skill.sha256) {
    throw new Error(`${skill.name} does not match the reviewed version, so it was not used.`)
  }
  return new TextDecoder().decode(bytes)
}
