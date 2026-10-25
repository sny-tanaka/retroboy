// 通信ケーブルの試験: 1 つのプロセスに 2 台のエミュレーターを作り、通信テスト ROM
// （testroms/link/linktest.gb、ソースは隣の link.asm）を動かして直結する。
// 2 台の間を流れたバイト（親機の Transfer と子機の Reply）が、ROM の決めた並びになっているかを確かめる。
// ROM は受け取った値から次に送る値を決めるので、並びが合っていれば、両方が正しく受け取れている。
//
// 環境変数 LINK_TEST_DUMP=<フォルダ> を付けると、各試験の終わりの 2 台の画面を PPM で書き出す（目で確かめる用）。
use retroboy::emulator::{CartridgeEffects, Emulator, Key, LinkEvent, LinkStepResult, RTCState};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;

const T_CYCLES_PER_FRAME: u64 = 70_224;

const FIRST_MASTER_BYTE: u8 = 0x01;
const FIRST_SLAVE_BYTE: u8 = 0x5A;
const SLAVE_XOR: u8 = 0xA5;

struct NoCartridgeEffects;

impl CartridgeEffects for NoCartridgeEffects {
    fn current_time_millis(&self) -> f64 {
        0.0
    }
    fn load_rtc_state(&self, _: &str) -> Option<RTCState> {
        None
    }
    fn save_rtc_state(&self, _: &str, _: &RTCState) {}
    fn load_ram(&self, _: &str) -> Option<Vec<u8>> {
        None
    }
    fn save_ram(&self, _: &str, _: &[u8]) {}
}

thread_local! {
    // canvasRender に当たる関数はただの fn なので、どちらの台の画面かをここで切り替える
    static CURRENT_SIDE: Cell<usize> = const { Cell::new(0) };
    static FRAMES: RefCell<[Vec<u8>; 2]> = const { RefCell::new([Vec::new(), Vec::new()]) };
}

fn render(frame: &[u8]) {
    let side = CURRENT_SIDE.with(|side| side.get());
    FRAMES.with(|frames| frames.borrow_mut()[side] = frame.to_vec());
}

fn test_rom() -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../testroms/link/linktest.gb");
    std::fs::read(&path).unwrap_or_else(|_| {
        panic!("{} がありません。scripts/build-testroms.sh でビルドしてください", path.display())
    })
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Sent {
    Transfer(u8),
    Reply(u8),
}

struct Side {
    emulator: Emulator,
    // この台が送ったもの（seq ごと）。親機の Transfer と子機の Reply
    sent: Vec<(u32, Sent)>,
}

struct Link {
    sides: [Side; 2],
}

impl Link {
    fn new(cgb: bool) -> Link {
        let rom = test_rom();
        let make = |index: usize| {
            CURRENT_SIDE.with(|side| side.set(index));
            let mut emulator = Emulator::new(render, false);
            emulator.set_cgb_mode(cgb);
            emulator.load_rom(&rom, Box::new(NoCartridgeEffects)).unwrap();
            emulator.set_link_connected(true);
            Side { emulator, sent: Vec::new() }
        };
        Link { sides: [make(0), make(1)] }
    }

    fn clock(&self, index: usize) -> u64 {
        self.sides[index].emulator.link_clock()
    }

    // index の台を limit まで（返事待ちならそこまで）進める。送るものは、すぐ相手に渡す
    fn run_side(&mut self, index: usize, limit: u64) {
        CURRENT_SIDE.with(|side| side.set(index));
        loop {
            let result = self.sides[index].emulator.step_link(limit);
            match result {
                LinkStepResult::AudioBufferFull => self.sides[index].emulator.clear_audio_buffers(),
                LinkStepResult::EventPending => {
                    let event = self.sides[index].emulator.take_link_event().unwrap();
                    let other = &mut self.sides[1 - index].emulator;
                    let sent = match event {
                        LinkEvent::Transfer { seq, at, byte } => {
                            other.deliver_link_transfer(seq, at, byte);
                            (seq, Sent::Transfer(byte))
                        },
                        LinkEvent::Reply { seq, byte } => {
                            other.deliver_link_reply(seq, byte);
                            (seq, Sent::Reply(byte))
                        },
                    };
                    self.sides[index].sent.push(sent);
                },
                LinkStepResult::WaitingReply | LinkStepResult::ReachedLimit => return,
            }
        }
    }

