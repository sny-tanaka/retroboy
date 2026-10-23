// 本家 Retro Boy のコアをリンクするだけ。#[wasm_bindgen] の関数は本家のクレート側にあり、
// リンクされればこの cdylib からそのまま export される。
// コードから使っていない依存はリンクされないので、extern crate で明示する。
extern crate retroboy;
