// JS（app/src/gba/gbaCore.ts）から呼ぶ mGBA の口。scripts/build-mgba.sh が libmgba.a と一緒に WASM にする。
// mGBA の libretro の口（src/platform/libretro/libretro.c）と同じ使い方を、要るものだけに絞って書いた。
//
// - スレッドは使わない（mGBA はパッチで DISABLE_THREADING にしてある）。1 回の gba_run_frame で 1 フレーム進める。
// - 絵: 240x160 の RGBA（canvas の ImageData にそのまま渡せる並び）。
// - 音: 左右の float の列。1 フレーム進めるたびに、そのフレームの分を読み出しておく（gba_audio_*）。
// - ゲーム内セーブ: 128KB（フラッシュ 1M の大きさ）の領域を mGBA に渡し、ゲームはそこへ直に書く。
//   JS は gba_save_data / gba_save_size で中身を読み、変わっていれば保存する。読み込むときは gba_load に渡す。
// - セーブステート: mGBA の形式（RTC を含める）。ファイルに書き出す（.ss1）ときはゲーム内セーブも含める
//   （別の端末へ引っ越せるように）。端末の中の枠には含めない（ロードでゲーム内セーブが巻き戻らないように）。
// - 通信ケーブル: いちばん下の gba_link_*（docs/link-cable-design.md 8 章）。
#include <stdlib.h>
#include <string.h>

#include <emscripten/emscripten.h>

#include <mgba/core/blip_buf.h>
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <mgba/core/serialize.h>
#include <mgba/internal/arm/arm.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/gba/io.h>
#include <mgba/internal/gba/sio.h>
#include <mgba/internal/gba/video.h>
#include <mgba-util/memory.h>
#include <mgba-util/vfs.h>

#define WIDTH 240
#define HEIGHT 160
#define SAVE_MAX SIZE_CART_FLASH1M
// 1 フレームの音は 48kHz で 800 ほど。余裕を持たせる
#define AUDIO_MAX 4096

static struct mCore* core;
static color_t video[WIDTH * HEIGHT];
static uint32_t rgba[WIDTH * HEIGHT];
static uint8_t* rom;
static uint8_t* savedata;
static int16_t audioTemp[AUDIO_MAX];
static float audioLeft[AUDIO_MAX];
static float audioRight[AUDIO_MAX];
static uint8_t* stateBuffer;

// mGBA のログは出さない（ゲームによっては 1 フレームに何度も出て遅くなる）
static void quietLog(struct mLogger* logger, int category, enum mLogLevel level, const char* format, va_list args) {
	(void) logger;
	(void) category;
	(void) level;
	(void) format;
	(void) args;
}
static struct mLogger logger = { .log = quietLog };

static void linkForget(void);

EMSCRIPTEN_KEEPALIVE void gba_unload(void) {
	linkForget();
	if (core) {
		mCoreConfigDeinit(&core->config);
		core->deinit(core);
		core = NULL;
	}
	free(rom);
	rom = NULL;
	free(savedata);
	savedata = NULL;
	free(stateBuffer);
	stateBuffer = NULL;
}

// JS が ROM（と、あればゲーム内セーブ）を書き込む場所を用意する。戻り値の先に romSize バイトを書いてから gba_load を呼ぶ
EMSCRIPTEN_KEEPALIVE uint8_t* gba_alloc_rom(size_t romSize) {
	gba_unload();
	rom = malloc(romSize);
	savedata = malloc(SAVE_MAX);
	if (savedata) memset(savedata, 0xFF, SAVE_MAX);
	return rom;
}

EMSCRIPTEN_KEEPALIVE uint8_t* gba_save_buffer(void) {
	return savedata;
}

