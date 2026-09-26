import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import AdmZip from 'adm-zip'
import { artifactFileName, readReleaseConfig, resolvePipelineRelease } from './release-config.mjs'
import { validateArtifactDirectory } from './artifact-smoke.mjs'

const requestedPipeline = process.argv[2] || 'all'
if (!['reborn', 'classic', 'all'].includes(requestedPipeline)) throw new Error('Specify reborn, classic, or all.')

const config = await readReleaseConfig()
const pipelines = requestedPipeline === 'all' ? ['reborn', 'classic'] : [requestedPipeline]
const artifactDirectory = resolve(process.cwd(), 'release-artifacts')

for (const pipeline of pipelines) {
  const release = resolvePipelineRelease(config, pipeline)
  const manifest = { version: release.version, version_name: release.version_name }
  const fileName = artifactFileName(pipeline, manifest)
  const zipPath = resolve(artifactDirectory, fileName)
  const zipBytes = await readFile(zipPath)
  const checksumText = await readFile(`${zipPath}.sha256`, 'utf8')
  const expectedChecksum = checksumText.trim().split(/\s+/)[0]
  const actualChecksum = createHash('sha256').update(zipBytes).digest('hex')
  assert.equal(expectedChecksum, actualChecksum, `${fileName} checksum does not match.`)

  const zip = new AdmZip(zipBytes)
  const entries = zip.getEntries()
  assert.ok(entries.length > 0, `${fileName} is empty.`)
  for (const entry of entries) {
    const entryPath = entry.entryName.replaceAll('\\', '/')
    assert.ok(!entryPath.startsWith('/') && !entryPath.split('/').includes('..'), `${fileName} contains an unsafe path: ${entry.entryName}`)
  }

  const extractionDirectory = await mkdtemp(resolve(tmpdir(), 'pushbullet-release-'))
  try {
    zip.extractAllTo(extractionDirectory, true)
    await validateArtifactDirectory(extractionDirectory, pipeline)
  } finally {
    await rm(extractionDirectory, { recursive: true, force: true })
  }
  console.log(`Validated ${fileName} and its checksum.`)
}
