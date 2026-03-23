# ccstats Architecture Design Document

> Claude Code の利用状況を集計・可視化するアプリケーション
> 作成日: 2026-03-23

---

## 1. システム概要 (C4 Context)

```
+-------------------+       Stop Hook        +-------------------+
|   Claude Code     | --------------------->  |  Hook Script      |
|   (ローカル)       |   セッション終了時に発火    |  (シェルスクリプト)  |
+-------------------+                        +-------------------+
                                                      |
                                              transcript JSONL を解析
                                              統計情報を抽出
                                                      |
                                              curl POST (CF Access token)
                                                      v
                                            +---------------------+
                    CF Access               |  Cloudflare Workers  |
  +----------+    (認証ゲートウェイ)          |  (Hono API)         |
  | ブラウザ  | -----+--------------------> |                     |
  | ダッシュ  |      |                      |  POST /api/sessions |
  | ボード    | <----+                      |  GET  /api/stats    |
  +----------+                             |  GET  /dashboard    |
                                            +---------------------+
                                                      |
                                                      v
                                            +---------------------+
                                            |  Cloudflare D1      |
                                            |  (SQLite)           |
                                            +---------------------+
```

### アクター

| アクター | 種別 | 説明 |
|---------|------|------|
| Claude Code | ソフトウェア | ローカルで動作するAIコーディングアシスタント |
| Stop Hook Script | ソフトウェア | セッション終了時に自動実行されるスクリプト |
| ブラウザ (ダッシュボード閲覧者) | ユーザー | 利用統計を確認する個人ユーザー |
| Cloudflare Access | インフラ | 認証ゲートウェイ |

---

## 2. Container レベルアーキテクチャ

```
+------------------------------------------------------------------+
|                    Cloudflare Workers                              |
|                                                                    |
|  +------------------+  +------------------+  +------------------+  |
|  |  API Routes      |  |  Dashboard       |  |  Middleware      |  |
|  |  (Hono)          |  |  (HTML/JS)       |  |  (Auth, CORS)   |  |
|  |                  |  |                  |  |                  |  |
|  | POST /api/       |  | GET /            |  | CF Access 検証   |  |
|  |   sessions       |  | GET /dashboard   |  | リクエスト検証    |  |
|  | GET /api/stats   |  |                  |  |                  |  |
|  | GET /api/        |  |                  |  |                  |  |
|  |   sessions       |  |                  |  |                  |  |
|  +--------+---------+  +------------------+  +------------------+  |
|           |                                                        |
|  +--------v---------+                                              |
|  |  Repository      |                                              |
|  |  Layer           |                                              |
|  |                  |                                              |
|  | SessionRepo      |                                              |
|  | StatsRepo        |                                              |
|  +--------+---------+                                              |
|           |                                                        |
+-----------|--------------------------------------------------------+
            |
   +--------v---------+
   |  Cloudflare D1   |
   |  (SQLite)        |
   |                  |
   | sessions         |
   | tool_calls       |
   +------------------+
```

### 各コンポーネントの責務

| コンポーネント | 責務 |
|--------------|------|
| **Middleware (Auth)** | CF Access サービストークンの検証、リクエストバリデーション |
| **API Routes** | HTTPリクエストの受信・レスポンス生成、入力バリデーション |
| **Dashboard** | HTML/CSS/JSによる統計の可視化 (サーバーサイドHTML生成) |
| **Repository Layer** | D1へのクエリ発行、データ変換 |
| **D1 Database** | セッションデータ・ツール呼び出しの永続化 |

---

## 3. D1 スキーマ設計

### 3.1 ER図

```
sessions                          tool_calls
+----------------------+          +----------------------+
| id (PK, TEXT)        |---+      | id (PK, INTEGER)     |
| session_id (UNIQUE)  |   |      | session_id (FK)      |---+
| cwd                  |   +------| (sessions.session_id)|   |
| git_branch           |          | tool_name            |   |
| claude_version       |          | call_count           |   |
| input_tokens         |          +----------------------+   |
| output_tokens        |                                     |
| cache_read_tokens    |                                     |
| duration_seconds     |                                     |
| started_at           |                                     |
| ended_at             |                                     |
| created_at           |                                     |
+----------------------+                                     |
```

