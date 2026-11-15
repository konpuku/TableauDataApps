# Tableau Data Apps 検証メモ

最終更新: 2026-11-15 / 対象: Tableau Cloud(ベータ)、scaffold テンプレートの source-build `2026.3.4`

各項目に確度を付けています。

- **確認済み** — このリポジトリの作業で実際に観察した
- **文書** — 公式ドキュメントや公式スキルに書かれているが、まだ自分では確かめていない
- **未確認** — これから確かめる(多くは Sandbox Probe をブラウザで開けば結果が出る)

## 1. 全体像

- Data App の実体は「Web リソースをワークブックに同梱した Viz 拡張機能(またはダッシュボード拡張機能)」。Tableau 上ではワークブックとして見える。**文書**
- 新しく増えた API は 3 つ: データソースの `queryAsync()` / `readMetadataAsync()`、Tableau REST API を呼ぶ `fetch()`。**文書**
- 公式の作り方は「AI アシスタント + Tableau MCP + tableau-plugin」。手で作る手順は文書化されていないが、中身は zip と XML なので手組みできる(本リポジトリの `tools/dataapp.py`)。**確認済み**

## 2. 作成からパブリッシュまで

| 事実 | 確度 |
| --- | --- |
| `scaffold-data-app` が返すのは名前を入れる前の共通テンプレート(zip、約 84 KB)と、置換・改名の手順(`postUnzip`)。アプリごとの生成物ではない | 確認済み |
| テンプレートのダウンロード URL と、アップロード用 URL の有効期限は約 60 秒 | 確認済み |
| scaffold 結果の `allowedOrigins` は、サイトで許可された外部オリジンの一覧。検証サイトでは空だった(= 外部通信は一切できない設定) | 確認済み |
| テンプレートの `.twb` はデータソースが空。配線しないと実行時に「no data source found」になる | 確認済み(テンプレートの中身) |
| `.twbx` は `.twb` と `Packages/` を **アーカイブ直下** に置く。フォルダで一段包むと開けない | 文書(直下に置いた 3 本はパブリッシュ成功) |
| パブリッシュ済みデータソースの配線に要るのは LUID でも表示名でもなく **contentUrl**(`repository-location id` / `dbname`) | 文書(この形で配線した HR Dashboard はパブリッシュ成功) |
| CSV / Excel を `Data/` に同梱し、相対パスで参照する形でもパブリッシュできる。サイトにデータソースが無くても動かせる | 確認済み(パブリッシュ成功。クエリ結果は未確認) |
| パブリッシュ時に構造エラーがあれば `publish-workbook` が返す。事前検証の手段はない | 文書 |
| 3 本とも個人スペースに警告なしでパブリッシュできた(197 KB / 79 KB / 139 KB) | 確認済み |

### テンプレートを読んで分かったこと(確認済み)

- `.twb` の `document-format-change-manifest` に `_.fcp.Packages.true...Packages` が入る。パッケージ機能のフラグ。
- 拡張機能の参照 URL は `tableaulocalext:///<package id>/content/index.html` という専用スキーム。
- ワークシートのマークは `<mark class='VizExtension' />`。エンコードは持たない(マークカードのデータは使わない)。
- `.twb` に埋め込まれるマニフェストの写しは、作者名が `Claude` 固定になっている(パッケージ側の `.trex` は置換される)。
- `manifest.json` の `requestedOrigins` は空文字列で出てくる。外部オリジンは **空白区切りの 1 つの文字列** で書く(配列は黙って無視される — 文書)。

## 3. 実行環境(サンドボックス)

Sandbox Probe を Tableau Cloud(2026.3.4、Extensions API 1.19.0、Chrome)で開いて実測した結果。すべて **確認済み**。

適用されていた CSP(パッケージの URL は `<pkg>` に置換):

```text
default-src <pkg>; img-src data: <pkg>; font-src data: <pkg>;
script-src 'unsafe-inline' <pkg> 'unsafe-eval'; style-src 'unsafe-inline' <pkg>;
frame-src 'none'; object-src 'none'; webrtc 'block';
sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox
```

アプリは `sandbox` 付きの iframe で動く。`allow-same-origin` が無いので、URL は Tableau のホストでも
実効オリジンは `null` になる(`location.origin` は Tableau のホスト、`window.origin` は `"null"`)。
下の「不可」の多くはここから来ている。

