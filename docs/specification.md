# StepFlow 仕様書

## 概要

StepFlow は、ブラウザ操作をワークフローとして自動化する Chrome 拡張機能です。
クリック・フォーム入力・テキストコピー・ホバーの 4 つの操作をステップとして定義し、順番に自動実行できます。

---

## 動作環境

- Chrome 拡張機能（Manifest V3）
- サイドパネル UI（ページ操作中も常時表示）

---

## アーキテクチャ

```
sidepanel.js ←→ service-worker.js ←→ content.js / picker.js / observer.js
 (UI/編集)       (実行制御/集約)       (DOM操作 / 要素選択 / DOM監視)
      ↕
  chrome.storage.local（永続化）
```

| コンポーネント | ファイル | 役割 |
|---|---|---|
| サイドパネル | `sidepanel/sidepanel.{html,css,js}` | ワークフロー編集 UI、実行/停止操作、進捗表示 |
| Service Worker | `background/service-worker.js` | ステップ順次実行、遅延制御、コピー結果集約、クリップボード書き込み |
| Content Script | `content/content.js` | ページ上の DOM 操作（クリック、入力、コピー、ホバー） |
| Element Picker | `content/picker.js` | ページ上の要素を視覚的に選択し CSS セレクタを生成 |
| DOM Observer | `content/observer.js` | ページ上の動的 DOM 変更を監視し、追加された要素を報告 |

### コンポーネント間メッセージ一覧

| 送信元 | 送信先 | type | データ | 用途 |
|---|---|---|---|---|
| サイドパネル | Service Worker | `RUN_WORKFLOW` | `{ workflow }` | ワークフロー実行開始 |
| サイドパネル | Service Worker | `STOP_WORKFLOW` | - | 実行中のワークフロー停止 |
| サイドパネル | Service Worker | `START_PICKER` | - | 要素ピッカー起動 |
| サイドパネル | Service Worker | `CANCEL_PICKER` | - | 要素ピッカーキャンセル |
| サイドパネル | Service Worker | `START_OBSERVER` | - | DOM 監視開始 |
| サイドパネル | Service Worker | `STOP_OBSERVER` | - | DOM 監視停止 |
| Service Worker | サイドパネル | `STEP_PROGRESS` | `{ currentStep, totalSteps }` | 進捗通知 |
| Service Worker | サイドパネル | `STEP_ERROR` | `{ stepIndex, error }` | ステップエラー通知 |
| Service Worker | サイドパネル | `WORKFLOW_COMPLETE` | `{ copyResults }` | 実行完了通知 |
| Service Worker | サイドパネル | `WORKFLOW_STOPPED` | `{ copyResults }` | 停止完了通知 |
| Service Worker | サイドパネル | `PICKER_RESULT` | `{ selector, selectorIndex, selectOptions }` | ピッカー結果の転送 |
| Service Worker | サイドパネル | `OBSERVER_RESULT` | `{ elements }` | DOM 監視で検出された要素の転送 |
| Service Worker | Content Script | `EXECUTE_STEP` | `{ step }` | ステップ実行指示 |
| Service Worker | Content Script | `CANCEL_PICKER` | - | ピッカーキャンセル指示 |
| Service Worker | Content Script | `STOP_OBSERVER` | - | DOM 監視停止指示 |
| Content Script | Service Worker | (sendResponse) | `{ success, data }` or `{ success, error }` | ステップ実行結果 |
| Picker | Service Worker | `PICKER_RESULT` | `{ selector, selectorIndex, selectOptions }` | 選択した要素のセレクタ |
| Observer | Service Worker | `OBSERVER_RESULT` | `{ elements }` | 検出した要素の情報 |

---

## データモデル

### ワークフロー

