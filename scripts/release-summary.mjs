import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { artifactFileName, readReleaseConfig } from './release-config.mjs'

const config = await readReleaseConfig()
const readManifest = async (pipeline) => JSON.parse(await readFile(resolve(process.cwd(), pipeline === 'classic' ? 'dist-classic' : 'dist-reborn', 'manifest.json'), 'utf8'))
const reborn = await readManifest('reborn')
const classic = await readManifest('classic')
let commit
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  commit = process.env.GITHUB_SHA || 'local'
}

console.log(`# ${config.release.title}`)
console.log('')
console.log(`Source commit: \`${commit}\``)
console.log('')
console.log('| Pipeline | Manifest version | Artifact |')
console.log('| --- | --- | --- |')
console.log(`| Reborn | ${reborn.version} | \`${artifactFileName('reborn', reborn)}\` |`)
console.log(`| Classic | ${classic.version} (${classic.version_name}) | \`${artifactFileName('classic', classic)}\` |`)
console.log('')
console.log('`npm run verify:all`, extracted-ZIP validation, and SHA-256 checksums passed before this release was created.')
