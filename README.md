# Tableau Data Apps 検証リポジトリ

Tableau Data Apps(Tableau Cloud 限定ベータ)を実際に作ってパブリッシュし、仕様と挙動を確かめるためのリポジトリです。
アプリ本体・ビルド用の小さなツール・検証で分かったことをまとめています。

- 公式ドキュメント: <https://tableau.github.io/extensions-api/docs/dataapps/>
- 分かったことの一覧: [docs/findings.md](docs/findings.md)

> Data App とは: Web アプリ(HTML / JS / CSS)をワークブック(`.twbx`)に同梱し、Tableau がホストする仕組み。
> アプリは閲覧者のブラウザで動き、Extensions API の `queryAsync()` で Tableau のデータソースを実行時に集計します。

## 収録しているアプリ

| アプリ | テーマ | データ | 確かめたいこと |
| --- | --- | --- | --- |
| [Globe Explorer](apps/Globe%20Explorer) | 地球儀での地図表現 | 同梱 CSV(USGS の地震 1 週間分・1,707 件) | Canvas + d3-geo の地球儀、ライブラリと地形データの同梱、操作→フィルター→再クエリ |
| [HR Dashboard](apps/HR%20Dashboard) | HR ダッシュボード | パブリッシュ済みデータソース | パブリッシュ済み DS への接続、集計値だけを出す設計、クリックでの絞り込み |
| [Sandbox Probe](apps/Sandbox%20Probe) | 仕様の検証そのもの | 同梱 CSV(同上) | サンドボックス・CSP・クエリ API・REST ブリッジを約 60 項目、実際に試して記録 |

Globe Explorer と Sandbox Probe はデータを同梱しているので、どのサイトにもそのままパブリッシュできます。
HR Dashboard は `Employee Master` という名前のパブリッシュ済みデータソース(列は [descriptor](tools/descriptors/hr-dashboard.json) を参照)が前提です。

## 使い方

必要なもの: Python 3、Node.js(プレビューとデータ生成のみ)。追加の依存はありません。

```bash
# 新しいアプリの作業フォルダを作る(template/ をコピーして名前を確定)
python3 tools/dataapp.py new "My App"
```

```bash
# データソースを .twb に配線する(パブリッシュ済み DS、または Data/ 配下の CSV)
python3 tools/dataapp.py wire "apps/My App" tools/descriptors/my-app.json
```

```bash
# 共通ファイル(shared/kit.js, kit.css)を各アプリへ配る
./tools/sync-shared.sh
```

```bash
# .twbx に固める(dist/ に出力)
python3 tools/dataapp.py package "apps/My App"
```

できた `.twbx` は Tableau MCP の `request-workbook-upload` → `publish-workbook` でパブリッシュします
(Tableau Cloud の Web 画面からのアップロードでも可)。

### ローカルプレビュー

`queryAsync()` は Tableau の中でしか動きません。レイアウトと操作だけ手元で確かめるために、Extensions API を差し替える簡易モックを用意しています。

```bash
node tools/preview/server.mjs "apps/Globe Explorer" 4173
```

モックは VizQL Data Service のクエリの一部(集計・日付関数・主なフィルター)だけを再現します。
サンドボックス(null オリジン、CSP)は再現しないので、最終確認は必ずパブリッシュ後に Tableau で行ってください。
URL に `?failQuery=1` を付けると `queryAsync` の失敗を再現でき、代替経路の表示を確かめられます。
HR Dashboard のプレビューは架空データ(`tools/data/build-hr-mock.mjs` で生成)を使います。

## 構成

```text
apps/<App Name>/            ワークスペース(.twbx の中身そのもの)
  <App Name>.twb            ワークシート・拡張機能インスタンス・データソース接続
  Packages/<package id>/
    manifest.json           パッケージの ID・バージョン・requestedOrigins
    extensions/data-app.trex
    content/                ここだけが配信される(index.html, src/…)
  Data/                     同梱データ(.twb が参照するものだけ梱包)
  Resources/.agents/        AI エージェント向けのメモ(Tableau は無視する)
  mock/                     ローカルプレビュー用(梱包されない)
shared/                     全アプリ共通の kit.js / kit.css / local-query.js(編集はここ)
template/                   scaffold-data-app が返す未置換テンプレート
tools/                      dataapp.py(new / wire / package)、プレビュー、データ生成
docs/                       検証で分かったこと
```

## 同梱している第三者の成果物

- Tableau Extensions API ライブラリ(`tableau.extensions.1.latest.min.js`)— scaffold テンプレートに含まれるもの
- [d3-geo](https://github.com/d3/d3-geo) 3.1.0 / [d3-array](https://github.com/d3/d3-array) 3.2.4 / [topojson-client](https://github.com/topojson/topojson-client) 3.1.0 — ISC
- [world-atlas](https://github.com/topojson/world-atlas) 2.0.2(Natural Earth 由来の地形)— ISC
- 地震データ: USGS "All Earthquakes, Past Week"(2018-01-31〜02-07)を [vega-datasets](https://github.com/vega/vega-datasets) 3.3.1 経由で取得し CSV 化

`tools/dataapp.py` はこのリポジトリ独自の実装ですが、出力する XML の形は公式ドキュメントと
[tableau-plugin](https://github.com/tableau/tableau-plugin) の data app authoring スキルが定める形に合わせています。
