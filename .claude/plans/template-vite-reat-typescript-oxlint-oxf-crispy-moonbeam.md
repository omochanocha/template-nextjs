# oxlint / oxfmt 移行計画（Next.js テンプレート）

## Context

このリポジトリは Next.js 15 (App Router) + React 19 + TypeScript 5.8 + Tailwind CSS の
テンプレートで、現在 ESLint (flat config) + Prettier + stylelint という構成を採っている。
姉妹リポジトリ `template-vite-react-typescript` は `migrate-to-oxc` ブランチで
ESLint/Prettier を oxlint/oxfmt へ完全置換済みであり、テンプレート群として構成を揃えたい。

目的は 3 つ。

1. lint/format を Rust 製ツールチェーンに一本化し、実行速度と設定の単純さを得る
2. 姉妹リポジトリと設定の見た目を揃え、両者の差分が「フレームワーク差分」として読める状態にする
3. 移行のついでに、調査で判明した既存の不整合（Tailwind v3/v4 の混在、lint 対象グロブのずれ、
   `next` 15 系に対する `eslint-config-next` 16 系のメジャー不一致）を解消する

### 経緯（Next.js 16 / TypeScript 7 への更新は不要と判明）

調査の初期段階で「oxlint の type-aware linting には TypeScript 7 が必要」という前提のもと、
Next.js 16 への更新・新規リポジトリでの作成まで検討したが、`oxlint-tsgolint` は
typescript-go を内蔵したネイティブバイナリで、プロジェクトの `node_modules/typescript` を
一切参照しないことが計画レビューで判明した。type-aware に必要なのは
「`tsconfig.json` が TS7 的に解釈可能であること」（`baseUrl` 不使用など）だけであり、
このリポジトリの `tsconfig.json` は最初からこれを満たしている。

したがって Next.js 15 / TypeScript 5.8 のまま、このリポジトリに直接
oxlint + oxlint-tsgolint を導入するだけで type-aware linting が使える。

## 決定事項

| 論点 | 決定 |
|---|---|
| 対象リポジトリ | このリポジトリ（`template-nextjs`）に直接導入。Next.js / TypeScript のバージョンは変更しない |
| 置換範囲 | 完全置換。ESLint / Prettier / eslint-config-next / 各種 eslint-plugin をすべて削除 |
| stylelint | 廃止。CSS は oxfmt の整形のみ（参考リポとは分岐する判断） |
| Tailwind | v4 に統一。`tailwind.config.js` と `autoprefixer` を削除し CSS-first 設定へ |
| type-aware | 有効化する。`oxlint-tsgolint` を追加するだけで TypeScript 5.8 のまま動く見込み |
| type-aware の指定場所 | `.oxlintrc.json` の `options.typeAware: true` に一本化し、CLI の `--type-aware` は付けない（重複を避ける） |
| jsPlugins | 使わない。alpha / semver 非適用のため、テンプレートに依存を埋め込まない |
| ルール基準 | 参考リポの `.oxlintrc.json` を土台に Next.js 差分を加減算 |
| 整形設定 | Prettier 由来のオプションとしては `printWidth: 100` + `singleQuote: true` のみ明示。現行 `.prettierrc.json` を継承（参考リポは `printWidth: 80` なので意図的に分岐） |
| import 順序 | `react` グループに `next` / `next/**` を同居させ最上位に配置 |
| エディタ | 参考リポ準拠に加えて現行の `files.associations` を維持。`typescript.tsdk` も参考リポと同様に設定する（TS 5.8 のままなので問題なく機能する） |
| CI | スコープ外（別案件） |

## 移行で失うルール

置換によって等価物が存在しなくなるもの。意図的な放棄として記録する。

