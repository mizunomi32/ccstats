# ccstats

Claude Code の利用状況を集計・可視化するアプリケーション。

セッション終了時に Hook 経由でトークン使用量やツール呼び出しを収集し、Web ダッシュボードで確認できる。

## アーキテクチャ

```
Claude Code (ローカル)
    │  セッション終了時に Stop Hook 発火
    v
Hook Script (シェルスクリプト)
    │  transcript JSONL を解析 → 統計情報抽出
    │  CF Access サービストークン付きで POST
    v
Cloudflare Access (認証ゲートウェイ)
    │
    v
Cloudflare Workers (Hono)  ←── ブラウザ (ダッシュボード閲覧)
    │
    v
Cloudflare D1 (SQLite)
```

## 技術スタック

| コンポーネント | 技術 |
|--------------|------|
| ランタイム | Cloudflare Workers |
| フレームワーク | Hono (TypeScript) |
| データベース | Cloudflare D1 (SQLite) |
| 認証 | Cloudflare Access (サービストークン + ブラウザフロー) |
| ダッシュボード | SSR HTML + Chart.js (CDN) |
| バリデーション | Zod |
| テスト | Vitest + Miniflare |

## ディレクトリ構成

```
ccstats/
├── src/
│   ├── index.ts                 # エントリポイント
│   ├── routes/
│   │   ├── api.ts               # API ルートグループ (/api/*)
│   │   ├── sessions.ts          # POST/GET /api/sessions
│   │   ├── stats.ts             # GET /api/stats/*
│   │   └── dashboard.ts         # GET / (ダッシュボード)
│   ├── middleware/
│   │   ├── auth.ts              # CF Access 検証
│   │   └── validation.ts        # Zod バリデーション
│   ├── repositories/
│   │   ├── session.ts           # sessions テーブルクエリ
│   │   └── stats.ts             # 集計クエリ
│   ├── services/
│   │   └── stats.ts             # 集計ロジック
│   ├── templates/
│   │   └── dashboard.ts         # ダッシュボード HTML テンプレート
│   ├── types/
│   │   ├── api.ts               # API 型定義
│   │   └── db.ts                # DB 型定義
│   ├── lib/
│   │   ├── constants.ts         # 定数 (コスト単価等)
│   │   └── utils.ts             # ユーティリティ
│   └── db/
│       └── schema.sql           # D1 スキーマ
├── scripts/
│   └── hook.sh                  # Claude Code Stop Hook スクリプト
├── wrangler.toml
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## DB スキーマ

### sessions

| カラム | 型 | 説明 |
|-------|-----|------|
| id | TEXT (PK) | ULID |
| session_id | TEXT (UNIQUE) | Claude Code の sessionId |
| cwd | TEXT | 作業ディレクトリ |
| git_branch | TEXT | Git ブランチ名 |
| claude_version | TEXT | Claude Code バージョン |
| model | TEXT | 使用モデル名 |
| input_tokens | INTEGER | 入力トークン合計 |
| output_tokens | INTEGER | 出力トークン合計 |
| cache_read_tokens | INTEGER | キャッシュ読み取りトークン |
| duration_seconds | INTEGER | セッション時間（秒） |
| started_at | TEXT | 開始時刻 (ISO 8601) |
| ended_at | TEXT | 終了時刻 (ISO 8601) |
| created_at | TEXT | レコード作成時刻 |

### tool_calls

| カラム | 型 | 説明 |
|-------|-----|------|
| id | INTEGER (PK) | 自動採番 |
| session_id | TEXT (FK) | sessions.session_id |
| tool_name | TEXT | ツール名 (Read, Write, Bash 等) |
| call_count | INTEGER | 呼び出し回数 |

## API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| `POST` | `/api/sessions` | セッションデータ登録 (Hook から呼び出し) |
| `GET` | `/api/sessions` | セッション一覧取得 |
| `GET` | `/api/sessions/:id` | セッション詳細取得 |
| `GET` | `/api/stats/summary` | 集計サマリー |
| `GET` | `/api/stats/tokens` | トークン使用量の時系列データ |
| `GET` | `/api/stats/tools` | ツール別呼び出し統計 |
| `GET` | `/` | ダッシュボード |

### POST /api/sessions リクエスト例

```json
{
  "session_id": "7e33bf2d-6da2-4d7d-83de-921b3ff3ad8c",
  "cwd": "/Users/user/project",
  "git_branch": "main",
  "claude_version": "2.1.2",
  "model": "claude-opus-4-6",
  "input_tokens": 15000,
  "output_tokens": 3000,
  "cache_read_tokens": 7000,
  "duration_seconds": 1200,
  "started_at": "2026-03-23T10:00:00Z",
  "ended_at": "2026-03-23T10:20:00Z",
  "tool_calls": [
    { "tool_name": "Read", "call_count": 15 },
    { "tool_name": "Edit", "call_count": 8 },
    { "tool_name": "Bash", "call_count": 3 }
  ]
}
```

## ダッシュボード

### 概要カード

- 総セッション数
- 総トークン使用量 (input + output)
- 総コスト概算
- 平均セッション時間
- キャッシュヒット率

### グラフ

- トークン使用量推移（積み上げ棒グラフ: input / output / cache）
- セッション数推移（折れ線グラフ）
- ツール利用分布（横棒グラフ: 上位10ツール）
- プロジェクト別使用量（横棒グラフ）

### フィルター

- 期間: 今日 / 過去7日 / 過去30日 / 今月 / カスタム
- プロジェクト: cwd によるフィルタ

## 認証

Cloudflare Access で全エンドポイントを保護する。

| 用途 | 方式 |
|------|------|
| Hook → API | CF Access サービストークン (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) |
| ブラウザ → ダッシュボード | CF Access ブラウザフロー (OTP / OAuth) |

## Claude Code Hook 設定

### 1. Hook スクリプトの配置

`scripts/hook.sh` をローカルの任意の場所にコピーし、実行権限を付与する。

```bash
chmod +x /path/to/hook.sh
```

### 2. 環境変数の設定

```bash
export CCSTATS_URL="https://ccstats.example.com/api/sessions"
export CF_ACCESS_CLIENT_ID="<your-service-token-client-id>"
export CF_ACCESS_CLIENT_SECRET="<your-service-token-client-secret>"
```

### 3. Claude Code settings.json に Hook を登録

`~/.claude/settings.json` に以下を追加:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/hook.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### Hook の動作

1. セッション終了時に Stop Hook が発火
2. stdin から `session_id`, `transcript_path`, `cwd` を受け取る
3. `transcript_path` の JSONL ファイルを解析し、トークン使用量・ツール呼び出しを集計
4. CF Access サービストークン付きで `POST /api/sessions` に送信

## セットアップ

### 前提条件

- Node.js 18+
- Cloudflare アカウント
- wrangler CLI (`npm install -g wrangler`)

### ローカル開発

```bash
npm install
npx wrangler d1 create ccstats-db --local
npx wrangler d1 execute ccstats-db --local --file=src/db/schema.sql
npx wrangler dev
```

### デプロイ

```bash
npx wrangler d1 create ccstats-db
npx wrangler d1 execute ccstats-db --file=src/db/schema.sql
npx wrangler deploy
```

### Cloudflare Access 設定

1. Cloudflare Zero Trust ダッシュボードで Application を作成
2. ドメインに `ccstats.<your-domain>` を設定
3. サービストークンを作成（Hook 用 M2M 認証）
4. ポリシーを設定:
   - Service Auth: Hook スクリプト用
   - Email: ダッシュボード閲覧用

## 設計詳細

詳細な設計ドキュメントは [docs/architecture.md](docs/architecture.md) を参照。
