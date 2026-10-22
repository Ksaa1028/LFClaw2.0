# LFClaw release deployment

English | [中文](lfclaw-release-deployment.zh.md)

This procedure defines the release input and deployment rules for the LFClaw desktop update source and hosted services. The new deployment uses a separate root under `/opt`; the existing `/opt/LfClaw` service is outside its scope.

## LFClaw deployment requirements

The new deployment root is `/opt/lfclaw-enterprise`. Keep its releases, configuration, data, process identity, and network routes separate from the existing `/opt/LfClaw` service. The deployment environment supplies the server access method and process supervisor. Do not copy configuration or data from the existing service unless a separately verified migration is requested.

Transfer accepts files only, not folders. For each module update, upload one `.tar.gz` archive to `packages/` and run one module deploy command. The command selects the newest complete archive for that module, verifies it, then extracts and activates it. Upload under a temporary `.uploading` filename and rename it after transfer so a partial archive cannot be selected. Do not copy a local build directory or the entire repository to the server.

The operator-facing release ID uses `yyyyMMddxx`, with an Asia/Shanghai date and a two-digit sequence starting at `01` each day. Check existing IDs before publication; the same ID cannot name different bytes. The desktop updater requires SemVer, so LFClaw maps the ID to independent calendar numbering; for example, `2026102108` maps to `2026.10.21-8`, without the underlying DSH version prefix. The deployment record must retain the mapping, and the updater compares the internal version. A bare date ID must not replace the internal application version.

Keep only `packages/`, `admin/`, and `desktop/` when serving desktop updates at the deployment root. The admin module separates executable files, private configuration, and business data into `admin/versions/`, `admin/config/`, and `admin/data/`. The client obtains needed enterprise data through authenticated service APIs. A future public client JSON may contain enterprise endpoints, features, and presentation resources, but never server secrets, authorization credentials, or user data.

Keep only the active and one previous rollback archive per module in `packages/`. Windows and macOS each retain their latest two published installer versions and matching archives. After successful publication, delete earlier versions without extra server backups. Incomplete uploads use a non-archive extension; validation failures stop publication and cleanup. Current and previous feeds must reference retained files. See the [desktop publisher](../../LFClaw/08-构建运行/desktop-release/README.md) for cleanup checks.

The client needs to show its installed version and the latest available version. Before moving a feed to a new version, the publisher verifies the complete archive, manifest, installer size and SHA-512, public reads, and update metadata. The client prompts only after the server confirms a complete package with a version newer than the installed one. It still verifies the downloaded installer and uses the existing installation confirmation flow. A failed check must not offer installation.

The local Windows entry point is `一键打包LFClaw-Windows.bat` in the repository root. Double-clicking it installs dependencies, allocates a local release ID using the Asia/Shanghai date, and builds an unsigned Windows x64 installer connected to the deployed enterprise API. It requires no `.env.windows` or Windows signing certificate; it embeds the dedicated LFClaw update URL and release public key. Unless `ELECTRON_MIRROR` is already set, the launcher uses the npmmirror Electron mirror; downloads are verified against checksums from the pinned Electron npm package. Before delivery, the launcher starts the packaged client with isolated test data and requires the LFClaw sidebar to mount; a startup failure stops delivery. The installer is copied to `apps/desktop/.desktop-build/release-bundles/LFClaw-<release-id>-windows-x64.exe`; success opens that folder, and the window remains open on failure. Failed builds retain their reserved IDs. `-CheckOnly` on the PowerShell entry checks tooling without building. Clients without an update source require one manual installation. Subsequent LFClaw updates use an Ed25519-signed feed and SHA-512 installer checks, with separate user download and installation actions; this does not add Windows Authenticode signing. The script never uploads files. The [manual Apple Silicon workflow](../../.github/workflows/lfclaw-mac-arm64-package.yml) produces an unsigned test DMG with the same ID; it is not a production automatic update package. Production macOS updates require Apple Developer ID signing, notarization, and their configuration. Local Windows packaging cannot replace the macOS signed build.

The enterprise Gongfeng repository and GitHub repository for macOS packaging have not been selected. When supplied, record which repository owns source, workflows, and release artifacts; do not copy private enterprise resources or credentials into a public repository.

