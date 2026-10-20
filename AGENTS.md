# OWOX Data Marts plugin development

Before changing this plugin, read:
https://docs.owox.com/docs/plugins/authoring-guide/

Use the OWOX Data Marts plugin authoring guide as the source of truth for plugin behavior,
security constraints, manifests, SDK usage, deployment, releases, and publishing.

If the authoring guide cannot be accessed, report that limitation before making assumptions
about the OWOX plugin contract.

## Hosting

- The plugin is a static Vite build. The GitHub Actions workflow deploys `dist` to GitHub Pages.
- Vite `base` matches the deployed path: `/sql-console/` for a project site, `/` for a domain
  root.
- `delivery.url` in `plugin.json` is the public HTTPS address of the deployed page.
- Every deployment to that address changes what installed members run, even before a release.
  Treat it as a production change.

## Versions and releases

- A version is a published GitHub Release that is not a draft or a prerelease, tagged
  `MAJOR.MINOR.PATCH` with an optional leading `v` and no prerelease or build suffix. OWOX
  records the tagged commit and its `plugin.json`.
- The highest eligible release becomes current for every member. Moving or recreating a tag does
  not change a recorded version; roll back with a new, higher release.
- Within a compatibility line, a release cannot remove a collection or change its name, scope, or
  entity binding. Below 1.0.0 the line is the minor version, from 1.0.0 the major version; bump
  it to ship such a change.
- After a release, `owox-ctl plugins update OWNER/PLUGIN_NAME` applies it without waiting for the
  daily check.

## Errors

- Catch errors from every `ctx.owox`, collection, and credential call, and show the member what
  failed. Never leave a blank screen.
- An exact Credential's `asFetch()` resolves with the provider's error response instead of
  throwing: check `response.ok`.
- The reason is in `error.payload` (`code`, `status`, `message`, `details`), or in
  `error.cause.payload` when the API client wrapped it. See "Handle request errors" in the
  authoring guide.
