# 開発メモ（作業の手順・試してやめたこと）

開発に使った Claude のセッションの作業メモ（チェックリストの「いまの状態」）から、このリポジトリに関わるものを 2026-11-01 に書き移した。決まりごとは [decisions.md](decisions.md)。ビルド・検査・公開の詳しい手順は [README](../README.md) の「開発手順」「まとめて検査する」「GitHub Pages に公開する」。

## 手順（いま使っている形）

```sh
# 検査（コア取得・パッチ・WASM・型・lint・ビルド・ROM・ライセンス・攻略サイトの check）
cd app && nice -n 15 npm run check

# マージ（mergeable を見てから。直後は UNKNOWN のことがあるので数秒待って見直す）
gh pr view N --json mergeable -q .mergeable
gh pr merge N --squash && git pull -q --ff-only origin develop && git log --oneline -1

# 公開（3〜6 分。動いている作業が全部終わってからまとめて 1 回。decisions.md の #433・#500）
cd app && npm ci --silent && nice -n 15 npm run deploy > /tmp/deploy-XXX.log 2>&1; echo exit=$?; tail -2 /tmp/deploy-XXX.log
curl -s "https://sny-tanaka.github.io/retroboy/version.json?t=$(date +%s)"   # {"version":"YYYY-MM-DD HH:MM (コミット)"}
```

- 既定ブランチは `develop`。PR は squash マージ。CI は無い（`gh pr checks` は no checks）。
- 版の文字の後ろの `+` は、ビルドしたときに作業ツリーが汚れていた印。
- `scripts/deploy-pages.sh` の公開先（`PAGES_URL`）は https://sny-tanaka.github.io/retroboy/ 。
- 内蔵ソフトのうち、ソースが別のリポジトリにあるゲームは、そちらの書き出しの台本でここの `games/<id>/` に ROM・`game.json`・攻略サイトを写してから、ここで `npm run check` → コミット → PR → マージ → 公開する（[builtin-games.md](builtin-games.md)）。そちらで使うクレートが変わったら、ここの `NOTICE` と `licenses/` も合わせる（写す台本は確かめない）。
- `npm run check` に要る道具: brew の rustup・wasm-pack・rgbds・cmake・ninja、Homebrew の clang・ld.lld、emsdk 5.0.7（`~/.local/emsdk`。mGBA の WASM）。GBA のコアは mGBA 0.10.5（`mgba/upstream.rev`・`mgba/patches/`。ビルド `scripts/build-mgba.sh`、取得 `scripts/prepare-core.sh mgba`）。GB のコアの書き換えは `core/patches/`（`scripts/prepare-core.sh`・`export-core-patches.sh`）。

## コードの事実

- メモリーセーブは ROM の SHA-256 ごとの枠。内蔵ソフトの版が変わったときに `app/src/storage/builtinGames.ts` の carryOverSave が写すのはゲーム内セーブだけ（新しい版にセーブがあれば写さない）。
- 内蔵ソフトの過去の版の一覧（pastVersions）は、ビルドのとき ROM の git 履歴から作る（`app/plugins/builtinGames.ts`、キャッシュ `app/node_modules/.cache/builtin-rom-history.json`）。git の履歴に無い古い版（ソースを別のリポジトリに移して、このリポジトリの履歴から消したもの）は `games/<id>/past-versions.json`（新しい順の `[{ sha256, saveFormat? }]`）に書いておき、後ろに足す。一覧に無い ID・`roms` にある ID は消さない。
- GBA の `.ss1` にはゲーム内セーブ（フラッシュ）も入る（decisions.md の #512）。前は `mgba/glue/mgba-glue.c` が `SAVESTATE_RTC` だけで、ゲーム内セーブを含まなかった。

## 試してやめたこと

- Netlify の無料プランはデプロイのクレジットが足りず、GitHub Pages にした（前の Netlify のサイトは放っておく）。
- Mac の別プロセスのブラウザ同士では WebRTC がつながらなかった（通信ケーブルの確かめは iPhone 2 台か、同じページの中で）。
- 内蔵ソフトの古い版のセーブを「取り込みの印」で自動で消す作りは、アプリだけでは確実に判断できなかった（3 回レビューして毎回消える道が見つかった: 書いただけで取り込み済みと誤る・ゲームが読めず作り直したセーブ・版を戻して公開・別タブ、など）。やめて「今の版＋1 つ前を残し、古いのは人がメニューで消す」（#446）にした。アプリが推し量って消す形に戻さない。
- 版の巻き戻し（前の版を公開し直す）はしない。carryOverSave のため、前にその版で遊んだ古いセーブが読まれてしまう（#372）。
- 「更新前に `.rbs` を書き出して」と持ち主に頼んだのは誤りだった（そのころの GBA の書き出しはゲーム内セーブを含まなかった）。いまは `.ss1` に入る。

## 並べて動かすセッション（子）の進め方

- 子は worktree で動かす。重い処理は子ごとに 1 本・`nice -n 15`（#234）。ブラウザでの確かめは無音（`npm run dev` は既定で無音、本番ビルドは `?mute=1`。#55）。
- PR の題は出す前に仕上げる（WIP のまま squash しない）。写しは `/tmp` の新しいフォルダへ書き、`rm` を使わない。
- 子を閉じるのは、その子の PR がマージ済みになってから（マージと並べて閉じると枝が先に消える恐れ）。枝の削除は子にさせない。子の force push・`rm -f`・`git branch -D` は許可で止まる。
- PR の headRefOid がブランチの先頭と違い、CONFLICTING のまま動かないことがある。`gh pr close N && gh pr reopen N` で同期し直すと MERGEABLE になる。
- 子の報告にも誤りがある。大事な所は親が確かめる。持ち主の文は字のとおりに読み、変えると言われた所だけ変える。
- macOS に `timeout` は無い。zsh で `$B:g…` は修飾子になる（`git show` のパスは引用符で囲む）。
