# 内蔵ソフト（自作ゲームをアプリに入れて配る）

自作のゲームはこのリポジトリの `games/` で作り、できた ROM をアプリに入れて配信する。利用者は ROM ファイルを用意しなくても、メニューの「内蔵ソフト」から選ぶだけで遊べる。

市販のゲームの ROM は、これまで通りリポジトリにもビルド成果物にも入れない（著作権の問題があるため）。自作のゲームは著作権の問題が無いので入れてよい。例外にするのは「`games/` に登録した自作ゲームの ROM」と「`app/dist/builtin/` の、目録に載っている ROM」だけにしてある。

## 置き場所

```
games/
  <id>/                 … ゲームごとのフォルダ。<id> は英小文字・数字・- だけ（版が上がっても変えない）
    game.json           … 表示名・説明・GB/GBC・ROM の場所
    Makefile            … （あれば）scripts/build-games.sh が呼ぶ
    src/ ...            … ソース（GBDK-2020 なら C）
    <id>.gbc            … できた ROM。ソースと一緒にコミットする
    build/              … ビルドの途中の生成物（git に入れない）
```

いまは通信テスト（`games/linktest/`）・テイマーズライフの GBA 版（`games/tamers-life-gba/`、Rust の agb 製、作っているところ）・GBA ベンチ（`games/gba-bench/`）・GBA 通信テスト（`games/linktest-gba/`、C を llvm で。`docs/link-cable-design.md` 8.5）の 4 つ。テイマーズライフの GB 版（`games/tamers-life/`、GBDK-2020 製）は GBA 版に切り替えたので内蔵ソフトから外した（決定 #143）。フォルダは設計書（`docs/`）と道具（`tools/`）の置き場として残してある（下の「外し方」）。通信テストの ROM とソースは `testroms/link/` にある（RGBDS 製。コアの試験 `core/tests/link.rs` もこの ROM を使うので動かしていない）。

### game.json

```json
{
    "name": "通信テスト",
    "description": "メニューに出す説明（1〜2 文）",
    "system": "gbc",
    "rom": "../../testroms/link/linktest.gb",
    "builtBy": "scripts/build-testroms.sh",
    "toolchain": "gbdk",
    "saveFormat": 1
}
```

| キー | 要る | 内容 |
|---|---|---|
| `name` | 要る | メニューに出す名前 |
| `description` | 要る | メニューに出す説明 |
| `system` | 要る | `gb`（白黒のゲームボーイ用）か `gbc`（ゲームボーイカラー対応）か `gba`（ゲームボーイアドバンス。mGBA で動かす）。gb / gbc は ROM のヘッダの CGB フラグ（0x143 の bit 7）と、gba はヘッダが GBA の形（3 バイト目が 0xEA、0xB2 が 0x96）と合っていないとビルドが止まる。アプリはヘッダ（と名前の .gba）でどれで動かすかを決める |
| `rom` | 要る | できた ROM の場所（game.json からの相対パス）。リポジトリに入っている ROM をそのまま配信する |
| `builtBy` | 任意 | Makefile が無いゲームの作り方のメモ（`scripts/build-games.sh` が出すだけ） |
| `toolchain` | 任意 | `gbdk` なら GBDK-2020、`llvm` なら Homebrew の llvm と lld（GBA。`games/gba-bench/README.md`）、`agb` なら llvm と lld に加えて rustup の nightly と rust-src（GBA。Rust の agb。`games/tamers-life-gba/README.md`）が要る。無いときは `scripts/build-games.sh --check` が確かめずに飛ばす |
| `saveFormat` | 任意 | ゲーム内セーブの形式の番号（既定 1）。下の「版が上がったときのセーブ」 |
| `guide` | 任意 | 攻略サイトの場所（dist の中のフォルダ。例 `"guide/"`）。あれば、そのゲームを遊んでいるときにメニューに「攻略」が出て、画面いっぱいの重ね窓（iframe）で開く。テイマーズライフ GBA 版の攻略は `app/guide/index.html`（データは `games/tamers-life-gba/tools/guide_data.py` が書き出す） |
| `builtin` | 任意 | `false` なら内蔵ソフトに入れない（既定 `true`）。下の「外し方」 |