// 0 で成功。saveSize はセーブの領域（gba_save_buffer）の先頭に書いておいたゲーム内セーブの長さ（無ければ 0）
EMSCRIPTEN_KEEPALIVE int gba_load(size_t romSize, int sampleRate) {
	if (!rom || !savedata) return 1;
	mLogSetDefaultLogger(&logger);
	struct VFile* romFile = VFileFromMemory(rom, romSize);
	if (!romFile) return 2;
	core = mCoreFindVF(romFile);
	if (!core || core->platform(core) != mPLATFORM_GBA) {
		romFile->close(romFile);
		core = NULL;
		return 3;
	}
	mCoreInitConfig(core, NULL);
	core->init(core);
	core->setVideoBuffer(core, video, WIDTH);
	// 1 フレームの音の 2 倍（libretro と同じ）
	size_t samplesPerFrame = (size_t) ((float) sampleRate * core->frameCycles(core) / core->frequency(core));
	core->setAudioBufferSize(core, samplesPerFrame * 2);
	blip_set_rates(core->getAudioChannel(core, 0), core->frequency(core), sampleRate);
	blip_set_rates(core->getAudioChannel(core, 1), core->frequency(core), sampleRate);
	if (!core->loadROM(core, romFile)) {
		gba_unload();
		return 4;
	}
	struct VFile* saveFile = VFileFromMemory(savedata, SAVE_MAX);
	if (!core->loadSave(core, saveFile)) {
		saveFile->close(saveFile);
	}
	core->reset(core);
	return 0;
}

// ボタンの集まり（ビット: A 0・B 1・SELECT 2・START 3・右 4・左 5・上 6・下 7・R 8・L 9）
EMSCRIPTEN_KEEPALIVE void gba_set_keys(uint32_t keys) {
	if (core) core->setKeys(core, keys);
}

// たまっている音を gba_audio_left/right に読み出す。戻り値はサンプルの数（左右それぞれ）
static int takeAudio(void) {
	blip_t* left = core->getAudioChannel(core, 0);
	blip_t* right = core->getAudioChannel(core, 1);
	int available = blip_samples_avail(left);
	if (available > AUDIO_MAX) available = AUDIO_MAX;
	int produced = blip_read_samples(left, audioTemp, available, false);
	for (int i = 0; i < produced; ++i) audioLeft[i] = audioTemp[i] / 32768.0f;
	blip_read_samples(right, audioTemp, produced, false);
	for (int i = 0; i < produced; ++i) audioRight[i] = audioTemp[i] / 32768.0f;
	return produced;
}

// 1 フレーム進める。戻り値はこのフレームでできた音のサンプルの数（左右それぞれ。gba_audio_left/right に入る）
EMSCRIPTEN_KEEPALIVE int gba_run_frame(void) {
	if (!core) return 0;
	core->runFrame(core);
	return takeAudio();
}

EMSCRIPTEN_KEEPALIVE float* gba_audio_left(void) {
	return audioLeft;
}

EMSCRIPTEN_KEEPALIVE float* gba_audio_right(void) {
	return audioRight;
}

// いまの絵（240x160 の RGBA）。mGBA の 32 ビットの色は下位から R・G・B なので、不透明の A を足すだけ
EMSCRIPTEN_KEEPALIVE uint32_t* gba_video(void) {
	for (int i = 0; i < WIDTH * HEIGHT; ++i) rgba[i] = video[i] | 0xFF000000u;
	return rgba;
}

// 1 秒あたりのフレームの数 × 1000（等速の割合を出すのに使う。GBA は 59727 ほど）
EMSCRIPTEN_KEEPALIVE int gba_frame_rate_milli(void) {
	if (!core) return 0;
	return (int) ((double) core->frequency(core) * 1000.0 / core->frameCycles(core));
}

// ゲーム内セーブの長さ。まだセーブの種類が決まっていない（一度もセーブを使っていない）・セーブの無いゲームは 0
EMSCRIPTEN_KEEPALIVE size_t gba_save_size(void) {
	if (!core) return 0;
	struct GBA* gba = core->board;
	switch (gba->memory.savedata.type) {
	case SAVEDATA_AUTODETECT:
	case SAVEDATA_FORCE_NONE:
		return 0;
	default:
		return GBASavedataSize(&gba->memory.savedata);
	}
}

// ゲームのタイトル（ヘッダの 12 文字）。buffer は 16 バイト以上
EMSCRIPTEN_KEEPALIVE void gba_title(char* buffer) {
	memset(buffer, 0, 16);
	if (core) core->getGameTitle(core, buffer);
}