| 失うルール | 理由 | 代替 |
|---|---|---|
| `@stylistic/padding-line-between-statements` | oxlint にネイティブ実装なし | なし（jsPlugins で復活可能だが alpha のため見送り） |
| `simple-import-sort/exports` | oxfmt に `sortExports` なし | なし |
| `tailwindcss/no-custom-classname` | oxlint スコープ外（oxc メンテナが issue #22537 で明言） | なし |
| `tailwindcss/no-contradicting-classname` | 同上 | なし |
| `tailwindcss/classnames-order` | 同上 | oxfmt の `sortTailwindcss` が代替（整形時に自動並び替え） |
| `eslint-plugin-react-hooks`（React Compiler 系）recommended のうち `rules-of-hooks` / `exhaustive-deps` 以外すべて（`error-boundaries`, `globals`, `immutability`, `preserve-manual-memoization`, `purity`, `refs`, `set-state-in-effect`, `set-state-in-render`, `static-components`, `unsupported-syntax`, `use-memo`, `incompatible-library` 等） | oxlint の `react` プラグインには未実装。特に `set-state-in-render` / `refs` / `purity` は実バグを捕まえる系統で、実質的な検知力の低下になる | なし。将来 oxlint 側に実装されるまで放棄 |
| `import/no-unresolved` | oxlint の import プラグインに該当なし | 代替なし。`typecheck` スクリプトは自動実行経路（lefthook・CI）に乗っておらず、手動で叩かない限り検出されない |
| stylelint の全ルール | stylelint 自体を廃止 | CSS 整形のみ oxfmt が担当。プロパティ順序と静的検査は放棄 |

（`import/named` は oxlint に実装があるため「失うルール」から除外。`react/prop-types` は
現行 `eslint-config-next` が既に `'off'` にしているため元々失うものがない。
`@next/next/no-location-assign-relative-destination` は、対象リポにインストール済みの
`@next/eslint-plugin-next@16.2.10` 自体に存在しないルールだったため対象外とした。）

## 実装

コミットは 3 つに分ける。

### コミット① Tailwind v4 への統一

現状は `@tailwindcss/postcss` v4 と `tailwindcss` v3.4 + `autoprefixer` が同居し、
`postcss.config.mjs` は v3 方式、`globals.css` は v3 の `@tailwind` ディレクティブと
v4 の `@theme inline` が混在している。

- `postcss.config.mjs` を `{ plugins: { '@tailwindcss/postcss': {} } }` のみにする
- `src/app/globals.css` … 実体を確認済み。変更が必要なのは先頭 3 行の `@tailwind base/components/utilities;`
  を `@import "tailwindcss";` に置き換える部分のみ。`@layer base { :root {...} }` /
  `@theme inline {...}` / `@media (prefers-color-scheme: dark) {...}` / `body { ... @apply ... }`
  はすべて Tailwind v4 でもそのまま有効なので変更しない。最終形（`.oxfmtrc.json` の
  `singleQuote: true` を見越してシングルクォートで記載。実装時に手で書くかどうかに
  関わらず初回 `oxfmt` 実行でこの形になる）:

  ```css
  @import 'tailwindcss';

  @layer base {
    :root {
      --background: #fff;
      --foreground: #171717;
    }
  }

  @theme inline {
    --color-background: var(--background);
    --color-foreground: var(--foreground);
    --font-sans: var(--font-geist-sans);
    --font-mono: var(--font-geist-mono);
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --background: #0a0a0a;
      --foreground: #ededed;
    }
  }

  body {
    font-family: Arial, Helvetica, sans-serif;
    color: var(--foreground);
    background: var(--background);

    @apply bg-background text-foreground;
  }
  ```

- `tailwind.config.js` を削除する
- devDependencies: `tailwindcss`(v3 系) と `autoprefixer` を削除し、`"tailwindcss": "^4"` を
  明示的に追加する（`@tailwindcss/postcss` からの transitive 依存に任せず、直接依存にする）

### コミット② oxc 移行本体（ツール入れ替え一式）

ESLint/Prettier/stylelint を使う設定ファイル・フック・スクリプトを同一コミットで
すべて置き換える。分割すると、削除直後に `lefthook.yml` や npm scripts が
存在しないコマンドを呼び続けて壊れた状態になる。

**削除する devDependencies**（16 個）:
`@eslint/js` / `@stylistic/eslint-plugin` / `@types/eslint-plugin-tailwindcss` / `eslint` /
`eslint-config-next` / `eslint-config-prettier` / `eslint-plugin-jsx-a11y` /
`eslint-plugin-simple-import-sort` / `eslint-plugin-tailwindcss` / `eslint-plugin-unused-imports` /
`prettier` / `typescript-eslint` / `stylelint` / `stylelint-config-recess-order` /
`stylelint-config-standard` / `stylelint-order`

**追加**: `oxlint` / `oxfmt` / `oxlint-tsgolint`

**削除するファイル**: `eslint.config.mjs` / `.prettierrc.json` / `.stylelintrc.json`

これにより `next` 15 系に対し `eslint-config-next` が 16 系というメジャー不一致の問題も
自動的に解消する。