```json
{
  "id": "id-1234567890-abc123",
  "name": "ワークフロー名",
  "interval": 500,
  "stopOnError": false,
  "steps": [ ... ]
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 一意な識別子（自動生成） |
| `name` | string | ワークフロー名 |
| `interval` | number | ステップ間のデフォルト間隔（ミリ秒） |
| `stopOnError` | boolean | エラー時にワークフローを停止するか（デフォルト: false） |
| `steps` | array | ステップの配列 |

### ステップ

```json
{
  "id": "id-1234567890-def456",
  "type": "click",
  "selector": "#submit-btn",
  "selectorIndex": 2,
  "value": "テキスト",
  "label": "商品名",
  "interval": 1000,
  "multiline": false
}
```

| フィールド | 型 | 必須 | 対象タイプ | 説明 |
|---|---|---|---|---|
| `id` | string | 全タイプ | - | 一意な識別子（自動生成） |
| `type` | string | 全タイプ | - | `click` / `input` / `copy` / `hover` |
| `selector` | string | 全タイプ | - | 操作対象の CSS セレクタ |
| `value` | string | `input` のみ | input | 入力するテキスト |
| `label` | string | 任意 | copy | コピー結果に付けるラベル |
| `selectorIndex` | number \| null | 任意 | 全タイプ | N番目の要素を対象にする（1始まり）。未設定時は1番目の要素を使用 |
| `interval` | number \| null | 任意 | 全タイプ | 次のステップまでの個別間隔（ms）。未設定時はワークフローの `interval` を使用 |
| `multiline` | boolean | 任意 | input | 複数行入力モード。true の場合 UI がテキストエリアに切り替わる |

### 永続化

`chrome.storage.local` に以下の構造で保存:

```json
{
  "workflows": [ ... ],
  "activeWorkflowId": "id-xxx"
}
```

---

## 機能詳細

### 1. ワークフロー管理

- **作成**: 「+」ボタンで新規ワークフローを作成（デフォルト名「新規ワークフロー」、間隔 500ms）
- **選択**: ドロップダウンでワークフローを切り替え
- **名前変更**: テキスト入力で随時変更（自動保存）
- **削除**: 「×」ボタンで削除（確認ダイアログあり、最後の 1 つは削除不可）
- **複製**: 「複製」ボタンでアクティブなワークフローをディープコピー（名前に「(コピー)」を付与、新規 ID を採番）
- **並び替え**: 「⇅」ボタンでワークフロー並び替えパネルを表示。ドラッグ＆ドロップで順序を変更可能
- **全体間隔設定**: ステップ間のデフォルト待機時間をミリ秒で設定

### 2. ステップ管理

- **追加**: 「+ ステップ追加」ボタンで末尾に追加（初期タイプ: click）
- **削除**: 各ステップの「×」ボタンで削除
- **複製**: 各ステップの「複製」ボタンでステップを複製（直後に挿入、新規 ID を採番）
- **並び替え**: ドラッグ＆ドロップ（ドラッグハンドル ⠿）で順序変更
- **タイプ変更**: ドロップダウンで切り替え。タイプ変更時に不要なフィールドは自動削除
- **個別間隔**: 各ステップに個別の間隔を設定可能（空欄なら全体設定を使用）
- **オプション折りたたみ**: selectorIndex と個別間隔の設定欄は折りたたみ可能。設定値がある場合は「設定あり」バッジを表示

### 3. ステップタイプ

#### 要素の特定

全タイプ共通で、`document.querySelectorAll(selector)` により要素を取得します。

- `selectorIndex` 未設定または 1 の場合: 最初にマッチした要素を使用
- `selectorIndex` が 2 以上の場合: N 番目にマッチした要素を使用
- マッチ数が `selectorIndex` に満たない場合はエラー（「N番目が見つかりません（該当: X個）」）

#### 3.1 クリック (`click`)

- CSS セレクタで指定した要素に対して `element.click()` を実行

#### 3.2 入力 (`input`)

- CSS セレクタで指定した要素に値を入力
- 処理手順:
  1. `element.focus()`
  2. `element.value = value`
  3. `input` イベント発火（bubbles: true）
  4. `change` イベント発火（bubbles: true）
- React / Vue 等のフレームワーク対応のため `input` と `change` の両イベントを発火
- **複数行入力**: `multiline` フラグを有効にすると、UI が単行入力からテキストエリア（4行）に切り替わる

#### 3.3 コピー (`copy`)

- CSS セレクタで指定した要素のテキストを取得
- **`<a>` タグの特殊処理**: テキストと `href` が異なる場合、`テキスト(URL)` 形式で取得
  - 例: `<a href="https://example.com">商品ページ</a>` → `商品ページ(https://example.com)`
  - テキストと URL が同一の場合はそのまま
- **ラベル**: 任意で設定可能。コピー結果のフォーマットに影響

#### 3.4 ホバー (`hover`)

- CSS セレクタで指定した要素に対してマウスホバーを模擬
- `mouseenter` と `mouseover` イベントを発火（いずれも `bubbles: true, cancelable: true`）
- 動的にコンテンツを表示する要素（ツールチップ、ドロップダウンメニュー等）の操作に使用

### 4. コピー結果フォーマット

ワークフロー内の全コピーステップの結果を集約し、クリップボードに書き込みます。

**ラベルありの場合**（1 つでもラベルが設定されていれば）:
```
■商品名
ワイヤレスイヤホン Pro X
■価格
¥12,800
```

**ラベルなしの場合**（全ステップでラベル未設定）:
```
ワイヤレスイヤホン Pro X
¥12,800
```

- クリップボードへの書き込みは全ステップ完了後に一括実行
- 途中停止した場合も、それまでに取得したコピー結果を書き込み
- **コピーボタン**: 結果テキストエリアの横に「コピー」ボタンがあり、再度クリップボードにコピー可能（コピー後「コピー済」と表示、1.5 秒で元に戻る）

### 5. ワークフロー実行

#### 実行フロー

1. サイドパネルから「▶」ボタンで実行開始
2. UI がランナーモード（進捗表示）に切り替わる
3. Service Worker がアクティブタブに Content Script をインジェクト
4. 各ステップを順番に実行:
   - ステップごとに進捗を通知（プログレスバー + ステップ状態アイコン）
   - ステップ間は設定された間隔で待機
5. 全ステップ完了後、コピー結果をクリップボードに書き込み
6. 完了画面を表示（「ホームに戻る」ボタンで編集画面に遷移）

#### 経過時間表示

- ワークフロー実行中、全体の経過時間をリアルタイム表示（100ms 間隔で更新）
- 表示形式: 60 秒未満は「X.Xs」、60 秒以上は「XmYYs」
- 各ステップにも個別の実行時間を表示
- 完了・停止時に時間表示を固定

#### ランナーパネル

- パネルヘッダーをクリックで本体を折りたたみ/展開可能
- ステップ状態リストに各ステップの個別経過時間を表示
- コピー結果パネルは実行完了後に表示

#### 停止機能

- 実行中に「■」ボタンで停止可能
- `aborted` フラグにより次のステップ実行前にループを抜ける
- 停止時もそれまでのコピー結果はクリップボードに書き込まれる

#### エラー処理

- ステップ実行でエラーが発生した場合（要素が見つからない、`selectorIndex` が範囲外等）:
  - 該当ステップに「✗」マークを表示
  - `stopOnError` が有効な場合: ワークフローを即停止
  - `stopOnError` が無効な場合（デフォルト）: **次のステップに進む**（スキップ動作）

#### 進捗表示

| アイコン | 状態 |
|---|---|
| ○ | 未実行（pending） |
| ⏳ | 実行中（running） |
| ✓ | 完了（done） |
| ✗ | エラー（error） |

### 6. 要素ピッカー

ページ上の要素を視覚的に選択して CSS セレクタを自動生成する機能です。

#### 操作方法

1. ステップのセレクタ入力欄の横にある「選択」ボタンをクリック
2. ページ上部に「要素を選択してください（Esc でキャンセル）」バナーが表示
3. マウスホバーで要素が青枠でハイライト、ツールチップに生成セレクタを表示
4. 同一セレクタに複数要素がマッチする場合、ツールチップに「セレクタ (N番目)」と表示
5. クリックでセレクタ確定 → サイドパネルの入力欄に自動反映（`selectorIndex` も自動設定）
6. Esc キーでキャンセル

#### セレクタ生成の優先順位

1. **ID**: `#element-id`（最優先）
2. **クラス名**: `tag.class1.class2`（ページ内で一意の場合）
3. **name 属性**: `input[name="field"]`（フォーム要素、一意の場合）
4. **data 属性**: `tag[data-xxx="value"]`（一意の場合）
5. **パスセレクタ**: `parent > child:nth-of-type(n)`（上記で特定できない場合、最大 4 階層）

一意性チェック: 生成したセレクタが `querySelectorAll` で 1 件だけ返すことを確認。

#### セレクト要素の特殊処理

`<select>` 要素を選択した場合、サイドパネルにオプション一覧パネルを表示:

- 各 `<option>` のテキストと value を表示
- 現在選択中のオプションに「現在」バッジを表示
- オプションをクリックすると、ステップタイプを `input` に変更し、その value を入力値に設定

### 7. DOM 監視（Observer）

ページ上の動的な DOM 変更をリアルタイムで監視する機能です。

#### 動作概要

1. サイドパネルの「DOM監視」ボタンで監視を開始
2. `MutationObserver` を使用してページ上の DOM 追加を検知
3. 検知した要素の情報をサイドパネルにリアルタイム表示
4. 表示された要素をクリックして、ステップのセレクタとして採用可能

#### 検知対象

- ページに動的に追加された可視要素
- 除外タグ: SCRIPT, STYLE, LINK, META, BR, HR, NOSCRIPT

#### 要素情報

各検知要素について以下の情報を収集:

- タグ名
- 直接テキスト（子要素のテキストは除外）
- 主要属性: id, class, name, value, href, type, role, aria-label, data-*
- 自動生成された CSS セレクタ
- selectorIndex（同一セレクタにマッチする要素中の位置）

#### UI パネル

- ヘッダー: 「DOM監視」タイトル + 閉じるボタン
- ヒントテキスト: 「ページ上でホバーやクリックして要素を表示させてください」
- コントロール: クリアボタン + 要素件数表示
- 要素リスト: スクロール可能。各要素はタグ・属性・テキスト・セレクタを表示
- 要素クリックでステップのセレクタに反映
- 多重起動防止: `window.__stepFlowObserverActive` フラグで制御

### 8. インポート / エクスポート

#### エクスポート

- アクティブなワークフローを JSON ファイルとしてダウンロード
- ファイル名: `{ワークフロー名}.json`

#### インポート

- JSON ファイルを読み込み、新しいワークフローとして追加
- インポート時に ID は新規採番
- バリデーション項目:
  - `name`: 非空の文字列
  - `interval`: 0 以上の数値
  - `steps`: 配列
  - 各ステップ: `type` が `click` / `input` / `copy` / `hover` のいずれか
  - 各ステップ: `selector` が非空の文字列
  - `input` タイプ: `value` が文字列として存在

---

## ファイル構成

```
StepFlow/
├── manifest.json                 # 拡張機能マニフェスト
├── README.md                     # 要件メモ
├── docs/
│   └── specification.md          # 本ドキュメント
├── sidepanel/
│   ├── sidepanel.html            # サイドパネル UI
│   ├── sidepanel.css             # スタイル
│   └── sidepanel.js              # UI ロジック・ワークフロー管理
├── background/
│   └── service-worker.js         # 実行制御・メッセージルーティング
├── content/
│   ├── content.js                # DOM 操作（click / input / copy / hover）
│   ├── picker.js                 # 要素ピッカー
│   └── observer.js               # DOM 監視（MutationObserver）
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── test/
    └── test-page.html            # テスト用ページ
```

---

## 権限

| 権限 | 用途 |
|---|---|
| `activeTab` | アクティブタブへのアクセス |
| `tabs` | タブ情報の取得 |
| `scripting` | Content Script の動的インジェクト |
| `storage` | ワークフローデータの永続化 |
| `clipboardWrite` | コピー結果のクリップボード書き込み |
| `sidePanel` | サイドパネル UI の使用 |
| `host_permissions: <all_urls>` | 全 URL への Content Script インジェクト |

---

## 既知の制約・注意事項

- **Service Worker の寿命**: MV3 の Service Worker は 30 秒で休止する可能性がある。長い間隔設定（25 秒超）ではタイマーが発火しないリスクがある
- **クリップボード書き込み**: Service Worker から直接書き込めないため、Content Script 経由で `navigator.clipboard.writeText()` を使用
- **要素ピッカーのセレクタ**: 具体的なセレクタを生成するため、動的に変化する要素では意図通りに動かない場合がある。手動で `:first-child` や `:nth-child(n)` 等に書き換え可能
- **Content Script 多重インジェクト防止**: `window.__stepFlowInjected` フラグで制御
- **DOM Observer 多重起動防止**: `window.__stepFlowObserverActive` フラグで制御
- **エラー時の動作**: デフォルトではステップエラーを無視して続行する。「エラー時停止」オプションで停止に切替可能