// セーブステートを作る。withSave が 0 でなければゲーム内セーブも含める。戻り値は長さ（失敗なら 0）。
// 中身は gba_state_buffer の先（次の gba_state_save まで有効）
EMSCRIPTEN_KEEPALIVE size_t gba_state_save(int withSave) {
	if (!core) return 0;
	free(stateBuffer);
	stateBuffer = NULL;
	struct VFile* vf = VFileMemChunk(NULL, 0);
	if (!vf) return 0;
	size_t size = 0;
	if (mCoreSaveStateNamed(core, vf, SAVESTATE_RTC | (withSave ? SAVESTATE_SAVEDATA : 0))) {
		size = vf->size(vf);
		stateBuffer = malloc(size);
		if (stateBuffer) {
			vf->seek(vf, 0, SEEK_SET);
			vf->read(vf, stateBuffer, size);
		} else {
			size = 0;
		}
	}
	vf->close(vf);
	return size;
}

EMSCRIPTEN_KEEPALIVE uint8_t* gba_state_buffer(void) {
	return stateBuffer;
}

// JS がセーブステートを書き込む場所を用意する
EMSCRIPTEN_KEEPALIVE uint8_t* gba_state_alloc(size_t size) {
	free(stateBuffer);
	stateBuffer = malloc(size);
	return stateBuffer;
}

// gba_state_alloc の先に書いたセーブステートに、ゲーム内セーブが含まれているか（1 で含まれている）
EMSCRIPTEN_KEEPALIVE int gba_state_has_save(size_t size) {
	if (!core || !stateBuffer) return 0;
	struct VFile* vf = VFileFromConstMemory(stateBuffer, size);
	if (!vf) return 0;
	struct mStateExtdata extdata;
	mStateExtdataInit(&extdata);
	struct mStateExtdataItem item;
	bool has = mCoreExtractExtdata(core, vf, &extdata) && mStateExtdataGet(&extdata, EXTDATA_SAVEDATA, &item) && item.data;
	mStateExtdataDeinit(&extdata);
	vf->close(vf);
	return has ? 1 : 0;
}

// gba_state_alloc の先に書いたセーブステートを読む。withSave が 0 でなければ、含まれているゲーム内セーブも
// いまのゲーム内セーブ（gba_save_buffer）に書き込む。戻り値: 0 失敗、1 成功、2 状態は読めたがゲーム内セーブは
// 書き込めなかった。
// mCoreLoadStateNamed は使わない。あれはゲーム内セーブが含まれていると、置き換えないときも mGBA の中で
// 一時的に差し替える（GBASavedataMask。ゲームが書いたセーブが gba_save_buffer に届かなくなる）ため。
// 状態と RTC の読み方は mCoreLoadStateNamed（src/core/serialize.c）と同じ
EMSCRIPTEN_KEEPALIVE int gba_state_load(size_t size, int withSave) {
	if (!core || !stateBuffer) return 0;
	struct VFile* vf = VFileFromConstMemory(stateBuffer, size);
	if (!vf) return 0;
	struct mStateExtdata extdata;
	mStateExtdataInit(&extdata);
	void* state = mCoreExtractState(core, vf, &extdata);
	vf->close(vf);
	if (!state) {
		mStateExtdataDeinit(&extdata);
		return 0;
	}
	bool ok = core->loadState(core, state);
	mappedMemoryFree(state, core->stateSize(core));
	int result = ok ? 1 : 0;
	struct mStateExtdataItem item;
	if (ok && withSave && mStateExtdataGet(&extdata, EXTDATA_SAVEDATA, &item) && item.data) {
		if (!core->savedataRestore(core, item.data, item.size, true)) result = 2;
	}
	if (ok && mStateExtdataGet(&extdata, EXTDATA_RTC, &item) && core->rtc.d.deserialize) {
		core->rtc.d.deserialize(&core->rtc.d, &item);
	}
	mStateExtdataDeinit(&extdata);
	return result;
}

