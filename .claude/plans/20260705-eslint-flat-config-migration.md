# ESLint: FlatCompatの名残を消して完全ネイティブFlat Config化

## Context（なぜやるか）

現在の `eslint.config.mjs` は `create-next-app` が生成した「FlatCompatブリッジ」構成のまま。`@eslint/eslintrc` の `FlatCompat` を使い、Next.jsのレガシー(`.eslintrc`形式)設定 `next/core-web-vitals` / `next/typescript` などを `compat.extends(...)` でflat configに変換して食わせている。これはあくまで移行過渡期の「名残」であり、真のflat configではない。

調査で判明した核心:
- **`eslint-config-next@15.2.4`（現行）はflat configを一切エクスポートしない**。中身は `.eslintrc` 形式（文字列extends、`@rushstack/eslint-patch` によるモジュール解決ハック、babelベースparser、`env`/`overrides`/`settings`）で、flat configと構造的に非互換。FlatCompatはまさにこれを食わせるために存在している。
- **`eslint-config-next@16` は完全に別物で、ネイティブflat config配列を返す**。`eslint-config-next/core-web-vitals` は `[...index(react/react-hooks/@next/next/import/jsx-a11y をflat配線), next.configs['core-web-vitals']]`、`eslint-config-next/typescript` は `[...typescript-eslint.configs.recommended, {rules}, {ignores}]`。`typescript-eslint` メタパッケージを内部バンドル。
- **`eslint-config-next@16` は `next` にpeer依存しない**（peerは `eslint>=9` と `typescript>=3.3` のみ）。よって **Next本体は15.5据え置きのまま、`eslint-config-next` だけを16へ上げればFlatCompatを完全に外せる**（＝採用する案1）。

目的: FlatCompat/`@eslint/eslintrc` を排除し、`eslint-config-next` のネイティブflatエクスポートを直接importする素直なflat configにする。現状のlintはクリーン（`src/app` は `layout.tsx`/`page.tsx` のみ、`eslint` exit 0）なので挙動リスクは小さい。

## 採用方針（案1）

- **Next本体(`next@15.5`)は上げない**。`eslint-config-next` のみ `15.2.4 → ^16` に更新。
- FlatCompat・`@eslint/eslintrc`・`@eslint/js`(compat用)を撤去。
- Next提供のflat配列を `import` して展開し、独自ルールと型チェック層を追記。
- **型チェック系の厳格さは維持**する（現行が `recommended-type-checked` + `stylistic-type-checked` + `strict-boolean-expressions:error` を意図的に有効化しているため）。`eslint-config-next/typescript` は非type-checkedの `recommended` だけなので、`typescript-eslint` の type-checked 設定を自前で足す。

## 変更対象

### 1. `package.json`（依存の更新）
- `eslint-config-next`: `15.2.4` → `^16`
- 追加: `typescript-eslint`（メタパッケージ。`tseslint.configs.*` を自前設定で使うため。※`eslint-config-next@16` も内部依存として持つが、直接使うので明示devDep化）
- 削除（FlatCompat撤去で不要化）:
  - `@eslint/eslintrc`（FlatCompatの供給元）
  - `@eslint/js`（`recommendedConfig` 用にのみ使用）
  - `@typescript-eslint/eslint-plugin` / `@typescript-eslint/parser` の**直接**依存は撤去可（`typescript-eslint` メタが内包）。独自ルールは `@typescript-eslint/...` のルール名参照のみで、プラグイン登録はNext設定＋tseslintが行う。
- 任意削除（typesync由来の死蔵`@types`。config は `.mjs` で型検査対象外）: `@types/eslint-config-prettier` / `@types/eslint-plugin-jsx-a11y` / `@types/eslint-plugin-tailwindcss` / `@types/prettier`
- `scripts`（`lint:es` 等の `eslint 'src/app/**'`）と `lint-staged` は変更不要。

### 2. `eslint.config.mjs`（全面書き換え）
FlatCompatブロックを撤去し、以下の構造へ。**プラグイン登録は極力Next/tseslintの提供に委ね、自前で足すのは `unused-imports` と `tailwindcss`（flat/recommended）のみ**。

