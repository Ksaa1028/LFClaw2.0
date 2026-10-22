/** 管理端组件回归使用仓库源码和共享 DOM 环境。 */
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin } from '../../../vitest.shared.ts'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./scripts/test-dom-environment.ts'],
    include: ['LFClaw/02-管理端/admin-web/tests/**/*.spec.tsx'],
  },
})