#### `.oxlintrc.json`

参考リポ
`/home/hiroki/Work/template-vite-react-typescript/template-vite-react-typescript/.oxlintrc.json`
の `rules` ブロック（`no-case-declarations` から `typescript/prefer-function-type` までの
全項目）をそのまま引き継ぎ、以下の差分のみ適用する。参考リポにあって
下記に登場しないキーはすべて変更なしで維持する。

**`plugins`**（参考リポ: `["typescript","react","jsx-a11y","import","vitest","unicorn","oxc"]`）
- `eslint` を追加する。これは必須で、oxlint は `plugins` を明示すると既定セットを丸ごと上書きするため、
  これが無いと `no-console` / `complexity` / `no-unused-vars` / `no-var` / `prefer-const` /
  `no-magic-numbers` が発火しない
- `nextjs` を追加（`@next/eslint-plugin-next` 相当。全 21 ルールが `correctness` カテゴリと
  確認済み〈oxc 公式ドキュメント基準〉なので、追加するだけで `categories.correctness: "error"`
  により全て有効になる）
- `vitest` を削除（このリポにテストが存在しないため）

**`options`**（参考リポには無いキー。新規追加）
- `{"typeAware": true}` を追加する（参考リポは意図的に書かず CLI フラグ側で制御しているが、
  このリポでは決定事項どおり `.oxlintrc.json` 側に一本化するため必須）

**`categories`**: `{"correctness": "error"}` のまま変更なし

**`env`**（参考リポ: `{"builtin": true, "browser": true, "es2026": true}`）
- `node: true` を追加（App Router の Server Component 対応。`eslint-config-next` は
  browser + node 両方を展開していた）

**`ignorePatterns`**（参考リポ: `["{dist,build,public,node_modules}/**",
"**/lib/utils.{js,ts}", "**/components/ui/**/*.{jsx,tsx}", "**/*.config.*"]`）

Vite/shadcn 向けパターンを Next.js 向けに置き換える。`node_modules/**` は
参考リポにあったものを引き続き明示する（oxlint が既定で無視するかは未確認のため、
消す積極的な理由がない限り残す）。`**/*.config.*` は維持する
（`postcss.config.mjs` を lint 対象にしないため。ただし現行 `eslint.config.mjs` の
ignore 対象は `*.config.mjs`/`*.config.js` のみで `.ts` を含まないため、
`next.config.ts` は今回新たに lint 対象外になる点を認識しておく）。

```json
["{.next,out,node_modules}/**", "next-env.d.ts", "**/*.config.*"]
```

**`rules` への追加・変更**
- `react/only-export-components` を、参考リポの `"error"` から
  `["error", { "allowExportNames": ["metadata", "generateMetadata", "viewport",
  "generateViewport", "dynamic", "dynamicParams", "revalidate", "fetchCache", "runtime",
  "preferredRegion", "maxDuration", "generateStaticParams", "alt", "size", "contentType",
  "generateImageMetadata"] }]` に変更する。App Router の `export const metadata` との
  同時 export が誤爆するためで、`src/app/layout.tsx` が実際にこのパターンを持つ。
  末尾の `alt` / `size` / `contentType` / `generateImageMetadata` はメタデータ画像ルート
  `opengraph-image.tsx` 等向けで、現状 `src/app` には存在しないが、テンプレートとして
  将来追加されたときに備える
- `react/rules-of-hooks: "error"` を追加（`pedantic` カテゴリと確認済みのため明示が必須）
- `react/exhaustive-deps: "error"` を追加（現行 `eslint.config.mjs` は
  `nextCoreWebVitals` 経由でこれを有効にしており、見落とすと退行になる。
  `correctness` カテゴリの可能性が高いが、明示することで確実性を担保する）
- `typescript/explicit-module-boundary-types: "warn"` を追加（`restriction` カテゴリ。
  現行 ESLint 設定を継承）
- `typescript/consistent-type-definitions` を、参考リポの `"error"` から
  `["error", "type"]` に変更（現行 ESLint 設定の `type` 指定を継承）
- `typescript/no-misused-promises` を、参考リポの `"error"` から `"warn"` に変更
  （現行 `eslint.config.mjs` の `warn` 指定を継承）
