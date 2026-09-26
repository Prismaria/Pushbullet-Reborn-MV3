# Release Pipeline Implementation Plan

This plan makes the Reborn and Classic MV3 pipelines releasable from GitHub without mixing their source trees, manifests, output directories, versions, or publishing credentials.

## Current State

The project already has the required build separation:

- `src/` contains the shared worker, message, model, and Reborn UI code.
- `src/classic/` contains the Classic React UI implementation.
- `classic-pages/` contains Classic HTML entrypoints.
- `public/` contains shared runtime files and the base manifest.
- `public/classic-assets/` contains Classic-only static assets.
- `dist-reborn/` is the Reborn build output.
- `dist-classic/` is the Classic build output.
- `npm run verify:all` validates both pipelines with type, unit, worker, and artifact checks.

The release gaps are packaging, version ownership, GitHub workflow automation, store publishing controls, and release rollback procedures.

## Release Model

Treat Reborn and Classic as separate release products that can be built from the same commit.

- Reborn manifest version comes from the release version configuration.
- Classic manifest version and `version_name` come from the same configuration, not a hardcoded patch script value.
- A coordinated GitHub Release may contain both ZIPs.
- Each Chrome Web Store item is published independently with its own item ID and credentials.
- Publishing to the Chrome Web Store is a protected, manually approved stage after the GitHub Release artifacts are verified.

Recommended artifact names:

- `pushbullet-reborn-<version>.zip`
- `pushbullet-classic-<version>-<version_name>.zip`
- Matching SHA-256 checksum files for both ZIPs.

## Phase 1: Version and Release Metadata

Status: planned

- [ ] Add one committed release metadata file, such as `release-versions.json`.
- [ ] Define Reborn `version`, release title, and release notes key in that file.
- [ ] Define Classic numeric `version` and `version_name` in that file.
- [ ] Validate that Reborn and Classic versions satisfy Chrome Web Store manifest rules.
- [ ] Replace the hardcoded values in `scripts/patch-manifest.mjs` with values read from the release metadata or explicit CLI arguments.
- [ ] Fail the build when a requested pipeline version is missing or invalid.
- [ ] Document whether a release is coordinated or variant-specific.
- [ ] Add a release notes or changelog entry for every published version.

Suggested configuration shape:

```json
{
  "reborn": {
    "version": "0.1.0"
  },
  "classic": {
    "version": "367",
    "version_name": "367 beta"
  }
}
```

The committed file is the source of truth for local and CI builds. A future release workflow may accept an explicit version override, but it must write and validate the same manifest values before packaging.

## Phase 2: Build and Packaging Scripts

Status: planned

- [ ] Add `package:reborn`, `package:classic`, and `package:all` npm scripts.
- [ ] Add a cross-platform Node packaging script instead of depending on a developer's local `zip` or PowerShell command.
- [ ] Package only the contents of `dist-reborn/` or `dist-classic/`, not the output directory itself.
- [ ] Write ZIPs to a separate `release-artifacts/` directory.
- [ ] Generate SHA-256 checksums beside each ZIP.
- [ ] Make packaging fail when the output directory is missing or empty.
- [ ] Make packaging fail when a ZIP contains `node_modules/`, source files, `.env` files, or development metadata.
- [ ] Use stable artifact names derived from the generated manifest, not from the package version alone.
- [ ] Ensure repeated packaging from the same commit produces equivalent file sets.

Required package checks:

- Reborn ZIP contains `manifest.json`, `background.js`, Reborn entrypoints, required icons, locales, and runtime assets.
- Reborn ZIP contains no `classic-pages/` or `classic-assets/`.
- Classic ZIP contains `manifest.json`, `classic-pages/`, `classic-assets/`, `background.js`, required icons, locales, and runtime assets.
- Classic manifest contains the Classic name, numeric version, `version_name`, popup route, and options route.
- Every manifest-referenced file exists inside the ZIP.

## Phase 3: Artifact Validation

Status: planned

