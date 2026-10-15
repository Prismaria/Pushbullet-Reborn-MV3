import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { readReleaseConfig, resolvePipelineRelease } from './release-config.mjs'

const outputDirectory = process.argv[2] || 'dist-reborn'
const pipeline = process.argv[3] || (outputDirectory === 'dist-classic' ? 'classic' : 'reborn')

export async function validateArtifactDirectory(outputPath, artifactPipeline = pipeline) {
  const root = resolve(process.cwd(), outputPath)
  const read = (name) => readFile(resolve(root, ...name.split('/')))
  const manifest = JSON.parse(await read('manifest.json'))
  const config = await readReleaseConfig()
  const release = resolvePipelineRelease(config, artifactPipeline)
  const classic = artifactPipeline === 'classic'

  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.background.service_worker, 'background.js')
  assert.equal(manifest.version, release.version)
  assert.equal(manifest.action.default_popup, classic ? 'classic-pages/panel.html' : 'popup.html')
  assert.equal(manifest.options_page, classic ? 'classic-pages/options.html' : 'options.html')
  if (classic) assert.equal(manifest.version_name, release.version_name)
  else assert.equal(manifest.version_name, undefined)
  assert.ok(manifest.permissions.includes('activeTab'))
  assert.ok(manifest.permissions.includes('tabs'))
  assert.ok(manifest.permissions.includes('cookies'))
  assert.equal(manifest.key, undefined)
  assert.deepEqual(manifest.host_permissions, [
    'https://api.pushbullet.com/*',
    'https://upload.pushbullet.com/*',
    'https://*.upload.pushbullet.com/*',
    'https://upload2.pushbullet.com/*',
    'https://www.pushbullet.com/*'
  ])
  assert.deepEqual(manifest.optional_permissions, ['contextMenus'])

  const entryFiles = classic
    ? ['background.js', 'classic-pages/panel.html', 'classic-pages/options.html', 'classic-pages/chat-window.html', 'classic-pages/welcome.html', 'offscreen.html', 'classic-assets/base.css']
    : ['background.js', 'popup.html', 'options.html', 'chat.html', 'offscreen.html']
  if (!classic) {
    await assert.rejects(read('classic-pages/panel.html'))
    await assert.rejects(read('classic-assets/base.css'))
  }
  const classicActionAssets = classic
    ? ['classic-assets/action_cancel.png', 'classic-assets/action_halt.png', 'classic-assets/action_tick.png', 'classic-assets/action_undo.png', 'classic-assets/action_web.png']
    : []
  for (const file of [...entryFiles, ...classicActionAssets, 'icon_16.png', 'icon_19_gray.png', 'icon_32.png', 'icon_38_gray.png', 'icon_48.png', 'icon_128.png', 'alert.ogg', '_locales/en/messages.json']) {
    await read(file)
  }

  if (classic) {
    const panel = (await read('classic-pages/panel.html')).toString()
    await read('classic-assets/panel-startup.js')
    await read('classic-assets/panel-shell.js')
    assert.match(panel, /<script src="(?:\.\.\/|\/)classic-assets\/panel-startup\.js"><\/script>/)
    assert.ok(panel.indexOf('classic-assets/panel-startup.js') < panel.indexOf('type="module"'))
    assert.match(panel, /class="classic-popup-shell"/)
    assert.match(panel, /rel="preload"[^>]+pushfont\.woff/)
  }

  for (const [file, size] of [['icon_16.png', 16], ['icon_19_gray.png', 19], ['icon_32.png', 32], ['icon_38_gray.png', 38], ['icon_48.png', 48], ['icon_128.png', 128]]) {
    const image = await read(file)
    assert.equal(image.toString('ascii', 1, 4), 'PNG')
    assert.equal(image.readUInt32BE(16), size)
    assert.equal(image.readUInt32BE(20), size)
  }

  return manifest
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  await validateArtifactDirectory(outputDirectory, pipeline)
  console.log('Build artifact smoke test passed.')
}