- `import/extensions`（参考リポは `["error","always",{...,"ignorePackages":true}]`）は
  引き継がず削除する。Next.js/bundler 環境では拡張子を書かない運用のため、
  残すと `import { x } from '@/lib/x'` のような拡張子なしエイリアス import が
  すべて error になり、テンプレートとして致命的になる

**`overrides`**（参考リポの override は `files: ["{src,app,pages}/**/*.{ts,tsx}"]`）
- `files` を `["src/**/*.{ts,tsx}"]` に変更（このリポは App Router のみで `pages` は無い）
- `typescript/consistent-type-imports` に、参考リポの `["warn", {"prefer": "type-imports"}]`
  から `fixStyle: "inline-type-imports"` を追加した
  `["warn", { "prefer": "type-imports", "fixStyle": "inline-type-imports" }]` に変更
  （現行 ESLint 設定の指定を継承。`FixStyle` として oxlint に実在するオプション）
- 他の override 内ルール（`typescript/strict-boolean-expressions`, `prefer-const`,
  `prefer-rest-params`, `prefer-spread`, `no-magic-numbers`）は参考リポのまま維持

**確定済みの設定値**（実装時に迷わないよう先に確認済み）
- `no-magic-numbers`（ESLint コア版。oxlint に `typescript/no-magic-numbers` は無い）は
  `ignoreEnums` / `ignoreReadonlyClassProperties` / `ignoreTypeIndexes` /
  `ignoreNumericLiteralTypes` をすべて受け付ける。参考リポの override は既に
  `ignore: [-1, 0, 1], ignoreEnums: true, ignoreReadonlyClassProperties: true,
  ignoreTypeIndexes: true` を使用しており、現行 ESLint 設定と同一なのでそのまま維持

#### `.oxfmtrc.json`

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "printWidth": 100,
  "singleQuote": true,
  "ignorePatterns": [
    "{.next,out,node_modules}/**",
    "**/*.min.*",
    "**/*-lock.{json,yaml,yml}"
  ],
  "sortImports": {
    "newlinesBetween": false,
    "internalPattern": ["@/"],
    "customGroups": [
      {
        "groupName": "react",
        "elementNamePattern": ["react", "react-dom", "react/**", "react-dom/**", "next", "next/**"]
      },
      {
        "groupName": "assets",
        "elementNamePattern": ["*.json", "**/*.json", "*.svg", "**/*.svg", "*.png", "**/*.png", "*.jpg", "**/*.jpg"]
      }
    ],
    "groups": [
      "react",
      "builtin",
      "external",
      "internal",
      ["parent", "sibling", "index"],
      { "newlinesBetween": true },
      "assets",
      ["style", "side_effect_style"],
      "side_effect",
      "unknown"
    ]
  },
  "sortTailwindcss": {
    "stylesheet": "./src/app/globals.css"
  }
}
```

`printWidth` はデフォルトと同値だが意図を残すため明示する。`tabWidth` / `semi` /
`trailingComma` / `arrowParens` は oxfmt のデフォルトと現行 `.prettierrc.json` が
一致するため記述しない。

`sortTailwindcss.stylesheet` は Tailwind v4 の CSS entry（コミット①で書き換えた
`globals.css`）を指し、`tailwindcss/classnames-order` の代替になる。
`style` と `side_effect_style` を同一配列に入れるのは、`import './globals.css'` が
先頭に飛ぶのを防ぐため（参考リポの実測による知見）。ただし oxfmt は
`sortSideEffects` が既定 `false`（セキュリティ上の理由で side-effect import は
既定でソート対象外）なので、`import './globals.css'`（side-effect import）自体は
そもそも並び替えの対象にならない可能性がある。この場合グループ配置の指定は
実質無効という未確認の懸念があり、検証 9 で位置が変わらないことも含めて確認する。

`sortPackageJson` は oxfmt の既定が `true` のため、初回の oxfmt 実行で `package.json` の
キー順が並び替わる（`prettier-plugin-packagejson` とは非互換のアルゴリズム）。
意図した変更として受け入れる。

#### `package.json` scripts

`options.typeAware: true` を `.oxlintrc.json` に書くため、CLI から `--type-aware` を
省略できる。

```json
"lint": "oxlint",
"lint:fix": "oxlint --fix",
"format": "oxfmt",
"format:check": "oxfmt --check",
"typecheck": "tsc"
```

（`dev` / `build` / `start` / `prepare`（`lefthook install`）/ `preinstall`
（`npx typesync || :`）は現行のまま変更しない。`lint` / `format` / `format:check` /
`typecheck` はすべて新規追加のスクリプト。）
現行の `lint:es` / `lint:es:fix` / `lint:style` は削除。`typecheck` は `tsc --noEmit`
ではなく `tsc` とする（`tsconfig.json` に既に `"noEmit": true` があるため冗長な
フラグを避ける）。

#### `lefthook.yml`

現行ファイルは `stage_fixed: true` を pre-commit 直下に置く形式なので、それを維持する。
`parallel` は現行の `true` から `false` に変更する（oxfmt → oxlint の順序を固定するため）。
glob はこのリポの `src/**` 限定から、参考リポと同じくリポジトリ全体を対象にする形に変更する
（`src/**/*.tsx` のような glob は lefthook では `src/` 配下のみにしかマッチせず、root の
ファイルが恒久的に対象外になっていた）。

この変更の効果は oxfmt 側に限られる。このリポの root にある
JS/TS ファイルは `next.config.ts` と `postcss.config.mjs` の 2 つだけで、どちらも
`.oxlintrc.json` の `ignorePatterns: ["**/*.config.*"]` で意図的に除外し続けるため、
glob 拡大後も oxlint の対象ファイルは増えない。増えるのは oxfmt（`next.config.ts` /
`package.json` / `README.md` など、lint 対象ではなく整形対象のファイル）だけである。

```yaml
pre-commit:
  parallel: false
  stage_fixed: true
  commands:
    1_oxfmt:
      glob: '*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,html,htm,css,scss,sass,less,json,jsonc,yaml,yml,graphql,gql,md,mdx}'
      exclude:
        - '{.next,out,node_modules}/*'
        - '*-lock.{json,yaml,yml}'
      run: npx oxfmt {staged_files}
    2_oxlint:
      glob: '*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'
      exclude:
        - '{.next,out,node_modules}/*'
        - '*.config.*'
      run: npx oxlint {staged_files} --fix --quiet
