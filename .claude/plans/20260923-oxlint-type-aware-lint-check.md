# oxlint type-aware lint の実行方式の確認

## Context

`.claude/plans/template-vite-reat-typescript-oxlint-oxf-crispy-moonbeam.md`
（oxlint/oxfmt 移行計画）には type-aware linting について
「`.oxlintrc.json` の `options.typeAware: true` に一本化し、CLI の
`--type-aware` は付けない」「`.vscode/settings.json` に `oxc.typeAware: true`
を追加する」という決定が書かれているが、これが実際に

- コマンドを叩く（`npx oxlint` / `npm run lint`）ことで動くのか
- エディタでコードを保存するだけで動くのか

のどちらなのか、あるいは両方なのかが明文化されていなかった。公式ドキュメント
（oxc.rs, oxc-project/tsgolint, npm）で動作原理を確認し、既存プランの記述が
正しいかどうかを検証する。

## 調査結果

### `oxlint-tsgolint` パッケージの実体

npm パッケージとして配布され、実体は Go 製バイナリ（`tsgolint`、
`typescript-go` を内蔵）を含む。`npm install` で取得されるだけで、
別途ビルドや外部ツールの導入は不要。

### CLI 実行での動作

- `.oxlintrc.json` の `options.typeAware: true` を設定していれば、通常の
  `npx oxlint`（= 既存プランの `npm run lint`）を実行するだけで type-aware
  ルールが自動的にかかる。**追加のコマンドやフラグは不要**。
- CLI フラグ `--type-aware` は config 値より優先されるとドキュメントに
  記載があるが、precedence の出典はドキュメント側の記述のみで、手元の
  `oxlint` パッケージの config スキーマでは `typeAware`/`typeCheck` の
  説明文に precedence の明記はなかった（優先度が明記されているのは別の
  設定キーのみ）。ただし既存プランは CLI フラグを使わず config だけで
  完結させる方針なので、この精度差はどのみち本件に影響しない。
- `options.typeAware` / `options.typeCheck` がルート config 限定という
  記述も出典は oxc.rs のドキュメントで、手元のスキーマ内には同様の
  root 限定の注記は見当たらなかった。バージョン差の可能性がある。
  いずれにせよこのリポは単一 `.oxlintrc.json` 構成（ネスト config なし）
  なので、真偽どちらでも挙動に影響しない。
- `typeCheck: true`（config スキーマ上は experimental 機能と明記）に
  すると、type-aware ルールに加えて TypeScript のコンパイルエラー自体
  も lint 結果に混ぜて報告される（`tsc --noEmit` 相当を兼ねる）。
  既存プランは `typeCheck` を設定せず `typeAware` のみ
  なので、`tsc` の代替にはならない。これは既存プランの検証 5 が
  `npm run typecheck`（`tsc`）を別途走らせる設計と整合している。
  なお tsgolint の用例は `--type-aware --type-check` の併用形であり、
  「config で typeAware が有効なら `--type-check` 単独追加でよい」という
  既存プラン検証 4 の想定は未検証（この調査では裏取りできなかった）。

### エディタ（VSCode 拡張）経由での動作

- 拡張機能側の設定で `oxc.typeAware: true` を有効にすれば、**保存時に
  自動的に** type-aware ルールがリアルタイムで走り、Problems パネルに
  表示される。
- 前提は CLI 経由と同じ（後述「インストールの前提条件」を参照）。
  拡張独自の追加セットアップは無い。
- **既存プランの検証 13 は要修正**: 現状の文言「VSCode で `.tsx` を開き、
  型エラーが Problems パネルに出ること」は `typescript.tsdk`（標準の
  tsserver）だけでも満たされてしまい、`oxc.typeAware: true` が実際に
  効いているかを判別できない。tsserver では出ない type-aware 固有の
  診断（例: `typescript/no-floating-promises`）を意図的に発生させ、
  診断ソースが tsserver ではなく oxc 拡張であることまで確認する文言に
  具体化する必要がある（拡張側の実際の表示文字列はこの調査では未確認）。

### pre-commit（lefthook）経由の動作 — 参考リポとの分岐点

- 既存プランは `.oxlintrc.json` に `options.typeAware: true` を書く
  「config 一本化」方針のため、lefthook の pre-commit フック
  （`npx oxlint {staged_files} --fix --quiet`）でも type-aware が
  **自動的にかかる**。既存プラン自身がこれを利点として明記している。
- 参考リポ（`template-vite-react-typescript`）は type-aware を config
  ではなく npm script 側の CLI フラグ（`oxlint --type-aware`）にしか
  付けておらず、pre-commit コマンドにはフラグが付いていないため
  pre-commit では type-aware が走らない。**このリポは config 一本化に
  よって参考リポと挙動が分岐し、毎コミットで型解析が走る側になる。**
- これに伴う未確認点が 2 つある。(1) コミットのたびにプログラム全体の
  型解析が走るため、コミット所要時間が伸びる可能性がある。
  (2) `--quiet` 指定により、type-aware ルールのうち `warn` 級（既存
  プランが `warn` に落とす `typescript/no-misused-promises` など）は
  pre-commit 実行時には表示されない仕様になる。既存プランの検証 12
  にはこの所要時間の確認が含まれていないため、追加する余地がある
  （なお `--fix` と type-aware の併用自体は、参考リポの npm script
  `"lint:oxlint:fix": "oxlint --type-aware --fix"` で既に使われている
  組み合わせであり、目新しい懸念ではない）。