### 3.2 テーブル定義

```sql
-- セッションテーブル
CREATE TABLE sessions (
    id            TEXT PRIMARY KEY,       -- ULID or UUID (Workers側で生成)
    session_id    TEXT NOT NULL UNIQUE,   -- Claude Code の sessionId
    cwd           TEXT NOT NULL,          -- 作業ディレクトリ
    git_branch    TEXT,                   -- Gitブランチ名 (nullable)
    claude_version TEXT,                  -- Claude Code バージョン
    model         TEXT,                   -- 使用モデル名
    input_tokens  INTEGER NOT NULL DEFAULT 0,  -- 入力トークン合計
    output_tokens INTEGER NOT NULL DEFAULT 0,  -- 出力トークン合計
    cache_read_tokens INTEGER NOT NULL DEFAULT 0, -- キャッシュ読み取りトークン
    duration_seconds INTEGER,            -- セッション時間（秒）
    started_at    TEXT NOT NULL,          -- セッション開始時刻 (ISO 8601)
    ended_at      TEXT NOT NULL,          -- セッション終了時刻 (ISO 8601)
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))  -- レコード作成時刻
);

-- インデックス: 日付範囲クエリの高速化
CREATE INDEX idx_sessions_started_at ON sessions(started_at);
CREATE INDEX idx_sessions_ended_at ON sessions(ended_at);
CREATE INDEX idx_sessions_cwd ON sessions(cwd);

-- ツール呼び出しテーブル
CREATE TABLE tool_calls (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    tool_name     TEXT NOT NULL,          -- ツール名 (Read, Write, Bash 等)
    call_count    INTEGER NOT NULL DEFAULT 0,  -- そのセッション内での呼び出し回数
    UNIQUE(session_id, tool_name)         -- セッション×ツール名でユニーク
);

-- インデックス: ツール別集計の高速化
CREATE INDEX idx_tool_calls_tool_name ON tool_calls(tool_name);
CREATE INDEX idx_tool_calls_session_id ON tool_calls(session_id);
```

### 3.3 設計判断

| 判断事項 | 決定 | 理由 |
|---------|------|------|
| セッションとツール呼び出しを分離 | 別テーブル | ツール呼び出しはセッションあたり可変個数。正規化によりクエリの柔軟性を確保 |
| session_id を文字列型に | TEXT | Claude Code の sessionId は UUID 形式 |
| 日時を TEXT (ISO 8601) で保存 | TEXT | D1 (SQLite) に専用の日時型がなく、ISO 8601 文字列なら比較・ソートが自然に動作 |
| cache_read_tokens を独立カラムに | 独立カラム | Claude API のキャッシュ利用量を追跡するため。コスト分析に有用 |
| tool_calls に UNIQUE(session_id, tool_name) | 複合ユニーク制約 | セッションごとのツール別集約値を1行で保持し、INSERT OR REPLACE で冪等にする |

---

## 4. API エンドポイント設計

### 4.1 エンドポイント一覧

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| `POST` | `/api/sessions` | セッションデータの登録 | CF Access サービストークン |
| `GET` | `/api/sessions` | セッション一覧取得 | CF Access |
| `GET` | `/api/sessions/:id` | セッション詳細取得 | CF Access |
| `GET` | `/api/stats/summary` | 集計サマリー取得 | CF Access |
| `GET` | `/api/stats/tokens` | トークン使用量の時系列データ | CF Access |
| `GET` | `/api/stats/tools` | ツール別呼び出し統計 | CF Access |
| `GET` | `/` | ダッシュボードHTML | CF Access |

### 4.2 POST /api/sessions

セッション終了時にHookスクリプトから呼ばれるエンドポイント。

**Request Body:**