```

`parallel: false` と数字プレフィックスで oxfmt → oxlint の順序を固定する
（import ソートと未使用 import 削除に順序依存があるため）。
`.oxlintrc.json` の `options.typeAware: true` により、pre-commit 実行時も
型情報ルールが自動的にかかる（CLI へのフラグ追加は不要）。

### コミット③ エディタ設定・README

#### エディタ設定

`.vscode/settings.json`（現行は `editor.defaultFormatter` 未指定で環境依存だった。
`editor.formatOnSave: true` も、整形を `codeActionsOnSave.source.format.oxc` に
委ねる形に変えるため `false` にする）:

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "editor.defaultFormatter": "oxc.oxc-vscode",
  "editor.formatOnSave": false,
  "editor.codeActionsOnSave": {
    "source.format.oxc": "always",
    "source.fixAll.oxc": "always"
  },
  "oxc.typeAware": true,
  "files.associations": { "**/*.json": "jsonc" }
}
```

参考リポと同様に `typescript.tsdk` を設定する。このリポは TypeScript 5.8 のまま
更新しないため（TS7 のような JS API 欠如の問題が無く）、素直に機能する。

`.vscode/extensions.json`（新規）: `{ "recommendations": ["oxc.oxc-vscode"] }`
（参考リポは `stylelint.vscode-stylelint` も含むが、stylelint を廃止するため含めない）

現行リポの `.gitignore` には `.vscode` 関連の記述が無く、`.vscode/settings.json` は
既に git 追跡対象になっている（変更不要）。

#### README

`README.md` は既に存在する（1 行目が概要文、以下 dev サーバ起動手順と `next/font` の説明）。
概要文の直後に、oxlint/oxfmt を導入済みでコミット時に自動整形・lint が走る旨を
1 行追記する（参考リポも概要直後にこの種の記述を置いている）。

## 検証

1. `npm install` を実行し、削除・追加後に依存が解決することを確認する
2. `npm run build` を実行し、Next.js 15 でビルドが通ることを確認する。ビルド後の CSS 出力を確認し、
   `tailwind.config.js` 削除に伴い `theme.extend.colors` の `background`/`foreground`
   拡張が失われていないか（`@theme inline` 経由で `bg-background` / `text-foreground` が
   引き続き解決されること）を主眼に照合する。`page.tsx` の `border` 使用箇所はすべて
   色を明示済み（`border-transparent`, `border-black/[.08]` 等）のため v3→v4 の
   既定色変更の影響は受けない見込みだが、念のため見た目を確認する
   （任意値の透過度指定 `bg-black/[.05]` 自体は v3/v4 共通の正規構文であり
   非互換の原因ではない）
