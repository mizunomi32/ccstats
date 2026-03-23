#!/bin/bash
# ccstats - Claude Code Stop Hook Script
# セッション終了時にtranscript JSONLを解析し、ccstats APIにPOSTする
#
# 環境変数:
#   CCSTATS_URL              - ccstats API URL (例: https://ccstats.example.com/api/sessions)
#   CF_ACCESS_CLIENT_ID      - Cloudflare Access サービストークン Client ID
#   CF_ACCESS_CLIENT_SECRET  - Cloudflare Access サービストークン Client Secret

set -euo pipefail

# 環境変数チェック
if [ -z "${CCSTATS_URL:-}" ] || [ -z "${CF_ACCESS_CLIENT_ID:-}" ] || [ -z "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
  exit 0
fi

# Hook の stdin から JSON 入力を読み取り
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -z "$SESSION_ID" ] || [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  exit 0
fi

# transcript JSONL を解析
JQ_ERROR_LOG="${TMPDIR:-/tmp}/ccstats-jq-error.log"
STATS=$(jq -s '
  # 最初のエントリからメタ情報を取得
  (.[0] // {}) as $first |

  # assistant メッセージの usage を合算
  [.[] | select(.message.role == "assistant" and .message.usage != null) | .message.usage] as $usages |

  # tool_use エントリをカウント
  [.[] | select(.message.role == "assistant") | .message.content[]? | select(.type == "tool_use") | .name] as $tools |

  # タイムスタンプの min/max
  [.[] | .timestamp // empty | select(. != null)] as $timestamps |

  {
    session_id: ($first.sessionId // ""),
    cwd: ($first.cwd // ""),
    git_branch: ($first.gitBranch // null),
    claude_version: ($first.version // null),
    model: ([$usages[].model_id // empty] | last // null),
    input_tokens: ([$usages[].input_tokens // 0] | add // 0),
    output_tokens: ([$usages[].output_tokens // 0] | add // 0),
    cache_read_tokens: ([$usages[].cache_read_input_tokens // 0] | add // 0),
    started_at: ($timestamps | min // null),
    ended_at: ($timestamps | max // null),
    tool_calls: (
      $tools | group_by(.) | map({tool_name: .[0], call_count: length})
    )
  }

  # duration を計算
  | if .started_at and .ended_at then
      .duration_seconds = ((.ended_at | fromdateiso8601) - (.started_at | fromdateiso8601) | floor)
    else
      .duration_seconds = null
    end
' "$TRANSCRIPT_PATH" 2>"$JQ_ERROR_LOG")

if [ -z "$STATS" ] || [ "$STATS" = "null" ]; then
  if [ -s "$JQ_ERROR_LOG" ]; then
    logger -t ccstats "jq parse failed for $TRANSCRIPT_PATH: $(cat "$JQ_ERROR_LOG")" 2>/dev/null || true
  fi
  exit 0
fi

# session_id が空なら Hook の入力から補完
PARSED_SESSION_ID=$(echo "$STATS" | jq -r '.session_id // empty')
if [ -z "$PARSED_SESSION_ID" ]; then
  STATS=$(echo "$STATS" | jq --arg sid "$SESSION_ID" '.session_id = $sid')
fi

# cwd が空なら Hook の入力から補完
PARSED_CWD=$(echo "$STATS" | jq -r '.cwd // empty')
if [ -z "$PARSED_CWD" ]; then
  STATS=$(echo "$STATS" | jq --arg cwd "$CWD" '.cwd = $cwd')
fi

# API に送信 (タイムアウト10秒、リトライ2回)
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time 10 --retry 2 --retry-delay 1 \
  -X POST "$CCSTATS_URL" \
  -H "Content-Type: application/json" \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -d "$STATS" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" -lt 200 ] 2>/dev/null || [ "$HTTP_CODE" -ge 300 ] 2>/dev/null; then
  # 送信失敗時はローカルにフォールバック保存
  echo "$STATS" >> "${HOME}/.ccstats-failed.jsonl"
  logger -t ccstats "API POST failed (HTTP $HTTP_CODE)" 2>/dev/null || true
fi

exit 0