```typescript
interface CreateSessionRequest {
  session_id: string;           // Claude Code の sessionId (UUID)
  cwd: string;                  // 作業ディレクトリ
  git_branch?: string;          // Gitブランチ名
  claude_version?: string;      // Claude Code バージョン
  model?: string;               // 使用モデル名
  input_tokens: number;         // 入力トークン合計
  output_tokens: number;        // 出力トークン合計
  cache_read_tokens?: number;   // キャッシュ読み取りトークン
  duration_seconds?: number;    // セッション時間（秒）
  started_at: string;           // ISO 8601
  ended_at: string;             // ISO 8601
  tool_calls: {                 // ツール呼び出し集計
    tool_name: string;
    call_count: number;
  }[];
}
```

**Response:**

```typescript
// 201 Created
interface CreateSessionResponse {
  id: string;
  session_id: string;
  created_at: string;
}

// 409 Conflict (重複 session_id)
interface ErrorResponse {
  error: string;
  message: string;
}
```

**冪等性の考慮:**

同一 `session_id` の重複送信時は `409 Conflict` を返す。Hookスクリプト側でリトライ時のハンドリングを行う。もしくは UPSERT（INSERT OR REPLACE）で上書きする方針も選択可能。個人利用のためシンプルに409で十分。

### 4.3 GET /api/sessions

**Query Parameters:**

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `from` | string (ISO 8601) | 30日前 | 開始日時 |
| `to` | string (ISO 8601) | now | 終了日時 |
| `cwd` | string | - | 作業ディレクトリでフィルタ |
| `limit` | number | 50 | 取得件数上限 |
| `offset` | number | 0 | オフセット |

**Response:**

```typescript
interface SessionListResponse {
  sessions: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
}

interface SessionSummary {
  id: string;
  session_id: string;
  cwd: string;
  git_branch: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;        // input + output (計算値)
  duration_seconds: number | null;
  started_at: string;
  ended_at: string;
}
```

### 4.4 GET /api/stats/summary

**Query Parameters:**

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `from` | string (ISO 8601) | 30日前 | 開始日時 |
| `to` | string (ISO 8601) | now | 終了日時 |

**Response:**

```typescript
interface StatsSummaryResponse {
  period: { from: string; to: string };
  total_sessions: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_duration_seconds: number;
  avg_tokens_per_session: number;
  avg_duration_per_session: number;
  most_used_tools: { tool_name: string; total_calls: number }[];
  most_active_projects: { cwd: string; session_count: number }[];
}
```

### 4.5 GET /api/stats/tokens

トークン使用量の時系列データ。ダッシュボードのグラフ描画用。

**Query Parameters:**

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `from` | string (ISO 8601) | 30日前 | 開始日時 |
| `to` | string (ISO 8601) | now | 終了日時 |
| `granularity` | `daily` / `weekly` / `monthly` | `daily` | 集計粒度 |

**Response:**

```typescript
interface TokenTimeSeriesResponse {
  granularity: "daily" | "weekly" | "monthly";
  data: {
    period: string;           // "2026-03-23" / "2026-W12" / "2026-03"
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    session_count: number;
  }[];
}
```

### 4.6 GET /api/stats/tools

**Query Parameters:**

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `from` | string (ISO 8601) | 30日前 | 開始日時 |
| `to` | string (ISO 8601) | now | 終了日時 |

**Response:**

```typescript
interface ToolStatsResponse {
  tools: {
    tool_name: string;
    total_calls: number;
    session_count: number;     // このツールが使われたセッション数
    avg_calls_per_session: number;
  }[];
}
```

---

## 5. ダッシュボード表示メトリクス

### 5.1 概要カード（ヘッダー部分）

| メトリクス | 表示例 | 説明 |
|-----------|--------|------|
| 総セッション数 | 142 | 選択期間内のセッション数 |
| 総トークン使用量 | 2.4M | input + output の合計 |
| 総コスト概算 | $12.50 | トークン単価 x 使用量の推計 |
| 平均セッション時間 | 18分 | セッションの平均時間 |
| キャッシュヒット率 | 45% | cache_read / (input + cache_read) |

### 5.2 グラフ