## Admin server directories

The admin archive contains the dedicated LFClaw enterprise API and built administrator Web assets. The packaged dsh launcher selects the lfclaw-admin profile with server/cordis.admin.patch.yml; it does not load the general DSH Web application. See the `LFClaw/08-构建运行/server-release/README.md` for deployment commands.

```text
/opt/lfclaw-enterprise/
  packages/                      # one uploaded archive per module update
    lfclaw-admin-<yyyyMMddxx>-linux-x64.tar.gz
    lfclaw-win-x64-<yyyyMMddxx>.tar.gz
    lfclaw-mac-arm64-<yyyyMMddxx>.tar.gz
  admin/
    live -> versions/<yyyyMMddxx>/
    versions/<yyyyMMddxx>/       # extracted runtime/ and web/
    config/runtime.json
    data/
      db.json
      admin-auth.json
      sessions.json
      dsh-home/                 # dedicated admin DSH_HOME
      connector-data/           # created when connectors need persistent state
      skills/                    # uploaded skill ZIP files
      session-shares/            # index.json and shared session JSON files
      backups/                   # created only when an admin backup runs
  desktop/                       # only when serving desktop updates
    dsh-desk/bin/<target>/       # installers, update files, blockmaps
    dsh-desk/feeds/<target>/     # update channel YAML
```

- `packages/` is the only upload directory. Admin, Windows, and Mac packages are single-file archives; the deploy command selects the newest file by module prefix and valid release ID, then checks its manifest, target, size, and SHA-512. A valid archive is not necessarily running, so its filename alone must not trigger a client update.
- `admin/` is the admin module. Keep only the current and one previous validated extracted version in `versions/`; the deployer points `live` to the candidate during activation and restores the previous target if startup or health checking fails. Serve the administrator Web app from `live/web/` and the dedicated LFClaw API from `live/runtime/`. Route `/lfclaw/api` to that API process.
- `admin/config/runtime.json` stores bindHost, port, publicOrigin and dataDirectory. The installer removes initialPassword after successful initialization. Only root and the service group can read the file; it is never served over HTTP or included in an archive.
- `admin/data/db.json` holds structured department, employee, model, skill, connector, expert, personal expert, release, and operation records. Connector accounts and secrets, commands, arguments, environment variables, and external expert configuration are stored there too. Connectors that need local state use `connector-data/` or their explicitly configured data directory. Do not create separate `experts/` or `connectors/` directories for structured records or serve this file as client-readable JSON.
- `admin/data/admin-auth.json` holds administrator credentials; `sessions.json` holds administrator and employee login sessions. `skills/<UUID>.zip` holds uploaded skill content, while `db.json` records references and revisions. Retain older ZIPs while skill history references them.
- `admin/data/session-shares/index.json` holds sharing policy, metadata, and notices. Sibling `<UUID>.json` files hold full shared sessions and attachments; the server removes expired payloads. `backups/<UUID>.zip` holds manual admin backups, whose records live in `db.json`. Downloadable admin backups exclude personal experts, so server migration must also back up the complete `db.json`, session files, and share files. Switching `live` never resets `data/`.
- `desktop/dsh-desk/bin/` holds public installers and update files, and `feeds/` holds channel metadata. This tree maps to the existing client URLs `/dsh-desk/bin/<target>/` and `/dsh-desk/feeds/<target>/`. Windows updates require `.exe` and `.exe.blockmap`. Mac manual installation uses `.dmg`; automatic updates require `.zip` and `.zip.blockmap`. Replace a feed only after publishing and verifying its referenced files. Do not create `desktop/` for an admin-only deployment.

The Linux x64 archive requires Node.js 24 or newer and systemd. Direct HTTP management access is supported when explicitly selected; traffic is unencrypted. Desktop uses the configured production enterprise service, including local manual testing; HTTP requires explicit allowInsecureHttp configuration. Server stdio connectors need their executables available to the service account: npx commands require npm/npx and registry access. Pin package versions and test each connector under that account. Its HOME is admin/data, which also holds its npm cache. Client-side connectors need dependencies on each client. Logs go to journald.

