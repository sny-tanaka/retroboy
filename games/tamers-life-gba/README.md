# テイマーズライフ（内蔵ソフト）

GBA のテイマーズライフ。ソース・素材・設計書・攻略サイトのソースは非公開のリポジトリ tamers-life にあり、ここには配信するものだけを置く
（tamers-life の `scripts/export-to-retroboy.sh` が写す。手で書き換えない）。

| ファイル | 中身 |
|---|---|
| `tamers-life-gba.gba` | できた ROM（内蔵ソフトとして配信する） |
| `game.json` | 表示名・説明・`saveFormat`・攻略サイトの場所（`guide`） |
| `guide/` | できた攻略サイト（`/guide/` で配信し、遊んでいるときにメニューの「攻略」で重ね窓に出す） |
| `past-versions.json` | ソースを tamers-life に移す前の版の一覧（古い版のセーブの掃除に使う） |

仕組みは `docs/builtin-games.md` の「ソースが別のリポジトリにあるゲーム」。
