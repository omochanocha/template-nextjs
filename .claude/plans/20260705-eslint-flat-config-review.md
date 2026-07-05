# Code Review: ESLint Flat Config移行 / husky→lefthook移行

## メタ情報

| 項目 | 内容 |
| --- | --- |
| レビュー対象 | `git diff master...develop`（2コミット） |
| コミット | `039b2f0` eslintをネイティブflat configへ移行し設定を整理 / `e7e513f` huskyとlint-stagedをlefthookへ移行 |
| レビュー日 | 2026-07-05 |
| 手法 | high-effort マルチエージェント（correctness 3角度 + cleanup/altitude/conventions 5角度 → 検証1票） |
| 指摘件数 | 10件（CONFIRMED 6件 / PLAUSIBLE 4件） |

---

## サマリ表

| # | ファイル:行 | 分類 | 検証 | 要約 |
| --- | --- | --- | --- | --- |
| 1 | `eslint.config.mjs:126` | バグ | CONFIRMED | `recommendedTypeChecked` がファイル無制限展開、`disableTypeChecked` ガードがコメントアウト → JS ファイルで型情報エラー |
| 2 | `eslint.config.mjs:126` | バグ | CONFIRMED | `@typescript-eslint/no-unused-expressions` が `nextTs` の `warn` を `error` に上書き → コミットブロック |
| 3 | `eslint.config.mjs`（config全体） | バグ | CONFIRMED | `eslint:recommended` が丸ごと消失 → `no-fallthrough` / `no-debugger` 等60ルール無効化 |
| 4 | `eslint.config.mjs:123` | バグ | CONFIRMED | `jsx-a11y/recommended` 32ルール → `nextCoreWebVitals` の6ルールに縮小 |
| 5 | `lefthook.yml:7,13` | バグ | CONFIRMED | prettier v3 で `--loglevel` は廃止。`--log-level` が正しい |
| 6 | `eslint.config.mjs:21` | バグ | CONFIRMED | `no-var:'error'` が TS限定スコープに移動 → JS/JSX で `var` 素通り |
| 7 | `lefthook.yml:2` | バグ | PLAUSIBLE | `parallel:true` + `stage_fixed:true` で並行 `git add` が `.git/index.lock` 競合 |
| 8 | `eslint.config.mjs:52` | バグ | PLAUSIBLE | `'^react'` 正規表現が `react-query` 等も第1グループに誤分類 |
| 9 | `eslint.config.mjs:61` | 脆弱性 | PLAUSIBLE | `import/first` 等3ルールが `nextCoreWebVitals` のプラグイン登録に暗黙依存 |
| 10 | `eslint.config.mjs:125` | バグ | PLAUSIBLE | `nextTs` → `typescript-eslint/base` が babel パーサをグローバル上書き |

---

## 推奨対応の優先度

**先行対応**（コミットフローや lint 実行そのものを壊す）

- **#1 #2**: `recommendedTypeChecked` の適用スコープ制御とルール重複解消
- **#5**: prettier の `--loglevel` → `--log-level` 修正
- **#7**: `parallel:true` + `stage_fixed:true` の安全性確認

**次フェーズ**（ルール網羅性の後退）

- **#3**: `eslint:recommended` の再追加（`@eslint/js` を import して `js.configs.recommended` を展開）
- **#4**: `jsx-a11y/recommended` の追加（`eslint-plugin-jsx-a11y` を直接 import して全ルールを適用）
- **#6**: `no-var` を `typeConfig` から外して全ファイル対象に戻す（または global config に移動）

**要判断**（挙動変更だが意図次第）

- **#8**: `'^react'` 正規表現の意図確認 → `'^react$'`/`'^react-dom(/|$)'` に絞るか検討
- **#9**: `import/*` ルールの explicit 登録化（今は動くが将来の eslint-config-next 更新で壊れる可能性）
- **#10**: babel 専用構文を使う .js ファイルが存在するかを確認

---

## 各指摘 詳細

### #1 — JS ファイルで型チェックルールがクラッシュ

**ファイル**: `eslint.config.mjs:126`  
**検証**: CONFIRMED

**現象**  
`tseslint.configs.recommendedTypeChecked` と `tseslint.configs.stylisticTypeChecked` はどちらも `files` フィルタなしで全ファイルに型チェックルールを展開する。一方 `projectService: true`（TypeScript の型情報ソース）は `typeConfig` の `files: ['src/**/*.{ts,tsx}']` にしかない。`disableTypeChecked` による JS ファイルの保護はコメントアウト状態。