### 型情報の参照元

実際の型解析は内蔵の `typescript-go` が行う。`tsconfig.json` と依存
パッケージの型情報（`.d.ts`）を参照するが、`node_modules/typescript`
（TypeScript 本体の JS 実装）自体は参照しない。モノレポでは依存パッケージ
のビルド完了が前提になるとの記載があるが、このリポは単一パッケージ構成
のため影響なし。

tsgolint は TypeScript 7（typescript-go）をターゲットにしている。既存
プランは `baseUrl` 不使用を根拠に現行 `tsconfig.json` の互換性を判断
しているが、このリポの `tsconfig.json` には `plugins: [{name: "next"}]`、
`incremental: true`、ビルド前は存在しない `.next/types/**/*.ts` を含む
`include` があり、typescript-go がこれらをどう扱うかは未確認。

このリスクは pre-commit 経路の記述（前項）と合わせて評価する必要が
ある。config 一本化により type-aware は毎コミットで走る側になったため
（`--quiet` は warn を消すだけで `typescript(tsconfig-error)` のような
error 級は残る）、もし `tsconfig.json` と typescript-go が不適合なら
影響は「lint 結果が乱れる」ではなく「全コミットが lefthook で
ブロックされる」に格上げされる。対応として:

- 検証 4（`npx oxlint` で `typescript(tsconfig-error)` が出ないことの
  確認）自体は、依存追加と `.oxlintrc.json` 作成がコミット②の内容
  （既存プランは lefthook 等も含め一式を同一コミットにする方針）
  であるため、「コミット②より前」には実行できない。**正しくは**
  コミット②の作業内で、依存追加・`.oxlintrc.json` 作成の直後、
  `lefthook.yml` を書き換える前に `npx oxlint` を 1 回手動で通す、
  という実装順序にする（lefthook はワークツリーの `lefthook.yml` を
  都度読むため、書き換え前ならまだ旧フックのままで安全に確認できる）
- 不適合が判明した場合の退避策として、`.oxlintrc.json` の
  `options.typeAware` を外し、参考リポと同じく npm script 側の
  `--type-aware` フラグ方式に戻せば pre-commit は型解析なしで動く。
  ただしこれは pre-commit を通すだけの回避で、`npm run lint` 自体で
  type-aware が機能しない問題は残るため、tsconfig 側を直すのか
  type-aware を諦めるのかは別途判断が必要（`.oxlintrc.json` 1 行と
  `package.json` の `lint`/`lint:fix` スクリプト、決定事項表の記述も
  合わせて戻す必要があり、「1 行戻すだけ」ではない）

### インストールの前提条件（訂正）

「`oxlint-tsgolint` が入っていれば十分」ではなく、前提は 2 つある。

1. `oxlint` 本体が `oxlint-tsgolint` を optional peerDependency として
   要求しており、下限バージョン（`>=7.0.2001` 形式）を満たす必要が
   ある。既存プランはバージョン指定なしで両方を `devDependencies` に
   列挙しているだけだが、通常の `npm install` ではこの下限は自然に
   満たされる見込みで、過大なリスクではない。
2. `oxlint-tsgolint` の実体はプラットフォーム別の optional dependency
   （例: `linux-x64` 用パッケージ）に分かれているため、`--no-optional`
   運用やミラー環境ではバイナリ自体が取得されない可能性がある。

既存プランの検証 1（`npm install`）で peer dependency の警告が出ない
ことを合わせて見ておくとよい。

## 結論

**コマンド実行・エディタ保存のどちらでも動く**が、「変更不要」ではなく
**既存プランに 2 箇所の追記・修正の余地がある**。

- `npm run lint`（`oxlint`）を叩けば自動で type-aware ルールが実行される
- VSCode で保存するだけでも `oxc.typeAware: true` 設定により
  リアルタイムに実行される
- **加えて、pre-commit（lefthook）でも自動的に実行される**
  （参考リポとはここで挙動が分岐する）

既存プラン（`template-vite-reat-typescript-oxlint-oxf-crispy-moonbeam.md`）
への修正提案:

1. 検証 13 の文言を、tsserver では出ない type-aware 固有の診断で、
   診断ソースが tsserver ではなく oxc 拡張であることまで確認する内容に
   具体化する
2. 検証 12 に、pre-commit 実行時に type-aware の型解析が走ることと、
   コミット所要時間が許容範囲であることの確認を 1 行追加する
3. コミット②の作業内で、依存追加・`.oxlintrc.json` 作成の直後、
   `lefthook.yml` 書き換え前に検証 4（`typescript(tsconfig-error)`
   が出ないこと）を 1 回手動で通す。不適合が判明した場合は
   `options.typeAware` を外し参考リポ方式（npm script 側の
   `--type-aware` フラグ）に戻す退避策があるが、これは pre-commit を
   通すだけの回避であり、tsconfig 側を直すか type-aware を諦めるかは
   別途判断が必要
4. （任意）決定事項表の `oxc.typeAware: true` の行に、動作原理の詳細は
   本ファイルを参照する旨のリンクを添える

## 参考

- https://oxc.rs/docs/guide/usage/linter/type-aware.html
- https://github.com/oxc-project/tsgolint
- https://www.npmjs.com/package/oxlint-tsgolint