| グラフ | 種類 | X軸 | Y軸 | 説明 |
|--------|------|-----|-----|------|
| トークン使用量推移 | 積み上げ棒グラフ | 日付 | トークン数 | input/output/cache を色分け |
| セッション数推移 | 折れ線グラフ | 日付 | セッション数 | 日次/週次/月次切替 |
| ツール利用分布 | 横棒グラフ / 円グラフ | ツール名 | 呼び出し回数 | 上位10ツール |
| プロジェクト別使用量 | 横棒グラフ | プロジェクト名 | トークン数 | cwd をプロジェクト名に変換 |
| セッション時間分布 | ヒストグラム | 時間帯 | セッション数 | セッション長の分布 |

### 5.3 テーブル

| テーブル | カラム | 説明 |
|---------|--------|------|
| 直近セッション一覧 | 日時, プロジェクト, ブランチ, トークン, 時間 | 直近のセッション詳細 |

### 5.4 フィルター

- **期間選択**: 今日 / 過去7日 / 過去30日 / 今月 / カスタム範囲
- **プロジェクト選択**: cwd によるフィルタリング

### 5.5 コスト概算ロジック

```
// Claude API の概算単価 (変更しやすいように定数化)
const COST_PER_INPUT_TOKEN  = 3.0 / 1_000_000;   // $3 / 1M tokens
const COST_PER_OUTPUT_TOKEN = 15.0 / 1_000_000;   // $15 / 1M tokens
const COST_PER_CACHE_TOKEN  = 0.3 / 1_000_000;    // $0.30 / 1M tokens

cost = (input_tokens * COST_PER_INPUT_TOKEN)
     + (output_tokens * COST_PER_OUTPUT_TOKEN)
     + (cache_read_tokens * COST_PER_CACHE_TOKEN);
```

注: 実際の課金単価はモデルやプランによって異なるため、設定で変更可能にする。

---

## 6. ディレクトリ構成

```
ccstats/
├── src/
│   ├── index.ts                 # エントリポイント: Hono app 初期化・ルーティング
│   ├── routes/
│   │   ├── api.ts               # API ルートグループ (/api/*)
│   │   ├── sessions.ts          # POST/GET /api/sessions
│   │   ├── stats.ts             # GET /api/stats/*
│   │   └── dashboard.ts         # GET / (ダッシュボードHTML)
│   ├── middleware/
│   │   ├── auth.ts              # CF Access サービストークン検証
│   │   └── validation.ts        # リクエストバリデーション (Zod)
│   ├── repositories/
│   │   ├── session.ts           # sessions テーブルへのクエリ
│   │   └── stats.ts             # 集計クエリ
│   ├── services/
│   │   └── stats.ts             # 集計ロジック・コスト計算
│   ├── templates/
│   │   └── dashboard.ts         # ダッシュボードHTML テンプレート (JSX or テンプレートリテラル)
│   ├── types/
│   │   ├── api.ts               # API リクエスト/レスポンス型定義
│   │   └── db.ts                # D1 テーブル行の型定義
│   ├── lib/
│   │   ├── constants.ts         # 定数 (コスト単価等)
│   │   └── utils.ts             # ユーティリティ関数
│   └── db/
│       └── schema.sql           # D1 マイグレーション用 SQL
├── scripts/
│   └── hook.sh                  # Claude Code Stop Hook スクリプト
├── wrangler.toml                # Cloudflare Workers 設定
├── package.json
├── tsconfig.json
├── vitest.config.ts             # テスト設定
├── docs/
│   └── architecture.md          # 本ドキュメント
└── .dev.vars                    # ローカル開発用環境変数 (gitignore対象)
```

### 構成の設計原則

| 原則 | 適用 |
|------|------|
| 関心の分離 | routes / middleware / repositories / services を明確に分割 |
| 薄いルート層 | routes はリクエスト受信とレスポンス生成のみ。ロジックは services に委譲 |
| Repository パターン | D1 クエリを repositories に集約。SQL を routes に書かない |
| 型安全性 | types/ に API 型と DB 型を定義。Zod でランタイムバリデーション |
| 小さいファイル | 1ファイルの責務を明確にし、見通しをよく保つ |

---

