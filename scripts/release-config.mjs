import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const CONFIG_FILE = 'release-versions.json'

export async function readReleaseConfig(root = process.cwd()) {
  const file = resolve(root, CONFIG_FILE)
  const config = JSON.parse(await readFile(file, 'utf8'))
  if (!config.release || typeof config.release.title !== 'string' || !config.release.title.trim()) {
    throw new Error(`${CONFIG_FILE} must define release.title.`)
  }
  if (typeof config.release.notes_key !== 'string' || !config.release.notes_key.trim()) {
    throw new Error(`${CONFIG_FILE} must define release.notes_key.`)
  }
  resolvePipelineRelease(config, 'reborn')
  resolvePipelineRelease(config, 'classic')
  return config
}

export function validateChromeVersion(value, label) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/.test(value)) {
    throw new Error(`${label} must be one to four dot-separated non-negative integers.`)
  }
  const parts = value.split('.').map(Number)
  if (parts.some((part) => part > 65535)) {
    throw new Error(`${label} must not contain a component greater than 65535.`)
  }
  return value
}

export function resolvePipelineRelease(config, pipeline, overrides = {}) {
  if (pipeline !== 'reborn' && pipeline !== 'classic') throw new Error(`Unknown release pipeline: ${pipeline}`)
  const definition = config?.[pipeline]
  if (!definition || typeof definition !== 'object') throw new Error(`${pipeline} release metadata is missing.`)

  const version = overrides.version ?? definition.version
  validateChromeVersion(version, `${pipeline}.version`)

  const versionName = overrides.versionName ?? definition.version_name
  if (pipeline === 'classic' && (typeof versionName !== 'string' || !versionName.trim())) {
    throw new Error('classic.version_name must be a non-empty string.')
  }

  return {
    ...definition,
    version: String(version),
    version_name: versionName === undefined ? undefined : String(versionName)
  }
}

export function safeArtifactPart(value) {
  const normalized = String(value)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
  if (!normalized) throw new Error(`Cannot create an artifact name from: ${value}`)
  return normalized
}

export function artifactFileName(pipeline, manifest) {
  const name = pipeline === 'classic' ? 'classic' : 'reborn'
  const suffix = pipeline === 'classic' && manifest.version_name
    ? `-${safeArtifactPart(manifest.version_name)}`
    : ''
  return `pushbullet-${name}-${safeArtifactPart(manifest.version)}${suffix}.zip`
}

export function expectedReleaseTag(config) {
  const reborn = resolvePipelineRelease(config, 'reborn')
  const classic = resolvePipelineRelease(config, 'classic')
  return `release/reborn-${reborn.version}-classic-${classic.version}`
}