// ---- 通信ケーブル（docs/link-cable-design.md 8 章）----
//
// Game Boy（core/patches/0003）と同じ形: 2 台が互いのゲーム内の時刻を送り合い、相手より進みすぎないよう止まり
// ながら、転送の中身を渡し合う。進みを合わせるのは JS（app/src/link/linkSession.ts）で、ここは次をする。
//
// - mGBA の SIO のドライバー（GBASIODriver。本家の公開の口）を、ノーマルモード（8 ビット・32 ビット）に差す。
//   マルチプレイ・UART・JOY BUS は今は差さない（本家のダミーのまま＝つながっていないのと同じ）。
// - 親機（内部クロック。SIOCNT の bit 0 = 1）が転送を始めたら、中身と「相手が受け取る時刻」（始め＋転送の長さ）を
//   送るものに積む。転送の長さが過ぎたとき、子機の返事が来ていれば受け取って終える。来ていなければ CPU を止めて
//   JS に戻り（返事待ち）、返事が届いたら終える。ビットを 1 つずつはずらさない（転送の単位でまとめて受け渡す）。
// - 子機（外部クロック）は、届いた転送を時刻 at に受け取る（もう過ぎていればすぐ）。受ける用意（SIOCNT の bit 7）が
//   あれば自分のデータを返事にし、相手のデータを受け取って割り込みを立てる。用意が無い・自分も親機なら、自分の
//   データは変えずに全部 1（つながっていないのと同じ）を返す。
// - SO（SIOCNT の bit 3。止まっている間の SO の高さ）が変わったら相手に送り、相手の SI（bit 2）にする。ゲームが
//   「子機の用意ができた」を知らせ合うのに使う。
// - 時刻は通信用の時刻（GBA のサイクル。16.78MHz）。つないだときを 0 にする。double で持つ（2^53 まで正確）。
//
// どれもセーブステートには入れない（つないでいる間はロードできないようにしてある。アプリ側）。

// gba_link_step の戻り値（Game Boy の linkStep と同じ番号）
enum {
	LINK_STEP_FRAME = 0, // 1 フレーム進んだ（gba_take_audio で音を読む）
	LINK_STEP_EVENT = 1, // 相手に送るものができた（gba_link_take_event）
	LINK_STEP_WAITING_REPLY = 2, // 親機で、返事を待っている
	LINK_STEP_LIMIT = 3, // 時刻が limit に着いた
};
// 送るもの・届いたものの種類
enum {
	LINK_EVENT_TRANSFER = 0,
	LINK_EVENT_REPLY = 1,
	LINK_EVENT_SO = 2,
};
// 積んでおける数。進みを合わせているので、ふつうは 1〜2 個しかたまらない
#define LINK_QUEUE 32

struct LinkItem {
	int kind;
	uint32_t seq;
	double at;
	uint32_t data;
	int bits; // TRANSFER: 8 か 32。SO: 高さ（0 か 1）
};

struct LinkQueue {
	struct LinkItem items[LINK_QUEUE];
	int head;
	int count;
};

static struct {
	struct GBASIODriver d;
	bool connected;
	// 通信用の時刻: 最後に測ったときの時刻と、そのときの mGBA の時刻（32 ビットで回るので差だけを使う）
	double clockBase;
	uint32_t sampledAt;
	// 1 フレームの区切りを見る（本家の _GBACoreRunFrame と同じ見方）
	uint32_t frameCounter;
	uint32_t frameStart;
	struct LinkQueue outgoing;
	// 届いた転送と SO。届いた順に、それぞれの時刻に受け取る
	struct LinkQueue incoming;
	struct mTimingEvent incomingEvent;
	// 子機として前に受け取った時刻と、そのときの親機の時刻（続けて遅れて届いたときに間を空ける）
	bool received;
	double lastReceivedAt;
	double lastMasterAt;
	// 親機の転送
	bool masterActive;
	uint32_t masterSeq;
	bool replyReady;
	uint32_t reply;
	bool waitingReply;
	struct mTimingEvent masterEvent;
	uint32_t nextSeq;
	// SO・SI
	int peerSo;
	int sentSo;
	// gba_link_step の区切り
	struct mTimingEvent limitEvent;
	bool limitReached;
	// gba_link_take_event で取り出したもの
	struct LinkItem taken;
} linkState;

static struct GBA* linkGba(void) {
	return core ? core->board : NULL;
}

static double linkNow(void) {
	struct GBA* gba = linkGba();
	return linkState.clockBase + (double) (uint32_t) (mTimingCurrentTime(&gba->timing) - linkState.sampledAt);
}