    // 2 台を、どちらも相手より quantum より先には進まないように、交互に end まで進める。
    // quantum が小さいほど 2 台の時刻がそろう（大きいと、子機が相手の送り始めより先に進んでいて、遅れて受け取る）
    fn run_until(&mut self, end: u64, quantum: u64) {
        let mut stalled_rounds = 0;
        while self.clock(0) < end || self.clock(1) < end {
            let before = (self.clock(0), self.clock(1));
            for index in 0..2 {
                let limit = (self.clock(1 - index) + quantum).min(end);
                self.run_side(index, limit);
            }
            if (self.clock(0), self.clock(1)) == before {
                stalled_rounds += 1;
                assert!(stalled_rounds < 3, "2 台とも進まない（時刻 {:?}）", before);
            } else {
                stalled_rounds = 0;
            }
        }
    }

    fn run_frames(&mut self, frames: u64, quantum: u64) {
        let end = self.clock(0).max(self.clock(1)) + frames * T_CYCLES_PER_FRAME;
        self.run_until(end, quantum);
    }

    // ボタンを数フレーム押して離す（ROM はフレームごとに読む）
    fn press(&mut self, index: usize, key: Key) {
        self.sides[index].emulator.handle_key_press(&key);
        self.run_frames(4, 64);
        self.sides[index].emulator.handle_key_release(&key);
        self.run_frames(4, 64);
    }

    // 親機（master）が送った Transfer と、子機が返した Reply を seq でつないだ並び
    fn exchanges(&self, master: usize) -> Vec<(u8, u8)> {
        let replies: HashMap<u32, u8> = self.sides[1 - master]
            .sent
            .iter()
            .filter_map(|(seq, sent)| match sent {
                Sent::Reply(byte) => Some((*seq, *byte)),
                _ => None,
            })
            .collect();
        self.sides[master]
            .sent
            .iter()
            .filter_map(|(seq, sent)| match sent {
                Sent::Transfer(byte) => replies.get(seq).map(|reply| (*byte, *reply)),
                _ => None,
            })
            .collect()
    }

    fn clear_sent(&mut self) {
        for side in self.sides.iter_mut() {
            side.sent.clear();
        }
    }

    fn dump_screens(&self, name: &str) {
        let Ok(dir) = std::env::var("LINK_TEST_DUMP") else { return };
        std::fs::create_dir_all(&dir).unwrap();
        FRAMES.with(|frames| {
            for (index, frame) in frames.borrow().iter().enumerate() {
                if frame.is_empty() {
                    continue;
                }
                let mut ppm = b"P6\n160 144\n255\n".to_vec();
                for pixel in frame.chunks(4) {
                    ppm.extend_from_slice(&pixel[..3]);
                }
                std::fs::write(format!("{}/{}-{}.ppm", dir, name, index), ppm).unwrap();
            }
        });
    }
}

// 並びが ROM の式（m(0) = $01, s(0) = $5A, m(k+1) = s(k) + 1, s(k+1) = m(k) xor $A5）どおりか
fn assert_chain(exchanges: &[(u8, u8)]) {
    assert!(!exchanges.is_empty(), "1 バイトも受け渡していない");
    assert_eq!(exchanges[0], (FIRST_MASTER_BYTE, FIRST_SLAVE_BYTE), "最初の受け渡し");
    for k in 1..exchanges.len() {
        let (previous_sent, previous_reply) = exchanges[k - 1];
        let (sent, reply) = exchanges[k];
        assert_eq!(sent, previous_reply.wrapping_add(1), "{} 回目に親機が送った値", k);
        assert_eq!(reply, previous_sent ^ SLAVE_XOR, "{} 回目に子機が返した値", k);
    }
}

// 起動 ROM が終わってテスト ROM が動き出すまで（GB で約 1.7 秒、GBC はロゴの動きが長く約 3 秒）
const BOOT_FRAMES: u64 = 240;

fn start_master_and_slave(link: &mut Link) {
    link.press(1, Key::B);
    link.press(0, Key::A);
}

