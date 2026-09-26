import { expectedReleaseTag, readReleaseConfig } from './release-config.mjs'

const tag = process.argv[2] || process.env.GITHUB_REF_NAME
if (!tag) throw new Error('A release tag is required.')
const config = await readReleaseConfig()
const expected = expectedReleaseTag(config)
if (tag !== expected) throw new Error(`Expected release tag ${expected}, received ${tag}.`)
console.log(`Validated release tag ${tag}.`)
