import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const pipeline = process.argv[2]
if (pipeline !== 'classic') throw new Error('Specify the manifest pipeline to patch.')

const file = resolve(process.cwd(), 'dist-classic', 'manifest.json')
const manifest = JSON.parse(await readFile(file, 'utf8'))
manifest.name = 'Pushbullet Classic'
manifest.version = '367'
manifest.version_name = '367 beta'
manifest.description = 'The faithful component-based Pushbullet Classic interface.'
manifest.action.default_popup = 'classic-pages/panel.html'
manifest.action.default_title = 'Pushbullet'
manifest.options_page = 'classic-pages/options.html'
await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`)