// 32 ビットの mGBA の時刻が回る前に（gba_link_step のたびに）、通信用の時刻に足し込む
static void linkSample(void) {
	struct GBA* gba = linkGba();
	uint32_t now = mTimingCurrentTime(&gba->timing);
	linkState.clockBase += (double) (uint32_t) (now - linkState.sampledAt);
	linkState.sampledAt = now;
}

static void linkPush(struct LinkQueue* queue, struct LinkItem item) {
	if (queue->count == LINK_QUEUE) return; // 起きないはず。あふれたら捨てる（ゲームは通信エラーにする）
	queue->items[(queue->head + queue->count) % LINK_QUEUE] = item;
	++queue->count;
}

static struct LinkItem* linkPeek(struct LinkQueue* queue) {
	return queue->count ? &queue->items[queue->head] : NULL;
}

static void linkPop(struct LinkQueue* queue) {
	queue->head = (queue->head + 1) % LINK_QUEUE;
	--queue->count;
}

// 相手に送るものを積み、CPU を止めて JS に戻る（すぐ送ってもらう）
static void linkSend(struct LinkItem item) {
	linkPush(&linkState.outgoing, item);
	linkGba()->earlyExit = true;
}

static bool linkNormalMode(const struct GBASIO* sio) {
	return sio->mode == SIO_NORMAL_8 || sio->mode == SIO_NORMAL_32;
}

static uint32_t linkReadData(const struct GBA* gba, bool is32) {
	if (is32) {
		return gba->memory.io[REG_SIODATA32_LO >> 1] | ((uint32_t) gba->memory.io[REG_SIODATA32_HI >> 1] << 16);
	}
	return gba->memory.io[REG_SIODATA8 >> 1] & 0xFF;
}

static void linkWriteData(struct GBA* gba, bool is32, uint32_t data) {
	if (is32) {
		gba->memory.io[REG_SIODATA32_LO >> 1] = data;
		gba->memory.io[REG_SIODATA32_HI >> 1] = data >> 16;
	} else {
		gba->memory.io[REG_SIODATA8 >> 1] = data & 0xFF;
	}
}

static uint16_t linkWithSi(uint16_t siocnt) {
	return linkState.peerSo ? (siocnt | 0x0004) : (siocnt & ~0x0004);
}

// 親機の転送を終える（受け取ったデータを置き、bit 7 を下ろし、割り込みを立てる）
static void linkFinishMaster(uint32_t data, uint32_t cyclesLate) {
	struct GBA* gba = linkGba();
	struct GBASIO* sio = &gba->sio;
	linkState.masterActive = false;
	linkState.waitingReply = false;
	linkState.replyReady = false;
	if (mTimingIsScheduled(&gba->timing, &linkState.masterEvent)) {
		mTimingDeschedule(&gba->timing, &linkState.masterEvent);
	}
	linkWriteData(gba, sio->mode == SIO_NORMAL_32, data);
	sio->siocnt &= ~0x0080;
	if (sio->siocnt & 0x4000) {
		GBARaiseIRQ(gba, GBA_IRQ_SIO, cyclesLate);
	}
}

// 親機の転送の長さが過ぎた
static void linkMasterDue(struct mTiming* timing, void* context, uint32_t cyclesLate) {
	(void) timing;
	(void) context;
	if (linkState.replyReady) {
		linkFinishMaster(linkState.reply, cyclesLate);
	} else {
		linkState.waitingReply = true;
		linkGba()->earlyExit = true;
	}
}

// 子機として、相手の転送を受け取る。返事を送るものに積む
static void linkReceiveTransfer(const struct LinkItem* item, uint32_t cyclesLate) {
	struct GBA* gba = linkGba();
	struct GBASIO* sio = &gba->sio;
	uint32_t reply = 0xFFFFFFFF;
	uint16_t siocnt = sio->siocnt;
	if (linkNormalMode(sio) && !(siocnt & 0x0001) && (siocnt & 0x0080)) {
		bool is32 = sio->mode == SIO_NORMAL_32;
		reply = linkReadData(gba, is32);
		linkWriteData(gba, is32, item->data);
		sio->siocnt = siocnt & ~0x0080;
		if (siocnt & 0x4000) {
			GBARaiseIRQ(gba, GBA_IRQ_SIO, cyclesLate);
		}
	}
	linkSend((struct LinkItem) { .kind = LINK_EVENT_REPLY, .seq = item->seq, .data = reply });
}

