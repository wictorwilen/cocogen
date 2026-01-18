# Releasing `@wictorwilen/cocogen`

This repo publishes to npm via GitHub Actions when you push a semver tag.

## Prerequisites (one-time)
- Configure npm Trusted Publishing (OIDC) for `@wictorwilen/cocogen`.
   - Add GitHub Actions as a trusted publisher in npm for this repo.
   - Ensure the workflow has `id-token: write` permission (already set).
- Ensure the npm package scope is configured for public publishing.
   - This repo sets `publishConfig.access = "public"` in package.json.

## Release process
1) Pick a version number (semver).

2) Bump the version in `package.json`.
   - Recommended: `npm version <patch|minor|major> --no-git-tag-version`
   - Or edit `package.json` manually.

3) Commit the version bump.
   - Use a Conventional Commit message, for example: `chore(release): v0.0.1`

4) Create a tag that matches the workflow pattern `v*.*.*`.
   - Example: `git tag v0.0.1`

5) Push to GitHub.
   - `git push origin main`
   - `git push origin v0.0.1`

6) Verify the publish.
   - Check the GitHub Actions run for “Release (npm)”.
   - Confirm on npm: `npm view @wictorwilen/cocogen version`

## Notes
- The publish workflow builds from the tagged commit and runs `npm publish --provenance --access public` using OIDC.
- If you need to re-run without a new tag, you can use `workflow_dispatch` in GitHub Actions.
- Avoid reusing tags; npm won’t allow republishing the same version.