## ビルド

ゲームの作り方はゲームごとに違ってよい。`scripts/build-games.sh` は `games/<id>/Makefile` があるゲームだけを `make -C games/<id> OUT=<出力する ROM>` でビルドし、できた ROM を game.json の `rom` に写す。Makefile は `OUT=` の場所に ROM を出すこと。

```sh
./scripts/build-games.sh            # 全部
./scripts/build-games.sh <id>       # 1 つだけ
./scripts/build-games.sh --check    # ソースから作り直した ROM が、コミットしてある ROM と同じかだけを確かめる
```

ROM もコミットするので、アプリのビルド（`npm run check`・デプロイ）には GBDK も RGBDS も要らない。`npm run check` は `--check` を流し、ソースを直して ROM を作り直し忘れていたら止める（ツールが無ければ飛ばす）。

### GBDK-2020 の Makefile のひな形

```make
# scripts/build-games.sh から OUT= を付けて呼ばれる
GBDK_HOME ?= $(HOME)/.local/gbdk
LCC := $(GBDK_HOME)/bin/lcc
OUT ?= build/mygame.gbc
SRC := $(wildcard src/*.c)
# -Wm-yc: GBC 対応（GB でも動く）/ -Wm-yC: GBC 専用 / -Wm-yn: ヘッダのタイトル
LCCFLAGS := -Wm-yc -Wm-yn"MYGAME" -Wl-j

.PHONY: all
all:
	mkdir -p $(dir $(OUT))
	$(LCC) $(LCCFLAGS) -o $(OUT) $(SRC)
```

game.json には `"system": "gbc"`、`"toolchain": "gbdk"`、`"rom": "mygame.gbc"` を書く。GBDK の入れ方は README の「必要なツール」。

## アプリへの入れ方

- `app/plugins/builtinGames.ts`（vite のプラグイン）が `games/*/game.json` を読み、ROM の SHA-256 と大きさを測って目録を作る。
  - アプリには目録を `virtual:builtin-games` として渡す（JS に入る。目録を取りに行く通信は無い）。
  - 本番ビルドでは `dist/builtin/<id>-<SHA-256 の頭 12 文字>.gb(c)`（GBA は `.gba`） に ROM を、`dist/builtin/index.json` に目録（`id`・`name`・`description`・`system`・`sha256`・`size`・`file`・`saveFormat`・`guide`）を出す。ROM の名前は中身で変わるので、版が上がると別のファイルになる。
  - 開発サーバー（`npm run dev`）では `/builtin/` の下で同じものを返す。`games/` や ROM を書き換えると読み直して画面を再読み込みする。
- `app/scripts/generate-sw.mjs` は、これまで通り dist の ROM・セーブを見つけたらビルドを止める。ただし `dist/builtin/index.json` に載っていて、中身の SHA-256 と大きさが目録と合う `dist/builtin/` の ROM だけは通す。目録に載っていない ROM や、`builtin/` の外の ROM は止まる。
- Service Worker は dist の中身を全部事前キャッシュするので、内蔵ソフトの ROM と目録も入る。オフラインでも選べる。

## 選んだときの動き（毎回取る）

内蔵ソフトを選ぶと、`dist/builtin/` の ROM を毎回 `fetch` で取る（`app/src/storage/builtinGames.ts`）。インストール済みのホーム画面アプリでは Service Worker のキャッシュから出るので、通信はしない。取った ROM は SHA-256 と大きさを目録と比べ、違えば読み込まない。

IndexedDB（`roms`）には入れない。理由:

- アプリの版と内蔵ソフトの版がいつも揃う（古い版の ROM が端末に溜まらず、消す手段を作らなくてよい）。
- 利用者が追加した ROM の一覧と混ざらない。内蔵ソフトは削除の対象外（そもそも ROM の削除はまだ無い。`docs/future-work.md`）。
- ROM は小さい（GBDK のゲームでも数十〜数百 KB）ので、キャッシュから毎回読んでも重くない。

代わりに、Service Worker のキャッシュが無い状態（初めて開いたときの事前キャッシュが終わる前・サイトデータを消したあと）でオフラインだと選べない。そのときは「通信できる所で開き直してください」と出す。

