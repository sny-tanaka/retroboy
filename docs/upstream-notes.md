# Retro Boy 本家の調査メモ

② (ROM の IndexedDB 保存と自動読み込み) と ③ (UI の作り直し) の作業者向け。本家の仕組みと、このアプリでどう変えたか（「このアプリでは」の段落）を書く。

- 対象: [smparsons/retroboy](https://github.com/smparsons/retroboy) コミット `edf90d9fb192372a657a18d44f5c9841805fa554`（2026-03-01、`core/Cargo.toml` の Cargo の git 参照 `rev` と `core/Cargo.lock` で固定）
- 以下のパスは特に断りがなければ本家リポジトリのルートからの相対パス。本家のソースは [GitHub の該当コミット](https://github.com/smparsons/retroboy/tree/edf90d9fb192372a657a18d44f5c9841805fa554) か、ビルド後の Cargo のチェックアウト先（`~/.cargo/git/checkouts/retroboy-<ハッシュ>/edf90d9/`）で読める。

## 全体の構成

- Rust のコア (`src/`) を wasm-pack で WASM にする。JS とのつなぎは `src/wasm/api.rs` にまとまっている。
- コアはエミュレーターを **1 つだけ** `thread_local!` の `EMULATOR` に持つ（`src/wasm/api.rs`）。JS 側から複数のインスタンスは作れない。
- コアから JS への呼び出しは、`window` 上のグローバル関数を名前で呼ぶ方式（`extern "C"` ブロック）。モジュールの import ではないので、**WASM の関数を呼ぶ前に window に関数を置いておく必要がある**。
- 本家の `frontends/web`（CRA + MUI）は使わず、つなぎ部分だけを `app/src/emulator/` に移した。

## WASM のつなぎの API

生成物は `app/src/core/retroboyCore.js`（型は `retroboyCore.d.ts`）。`scripts/build-wasm.sh` で作る。

### JS → コア（export される関数）

| 関数 | 説明 |
|---|---|
| `init()`（default export） | WASM の読み込み。他の関数より先に 1 回だけ await する（`app/src/main.tsx`） |
| `initializeEmulator(rom: Uint8Array, settings: EmulatorSettings): RomMetadataResult` | **ROM 読み込みの関数**。モード設定・サンプルレート設定・ROM 読み込み・セーブ RAM の復元までを行う。結果は `{ error?: string, metadata?: { title, hasBattery } }` |
| `new EmulatorSettings(mode: "DMG" \| "CGB", audioSampleRate: number)` | `mode` は文字列 `"CGB"` のときだけカラー、それ以外はモノクロ。`audioSampleRate` は `AudioContext.sampleRate` を渡す |
| `stepUntilNextAudioBuffer()` | 音声バッファ 1 つ分エミュレーターを進める。途中のフレームは `canvasRender`、最後に `playAudioSamples` が呼ばれる |
| `pressKey(name)` / `releaseKey(name)` | `name` は `"Up" "Down" "Left" "Right" "Start" "Select" "A" "B"`。それ以外は無視される |
| `resetEmulator()` | エミュレーターを新しく作り直す（ROM も外れる） |
| `encodeSaveState(): SaveStateResult` | セーブステートのバイト列（`saveState`）か `error` |
| `applySaveState(data: Uint8Array): string \| undefined` | 適用。失敗時はエラー文を返す |
| `validateGamesharkCode` / `validateGamegenieCode` / `registerGamesharkCheat` / `registerGamegenieCheat` / `unregisterCheat` | チート。今回のアプリでは使っていない |

### コア → JS（window に置く関数）

`src/wasm/api.rs` の `extern "C"` ブロック。型は `app/src/emulator/globals.d.ts`。

| window の関数 | 呼ばれるとき | このアプリで置いている場所 |
|---|---|---|
| `canvasRender(frame: Uint8Array)` | 1 フレームごと。160×144 の RGBA | `app/src/emulator/GameScreen.tsx` |
| `playAudioSamples(left: Float32Array, right: Float32Array)` | `stepUntilNextAudioBuffer` の最後 | `app/src/emulator/useAudioSync.ts` |
| `currentTimeMillis(): number` | RTC（MBC3）の時刻 | `app/src/emulator/cartridgeEffects.ts` |
| `loadRam(key): Uint8Array \| null` / `saveRam(key, ram)` | カートリッジのセーブ RAM | 同上 |
| `loadRTCState(key)` / `saveRTCState(key, state)` | MBC3 の RTC の状態 | 同上 |

### ゲームループ

`requestAnimationFrame` ではなく **音で駆動**している（`useAudioSync.ts`）。`stepUntilNextAudioBuffer()` → `playAudioSamples` の中で `AudioBufferSourceNode` を予約し、その再生開始の 15ms 前に次の `step` を `setTimeout` で予約する。このため:

- `AudioContext` はユーザー操作（クリック・タップ）の中で作る必要がある。iPhone では特に、操作なしの自動開始では音が鳴らず、ループも進まない可能性が高い。このアプリでは、起動時の自動読み込みのあとに「タップして開始」を 1 回挟む。一覧から ROM を選んだとき・ROM を追加したときは、そのクリックの中で `AudioContext` を用意するので読み込み後すぐに始まる（`app/src/session/useRomSession.ts`）。
- 開始してから ROM のプログラムが動き出すまで 1.7 秒ほどかかる（コアが起動 ROM のロゴ表示を再現しているため）。
- 一時停止は `playing=false` にしてループを止めるだけ。リセットは再生中なら次の step で行う（step の途中で `resetEmulator` しないため）。
- 本家は、メインスレッドが止まって次の再生時刻が今より過去になると、遅れを取り戻すまで step を待ちなしで続ける（ブラウザの `setTimeout` の下限の 4ms ごとに 1 バッファ＝約 10.7ms 分進むので、約 2 倍速になり、止まっていたのと同じくらいの時間続く）。このアプリでは、遅れが 0.1 秒を超えたら追いつかずに再生時刻を今に合わせ直す（遅れた分の音とゲームの進みは捨てる）。0.1 秒までの遅れは、音が途切れないよう本家どおり追いつく。
- 倍速（このアプリで足した。×1.5・×2）は、1 バッファ（512 サンプル＝ゲームの中の約 10.7ms）を `playbackRate` を速さにして鳴らし（高く速い音になる）、次の再生時刻を 10.7ms ÷ 速さだけ進める。コアには手を入れない（音のサンプルの数もそのまま）。遅れの合わせ直しは実時間で 0.1 秒のままなので、端末が追いつかないときは速さが落ちるだけで、止まったり、そのあと速すぎたりはしない。ゲーム内セーブの書き出し（10 秒ごと）は実時間のタイマーなので、倍速でも間隔は変わらない。

## セーブ RAM（ゲーム内セーブ）

以下は本家の仕組み。このアプリでの変更は「このアプリでは（②）」を参照。

- **保存先: `localStorage`**（IndexedDB ではない）。`app/src/emulator/cartridgeEffects.ts`（本家 `frontends/web/src/cartridgeEffects.ts`）。
- **キー: カートリッジヘッダのタイトル**（ROM の 0x134〜0x143、0x00 か CGB フラグの位置で打ち切り）。`src/address_bus/cartridge.rs` の `load_rom_buffer` で `cartridge.header.title` をキーに `load_ram` を呼ぶ。
- 値: RAM 全体を base64 にした文字列。
- RTC（MBC3）: キー `"<タイトル>-rtc"`、値は JSON（`milliseconds, seconds, minutes, hours, days, base_timestamp, halted, day_carry`）。`src/address_bus/mbc3.rs`。
- 保存のタイミング: バッテリー付きカートリッジ（`has_battery`）で RAM に書き込みがあるたびに `saveRam` が呼ばれ、JS 側で **2 秒の debounce** をかけて書き込む（MBC1/MBC3/MBC5/HuC1 の `write_ram`）。
- 復元のタイミング: `initializeEmulator` の中（ROM 読み込み時）に `loadRam(title)` が呼ばれる。保存が無ければ ROM ヘッダの RAM サイズで 0 埋めの RAM を作る。

### ROM ごとに分かれているか

**タイトル単位で分かれている。ROM の中身（ハッシュ）単位ではない。** 次の場合は混ざる・上書きされる:

- 同じタイトルの別 ROM（例: 同じゲームの版違い・地域違い、ヘッダのタイトルが空や同じ自作 ROM）は、同じセーブ RAM を共有する。
- タイトルが `settings` など、他の localStorage のキーと同じ場合もぶつかる（本家はキー設定を `settings` に保存していた。このアプリでは今のところ使っていない）。

ブラウザで確かめたこと（自作の 32KB テストプログラム、タイトル `SNAPTEST`、MBC1+RAM+BATTERY）:

- RAM に書いた 2 秒後、`localStorage["SNAPTEST"]` に 8192 バイト分（base64）が保存された。
- ページを再読み込みして同じ ROM を開始すると、`loadRam("SNAPTEST")` が呼ばれ保存した内容が戻った。

### このアプリでは（②）

`app/src/emulator/cartridgeEffects.ts`。コアは書き換えていない。

- **保存先は `localStorage` のまま**。コアは `loadRam` / `saveRam` を **同期**で呼ぶ（戻り値をその場で使う）ので、同期で読み書きできる localStorage が合う。閉じる直前の保存（下記）も同期で書き切れる。IndexedDB にすると「読み込み前にメモリへ用意し、書き込みは非同期」の仕組みが要り、閉じる直前に書き切れる保証も弱くなる。
- **キーを ROM の ID（中身の SHA-256）に読み替える**: コアが渡してくるタイトルは使わず、`initializeEmulator` の前に `setActiveRomId(id)` で決めた ID をキーにする。
  - セーブ RAM: `sram:<ROM の ID>`（値は本家と同じ base64）
  - RTC: `rtc:<ROM の ID>`（値は本家と同じ JSON）
  - これで同じタイトルの別 ROM も、ほかの localStorage のキーともぶつからない。
- 本家の形式（キー＝タイトル）のセーブは引き継がない（消しもしない）。① の時点ではまだ配信しておらず、実際のセーブは無いため。
- **保存のタイミング**: 本家の debounce はやめ、**10 秒ごとの固定間隔**で、書き込み待ちのあるキーだけを書き出す（変化が無ければ書かない）。セーブ RAM の base64 への変換と localStorage への書き込みは、多くても 10 秒に 1 回になる。debounce と違い、MBC3 の RTC のように書き込みが続いても書き出しが遅れ続けることはない。さらに `pagehide` と `visibilitychange`（hidden）で保留中の保存を即時に書き出す（iPhone でホームに戻す・アプリを閉じるとき）。ROM の切り替え・停止の前にも書き出す。書き出すキーはコアから呼ばれた時点で決めるので、切り替え後に前の ROM のセーブが新しい ROM に入ることはない。
- 保存の失敗（容量不足など）は画面に出し、書けなかった値は捨てずに次の保存で書き直す。
- **`saveRam` 1 回あたりの処理を小さくした**: コアは RAM に 1 バイト書くたびに `saveRam` を RAM 全体（WASM のメモリを指すだけの `Uint8Array`）で呼ぶ。ゲームは起動時の初期化やセーブのときに数 KB〜数十 KB をまとめて書くので、1 回の step の中で数千〜数万回呼ばれる。本家は lodash の debounce が呼び出しをまとめていた（変換は最後の 1 回だけ）ので重くなかったが、② では呼ばれるたびに RAM 全体を base64 にしていたため、8KB を書くだけで数十秒メインスレッドが止まった（CPU を 4 倍遅くした Chrome で 1 回 2.3ms × 8192 回。32KB・6 倍では 1 回 3.4ms × 32768 回）。本家の web フロントを同じテストプログラム・同じ条件で動かすと止まらず、こちらも `saveRam` の中身を空にするだけで止まらなくなった。コアからの受け渡し（WASM のメモリを指す `Uint8Array` を作るだけでコピーはしない）は重くない。いまは呼ばれたときは RAM の場所（WASM のメモリ内の位置と長さ）だけ覚え、その step が終わったあと（microtask）に 1 回だけ写して書き込み待ちにする。base64 にするのは localStorage に書き出すときだけ。`Uint8Array` をそのまま持たないのは、WASM のメモリが広がると読めなくなるため（`init()` の戻り値の `memory` から読み直す。`app/src/main.tsx` の `setWasmMemory`）。
- 保存が壊れていて読めない（base64 や JSON として読めない）ときは、元の値を `sram-corrupt:<ROM の ID>`（RTC は `rtc-corrupt:<ROM の ID>`）に退避し、画面で知らせてから空のセーブで始める（例外をコアに返すと WASM が止まるため）。退避できなかったときは、元データを上書きしないよう、そのゲームのセーブを保存しない。
- localStorage の容量は 1 オリジンあたり 5MB 程度。セーブ RAM は最大 128KB 程度（base64 で約 1.33 倍）なので数本〜十数本なら足りる。

ブラウザで確かめたこと（自作の 32KB テストプログラム 2 本。どちらもタイトル `SNAPTEST`、MBC1+RAM+BATTERY。起動のたびに RAM の先頭を 1 増やし、2 バイト目に ROM ごとの印を書く）:

- 再読み込みして開始すると、前回の値が `loadRam` で戻り、1 増えて保存された。
- （以下 2 つは ② の時点の debounce での確認。いまは 10 秒ごとの固定間隔）RAM に書かれてから 2 秒たつ前に再読み込みしても、`pagehide` で書き出された値が残った。
- 毎フレーム RAM に書くテストプログラムでは、`saveRam` が毎秒 57 回ほど呼ばれ続ける中で、約 10 秒ごとに書き込まれた。
- `sram:<ID>` を読めない値にして始めると、`sram-corrupt:<ID>` に元の値が残り、画面に知らせが出て、空のセーブで始まった。
- 2 本を交互に遊んでも、`sram:<A の ID>` と `sram:<B の ID>` に別々に保存され、混ざらなかった（本家の方式なら同じ `SNAPTEST` キーを共有していた）。

## セーブステート

- コアの `encodeSaveState()` がバイト列を返すだけで、**本家は端末内に保存しない**。`.rbs` ファイルとしてダウンロードし、ファイル選択で読み込んで `applySaveState()` に渡す（本家 `frontends/web/src/interface.tsx` の `saveState` / `handleLoadStateChange`）。このアプリもメニューの「セーブステート（ファイル）」で同じことができる（`app/src/emulator/saveState.ts`）。
- このアプリでは加えて、画面の「セーブ」で `encodeSaveState()` のバイト列を IndexedDB `retroboy-snap` の `saveStates` ストア（DB の版 2 で追加。キーは ROM の ID、ROM ごとに 1 件で上書き）に保存し、「ロード」で同じ `applySaveState()` に渡す。ファイルと同じく、6 バイト未満はコアに渡さない。書き込みと読み出しは 1 本の列に並べ、連打しても押した順に書き、ロードは手前のセーブの完了を待つ。同じレコードに、セーブを押した瞬間のゲーム画面（canvas の `toBlob()` で作った 160x144 の PNG のバイト列、`screenshot`）も入れ、ロードの確認に出す。値に足しただけなので DB の版は 2 のまま（足す前のセーブは `screenshot` が無く、確認は日時だけになる）。
- 形式（`src/emulator/save_state.rs`）: `"HEADER"` + 版（1 バイト、いまは 7）+ タイトル長（1 バイト）+ タイトル + `"STATE"` + エミュレーター全体の状態。
- 適用時にタイトルが今のゲームと違えばエラー（「This save state is meant to be used for a different game…」）。版が違ってもエラー。**本家のコミットを上げるとセーブステートの版が変わって古いものが読めなくなることがある**。
- セーブステートにはカートリッジ RAM も含まれ、適用すると RAM も巻き戻る（そのあと書き込みがあれば localStorage のセーブ RAM も上書きされる）。
- 設計書 9 章のとおり、セーブステートの自動保存・自動復元は今回の対象外。

## ROM 読み込みと切り替え時の初期化

本家の流れ（`frontends/web/src/interface.tsx`）:

1. ファイル選択 → `file.arrayBuffer()` → `Uint8Array`（本家 `bufferFileUpload.tsx` の `buildFileBufferObject`）。ファイル名が `.gbc` ならモードを CGB にする。
2. 「開始」で `AudioContext` を（無ければ）作り、`new EmulatorSettings(mode, sampleRate)` と ROM を `initializeEmulator` に渡す。
3. `error` があれば表示してリセット。`metadata` があれば `metadata.title` をゲームのキーにして再生開始。
4. ROM を替えるときは、いったん「リセット」→ `resetEmulator()`（エミュレーターを作り直す）→ ROM の選択を消す → 新しい ROM を選んで 2 から。

このアプリ（② 以降、`app/src/session/useRomSession.ts` と `app/src/storage/`）:

1. ROM の追加: ファイル選択 → 中身の SHA-256 を ID にして IndexedDB の `roms` に保存し、同じトランザクションで `settings` の `lastRomId` を更新 → 2 へ。同じ中身の ROM がすでにあれば保存し直さない（名前・登録日時も元のまま。保存済みのデータが壊れていたときだけ選び直したファイルで直す）。
2. `resetEmulator()` → `setActiveRomId(id)`（セーブのキー）→ `initializeEmulator`。モードは ROM ヘッダの CGB フラグ（0x143 の bit 7）か拡張子 `.gbc` なら CGB、それ以外は DMG（モードの選択欄は外した）。
3. 起動時: `lastRomId` の ROM を IndexedDB から読み、ID（SHA-256）が合うか確かめてから「タップして開始」を出す。ROM が無い・壊れている・読み込みや起動に失敗したときは、エラーと「再試行」を出し、一覧からの選び直しと ROM の追加ができる。
4. 一覧から選ぶと、その ROM を読んで `lastRomId` を更新し、すぐ始める。「止める」（本家のリセット）で同じ ROM の「タップして開始」に戻る。遊んでいる間は一覧と追加を押せない。

IndexedDB の形（データベース `retroboy-snap`、版 1）:

| ストア | キー | 中身 |
|---|---|---|
| `roms` | `id`（SHA-256、16 進） | `{ id, name, data: ArrayBuffer, createdAt }` |
| `settings` | `key` | `{ key: "lastRomId", value: <ROM の ID> }` |

版を上げるときは、`onupgradeneeded` で既存のストアを消さずに足すこと。

iOS ではバックグラウンドから戻ると接続が切れていることがある（`onclose` が来ないこともある）。`InvalidStateError` / `UnknownError` で失敗したら、接続を捨てて開き直し、1 回だけやり直す（`romDb.ts` の `withDb`）。

注意:

- `initializeEmulator` はエミュレーターを作り直さず、今のインスタンスに ROM を読み込み直す。本家は必ず `resetEmulator()` を挟んでから次の ROM を読むので、② の自動読み込みや ROM の切り替えでも **`resetEmulator()` → `initializeEmulator()` の順**を守るのが安全。
- 対応カートリッジは ROM のみ・MBC1・MBC3・MBC5・HuC1。それ以外はエラー文が返る（`src/address_bus/cartridge.rs`）。ヘッダより短いファイルもエラー。
- ヘッダの RAM サイズ（0x149）が 0〜5 以外で、保存したセーブ RAM も無いと、エラーを返さず panic する（`set_ram_size`）。このアプリでは `initializeEmulator` の前に JS 側で弾いている。
- `applySaveState` は 6 バイト未満のデータを渡すと長さを確かめる前にスライスして panic する（`src/emulator/save_state.rs`）。panic すると WASM の状態が壊れるので、このアプリでは 6 バイト未満なら渡さずにエラーを出す（`app/src/emulator/saveState.ts`）。
- `resetEmulator()` は保留中の `saveRam`（debounce 中）を消さない。debounce はキーを引数で持つので、切り替え後に前の ROM のキーで保存されるだけで、混ざることはない（このアプリでは切り替え前に書き出している）。

## ③ で使えるもの

- 状態とロジック: `app/src/session/useRomSession.ts` の戻り値（`status` と操作の関数）だけで画面を作れる。`App.tsx` は見た目だけなので、まるごと差し替えてよい。`status.kind` は `booting` / `noRom` / `loading` / `ready`（タップして開始）/ `running`（`paused` あり）/ `error`（`retry` あり）。
- 「ROM を追加」のボタンでは、ファイル選択を開く前に `unlockAudio()` を呼ぶ（保存後すぐに始められるように）。

- 画面: `GameScreen.tsx` は 160×144 の canvas を親の大きさいっぱいに表示するだけ（`image-rendering: pixelated`）。大きさは `app/src/ui/GbcBody.tsx` の画面枠が決める（1 ドットが実際の画面の整数個のピクセルになる大きさ）。
- 入力: `pressKey` / `releaseKey` にボタン名を渡せばよい。タッチボタンは pointerdown/pointerup でこれを呼ぶ。キーボードの割り当ては `useKeyListeners.ts` の `keyMap`。
- 本家のタッチ用ゲームパッドは `frontends/web/src/components/gamePad.tsx`（MUI 依存）。参考程度。