- [ ] Extend `scripts/artifact-smoke.mjs` to validate an extracted ZIP as well as a build directory.
- [ ] Validate the manifest after extraction, not only before packaging.
- [ ] Validate all popup, options, chat, welcome, worker, locale, icon, and audio paths.
- [ ] Validate icon dimensions for every manifest-referenced icon.
- [ ] Validate that Reborn has no Classic pages or assets.
- [ ] Validate that Classic has all renamed `classic-pages/` and `classic-assets/` paths.
- [ ] Add a ZIP integrity check using the generated SHA-256 checksum.
- [ ] Record the source commit SHA in the GitHub Release and workflow summary.

The release gate must run `npm run verify:all` before packaging and run the extracted-ZIP checks after packaging.

## Phase 4: Repository Hygiene

Status: planned

- [ ] Add `dist-reborn/`, `dist-classic/`, and `release-artifacts/` to `.gitignore`.
- [ ] Remove the obsolete empty `dist/` directory from the repository if it is no longer needed.
- [ ] Confirm that `.env`, Chrome keys, refresh tokens, CRX files, and PEM files are ignored.
- [ ] Commit `package-lock.json` and use `npm ci` in CI.
- [ ] Confirm that generated ZIPs are never committed to source control.
- [ ] Add a short release section to `README.md` linking to this plan and documenting local packaging.

## Phase 5: GitHub Actions Continuous Integration

Status: planned

Create `.github/workflows/ci.yml` for pull requests and pushes to the protected default branch.

Required jobs:

1. `verify`
   - Run on a supported Node LTS version.
   - Check out the repository.
   - Run `npm ci`.
   - Run `npm run verify:all`.
   - Upload failure diagnostics only when needed.

2. `package-preview`
   - Depend on `verify`.
   - Build and package both variants.
   - Run extracted-ZIP validation.
   - Upload short-lived workflow artifacts for pull request inspection.

Workflow requirements:

- Use `permissions: contents: read` for CI jobs.
- Use dependency caching only with the committed lockfile as the cache key.
- Set a concurrency group so obsolete runs for the same branch are cancelled.
- Do not expose Chrome Web Store secrets to pull request workflows.
- Pin third-party Actions to reviewed major versions or commit SHAs.

## Phase 6: GitHub Release Workflow

Status: planned

Create `.github/workflows/release.yml` triggered by an approved release tag and by manual dispatch.

Recommended flow:

1. Validate the tag and release metadata.
2. Run `npm ci`.
3. Run `npm run verify:all`.
4. Build and package Reborn and Classic in parallel.
5. Validate both extracted ZIPs and checksums.
6. Create or update the GitHub Release.
7. Upload both ZIPs and both checksum files.
8. Add the source commit, manifest versions, and verification summary to the release notes.

The workflow must not publish to the Chrome Web Store automatically as part of the unprotected build job.

Tag policy must be chosen and documented before implementation. The recommended initial policy is a coordinated tag containing both versions, for example:

```text
release/reborn-0.1.0-classic-367
```

If independent releases become necessary, support separate tags or manual dispatch inputs without changing the package format.

## Phase 7: Chrome Web Store Publishing

Status: planned

Create a separate `.github/workflows/publish-store.yml` or a protected publishing job in the release workflow.

- [ ] Use a protected GitHub Environment named `chrome-web-store`.
- [ ] Require at least one reviewer for the publishing environment.
- [ ] Publish Reborn and Classic as separate selectable jobs.
- [ ] Use separate item IDs for Reborn and Classic.
- [ ] Use separate credentials or explicitly scoped credentials for each item.
- [ ] Download the exact ZIP attached to the GitHub Release instead of rebuilding from an unverified workspace.
- [ ] Verify the checksum before upload.
- [ ] Record the Chrome Web Store upload result and version in the workflow summary.
- [ ] Keep publishing manual until upload, review, and rollback behavior has been exercised successfully.

Expected GitHub secrets or environment variables should be documented without storing values in the repository:

- Chrome Web Store API client ID.
- Chrome Web Store API client secret.
- Chrome Web Store API refresh token.
- Reborn Chrome Web Store item ID.
- Classic Chrome Web Store item ID, if Classic is store-listed.

Store publishing must account for the extension identity and signing key. A replacement extension cannot read the installed legacy extension's storage unless it uses the existing extension identity and compatible publishing setup.

## Phase 8: Manual Release Gates

Status: planned

Before approving store publication, install each generated ZIP as an unpacked extension and exercise:

- Authentication and sign-out.
- Popup and options entrypoints.
- Push, link, file, and SMS/MMS flows.
- Chat pop-out and window routing.
- Notifications and notification actions.
- Context menus, commands, permissions, and worker restart.
- Welcome/privacy approval flow.
- Classic visual and interaction comparison against the active legacy extension.

Record the result in the GitHub Release checklist or an issue linked from the release. Automated worker and artifact tests do not replace this live browser/account gate.

## Phase 9: Rollback and Recovery

Status: planned

- [ ] Keep the previous successful ZIPs and checksums attached to GitHub Releases.
- [ ] Do not rewrite or force-move release tags.
- [ ] Roll back by publishing a corrective release built from the previous known-good code with a new valid Chrome version.
- [ ] Remember that Chrome Web Store versions cannot normally be decreased; a rollback is a new forward version containing the previous behavior.
- [ ] Document how to disable a failed publishing job without deleting the GitHub Release.
- [ ] Document who approves a corrective store upload.
- [ ] Preserve release workflow logs and manifest summaries for auditability.

## Phase 10: Documentation and Ownership

Status: planned

- [ ] Add local release commands to `README.md`.
- [ ] Add a release checklist to the GitHub Release template.
- [ ] Document the version source of truth and tag format.
- [ ] Document the two artifact names and their intended install targets.
- [ ] Document Chrome Web Store item ownership and environment protection rules outside the repository's secret values.
- [ ] Record the manual browser validation owner and backup reviewer.
- [ ] Add a release history entry for every published Reborn or Classic version.

## Proposed NPM Commands

The final command names may change during implementation, but the project should expose equivalent commands:

```bash
npm run verify:all
npm run build:reborn
npm run build:classic
npm run package:reborn
npm run package:classic
npm run package:all
npm run validate:release
```

`validate:release` should validate both generated manifests, both ZIPs, all referenced files, version metadata, and the absence of cross-pipeline files.

## Acceptance Criteria

The release pipeline is complete when all of the following are true:

- [ ] A clean checkout with `npm ci` can build and package both variants.
- [ ] `npm run verify:all` passes in GitHub Actions.
- [ ] Reborn and Classic produce separate, named, checksummed ZIP artifacts.
- [ ] Reborn contains no Classic pages or assets.
- [ ] Classic contains its `classic-pages/` and `classic-assets/` paths.
- [ ] Both extracted ZIPs pass manifest and asset validation.
- [ ] A tagged GitHub Release receives both artifacts and checksums automatically.
- [ ] Chrome Web Store publication requires explicit protected approval.
- [ ] Reborn and Classic store credentials and item IDs cannot cross-contaminate.
- [ ] A known-good release can be reissued as a higher-version corrective release.
- [ ] The release process is documented well enough for a second maintainer to execute it.

## Implementation Order

1. Add version metadata and remove hardcoded Classic release values.
2. Add cross-platform packaging and extracted-ZIP validation.
3. Update `.gitignore` and release documentation.
4. Add CI workflow and verify it on a pull request.
5. Add GitHub Release workflow and test it with a non-store release.
6. Configure protected Chrome Web Store publishing.
7. Perform a supervised end-to-end release of both variants.
8. Document the final release and rollback runbooks.

## Open Decisions

- [ ] Are Reborn and Classic released together or independently by default?
- [ ] Is Classic published to the Chrome Web Store or only distributed as a GitHub artifact?
- [ ] Which maintainers approve a store publication?
- [ ] Which Node LTS and browser versions are supported by CI?
- [ ] Should live browser smoke tests run in CI, or remain a protected manual gate?