| 項目 | 結果 | 補足 |
| --- | --- | --- |
| 同梱ファイルの `fetch()` / XHR | 不可 | `Failed to fetch`。データや設定は `.js` にして `<script src>` で読む |
| 同梱の画像を `<img>`、`data:` URI の画像 | 可 | |
| 同梱 JS を `<script src>`、CSS を `<link>` | 可 | |
| ES モジュールの動的 `import()`(同梱ファイル) | 不可 | 「CORS-cross-origin script から呼ばれたため base URL が about:blank」。バンドルして classic script にする |
| 外部への `fetch`(cors / no-cors)、WebSocket | 不可 | `connect-src` 違反 |
| 外部の画像・CDN のスクリプト・外部 CSS / Web フォント | 不可 | それぞれ `img-src` / `script-src-elem` / `style-src-elem` 違反 |
| インラインスクリプト、`eval` / `new Function` | 可 | |
| iframe(外部サイト) | 不可 | `frame-src 'none'` |
| iframe(`srcdoc`) | 可 | 読み込みイベントは発火し、CSP 違反は記録されなかった |
| WebGL | 可 | `webgl2` コンテキストを取得できた(GPU も有効) |
| Web Worker(Blob URL) | 不可 | `worker-src` 違反 |
| Web Worker(同梱ファイル) | 不可 | `SecurityError: cannot be accessed from origin 'null'` |
| localStorage / sessionStorage / IndexedDB / cookie | 不可 | 「sandboxed and lacks the 'allow-same-origin' flag」 |
| 親フレームの DOM | 不可 | クロスオリジン扱い |
| Extensions API の `settings` | 可(有無のみ確認) | 状態を持ちたいときの唯一の候補。保存の動作は未確認 |
| ポップアップ | 未確認 | `sandbox` に `allow-popups` はある。手動テストで確認する |

**設計への影響**

- ブラウザのストレージが全滅なので、ユーザー設定を残すなら Extensions API の `settings`(ワークブックに保存)しかない。
- Worker が使えないので、重い計算はメインスレッドを塞ぐ。集計はクエリ側に寄せる。
- ES モジュールの動的 import が使えないので、ビルドするなら単一バンドル(IIFE)にする。
- WebGL は動く。公式スキルは 2D を推奨しているが、three.js や deck.gl などを同梱すれば 3D 表現も視野に入る。
- 地形データ(TopoJSON)は `fetch` できないので、`window.WORLD_110M = {...}` を置く `.js` として同梱した。
- 起動時の例外は `kit.js` が必ず画面に出す。真っ白なシートを残さない。

## 4. データアクセス

- `queryAsync({ fields, filters })` のクエリは VizQL Data Service と同じ形。応答は `{ data: [...] }`。**文書**
- データソースは `tableau.extensions.workbook.getAllDataSourcesAsync()` で取り、**名前(caption)で引く**。配線順には並ばない。**文書**
- サーバーが接続するのは、アプリのあるシートの `<view>` に列挙されたデータソースだけ。**文書**
- 複数データソースの結合・ブレンドは無い。別々に問い合わせて JS 側で突き合わせる。**文書**
- クエリは閲覧者本人として実行される。行レベルセキュリティはそのまま効く。**文書**
- REST 用メソッドの名前は **`tableau.extensions.fetchAsync()`**。ドキュメントの表記は `fetch()` だが、`tableau.extensions.fetch` は `undefined` だった。**確認済み**
  - 形: `fetchAsync(url, { method, headers, body, urlVariables, base64EncodeResponse })` → `{ ok, status, statusText, headers, body }`(`body` は文字列)。
  - URL には `{api-version}` と `{site-id}` のプレースホルダーをそのまま書ける。
  - 検証サイトでは `serverinfo`、プロジェクト一覧、サイト情報の GET がいずれも 200 で返った(REST API のバージョンは 3.30)。
- データソースの取得は `workbook.getAllDataSourcesAsync()` でも、従来の `worksheet.getDataSourcesAsync()` でも同じものが返る。**確認済み**
- 同梱 CSV のデータソースは `isExtract: false` / `isPublished: false` として見える。**確認済み**
- `getSummaryDataAsync()` は列 0・行 0(Data App はマークカードにフィールドを置かないため)。**確認済み**
- ライブラリ内部のサービス名は `Hbi`(Headless BI)。`queryAsync` の第 2 引数にオプションを渡せる。**確認済み**(ソース)/ 効くオプションは **未確認**

### queryAsync / readMetadataAsync が全滅した(確認済み・原因は未確定)

