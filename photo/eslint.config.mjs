// ESLint 扁平配置（flat config）。
//
// 定位：**正确性优先**，不承担格式化职责。
// 理由：把 ESLint 当 formatter 用会把全仓 110+ 个 TS 文件整体重排，
// diff 无法 review，且与本项目"改一处、四处受益"的小步提交习惯冲突。
// 格式约束由 `.editorconfig` 管；将来若需要真正的格式化，另接 Prettier。
//
// 用法：`npm run lint`（根目录），已接入 `npm run verify`。

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/** 全仓忽略：产物、依赖、冻结代码、临时目录。 */
const IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  'dist/**',
  // electron-builder 的产物目录（含解包后的 Electron 运行时，不是我们的源码）。
  '**/release/**',
  'release/**',
  'tmp/**',
  'apps/*/tmp/**',
  '**/*.d.ts',
  '.workbuddy/**',
  // legacy/ 已冻结：只接受致命修复，不做风格改造。
  // 见 docs/P6C-PLAN.md §2 —— 把它纳入 lint 等于逼着改冻结代码。
  'legacy/**',
];

const PLATFORM_GLOBALS = [
  'document',
  'window',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'fetch',
  'process',
  'Buffer',
  'require',
  'module',
  'global',
  '__dirname',
  '__filename',
];

export default tseslint.config(
  { ignores: IGNORES },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      /* ── 正确性优先的小集合：低噪声、高收益 ── */
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-throw-literal': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  /* ── 纯 JS 外壳（Electron 主进程 / preload / 构建脚本）：Node 环境 ── */
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },

  /* 手机修图外壳跑在 WebView 里，不是 Node。浏览器全局在这里是对的。 */
  {
    files: ['apps/mobile/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },

  /* ── CommonJS：`require()` 在这里是**正确写法**，不是风格问题 ──
   *
   * Electron 主进程与 preload 必须是 CJS（随附 Node 不支持 `require(esm)`），
   * 因此 typescript-eslint 的 `no-require-imports` 对 `.cjs` 是纯误报。
   * 见 docs/ARCHITECTURE.md 决策 D11。
   */
  {
    files: ['**/*.{cjs,cts}'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  /* ── TypeScript：语言本身已管住未声明标识符 ── */
  {
    files: ['**/*.ts'],
    rules: { 'no-undef': 'off' },
  },

  /* ── 库（packages/*）不许往控制台输出：那是外壳的职责 ── */
  {
    files: ['packages/**/*.ts'],
    rules: { 'no-console': 'error' },
  },

  /* ── 内核边界守门：core / io 不得引用任何平台全局 ──
   *
   * `packages/core` / `packages/io` 的 tsconfig 是 `lib: ES2022` + `types: []`，
   * 引用平台 API 本就会**编译失败**。这里再加一道 lint 级守门，纯粹是为了
   * **错误信息更直白** —— 编译期报的是"找不到名字 document"，而这条直接说
   * "内核必须零平台依赖，改由外壳注入"。
   */
  {
    files: ['packages/core/**/*.ts', 'packages/io/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...PLATFORM_GLOBALS.map((name) => ({
          name,
          message: '内核必须零平台依赖：不要引用平台全局，改由外壳注入（见 docs/ARCHITECTURE.md）。',
        })),
      ],
    },
  },
);