## 7. 認証フロー

### 7.1 全体像

```
[Hook Script]                [CF Access]              [Workers API]
     |                            |                        |
     | curl POST /api/sessions    |                        |
     | Headers:                   |                        |
     |   CF-Access-Client-Id: xxx |                        |
     |   CF-Access-Client-Secret: yyy                      |
     |--------------------------->|                        |
     |                            | サービストークン検証    |
     |                            | (CF Access ポリシー)   |
     |                            |----------------------->|
     |                            |                        | Cf-Access-Jwt-Assertion
     |                            |                        | ヘッダーで検証済みトークン受信
     |                            |                        |
     |<--------------------------------------------------------|
     | 201 Created               |                        |


[ブラウザ]                   [CF Access]              [Workers]
     |                            |                        |
     | GET /                      |                        |
     |--------------------------->|                        |
     |                            | ブラウザ認証             |
     |<-- ログインページへリダイレクト |                        |
     | 認証完了                    |                        |
     |--------------------------->|                        |
     |                            |--- JWT 付きプロキシ ---->|
     |                            |                        |
     |<--------------------------------------------------------|
     | ダッシュボード HTML         |                        |
```

### 7.2 認証方式

| 用途 | 認証方式 | 説明 |
|------|---------|------|
| Hook スクリプト → API | CF Access サービストークン | `CF-Access-Client-Id` と `CF-Access-Client-Secret` ヘッダー。非対話的なM2M認証 |
| ブラウザ → ダッシュボード | CF Access (ブラウザフロー) | CF Access のログインページ経由。OTP、GitHub OAuth 等を選択可能 |

### 7.3 Workers 側での検証

Cloudflare Access がリクエストをプロキシする場合、Workers は `Cf-Access-Jwt-Assertion` ヘッダーにJWTを受け取る。これにより Workers 側でも二重検証が可能だが、個人利用の場合は CF Access のポリシー設定だけで十分。

```typescript
// middleware/auth.ts の概要
// CF Access が前段にいるため、Workers に到達した時点で認証済み。
// 追加の検証が必要な場合のみ JWT を検証する。

const authMiddleware = async (c: Context, next: Next) => {
  // CF Access 経由のリクエストは Cf-Access-Jwt-Assertion ヘッダーを持つ
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");

  if (!jwt) {
    // CF Access を経由していないリクエスト (直接アクセス等)
    return c.json({ error: "Unauthorized" }, 401);
  }

  // オプション: JWT の署名検証 (cf access certs endpoint で公開鍵取得)
  // 個人利用なら省略可。CF Access のポリシーで保護されていれば到達 = 認証済み。

  await next();
};
```

### 7.4 Cloudflare Access の設定

```
Application:
  - Name: ccstats
  - Domain: ccstats.<your-domain>.workers.dev (または ccstats.example.com)
  - Session Duration: 24h

Policies:
  1. Allow - Service Auth (Hook用)
     - Service Token: "ccstats-hook"

  2. Allow - Email (ダッシュボード用)
     - Email: your-email@example.com
```

### 7.5 Hook スクリプトでの認証ヘッダー

```bash
# scripts/hook.sh (認証部分の抜粋)
CCSTATS_URL="https://ccstats.example.com/api/sessions"
CF_ACCESS_CLIENT_ID="<service-token-client-id>"
CF_ACCESS_CLIENT_SECRET="<service-token-client-secret>"

curl -s -X POST "$CCSTATS_URL" \
  -H "Content-Type: application/json" \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -d "$JSON_PAYLOAD"
```

---

## 8. Hook スクリプト設計

### 8.1 データ抽出フロー

```
Stop Hook 発火
    |
    v
transcript JSONL ファイルのパスを特定
    |  $CLAUDE_SESSION_ID から
    |  ~/.claude/projects/<project-path>/<session-id>/subagents/*.jsonl
    |
    v
JSONL を1行ずつパース
    |
    |- sessionId, cwd, gitBranch, version を抽出 (最初の行から)
    |- usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens を合算
    |- content 配列内の type:"tool_use" エントリからツール名をカウント
    |- timestamp の min/max からセッション時間を算出
    |
    v
JSON ペイロードを構築
    |
    v
curl で POST /api/sessions に送信
```