利用者が通信テストの `.gb` を前にファイルで追加していた場合、中身が同じ（ID が同じ）なので「追加した ROM」には出さず、「内蔵ソフト」の欄にだけ出す。セーブも同じものを使う。

前回の ROM（`settings` の `lastRomId`）には、内蔵ソフトなら SHA-256 ではなく `builtin:<id>` を覚える。版が上がっても、次に開いたときは新しい版が読み込まれる。内蔵ソフトが無くなっていたら、ROM が選ばれていない状態で始まる。

## セーブ

ROM の ID は利用者の ROM と同じく中身の SHA-256 なので、ゲーム内セーブ（localStorage `sram:<ID>` / `rtc:<ID>`）とセーブステート（IndexedDB `saveStates`）は ROM ごと＝内蔵ソフトの版ごとに分かれる。

### 版が上がったときのセーブ

自作ゲームは直すたびに ROM の中身が変わり、ID も変わる。そのままだと、版を上げるたびにゲーム内セーブが空に戻ってしまうので、次のようにした（`carryOverSave`）。

- 内蔵ソフトを始めるとき、前に遊んだ版（localStorage `builtinSave:<id>` に `{ sha256, saveFormat }` を覚える）と中身が違い、`saveFormat` が同じなら、前の版のゲーム内セーブ（セーブ RAM・RTC）のバイト列をそのままいまの版の ID に**写す**。いまの版の形への取り込みは、新しい版のゲームが起動して読んだときに起きる。
  - **ここでは何も消さない。**
  - いまの版にもうゲーム内セーブがあれば写さない（上書きしない）。
  - 前の版に中身があるのに、いまの版のキーが空（空文字など）なら、記録を進めない（前の版を「前に遊んだ版」のまま守る）。写すのに失敗したときも記録は書き換えない。
- ゲーム内セーブの中身の形が変わって前の版のものを読ませたくないときは、game.json の `saveFormat` を 1 つ上げる。写さずに空のゲーム内セーブで始まる。
- セーブステート（画面の「セーブ」「ロード」と `.rbs` ファイル）は写さない。ROM が違うとプログラムの位置が合わず、正しく戻せないため。新しい版では「ロード」が押せない状態から始まる（前の版の枠は、次に起動したときの掃除で消える）。

### 古い版のセーブの掃除

Safari の localStorage は 1 サイト 5MB ほどで、テイマーズライフ GBA 版のゲーム内セーブは 1 版で約 17 万字あるので、古い版のものを溜めない。ただし、新しい版のゲームが前の版のセーブを正しく取り込めたかはアプリには分からないので、**1 つ前の版のゲーム内セーブは自動では消さず、利用者がメニューで消す**（決定 #446）。

**起動時の掃除**（前回の ROM を開いたあとに 1 回。`cleanUpOldSaves`。画面には知らせず、消した数を `console.info` に出す）

- 消してよい候補は、**内蔵ソフトの過去の版と分かっている ID だけ**（目録の `pastVersions`）。一覧に無い ID は、`roms` に無くても消さない（IndexedDB だけ消えたときに、利用者の ROM のセーブを消さないため）。利用者が読み込んだ ROM（`roms` にある ID）と同じ版も消さない。`roms` を読むのとセーブステートを消すのは 1 つのトランザクションで行い、`roms` が読めないときは何も消さない。
- セーブステート（IndexedDB `saveStates`）: 候補の枠を消す（今までどおり、版が変わったら消す）。
- ゲーム内セーブ（localStorage `sram:<ID>`・`rtc:<ID>`）: 候補のうち端末にあるもので、次のどれにも当たらない版だけを消す（1 つの版の `sram:`・`rtc:` はいっしょに消す）。
  - いまの版
  - 1 つ前の版（端末にあるうち、いまの版より古い中でいちばん新しい版。履歴の順で決める）
  - `saveFormat` ごとに、端末にあるうち、いまの版より古い中でいちばん新しい版
  - `saveFormat` の分からない版
  - いまの版より新しい版（版を戻して公開したとき）
  - 前に遊んだ版の記録（`builtinSave:<id>`）にある版（まだ新しい版を開いておらず、これから写す版）