**発生シナリオ**  
`lint:es` のグロブ `src/app/**/*.{js,jsx,ts,tsx}` が JS/JSX ファイルを含んでいるため、`src/` に `.js` ファイルが存在すると `no-unsafe-assignment` 等の型チェックルールが型情報なしで適用され、ESLint が `You have used a rule which requires type information, but don't have parserOptions set to enable type checking` で異常終了する。

**推奨修正**  
コメントアウトされているガードを有効化する:

```js
{
  files: ['**/*.{js,mjs,cjs}'],
  ...tseslint.configs.disableTypeChecked,
},
```

---

### #2 — `@typescript-eslint/no-unused-expressions` が `warn` から `error` に上書き

**ファイル**: `eslint.config.mjs:126`  
**検証**: CONFIRMED

**現象**  
`nextTs`（`eslint-config-next/typescript.js:46`）が `@typescript-eslint/no-unused-expressions: 'warn'` と意図的に緩和しているが、後ろに置かれた `tseslint.configs.recommendedTypeChecked`（インデックス2のコンフィグ、`files` フィルタなし）が同ルールを `'error'` に戻す。

**発生シナリオ**  
void ラップした非同期呼び出しや optional-chained な副作用式が `error` 扱いになり、`lefthook` の `lint_ts`（`eslint --fix --quiet`）が exit 1 を返してコミットをブロックする。

**推奨修正**  
`typeConfig.rules` または `importConfig.rules` に明示的なオーバーライドを追加:

```js
'@typescript-eslint/no-unused-expressions': 'warn',
```

---

### #3 — `eslint:recommended` が削除され、コアルールが無効化

**ファイル**: `eslint.config.mjs`（config 全体）  
**検証**: CONFIRMED

**現象**  
旧設定の `compat.extends('eslint:recommended', ...)` が削除された。`nextCoreWebVitals`・`nextTs`・`tseslint.configs.recommendedTypeChecked` のいずれも `eslint:recommended`（`js.configs.recommended`）を含まない（`typescript-eslint` の `eslint-recommended` は TypeScript で二重になるルールを *無効化* するだけで、基本ルールを有効化するものではない）。

**無効化されるルール例**  
`no-fallthrough`、`no-debugger`、`no-unreachable`、`no-duplicate-case`、`valid-typeof`、`use-isnan`、`no-constant-condition` 等、約60ルール。

**発生シナリオ**  
switch の break 漏れやデバッグ用 `debugger` 文がリントをパスしたまま本番コードに入る。

**推奨修正**  
`import js from '@eslint/js'` を追加し、config 配列の先頭近くに展開:

```js
import js from '@eslint/js';
// ...
export default defineConfig([
  js.configs.recommended,
  // ...
]);
```

---

### #4 — `jsx-a11y/recommended` が32ルールから6ルールに縮小

**ファイル**: `eslint.config.mjs:123`  
**検証**: CONFIRMED

**現象**  
旧設定の `plugin:jsx-a11y/recommended`（32ルール）が削除された。`eslint-config-next@16` の `dist/index.js` で有効化されているのは以下6ルールのみ:

- `jsx-a11y/alt-text`
- `jsx-a11y/aria-props`
- `jsx-a11y/aria-proptypes`
- `jsx-a11y/aria-unsupported-elements`
- `jsx-a11y/role-has-required-aria-props`
- `jsx-a11y/role-supports-aria-props`

**無効化されるルール例**  
`click-events-have-key-events`、`anchor-is-valid`、`label-has-associated-control`、`tabindex-no-positive`、`no-autofocus`、`interactive-supports-focus` 等、26ルール。

**推奨修正**  
`eslint-plugin-jsx-a11y` を直接 import して `flat/recommended` を展開:

```js
import jsxA11y from 'eslint-plugin-jsx-a11y';
// ...
jsxA11y.flatConfigs.recommended,
```

---

### #5 — prettier v3 で `--loglevel` フラグが廃止

**ファイル**: `lefthook.yml:7`（および`:13`）  
**検証**: CONFIRMED

**現象**  
prettier v3 でオプションが `--loglevel` から `--log-level` にリネームされた。現在の `lefthook.yml` は旧フラグを使用しており、prettier v3.5.3 実行時に以下の警告が出て出力抑制が機能しない:

```text
[warn] Ignored unknown option --loglevel=warn. Did you mean --log-level?
```

#### 推奨修正

```yaml
# 変更前
run: npx prettier --write --loglevel=warn {staged_files} && ...
# 変更後
run: npx prettier --write --log-level=warn {staged_files} && ...
```

---

### #6 — `no-var:'error'` が TS ファイル限定スコープに移動

**ファイル**: `eslint.config.mjs:21`  
**検証**: CONFIRMED

**現象**  
旧設定ではグローバルルールとして全ファイルに適用されていた `no-var: 'error'` が、`typeConfig`（`files: ['src/**/*.{ts,tsx}']`）内に移動した。