// 届いたもののうち先頭を、受け取る時刻に受け取る（予約する）
static void linkScheduleIncoming(void) {
	struct GBA* gba = linkGba();
	struct LinkItem* item = linkPeek(&linkState.incoming);
	if (!item || mTimingIsScheduled(&gba->timing, &linkState.incomingEvent)) return;
	double target = item->at;
	if (item->kind == LINK_EVENT_TRANSFER && linkState.received) {
		// 遅れて続けて届いたとき、子機が次の用意をする間を空ける（Game Boy と同じ。2.2 の※）
		double spaced = linkState.lastReceivedAt + (item->at - linkState.lastMasterAt);
		if (spaced > target) target = spaced;
	}
	double delay = target - linkNow();
	if (delay < 0) delay = 0;
	if (delay > 0x40000000) delay = 0x40000000;
	mTimingSchedule(&gba->timing, &linkState.incomingEvent, (int32_t) delay);
}

static void linkIncomingDue(struct mTiming* timing, void* context, uint32_t cyclesLate) {
	(void) timing;
	(void) context;
	struct LinkItem* item = linkPeek(&linkState.incoming);
	if (!item) return;
	struct LinkItem current = *item;
	linkPop(&linkState.incoming);
	if (current.kind == LINK_EVENT_TRANSFER) {
		linkState.received = true;
		linkState.lastReceivedAt = linkNow();
		linkState.lastMasterAt = current.at;
		linkReceiveTransfer(&current, cyclesLate);
	} else if (current.kind == LINK_EVENT_SO) {
		linkState.peerSo = current.bits;
		struct GBASIO* sio = &linkGba()->sio;
		if (linkNormalMode(sio)) sio->siocnt = linkWithSi(sio->siocnt);
	}
	linkScheduleIncoming();
}

static void linkLimitDue(struct mTiming* timing, void* context, uint32_t cyclesLate) {
	(void) timing;
	(void) context;
	(void) cyclesLate;
	linkState.limitReached = true;
	linkGba()->earlyExit = true;
}

static void linkSendSo(uint16_t siocnt) {
	int so = (siocnt >> 3) & 1;
	if (so == linkState.sentSo) return;
	linkState.sentSo = so;
	linkSend((struct LinkItem) { .kind = LINK_EVENT_SO, .at = linkNow(), .bits = so });
}

static bool linkDriverLoad(struct GBASIODriver* driver) {
	driver->p->siocnt = linkWithSi(driver->p->siocnt);
	return true;
}

static uint16_t linkDriverWrite(struct GBASIODriver* driver, uint32_t address, uint16_t value) {
	if (address != REG_SIOCNT) return value;
	struct GBASIO* sio = driver->p;
	struct GBA* gba = sio->p;
	// bit 2（SI）は読むだけ。相手の SO の高さにする
	value = linkWithSi(value);
	linkSendSo(value);
	if (linkState.masterActive) {
		if (!(value & 0x0080)) {
			// 転送の途中で bit 7 を下ろした: 取り消す（あとから来た返事は seq で捨てる）
			linkState.masterActive = false;
			linkState.waitingReply = false;
			linkState.replyReady = false;
			mTimingDeschedule(&gba->timing, &linkState.masterEvent);
		}
	} else if ((value & 0x0081) == 0x0081) {
		bool is32 = sio->mode == SIO_NORMAL_32;
		int bits = is32 ? 32 : 8;
		// 256KHz は 1 ビット 64 サイクル、2MHz は 8 サイクル
		int32_t length = bits * ((value & 0x0002) ? 8 : 64);
		linkState.masterActive = true;
		linkState.masterSeq = ++linkState.nextSeq;
		linkState.replyReady = false;
		linkState.waitingReply = false;
		mTimingSchedule(&gba->timing, &linkState.masterEvent, length);
		linkSend((struct LinkItem) {
			.kind = LINK_EVENT_TRANSFER,
			.seq = linkState.masterSeq,
			.at = linkNow() + length,
			.data = linkReadData(gba, is32),
			.bits = bits,
		});
	}
	return value;
}