The service reads business files from LFCLAW_DATA_DIR. The run.mjs launcher supplies configuration to the dedicated profile; /healthz reports product, releaseId and readiness. Only administrator static assets and enterprise APIs are served.

The admin process also requires its own `DSH_HOME=/opt/lfclaw-enterprise/admin/data/dsh-home`; do not share profiles, settings, or sessions with another DSH service on the host. Expose only the admin page and `/lfclaw/api` through the chosen network route. Do not expose other DSH Web paths. Check the selected listen port and proxy routes for collisions with existing services before activation.

## Release input

Build one immutable archive for each version and target. A target is one desktop platform and architecture or one hosted-service runtime. The archive contains a manifest with product, target, version, file paths, byte lengths, and SHA-512 values; the publisher verifies every entry before changing the live deployment. Rebuilding the same version with different bytes is rejected: assign a newer version instead. Never install a release by manually copying individual files into a live directory.

The desktop command `pnpm --dir apps/desktop run bundle:update -- <target>` creates a desktop archive after a completed target package. The COS uploader still publishes objects individually. The admin packager is `LFClaw/08-构建运行/server-release/pack.mjs`; its bundled deploy.mjs validates the archive, tests startup with temporary data, and activates the dedicated systemd unit.

## Directory ownership

The desktop update site reads verified archives from `packages/`, places installers in `desktop/dsh-desk/bin/<target>/` and channel metadata in `desktop/dsh-desk/feeds/<target>/`, and serves them over HTTPS. Apply the two-version retention rule after successful publication; clients requesting removed versions must refresh the feed. Do not place credentials or user data in `desktop/`.

The admin service reads verified archives from `packages/`, extracts them under `admin/versions/<release-id>/`, and uses `admin/live` to select the running version. `admin/config/` and `admin/data/` persist across releases. Logs go to the chosen supervisor or log service; a release archive contains no persistent data or secrets.

Admin updates preserve admin/data and operator configuration; only the initialization password is removed after first successful startup. Enterprise records, login sessions, skill ZIPs, shares and backups stay in place. The deployer rejects dataSchema changes; migrations require a separately verified complete backup and compatibility review.

Employee sessions reside in `$DSH_HOME` on each client device, not in the server's `desktop/` tree or the application installation directory. A desktop update may replace the application and bundled runtime only; it must not delete, move, or reset `$DSH_HOME`, Electron user data, or employee-selected workspaces. Keep the application identity and these data paths stable across packages. Windows in-place updates use the uninstall mode that retains user data; a user-initiated uninstall is a separate operation. A server update does not replace a backup of client-local sessions.

## Publication order

The operator runs one module deploy command. The deployer selects the newest complete archive for that module from `packages/`, then verifies its manifest, signature policy, file hashes, target, and strictly newer version before activation. For desktop updates, it publishes binaries and blockmaps to their final versioned paths first, verifies public reads, and replaces channel metadata atomically last; an interrupted upload cannot make the feed point to missing binaries. The desktop update URL embedded at packaging must be the same public origin used by the publisher.

For the admin service, the deployer extracts into `admin/versions/<release-id>/`, validates configuration, switches `admin/live`, then starts or restarts the service through its declared supervisor and runs the health check. If activation or health checking fails, it restores the previous pointer and service. It reports an unknown result when it cannot establish the active version; operators inspect state before retrying. Deployment never deletes older releases as part of activation.

## Verification and rollback

Verify desktop downloads, update metadata, signatures and retained client sessions after an update. For management deployment, check /healthz, administrator login and existing enterprise records. Activation failures automatically restore the previous version; manual downgrade is not exposed by the installer. After successful activation, cleanup keeps current and previous program versions and matching archives. deployment.json records the active and previous IDs.

## Current implementation limit

The management archive, dedicated launcher, validator, installer and health endpoint are implemented. Health qualification requires both the expected release ID and the enterprise API authentication response. Desktop supports explicitly configured HTTP enterprise access; Windows archive publication uses the [LFClaw publisher](../../LFClaw/08-构建运行/desktop-release/pack.mjs). Signed macOS publication needs Apple credentials and a destination repository.