### 8.2 Stop Hook で利用可能な環境変数

Claude Code の Stop Hook では以下の環境変数が利用可能（Hookのstdin経由でも取得可能）:

| 変数/データ | 説明 |
|------------|------|
| `session_id` | 現在のセッションID |
| `cwd` | 作業ディレクトリ |
| `transcript_path` | transcript JSONL のパス |

### 8.3 transcript JSONL の構造

実際の transcript JSONL から確認した構造:

```jsonl
{
  "sessionId": "7e33bf2d-6da2-4d7d-83de-921b3ff3ad8c",
  "cwd": "/Users/mz32/src/github.com/...",
  "version": "2.1.2",
  "gitBranch": "main",
  "agentId": "a7779f6",
  "type": "user" | "assistant",
  "message": {
    "role": "user" | "assistant",
    "content": [...],              // tool_use エントリを含む場合あり
    "usage": {                     // assistant メッセージのみ
      "input_tokens": 5771,
      "output_tokens": 135,
      "cache_read_input_tokens": 7424,
      "server_tool_use": { "web_search_requests": 0 }
    }
  },
  "timestamp": "2026-01-09T14:29:26.385Z"
}
```

---

## 9. トレードオフ分析

### ADR-001: ダッシュボードをWorkers内でSSRするか、SPAとして分離するか

**Decision:** Workers 内でサーバーサイド HTML 生成 (テンプレートリテラル or Hono JSX)

| 観点 | 内容 |
|------|------|
| **Pros** | デプロイが1つで済む。追加のビルドステップ不要。Workers の制約内で十分な複雑度 |
| **Cons** | リッチなインタラクションが限定される。フロントエンドフレームワークの恩恵を受けにくい |
| **Alternatives** | (A) React SPA を Pages にデプロイ: ビルドが複雑化、2つのデプロイ管理 / (B) htmx: 部分更新は可能だが学習コスト |
| **Confidence** | High -- 個人利用でシンプルなグラフ表示が主目的。Chart.js を CDN から読み込めば十分 |

### ADR-002: ツール呼び出しを sessions テーブルに JSON として保存するか、別テーブルにするか

**Decision:** 別テーブル (tool_calls)

| 観点 | 内容 |
|------|------|
| **Pros** | ツール別の集計クエリが SQL で直接書ける。インデックスが効く。正規化されたデータ |
| **Cons** | INSERT が2回必要 (sessions + tool_calls)。JOIN のコスト |
| **Alternatives** | sessions テーブルに `tool_calls_json TEXT` カラム: INSERT は1回だが集計時に JSON_EACH が必要。D1 でのパフォーマンスが不明瞭 |
| **Confidence** | High -- ツール別集計は主要ユースケース。正規化の方が長期的にメンテしやすい |

### ADR-003: Cloudflare Workers の CPU 制限 (10ms/リクエスト) への対応

**Decision:** 集計クエリを D1 側に寄せ、Workers 側の処理を最小限にする

| 観点 | 内容 |
|------|------|
| **Pros** | D1 の SQL でSUM/GROUP BY を行えば Workers の CPU を消費しない |
| **Cons** | 複雑な集計はクエリが長くなる |
| **Alternatives** | (A) Workers で全件取得して集計: CPU制限に抵触するリスク / (B) Durable Objects で事前集計: 過剰な複雑化 |
| **Confidence** | High -- D1 は SQL エンジンとしてSUM/GROUP BY/JOINを処理できる。Workers側はクエリ結果の整形のみ |

### ADR-004: コスト概算をDBに保存するか、表示時に計算するか

**Decision:** 表示時にフロントエンド (Dashboard JS) で計算

| 観点 | 内容 |
|------|------|
| **Pros** | 単価変更時に過去データの再計算が不要。DBスキーマがシンプルに保てる |
| **Cons** | フロントエンドに計算ロジックが必要 |
| **Alternatives** | DB に cost カラムを追加: 単価変更時にマイグレーションが必要 |
| **Confidence** | High -- 単価は頻繁に変わりうるため、データ層と分離するのが合理的 |

