# Retro Boy 本家の調査メモ

② (ROM の IndexedDB 保存と自動読み込み) と ③ (UI の作り直し) の作業者向け。

- 対象: [smparsons/retroboy](https://github.com/smparsons/retroboy) コミット `edf90d9fb192372a657a18d44f5c9841805fa554`（2026-03-01、`vendor/retroboy` に submodule で固定）
- 以下のパスは特に断りがなければ `vendor/retroboy/` からの相対パス。

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

- `AudioContext` はユーザー操作（クリック・タップ）の中で作る必要がある。iPhone では特に、操作なしの自動開始では音が鳴らず、ループも進まない可能性が高い（② の自動読み込みで要確認。「タップして開始」を挟むのが安全）。
- 一時停止は `playing=false` にしてループを止めるだけ。リセットは再生中なら次の step で行う（step の途中で `resetEmulator` しないため）。

## セーブ RAM（ゲーム内セーブ）

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

### ② で気をつけること

- 設計書 3 章は「既存の保存機構を優先し、IndexedDB 以外なら必要最小限の変更」としている。コアは `loadRam` / `saveRam` を **同期**で呼ぶ（戻り値をその場で使う）ので、IndexedDB（非同期）に置き換える場合は「ROM を読み込む前に IndexedDB から読んでメモリに用意しておき、`loadRam` はそれを同期で返す」「`saveRam` はメモリを更新して非同期で IndexedDB に書く」形になる。
- ROM ごとに分けたいなら、JS 側で `loadRam`/`saveRam` に渡されたキー（タイトル）を、いま読み込んでいる ROM の ID（SHA-256）に読み替えるのがコアを書き換えずに済む方法。ただし既存の localStorage のセーブ（キー＝タイトル）からの移行を考える必要がある。
- debounce が 2 秒なので、セーブ直後にアプリを閉じる（iPhone でホーム画面に戻してタスクを切る）と最後の書き込みが失われうる。`pagehide` / `visibilitychange` で保留中の保存を即時実行するとよい（今の debounce は flush を持っていない）。
- localStorage の容量は 1 オリジンあたり 5MB 程度。セーブ RAM は最大 128KB 程度（base64 で約 1.33 倍）なので数本〜十数本なら足りる。

## セーブステート

- コアの `encodeSaveState()` がバイト列を返すだけで、**本家は端末内に保存しない**。`.rbs` ファイルとしてダウンロードし、ファイル選択で読み込んで `applySaveState()` に渡す（本家 `frontends/web/src/interface.tsx` の `saveState` / `handleLoadStateChange`）。このアプリも同じ（`app/src/emulator/saveState.ts`）。
- 形式（`src/emulator/save_state.rs`）: `"HEADER"` + 版（1 バイト、いまは 7）+ タイトル長（1 バイト）+ タイトル + `"STATE"` + エミュレーター全体の状態。
- 適用時にタイトルが今のゲームと違えばエラー（「This save state is meant to be used for a different game…」）。版が違ってもエラー。**本家のコミットを上げるとセーブステートの版が変わって古いものが読めなくなることがある**。
- セーブステートにはカートリッジ RAM も含まれ、適用すると RAM も巻き戻る（そのあと書き込みがあれば localStorage のセーブ RAM も上書きされる）。
- 設計書 9 章のとおり、セーブステートの自動保存・自動復元は今回の対象外。

## ROM 読み込みと切り替え時の初期化

本家の流れ（`frontends/web/src/interface.tsx`）と、このアプリ（`app/src/App.tsx`）の流れは同じ:

1. ファイル選択 → `file.arrayBuffer()` → `Uint8Array`（本家 `bufferFileUpload.tsx` の `buildFileBufferObject`）。ファイル名が `.gbc` ならモードを CGB にする。
2. 「開始」で `AudioContext` を（無ければ）作り、`new EmulatorSettings(mode, sampleRate)` と ROM を `initializeEmulator` に渡す。
3. `error` があれば表示してリセット。`metadata` があれば `metadata.title` をゲームのキーにして再生開始。
4. ROM を替えるときは、いったん「リセット」→ `resetEmulator()`（エミュレーターを作り直す）→ ROM の選択を消す → 新しい ROM を選んで 2 から。

注意:

- `initializeEmulator` はエミュレーターを作り直さず、今のインスタンスに ROM を読み込み直す。本家は必ず `resetEmulator()` を挟んでから次の ROM を読むので、② の自動読み込みや ROM の切り替えでも **`resetEmulator()` → `initializeEmulator()` の順**を守るのが安全。
- 対応カートリッジは ROM のみ・MBC1・MBC3・MBC5・HuC1。それ以外はエラー文が返る（`src/address_bus/cartridge.rs`）。ヘッダより短いファイルもエラー。
- `applySaveState` は 6 バイト未満のデータを渡すと長さを確かめる前にスライスして panic する（`src/emulator/save_state.rs`）。panic すると WASM の状態が壊れるので、ファイルを渡す前に JS 側で長さを確かめるとよい。
- `resetEmulator()` は保留中の `saveRam`（debounce 中）を消さない。debounce はキーを引数で持つので、切り替え後に前の ROM のキーで保存されるだけで、混ざることはない。

## ③ で使えるもの

- 画面: `GameScreen.tsx` は 160×144 の canvas を `scale` 倍で表示するだけ。CSS は自由に替えてよい（`image-rendering: pixelated` は残す）。
- 入力: `pressKey` / `releaseKey` にボタン名を渡せばよい。タッチボタンは pointerdown/pointerup でこれを呼ぶ。キーボードの割り当ては `useKeyListeners.ts` の `keyMap`。
- 本家のタッチ用ゲームパッドは `frontends/web/src/components/gamePad.tsx`（MUI 依存）。参考程度。