Sandbox Probe の 1 回目の実行では、`readMetadataAsync()` と、内容の異なる約 30 本の `queryAsync()` が
**すべて同じエラー** で失敗した。

```text
name: Error / errorCode: internal-error / message: "internal-error: error"
```

- 存在しないフィールドを指定したクエリも、正しいクエリも同じエラー。クエリの中身を見る前に失敗している。
- 並列 10 本は 226 ms で全滅。問い合わせはすぐに拒否されている。
- 同じ時間帯、Tableau MCP 経由の VizQL Data Service 呼び出しも `API usage limit reached.` で失敗し続けていた。
- 一方、同じデータソースへの従来 API(`getLogicalTablesAsync()`)と REST ブリッジは正常に動いた。

いちばん有力な説明は「サイトの VizQL Data Service の利用上限に達しており、Data App の `queryAsync()` も同じ枠を使う」。
ただし「同梱 CSV(抽出でないファイル接続)が `queryAsync` の対象外」という可能性も残っている。
切り分けのため、Probe に次の 3 つを追加した。

1. `ds.fields` の一覧(CSV の列がどの型で解釈されたか)
2. 従来 API での明細取得(データ自体は読めるか)
3. REST ブリッジ経由で VizQL Data Service を直接呼ぶ(HTTP ステータスと本文が見える)

**どちらが原因でも言えること**: アプリからは `internal-error: error` としか見えず、原因を区別できない。
利用者向けには「データを取得できませんでした。時間をおいて再度お試しください」程度の文言にし、
詳細はエラーコードとして控えめに添えるのが現実的。

### VizQL Data Service の利用上限(確認済み)

検証中、Tableau MCP 経由の `get-datasource-metadata` / `query-datasource` が
`429` → `API usage limit reached.` を返し、その後しばらく回復しなかった(同じサイトでの数回の呼び出しの後)。

- VizQL Data Service には利用上限がある。30 分以上たっても回復しなかったので、短い時間窓のレート制限ではなさそう。
- Data App の中の `queryAsync()` が同じ枠を消費するかは上の節のとおり切り分け中。
- 念のため、アプリ側は同じクエリをセッション内でキャッシュし、スライダー操作はデバウンスしている(`shared/kit.js`)。

## 5. 表示・共有

- サーバー側の静止画書き出し(REST の view image、Tableau MCP の `get-view-image`)では Data App は描画されない。**Tableau Cloud のサインイン画面が写った画像** が返ってきた。サブスクリプションや PDF 出力も同様の可能性が高い(後者は **未確認**)。**確認済み**
- 閲覧に必要な権限: ワークブックの「表示」「完全なデータのクエリ」「API アクセス」、加えて各パブリッシュ済みデータソースの「表示」「接続」「API アクセス」。**文書**
- 初回表示で拡張機能の信頼確認ダイアログが出ることがある。**文書**
- サイト管理者は 設定 → Packages で、パッケージの有効化・ポップアップ・許可オリジン・REST API のパスを制御し、パッケージ単位で無効化できる。**文書**

## 6. 開発体験

- ローカルプレビューは公式には無い。見た目の確認だけなら Extensions API をモックすれば足りる(`tools/preview/`)。**確認済み**
- ビルド工程は不要。classic script を依存順に並べるだけで動く構成が公式サンプルの流儀。**確認済み**(公式サンプルの構成)
- `Resources/.agents/` に仕様メモを入れておくと `.twbx` と一緒に持ち運べる。Tableau は無視する。ダウンロードできる人は読めるので秘密は書かない。**文書**

## 7. これから確かめること

- `queryAsync` 全滅の原因(利用上限か、同梱 CSV の非対応か)。更新した Sandbox Probe の結果で判断する
- 原因が利用上限なら、上限の大きさ・回復のタイミング・Data App の 1 画面表示が何回分にあたるか
- `queryAsync` の対応範囲(集計関数・日付関数・ビン・計算フィールド・各フィルター・並べ替え・オプション)、明細の行数上限、応答時間 — クエリが通るようになってから
- HR Dashboard の `performance_rating` がディメンション / メジャーどちらで返るか(アプリは両対応にしてある)
- ポップアップ・クリップボード・ファイル保存(Probe の手動テスト)、`settings` の保存
- REST ブリッジで許可されていないパスを呼んだときの応答(検証サイトは試した GET がすべて通った)
- 権限の無いユーザーで開いたときの見え方、行レベルセキュリティの効き方
- 埋め込み(Embedding API)・モバイル・Tableau Desktop での表示
