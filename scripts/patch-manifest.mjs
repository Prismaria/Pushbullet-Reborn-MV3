import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readReleaseConfig, resolvePipelineRelease } from './release-config.mjs'

const pipeline = process.argv[2]
if (pipeline !== 'reborn' && pipeline !== 'classic') throw new Error('Specify the manifest pipeline to patch: reborn or classic.')

const args = process.argv.slice(3)
const overrides = {}
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]
  if (argument === '--version' || argument === '--version-name') {
    const value = args[index + 1]
    if (!value) throw new Error(`${argument} requires a value.`)
    if (argument === '--version') overrides.version = value
    else overrides.versionName = value
    index += 1
    continue
  }
  if (argument.startsWith('--version=')) overrides.version = argument.slice('--version='.length)
  else if (argument.startsWith('--version-name=')) overrides.versionName = argument.slice('--version-name='.length)
  else throw new Error(`Unknown manifest patch argument: ${argument}`)
}

const config = await readReleaseConfig()
const release = resolvePipelineRelease(config, pipeline, overrides)
const outputDirectory = pipeline === 'classic' ? 'dist-classic' : 'dist-reborn'
const file = resolve(process.cwd(), outputDirectory, 'manifest.json')
const manifest = JSON.parse(await readFile(file, 'utf8'))
manifest.name = release.name || manifest.name
manifest.version = release.version

if (pipeline === 'classic') {
  manifest.version_name = release.version_name
  manifest.description = 'The faithful component-based Pushbullet Classic interface.'
  manifest.action.default_popup = 'classic-pages/panel.html'
  manifest.action.default_title = 'Pushbullet'
  manifest.options_page = 'classic-pages/options.html'
} else {
  delete manifest.version_name
}

await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Patched ${pipeline} manifest to ${manifest.version}${manifest.version_name ? ` (${manifest.version_name})` : ''}.`)