---

## 10. Cloudflare Workers の制約と対策

| 制約 | 値 | 対策 |
|------|-----|------|
| CPU 時間 | 10ms (Free) / 30ms (Paid) | 集計は D1 SQL に委譲。Workers は結果の整形のみ |
| リクエストボディサイズ | 100MB | 1セッションのデータは数KB。問題なし |
| D1 行サイズ | 制限なし (SQLite) | 問題なし |
| D1 データベースサイズ | 500MB (Free) / 10GB (Paid) | 個人利用で数年分は余裕 |
| D1 読み取り行数 | 5M rows/day (Free) | 個人利用で十分 |
| D1 書き込み行数 | 100K rows/day (Free) | 個人利用で十分 |
| Workers 実行回数 | 100K/day (Free) | 個人利用で十分 |
| Subrequest | 50/リクエスト | 外部APIを呼ばないため問題なし |

---

## 11. 将来の拡張ポイント

以下は現時点では実装しないが、将来的に拡張可能な設計余地を残す:

| 拡張 | 設計上の考慮 |
|------|------------|
| **マルチユーザー対応** | sessions テーブルに `user_id` カラム追加。認証をCF Access のメール情報から取得 |
| **コスト目標/アラート** | 月次のトークン上限を設定し、超過時に通知 (Workers Cron + Email Workers) |
| **エクスポート機能** | GET /api/export?format=csv エンドポイントを追加 |
| **モデル別の集計** | sessions.model カラムで既にモデル情報を保存。GROUP BY model で集計可能 |
| **Cron による日次集計** | Workers Cron Triggers で日次のサマリーを別テーブルに保存。大量データ時のクエリ高速化 |
| **Webhook 通知** | セッション登録時に条件付きでSlack/Discord通知 |

---

## 12. 開発・デプロイフロー

### 12.1 ローカル開発

```bash
# 依存インストール
npm install

# ローカル D1 データベース作成
npx wrangler d1 create ccstats-db --local
npx wrangler d1 execute ccstats-db --local --file=src/db/schema.sql

# ローカル開発サーバー起動
npx wrangler dev
```

### 12.2 デプロイ

```bash
# D1 データベース作成 (本番)
npx wrangler d1 create ccstats-db
npx wrangler d1 execute ccstats-db --file=src/db/schema.sql

# デプロイ
npx wrangler deploy
```

### 12.3 wrangler.toml

```toml
name = "ccstats"
main = "src/index.ts"
compatibility_date = "2026-03-01"

[[d1_databases]]
binding = "DB"
database_name = "ccstats-db"
database_id = "<generated-id>"
```

---

## 13. テスト戦略

| レイヤー | テスト種別 | ツール | テスト対象 |
|---------|-----------|--------|-----------|
| Repository | 統合テスト | Vitest + Miniflare | D1 クエリの動作検証 |
| Service | ユニットテスト | Vitest | 集計ロジック・コスト計算 |
| API Routes | 統合テスト | Vitest + Miniflare | エンドポイントのE2Eテスト |
| Hook Script | 手動テスト | - | transcript JSONL のパースと送信 |

---

## 14. チェックリスト

### 機能要件

- [x] D1 スキーマ設計完了
- [x] API エンドポイント設計完了
- [x] ダッシュボードメトリクス定義完了
- [x] 認証フロー設計完了
- [x] Hook スクリプトのデータ抽出仕様定義完了

### 非機能要件

- [x] Workers CPU 制限への対策: D1 SQL に集計を委譲
- [x] セキュリティ: CF Access による認証保護
- [x] 冪等性: 重複 session_id の扱い定義済み
- [x] スケーラビリティ: 個人利用で十分。拡張ポイントを文書化

### 技術設計

- [x] ディレクトリ構成定義
- [x] コンポーネント責務の明確化
- [x] データフロー図示
- [x] トレードオフ分析 (ADR)
- [x] テスト戦略定義
