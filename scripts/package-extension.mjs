import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import archiver from 'archiver'
import { artifactFileName } from './release-config.mjs'
import { validateArtifactDirectory } from './artifact-smoke.mjs'

const requestedPipeline = process.argv[2] || 'all'
if (!['reborn', 'classic', 'all'].includes(requestedPipeline)) throw new Error('Specify reborn, classic, or all.')

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(absolutePath, relativePath))
    else if (entry.isFile()) files.push(relativePath)
    else throw new Error(`Unsupported file type in build output: ${relativePath}`)
  }
  return files
}

async function packagePipeline(pipeline) {
  const outputDirectory = pipeline === 'classic' ? 'dist-classic' : 'dist-reborn'
  const outputRoot = resolve(process.cwd(), outputDirectory)
  const outputStats = await stat(outputRoot).catch(() => null)
  assert.ok(outputStats?.isDirectory(), `${outputDirectory} does not exist.`)

  const manifest = JSON.parse(await readFile(resolve(outputRoot, 'manifest.json'), 'utf8'))
  await validateArtifactDirectory(outputDirectory, pipeline)

  const files = await listFiles(outputRoot)
  if (!files.length) throw new Error(`${outputDirectory} is empty.`)
  for (const file of files) {
    const segments = file.split('/')
    const basename = segments.at(-1)
    if (segments.includes('node_modules') || segments.includes('.git') || segments.includes('src') || basename === '.env' || basename?.endsWith('.pem') || basename?.endsWith('.crx')) {
      throw new Error(`Development or secret file found in ${outputDirectory}: ${file}`)
    }
  }

  const artifactDirectory = resolve(process.cwd(), 'release-artifacts')
  await mkdir(artifactDirectory, { recursive: true })
  const fileName = artifactFileName(pipeline, manifest)
  const zipPath = resolve(artifactDirectory, fileName)
  await rm(zipPath, { force: true })
  await rm(`${zipPath}.sha256`, { force: true })

  const output = createWriteStream(zipPath)
  const archive = archiver('zip', { zlib: { level: 9 } })
  const completed = new Promise((resolvePromise, rejectPromise) => {
    output.on('close', resolvePromise)
    output.on('error', rejectPromise)
    archive.on('error', rejectPromise)
  })
  archive.pipe(output)
  for (const file of files) {
    archive.append(await readFile(resolve(outputRoot, ...file.split('/'))), {
      name: file,
      date: new Date(0)
    })
  }
  await archive.finalize()
  await completed

  const checksum = createHash('sha256').update(await readFile(zipPath)).digest('hex')
  await writeFile(`${zipPath}.sha256`, `${checksum}  ${fileName}\n`)
  console.log(`Packaged ${fileName} (${archive.pointer()} bytes).`)
}

const pipelines = requestedPipeline === 'all' ? ['reborn', 'classic'] : [requestedPipeline]
if (requestedPipeline === 'all') await rm(resolve(process.cwd(), 'release-artifacts'), { recursive: true, force: true })
await mkdir(resolve(process.cwd(), 'release-artifacts'), { recursive: true })
for (const pipeline of pipelines) await packagePipeline(pipeline)