- 書き込み待ちのあるキー、`sram-corrupt:` などの退避やほかのキーには触れない。読めない `builtinSave:` があれば、ゲーム内セーブは何も消さない。
- 外した内蔵ソフト（下の「外し方」）は目録に無いので、そのセーブは消さない。

**メニューの「古い版のセーブを消す」**（「保存の状態」の欄）

- 内蔵ソフトの過去の版のゲーム内セーブが端末にあるときだけ押せる（無ければ灰色）。下に、どのソフトの何版が残っているかを出す。
- 押すと、何を消すか（ソフトの名前と版の数）を書いた確認を出す。初めは「いいえ」にフォーカスがある。「消す」で、いまの版以外の過去の版（いまの版より新しい版・`saveFormat` の分からない版も含む）のゲーム内セーブを消す。
- 消さないもの: いまの版、`roms` にある ID（消す直前に `roms` を読み直し、読めなければ何も消さない）、過去の版の一覧に無い ID、書き込み待ちのあるキー、`-corrupt:` などの退避、ほかのキー。まだ新しい版を開いていない（前に遊んだ版がいまの版でない）ときの前に遊んだ版も、引き継ぐ前なので消さない。

過去の版の一覧（`pastVersions`。新しい順に `{ sha256, saveFormat?, newer? }`）は、ビルドのときに `app/plugins/builtinGames.ts` が、git に入っている ROM（game.json の `rom`）の履歴から作る（`git log --follow` の各コミットの ROM の SHA-256 と、そのコミットの `games/<id>/game.json` の `saveFormat`）。いまの内蔵ソフトの版は除き、履歴の中でいまの版より新しい版には `newer` を付ける。ROM の中身の SHA-256 は `app/node_modules/.cache/builtin-rom-history.json` に覚え、2 回目からは新しい版だけ読む。ROM をコミットせずに公開した版は一覧に入らないので、そのセーブは消さない（足りない分は「消さない」側に倒れる）。

ゲームの側でも、セーブ RAM の先頭に印と形式の番号を置き、合わなければ初期化するようにしておくと安全（`saveFormat` を上げ忘れたときの備え）。

## 自作ゲームを足す手順

1. `games/<id>/` を作り、ソースと Makefile と game.json を置く。
2. `./scripts/build-games.sh <id>` で ROM を作る。
3. `cd app && npm run dev` で開き（開発サーバーは無音。音も確かめるときは `?sound=1` を付ける）、メニューの「内蔵ソフト」に出ることと動くことを確かめる。
4. ソースと ROM をコミットする（`.gitignore` は `games/` の中の `*.gb` / `*.gbc` を例外にしてある）。

## 外し方

フォルダ（ソース・設計書・道具・ROM）は残したまま、アプリの内蔵ソフトから外すときは、game.json に `"builtin": false` を足す。

- `app/plugins/builtinGames.ts` が読まなくなる。目録（`virtual:builtin-games`・`dist/builtin/index.json`）にも `dist/builtin/` の ROM にも入らず、メニューの「内蔵ソフト」に出なくなる。
- `scripts/build-games.sh`（id を指定しないとき）と `--check`、つまり `npm run check` が飛ばす。ツール（GBDK など）を入れなくてもよくなる。`./scripts/build-games.sh <id>` と id を指定すれば、これまで通り作れる。
- 前にそのゲームを遊んでいた端末: 前回の ROM（`lastRomId`）が `builtin:<id>` のままでも、目録に無いので ROM が選ばれていない状態（「内蔵ソフトから選ぶ」「ROM を追加」）で始まる（`resolveBuiltinLastRomId`）。ゲーム内セーブ（`sram:<ID>`・`builtinSave:<id>`）とセーブステートは消さずに残る（目録に無いので、古い版の掃除の対象にならない）。戻せば（`"builtin": false` を消せば）また遊べる。
- 外したゲームの ROM のファイルは、利用者が「ROM を追加」で選べば、ふつうの ROM として遊べる（ID が同じなので、前の版のセーブもそのまま使える）。
