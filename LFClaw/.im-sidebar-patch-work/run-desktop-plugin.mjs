import { runDesktopCli } from '../../apps/desktop/.desktop-build/development/project/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'

process.argv = [process.execPath, 'dsh', 'plugin', '--profile', 'desktop', 'install', '--force']
await runDesktopCli('D:/deepseek-harness/apps/desktop/.desktop-build/development/project', 'D:/deepseek-harness/apps/desktop/.desktop-build/targets/win-x64/runtime')