**発生シナリオ**  
`importConfig` のグロブ `src/**/*.{js,ts,jsx,tsx}` で処理される JS/JSX ファイルで `var` 宣言を使ってもエラーにならない。

**推奨修正**  
`no-var` をグローバル `languageOptions` ブロックと同階層のグローバルルールブロック、または `importConfig.rules` に移動:

```js
{
  files: ['src/**/*.{js,ts,jsx,tsx}'],
  rules: { 'no-var': 'error' },
},
```

---

### #7 — `parallel:true` + `stage_fixed:true` で `.git/index.lock` 競合

**ファイル**: `lefthook.yml:2`  
**検証**: PLAUSIBLE

**現象**  
`parallel: true` と `stage_fixed: true` が hook レベルで同時に設定されている。`stage_fixed` は各コマンドが修正したファイルを完了時に `git add` する機能。複数コマンドが同時完了すると、それぞれが `git add` を発行してインデックスロック（`.git/index.lock`）を取り合う。

**発生シナリオ**  
`lint_ts`（prettier+eslint 完了）と `lint_css`（stylelint 完了）がほぼ同時に終わると、2つめの `git add` が `fatal: Unable to create .git/index.lock: File exists` で失敗し、一部の自動修正が unstaged のままコミットがブロックされる。

**推奨修正の選択肢**

- `parallel: false` にしてシーケンシャル実行にする（簡単・確実）
- `stage_fixed` を hook レベルから外し、各コマンドレベルで個別管理する
- lefthook の issue tracker で `parallel + stage_fixed` の組み合わせのサポート状況を確認する

---

### #8 — `'^react'` 正規表現が react-query 等を誤分類

**ファイル**: `eslint.config.mjs:52`  
**検証**: PLAUSIBLE

**現象**  
`simple-import-sort/imports` の第1グループ正規表現 `'^react'` は `react` で始まる全パッケージにマッチするため、`react-query`・`react-hook-form`・`react-router` 等のサードパーティパッケージが `react`/`react-dom` と同じグループに入る。

**発生シナリオ**  
`react-query` を import すると自動修正で react コアグループに統合され、意図した「react コア専用」の第1グループが機能しない。

**推奨修正**  
react と react-dom だけに絞る:

```js
groups: [
  ['^react$', '^react-dom(/|$)'],
  ['^node:', '^@?\\w'],
  // ...
],
```

---

### #9 — `import/*` ルールがプラグイン未登録で `nextCoreWebVitals` に暗黙依存

**ファイル**: `eslint.config.mjs:61`  
**検証**: PLAUSIBLE

**現象**  
`importConfig.plugins` には `simple-import-sort` と `unused-imports` しか登録されていないが、`importConfig.rules` に `import/first`・`import/newline-after-import`・`import/no-duplicates` の3ルールが宣言されている。これらは `nextCoreWebVitals`（`eslint-config-next/dist/index.js`）が `eslint-plugin-import` を `'import'` キーで登録しているため、現状は動作する。ただし `eslint-plugin-import` は直接 devDependencies から削除済み。

**発生シナリオ**  
`eslint-config-next` が将来 `eslint-plugin-import-x`（プラグインキー `'import-x'`）に移行した場合、3ルールが全て `Definition for rule 'import/first' was not found` エラーになる。

**推奨修正**  
`eslint-plugin-import` を devDependencies に戻して `importConfig.plugins` に明示登録するか、3ルールを nextCoreWebVitals に委ねて自前宣言を削除する。

---

### #10 — `nextTs` が babel パーサをグローバルに TypeScript パーサで上書き

**ファイル**: `eslint.config.mjs:125`  
**検証**: PLAUSIBLE

**現象**  
`nextCoreWebVitals`（`dist/index.js`）が `.{js,jsx,mjs,ts,tsx,...}` に babel ベースのパーサを設定している。その後に置かれた `nextTs`（`eslint-config-next/dist/typescript.js`）は `typescript-eslint` の `recommended` を含み、その中の `typescript-eslint/base`（`files: undefined`）が `@typescript-eslint/parser` をグローバルに設定して babel パーサを上書きする。

**発生シナリオ**  
babel 専用の実験的構文を使う `.js`/`.jsx` ファイルが `src/` にある場合、`@typescript-eslint/parser` でパースされてエラーになる。現状はそのようなファイルが存在しないため実害は薄いが、将来的なリスク。

**推奨修正**  
現状のソースに babel 専用構文が存在しなければ影響は無い。状況に応じて `files: ['**/*.{ts,tsx}']` スコープで TypeScript パーサを明示指定し、JS ファイルへの適用を防ぐことを検討。