3. `npm run dev` を実行し、開発サーバが起動してライト/ダークモード両方でスタイルが
   Tailwind v3 のときと同じに見えることをブラウザで確認する（`@media
   (prefers-color-scheme: dark)` が `@theme` に統合されておらず独立して効くこと）
4. `npx oxlint` を実行し、`typescript(tsconfig-error)` 等の設定エラーが出ないこと
   （`options.typeAware: true` により type-aware は自動的にかかる）。
   型チェック診断も併せて見たい場合のみ任意で `--type-check` を追加する
   （`tsc` とほぼ同じ診断が出るため検証 5 と重複することを認識した上で使う）
5. `npm run typecheck`（`tsc`）を実行する。`typecheck` スクリプト自体が今回の新規追加なので、
   実装の前後どちらでも `npx tsc` で直接ベースラインの件数を取れる。実装後もその件数から
   増えていないことを確認する（`@tsconfig/strictest` を extends した状態で 0 件になる
   保証は無いため、まず現状を確認する）
6. `npx oxfmt` を実行し、差分を目視レビューする。「無変更」を合格基準にしない
   （import 順序・Tailwind クラス順序・`package.json` のキー順は今回新規導入する機能
   による意図した変更であり、必ず差分が出る）。それ以外の再フォーマットが出た場合のみ
   `printWidth` / `singleQuote` 以外の非互換を調査する
7. `src/app/page.tsx` に以下を一時的に入れ、`npm run lint` が
   検出することを確認して戻す（ルール発火の確認）:
   - 未使用変数、`console.log`（`plugins` に `eslint` を追加した効果の確認を兼ねる）
   - floating promise、`if (someString)` のような truthy 判定（型情報ルール。`any` は
     型情報不要のルールなので type-aware の確認には使わない）
   - `<img src="...">`（`nextjs/no-img-element`）
   - `<a href="/foo">`（`nextjs/no-html-link-for-pages`。誤爆する場合は
     `settings.next.rootDir` を検討）
   - `alt` 属性なしの `<img>`（`jsx-a11y/alt-text`）
8. `src/app/layout.tsx` に対して `npm run lint` を実行し、`export const metadata` と
   default component の同時 export が `react/only-export-components` で誤爆しないこと
   （`allowExportNames` が効いていることの確認）
9. `page.tsx` に `next/link` と `@/` の import を一時追加し、
   `npx oxfmt` で react グループ先頭に並ぶことを確認する（import 順序の確認）。あわせて `layout.tsx` にも
   `npx oxfmt` を掛け、side-effect import である `import './globals.css'` の位置が
   （`sortSideEffects` 既定 `false` により）動かないことを確認する
10. `className="p-4 flex text-sm"` のような乱れた順序のクラスを書き、
    `npx oxfmt` が並び替えることを確認する（Tailwind クラス順序の確認）
11. `src/` 直下にダミーのコンポーネントファイルを一時的に置き、そこで使った
    Tailwind クラスが `next build` の CSS 出力に含まれること（`tailwind.config.js` の
    `content: ['./src/**/*.{js,ts,jsx,tsx,mdx}']` 相当のカバレッジが v4 の自動検出でも
    保たれているか）を確認
12. 実際に `git commit` して lefthook が oxfmt → oxlint の順で走ること、
    root のファイル（例えば `package.json` 自体）も対象になっていることを確認する。
    lefthook の oxlint 実行には `--quiet` が付くため、`no-console` / `no-unused-vars`
    のような warn 級のルールはこの場では表示されない仕様であることも認識しておく
13. VSCode で `.tsx` を開き、型エラーが Problems パネルに出ること、
    保存時に整形と自動修正が走ることを確認

## 未確定事項（実装時に確認）

- `nextjs/no-html-link-for-pages` が App Router 下で誤爆しないか（検証 7 で確認）

## 補足

移行前後で ESLint と oxlint の出力を直接 diff 比較する手順は用意しない。
`npm run lint:es` 自体は実行可能だが、ESLint と oxlint はルール名・設定体系が
異なるため出力を機械的に突き合わせる意味が薄く、解釈コストの方が高い。
代わりに検証 7・8 のように個々のルールを直接発火させて確認する方式を取る。