```js
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';
import tailwindcss from 'eslint-plugin-tailwindcss';
import unusedImports from 'eslint-plugin-unused-imports';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['**/node_modules/', '**/.next/', '**/next-env.d.ts', '**/*.config.mjs', '**/*.config.js'] },

  ...nextCoreWebVitals,                        // react/react-hooks/@next/next/import/jsx-a11y をflat配線
  ...nextTs,                                   // typescript-eslint recommended（非type-checked）＋Next独自tweak

  // 型チェックの厳格さを維持する層（現行 recommended-type-checked / stylistic-type-checked 相当）
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  ...tailwindcss.configs['flat/recommended'],  // 現行 plugin:tailwindcss/recommended の後継

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        projectService: true,                  // 現行 project:['./tsconfig.json'] のモダン後継
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'unused-imports': unusedImports },
    rules: {
      // ── 現行 eslint.config.mjs の rules をそのまま移植 ──
      'no-var': 'error',
      'sort-imports': 0,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      'import/order': [ /* 現行の groups/pathGroups/newlines-between/alphabetize をそのまま */ ],
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['warn', { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' }],
      'tailwindcss/classnames-order': 'warn',
      'tailwindcss/no-custom-classname': 'warn',
      'tailwindcss/no-contradicting-classname': 'error',
    },
  },

  // 非TSファイルは型チェック系ルールを無効化（configファイル等の誤爆防止）
  { files: ['**/*.{js,mjs,cjs}'], ...tseslint.configs.disableTypeChecked },

  prettier,                                    // 競合する整形ルールをオフにするため必ず最後
];
```

移植時の注意:
- `import/order` の詳細設定（`groups` / `pathGroups` / `pathGroupsExcludedImportTypes` / `newlines-between` / `alphabetize`）は現行 `eslint.config.mjs:75-114` から**そのまま**移す。
- `prettier`（`eslint-config-prettier`）は配列**最後**に置く。
- `import.meta.dirname` はNode 20.11+で利用可（本環境はNode 22系のため可）。使えない場合のみ `fileURLToPath` フォールバック。

### 3. `.vscode`（存在すれば）
ESLint拡張のflat config有効化（`eslint.useFlatConfig` / `experimental.useFlatConfig`）設定を確認。既にflat configで動いているので通常は変更不要。**確認のみ**。

## 検証

1. 依存更新: `npm install`（`eslint-config-next@^16` と `typescript-eslint` を反映、不要依存を削除）。
2. 設定の健全性: `npx eslint --print-config src/app/page.tsx > after.json` が**エラーなく生成**できること（旧設定でも取得し、有効ルール差分を目視。型チェック層維持で `strict-boolean-expressions` 等が `after` に残ることを確認）。
3. Lint実行: `npm run lint:es`（＝`eslint 'src/app/**/*.{js,jsx,ts,tsx}'`）が **exit 0**。現状クリーンなので原則グリーン。react-hooks 7 由来の新規指摘が出た場合のみ個別対応（フックはほぼ無く低リスク）。
4. 自動修正の無副作用: `npm run lint:es:fix` を実行し、`git diff` が無変更（もしくは意図した並べ替えのみ）であること。
5. lint-staged経路: 適当なファイルをstageして `npx lint-staged`（またはコミット）で `prettier --write` → `eslint --fix` が通ること。
6. FlatCompat痕跡ゼロ確認: `grep -rn "FlatCompat\|@eslint/eslintrc\|compat.extends" eslint.config.mjs` が**ヒット無し**。
7. ビルド影響が無いこと: `npm run build`（Next 15.5のまま。設定変更がビルドを壊していないことの確認）。

## 想定される差分・注意点

- **react-hooks 5→7**（config-next@16のバンドル依存）: 新ルール追加で理論上は新規指摘の可能性。実コードにフックがほぼ無いため実害は想定薄。出たら都度判断。
- **型チェック層の再追加**は「挙動維持のための意図的な追加」。もし厳格さ不要なら `tseslint.configs.recommendedTypeChecked/stylisticTypeChecked` と `strict-boolean-expressions`/`no-misused-promises` を落とし、`eslint-config-next/typescript` の非type-checked baselineに合わせる選択も可（要判断）。
- **`ignores` の統合**: `eslint-config-next/typescript` が独自に `.next/**`,`out/**`,`build/**`,`next-env.d.ts` をglobal ignore。先頭の自前 `ignores` と重複しても無害だが、整理して重複を減らす。