#[test]
fn exchanges_bytes_between_master_and_slave() {
    let mut link = Link::new(false);
    link.run_frames(BOOT_FRAMES, 64);
    start_master_and_slave(&mut link);
    link.run_frames(60, 64);
    link.dump_screens("dmg");

    let exchanges = link.exchanges(0);
    assert_chain(&exchanges);
    // 通常クロックは 1 バイト約 1ms（実機どおりの速さ）。ROM は転送ごとに 512 M サイクルほど空けるので
    // 1 秒に 600 バイトほど
    assert!(exchanges.len() > 500, "1 秒で {} バイト", exchanges.len());
}

#[test]
fn exchanges_bytes_with_fast_clock_in_double_speed_mode() {
    let mut link = Link::new(true);
    link.run_frames(BOOT_FRAMES, 64);
    for index in 0..2 {
        link.press(index, Key::Select);
        link.press(index, Key::Start);
    }
    start_master_and_slave(&mut link);
    link.run_frames(60, 64);
    link.dump_screens("cgb-fast-double");

    let exchanges = link.exchanges(0);
    assert_chain(&exchanges);
    // 高速クロックは 1 バイト 32 M サイクル。ROM が転送ごとに空ける 512 M サイクルほどが大半を占め、
    // 倍速モードで 1 秒に 3,000 バイトほど
    assert!(exchanges.len() > 2500, "1 秒で {} バイト", exchanges.len());
}

#[test]
fn exchanges_bytes_when_slave_runs_ahead() {
    let mut link = Link::new(false);
    link.run_frames(BOOT_FRAMES, 64);
    start_master_and_slave(&mut link);
    link.clear_sent();
    // 互いに 1 フレーム近く先まで進んでよいことにする（子機は、相手の送り始めより先に進んでいることが多くなる）
    link.run_frames(60, T_CYCLES_PER_FRAME);

    let exchanges = link.exchanges(0);
    assert!(exchanges.len() > 100, "1 秒で {} バイト", exchanges.len());
    // 途中から数えるので、最初の 1 組とのつながりは見ない
    for k in 1..exchanges.len() {
        let (previous_sent, previous_reply) = exchanges[k - 1];
        assert_eq!(exchanges[k], (previous_reply.wrapping_add(1), previous_sent ^ SLAVE_XOR), "{} 回目", k);
    }
}

#[test]
fn decides_roles_in_auto_mode() {
    let mut link = Link::new(false);
    link.run_frames(BOOT_FRAMES, 64);
    link.press(0, Key::Up);
    link.press(1, Key::Up);
    link.run_frames(240, 64);
    link.dump_screens("auto");

    // 親機を試した側の Transfer のうち、返事が $5A だったものから先が本番の並び
    let master = if link.exchanges(0).iter().any(|exchange| *exchange == (FIRST_MASTER_BYTE, FIRST_SLAVE_BYTE)) { 0 } else { 1 };
    let exchanges = link.exchanges(master);
    let start = exchanges
        .iter()
        .position(|exchange| *exchange == (FIRST_MASTER_BYTE, FIRST_SLAVE_BYTE))
        .expect("どちらも親機になれなかった");
    assert_chain(&exchanges[start..]);
    assert!(exchanges.len() - start > 500, "{} バイト", exchanges.len() - start);
    assert!(link.exchanges(1 - master).iter().all(|(sent, _)| *sent == FIRST_MASTER_BYTE), "子機になった側は親機を試しただけ");
}

#[test]
fn master_receives_zero_when_other_side_is_not_ready() {
    let mut link = Link::new(false);
    link.run_frames(BOOT_FRAMES, 64);
    link.press(0, Key::A);
    link.run_frames(10, 64);

    let exchanges = link.exchanges(0);
    assert!(!exchanges.is_empty());
    assert!(exchanges.iter().all(|(_, reply)| *reply == 0x00), "{:?}", &exchanges[..4.min(exchanges.len())]);
}

// つないでいないときは今までどおり（step_until_next_audio_buffer で進み、相手に送るものは出ない）
#[test]
fn does_not_send_link_events_when_not_connected() {
    let rom = test_rom();
    let mut emulator = Emulator::new(render, false);
    emulator.load_rom(&rom, Box::new(NoCartridgeEffects)).unwrap();
    for _ in 0..BOOT_FRAMES {
        emulator.step_until_next_audio_buffer();
    }
    emulator.handle_key_press(&Key::A);
    for _ in 0..200 {
        emulator.step_until_next_audio_buffer();
    }
    assert!(!emulator.link_connected());
    assert_eq!(emulator.take_link_event(), None);
}