// 積んだもの・途中の転送を忘れる（予約は外さない。外すのは linkDeschedule。コアを捨てる前は予約もコアと一緒に消える）
static void linkForget(void) {
	linkState.connected = false;
	linkState.outgoing.count = 0;
	linkState.incoming.count = 0;
	linkState.masterActive = false;
	linkState.waitingReply = false;
	linkState.replyReady = false;
}

static void linkDeschedule(struct GBA* gba) {
	struct mTimingEvent* events[] = { &linkState.incomingEvent, &linkState.masterEvent, &linkState.limitEvent };
	for (size_t i = 0; i < sizeof(events) / sizeof(events[0]); ++i) {
		if (mTimingIsScheduled(&gba->timing, events[i])) mTimingDeschedule(&gba->timing, events[i]);
	}
}

// つなぐ（1）・切る（0）。つなぐたびに通信用の時刻を 0 にし、積んだもの・途中の転送を捨てる
EMSCRIPTEN_KEEPALIVE void gba_link_set_connected(int connected) {
	struct GBA* gba = linkGba();
	if (!gba) return;
	if (linkState.connected) {
		linkDeschedule(gba);
		// 返事を待っていた親機の転送は、つながっていないのと同じく全部 1 で終える
		if (linkState.masterActive) linkFinishMaster(0xFFFFFFFF, 0);
	}
	linkForget();
	linkState.peerSo = 1;
	if (!connected) {
		GBASIOSetDriver(&gba->sio, NULL, SIO_NORMAL_8);
		return;
	}
	linkState.d = (struct GBASIODriver) { .load = linkDriverLoad, .writeRegister = linkDriverWrite };
	linkState.incomingEvent = (struct mTimingEvent) { .callback = linkIncomingDue, .name = "retroboy-snap link incoming", .priority = 0x80 };
	linkState.masterEvent = (struct mTimingEvent) { .callback = linkMasterDue, .name = "retroboy-snap link master", .priority = 0x81 };
	linkState.limitEvent = (struct mTimingEvent) { .callback = linkLimitDue, .name = "retroboy-snap link limit", .priority = 0x82 };
	linkState.connected = true;
	linkState.clockBase = 0;
	linkState.sampledAt = mTimingCurrentTime(&gba->timing);
	linkState.frameCounter = gba->video.frameCounter;
	linkState.frameStart = linkState.sampledAt;
	linkState.received = false;
	linkState.sentSo = -1;
	GBASIOSetDriver(&gba->sio, &linkState.d, SIO_NORMAL_8);
	// いまの SO を知らせる（相手の SI にしてもらう）
	if (linkNormalMode(&gba->sio)) linkSendSo(gba->sio.siocnt);
}

// 通信用の時刻（GBA のサイクル）
EMSCRIPTEN_KEEPALIVE double gba_link_clock(void) {
	if (!linkState.connected) return 0;
	return linkNow();
}

