# Windows Desktop Update Publication

English | [中文](README.zh.md)

<a id="windows-客户端更新发布"></a>

The root packaging script embeds `http://8.216.38.213:39811/lfclaw-updates/win-x64/`, with no DeepSeek Harness update source or forced-update policy. Versions use an independent date format, such as `2026.10.21-9`; filenames use release IDs such as `2026102109`. The client offers only higher versions, with separate user choices for downloading and installing.

The installer has no Windows Authenticode signature. Ed25519 signs the update manifest and SHA-512 verifies the installer; HTTP provides no transport confidentiality. Clients embed the public key. The private key stays only in the maintainer user directory at `.codex/lfclaw-release/update-private.pem`, never in Git, the server or installers. Back it up securely; replacing the key cannot make installed clients trust new releases.

Older installed packages without update configuration require one manual installation of a version with update support. Uploading files or changing server manifests cannot add that capability to old binaries. New clients disable the original source and trust only LFClaw signed manifests. Downloads use complete installers rather than differential downloads based on SemVer filename substitution.

After the root build passes actual UI checks, run `node LFClaw/08-构建运行/desktop-release/pack.mjs <release-id>` to create one `lfclaw-win-x64-<release-id>.tar.gz`. Upload it under `/opt/lfclaw-enterprise/packages/` with an `.uploading` suffix, compare SHA256, then rename it to the final archive name. Extract `deploy.mjs` from the verified archive into a temporary file and execute it with the archive absolute path. The deployer verifies members, sizes, hashes, manifest signature and increasing version, publishing immutable installers before atomically replacing the manifest. After interruption, inspect current state; never overwrite a release ID with different bytes.

The administration service provides read-only static downloads from `desktop/win-x64/` and `desktop/mac-arm64/` under the deployment root by default; `desktopDirectory` selects a dedicated root. Store no business data or credentials there. After successful publication, retain the latest two versions for Windows and macOS independently. Delete earlier installers, blockmaps and matching archives without keeping extra server backups. The deployer calls `retention.mjs` for either platform after verifying the installer. Cleanup rejects files referenced by current or previous feeds. Clients requesting a removed version must refresh the feed. Verify retention with `node --test LFClaw/08-构建运行/desktop-release/retention.test.mjs`. Signed manifests bind version, installer name, size and hash; missing signatures, tampering, external origins and unauthorized differential-package fields are rejected.

For an Apple Silicon release, download the DMG from the matching GitHub Actions artifact and verify its SHA-256. Run `node LFClaw/08-构建运行/desktop-release/pack-mac.mjs <release-id> <verified-dmg-path>` to create `lfclaw-mac-arm64-<release-id>.tar.gz`. Transfer and deploy this archive through the same verified `packages/` procedure as Windows. A Mac build containing the LFClaw update URL detects a newer signed feed, downloads and verifies the DMG, and opens it after user confirmation. The user completes installation in macOS; an older Mac build without that URL needs one manual installation. The unsigned DMG is not an in-place automatic update.

Before delivery, run signature and update-coordinator tests, the actual packaged UI check and a real Electron online qualification such as `node apps/desktop/scripts/qualify-lfclaw-update.mjs 2026.10.21-10 2026.10.21-9 --direct`. Arguments are online version then simulated installed version; `--direct` bypasses the system proxy only for this isolated test. Confirm detection, signature verification and complete download. Qualification never executes the installer and does not replace an installation-upgrade test with retained user data.

## Knowledge-base installer synchronization

<a id="知识库安装包同步"></a>

After publication, update section thirteen, latest installers, in [LFClaw Enterprise Customization](https://bxz6lqekwy.feishu.cn/wiki/DHIgws6jkiizt1kOWsOcdr1jnSg), underlying document `HuQ4dRNsZoEx3KxnLBzcj1sFnOJ`. The maintenance agent performs this under user authorization as a release-delivery step, not a scheduled background task.

Use work-kb-maintainer and the Feishu document skill to read current rules and the target section, then verify online version, platform, architecture, size and hash. Upload the same verified installer as the platform attachment, replace the prior latest entry in place and add its fixed-version URL, version, date and upgrade limits. Windows and macOS reflect actual published artifacts separately. Platforms without new packages retain historical labels and pending status; never rename old packages as new. Follow project instructions for macOS artifact sourcing.

Read back attachment names, sizes and links, then append the knowledge-base maintenance log (`Am15doVKdohdqxxntSkcrZQAngc`) and local work log. If upload or document writing fails, retain a working entry and report incomplete synchronization. Never update only version text while leaving an old attachment, or label unpublished local changes as delivered.
