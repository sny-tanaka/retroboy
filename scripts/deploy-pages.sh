#!/usr/bin/env bash
# GitHub Pages に出す（app/ の npm run deploy）。README「GitHub Pages に公開する」。
#
# 1. app/ で npm run check（WASM のビルド・コアの試験・型チェック・lint・本番ビルド・Service Worker の生成と
#    ROM の検査）を通し、app/dist/ を作る。
# 2. 一時ディレクトリに app/dist/ を写し、そこで新しい git リポジトリを作って 1 コミットにする
#    （作業中のブランチ・作業ツリー・このリポジトリのブランチには触らない）。
# 3. そのコミットを origin の gh-pages ブランチに強制で push する（前の版は残さず、いつも 1 コミット）。
# 4. 公開の URL の version.json が、いま出した版になるまで待って確かめる。
#
# 使い方（リポジトリのどこからでもよい）:
#   scripts/deploy-pages.sh            # ビルドして push し、出たことを確かめる
#   scripts/deploy-pages.sh --dry-run  # ビルドとコミットまで。push しない（一時ディレクトリを残して場所を出す）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/app/dist"
BRANCH="gh-pages"
PAGES_URL="https://sny-tanaka.github.io/retroboy-snap/"
AUTHOR_NAME="sny-tanaka"
AUTHOR_EMAIL="36751082+sny-tanaka@users.noreply.github.com"

dry_run=false
case "${1:-}" in
  "") ;;
  --dry-run) dry_run=true ;;
  *)
    echo "使い方: $0 [--dry-run]" >&2
    exit 1
    ;;
esac

remote="$(git -C "$ROOT" remote get-url origin)"
source_commit="$(git -C "$ROOT" rev-parse --short HEAD)"
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "注意: コミットしていない変更があります（画面の版のハッシュの後ろに + が付きます）。" >&2
fi

# 1. ビルド（npm run check と同じ。失敗したらここで止まる）
(cd "$ROOT/app" && npm run check)

for file in index.html sw.js version.json .nojekyll LICENSE.txt NOTICE.txt; do
  if [ ! -f "$DIST/$file" ]; then
    echo "app/dist/$file がありません。" >&2
    exit 1
  fi
done
build_id="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).buildId)' "$DIST/version.json")"
version="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version)' "$DIST/version.json")"

# 2. 一時ディレクトリで 1 コミットにする
work="$(mktemp -d "${TMPDIR:-/tmp}/retroboy-snap-pages.XXXXXX")"
if ! $dry_run; then
  trap 'rm -rf "$work"' EXIT
fi
cp -R "$DIST/." "$work/"
git -C "$work" init -q -b "$BRANCH"
git -C "$work" add -A
git -C "$work" \
  -c user.name="$AUTHOR_NAME" -c user.email="$AUTHOR_EMAIL" -c commit.gpgsign=false \
  commit -q -m "Deploy $source_commit ($version)"
echo "gh-pages のコミットを作りました: $(git -C "$work" log --oneline -1)"

if $dry_run; then
  echo "--dry-run なので push しません。中身: $work"
  exit 0
fi

# 3. push（gh-pages を、このコミット 1 つだけに置き換える）
git -C "$work" push --force "$remote" "HEAD:refs/heads/$BRANCH"

# 4. 出たことを確かめる。Pages の反映には 1 分ほどかかる
echo "公開を待っています: ${PAGES_URL}version.json（buildId $build_id）"
for _ in $(seq 1 40); do
  body="$(curl -fsS -H 'Cache-Control: no-cache' "${PAGES_URL}version.json?t=$(date +%s)" 2>/dev/null || true)"
  if [[ "$body" == *"\"buildId\":\"$build_id\""* ]]; then
    echo "公開できました: $PAGES_URL（版 $version）"
    exit 0
  fi
  sleep 15
done
echo "10 分待っても新しい version.json が見えません。GitHub の Settings > Pages と Actions（pages build and deployment）を見てください。" >&2
exit 1