// つないでいる間の進め方。命令を実行し、次のどれかで止まって理由（LINK_STEP_*）を返す:
// 1 フレーム進んだ・相手に送るものができた・親機で返事を待つ・通信用の時刻が limit に着いた
EMSCRIPTEN_KEEPALIVE int gba_link_step(double limit) {
	struct GBA* gba = linkGba();
	if (!gba || !linkState.connected) return LINK_STEP_LIMIT;
	linkSample();
	if (linkState.waitingReply) return LINK_STEP_WAITING_REPLY;
	if (linkState.outgoing.count) return LINK_STEP_EVENT;
	// 子機として受け取りを待っている転送があれば、limit を越えてもその時刻まで進む（Game Boy と同じ。2.2 の※）。
	// 親機は返事を待って止まっているので追い越さない。越えずに止まると、間を空けた受け取りの時刻が「相手の時刻
	// ＋ W」の先になったとき、親機は返事を・子機は相手の時刻を待ち合って、どちらも進めなくなる
	struct LinkItem* pending = linkPeek(&linkState.incoming);
	if (pending && pending->kind == LINK_EVENT_TRANSFER && mTimingIsScheduled(&gba->timing, &linkState.incomingEvent)) {
		double receiveAt = linkNow() + mTimingUntil(&gba->timing, &linkState.incomingEvent) + 1;
		if (receiveAt > limit) limit = receiveAt;
	}
	double until = limit - linkNow();
	if (until <= 0) return LINK_STEP_LIMIT;
	if (until > 0x40000000) until = 0x40000000;
	linkState.limitReached = false;
	int32_t untilCycles = (int32_t) until;
	if (untilCycles < until) ++untilCycles;
	mTimingSchedule(&gba->timing, &linkState.limitEvent, untilCycles);
	int result;
	for (;;) {
		ARMRunLoop(gba->cpu);
		uint32_t now = mTimingCurrentTime(&gba->timing);
		if (gba->video.frameCounter != linkState.frameCounter
		    || now - linkState.frameStart >= VIDEO_TOTAL_LENGTH + VIDEO_HORIZONTAL_LENGTH) {
			linkState.frameCounter = gba->video.frameCounter;
			linkState.frameStart = now;
			result = LINK_STEP_FRAME;
			break;
		}
		if (linkState.waitingReply) {
			result = LINK_STEP_WAITING_REPLY;
			break;
		}
		if (linkState.outgoing.count) {
			result = LINK_STEP_EVENT;
			break;
		}
		if (linkState.limitReached) {
			result = LINK_STEP_LIMIT;
			break;
		}
	}
	if (mTimingIsScheduled(&gba->timing, &linkState.limitEvent)) {
		mTimingDeschedule(&gba->timing, &linkState.limitEvent);
	}
	linkSample();
	return result;
}

// gba_link_step が LINK_STEP_FRAME を返したあとに、そのフレームの音を読み出す（gba_run_frame の戻り値と同じ）
EMSCRIPTEN_KEEPALIVE int gba_take_audio(void) {
	if (!core) return 0;
	return takeAudio();
}

// 相手に送るものを 1 つ取り出す。戻り値は種類（LINK_EVENT_*。無ければ -1）。中身は gba_link_event_*
EMSCRIPTEN_KEEPALIVE int gba_link_take_event(void) {
	struct LinkItem* item = linkPeek(&linkState.outgoing);
	if (!item) return -1;
	linkState.taken = *item;
	linkPop(&linkState.outgoing);
	return linkState.taken.kind;
}

EMSCRIPTEN_KEEPALIVE uint32_t gba_link_event_seq(void) {
	return linkState.taken.seq;
}

EMSCRIPTEN_KEEPALIVE double gba_link_event_at(void) {
	return linkState.taken.at;
}

EMSCRIPTEN_KEEPALIVE uint32_t gba_link_event_data(void) {
	return linkState.taken.data;
}

// TRANSFER: ビットの数（8 か 32）。SO: 高さ（0 か 1）
EMSCRIPTEN_KEEPALIVE int gba_link_event_bits(void) {
	return linkState.taken.bits;
}

// 相手（親機）の転送を渡す。時刻 at に子機として受け取る
EMSCRIPTEN_KEEPALIVE void gba_link_deliver_transfer(uint32_t seq, double at, uint32_t data, int bits) {
	if (!linkState.connected) return;
	linkPush(&linkState.incoming, (struct LinkItem) { .kind = LINK_EVENT_TRANSFER, .seq = seq, .at = at, .data = data, .bits = bits });
	linkScheduleIncoming();
}

// 相手の SO の高さが時刻 at に変わった
EMSCRIPTEN_KEEPALIVE void gba_link_deliver_so(double at, int level) {
	if (!linkState.connected) return;
	linkPush(&linkState.incoming, (struct LinkItem) { .kind = LINK_EVENT_SO, .at = at, .bits = level ? 1 : 0 });
	linkScheduleIncoming();
}

// 相手（子機）の返事を渡す
EMSCRIPTEN_KEEPALIVE void gba_link_deliver_reply(uint32_t seq, uint32_t data) {
	if (!linkState.connected || !linkState.masterActive || seq != linkState.masterSeq) return;
	if (linkState.waitingReply) {
		linkFinishMaster(data, 0);
	} else {
		linkState.reply = data;
		linkState.replyReady = true;
	}
}
