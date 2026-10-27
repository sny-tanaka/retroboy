// JS（app/src/gba/gbaCore.ts）から呼ぶ mGBA の口。scripts/build-mgba.sh が libmgba.a と一緒に WASM にする。
// mGBA の libretro の口（src/platform/libretro/libretro.c）と同じ使い方を、要るものだけに絞って書いた。
//
// - スレッドは使わない（mGBA はパッチで DISABLE_THREADING にしてある）。1 回の gba_run_frame で 1 フレーム進める。
// - 絵: 240x160 の RGBA（canvas の ImageData にそのまま渡せる並び）。
// - 音: 左右の float の列。1 フレーム進めるたびに、そのフレームの分を読み出しておく（gba_audio_*）。
// - ゲーム内セーブ: 128KB（フラッシュ 1M の大きさ）の領域を mGBA に渡し、ゲームはそこへ直に書く。
//   JS は gba_save_data / gba_save_size で中身を読み、変わっていれば保存する。読み込むときは gba_load に渡す。
// - セーブステート: mGBA の形式（RTC を含め、ゲーム内セーブは含めない。libretro と同じ）。
#include <stdlib.h>
#include <string.h>

#include <emscripten/emscripten.h>

#include <mgba/core/blip_buf.h>
#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <mgba/core/serialize.h>
#include <mgba/internal/gba/gba.h>
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

EMSCRIPTEN_KEEPALIVE void gba_unload(void) {
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

// 1 フレーム進める。戻り値はこのフレームでできた音のサンプルの数（左右それぞれ。gba_audio_left/right に入る）
EMSCRIPTEN_KEEPALIVE int gba_run_frame(void) {
	if (!core) return 0;
	core->runFrame(core);
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

// セーブステートを作る。戻り値は長さ（失敗なら 0）。中身は gba_state_buffer の先（次の gba_state_save まで有効）
EMSCRIPTEN_KEEPALIVE size_t gba_state_save(void) {
	if (!core) return 0;
	free(stateBuffer);
	stateBuffer = NULL;
	struct VFile* vf = VFileMemChunk(NULL, 0);
	if (!vf) return 0;
	size_t size = 0;
	if (mCoreSaveStateNamed(core, vf, SAVESTATE_RTC)) {
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

// gba_state_alloc の先に書いたセーブステートを読む。1 で成功
EMSCRIPTEN_KEEPALIVE int gba_state_load(size_t size) {
	if (!core || !stateBuffer) return 0;
	struct VFile* vf = VFileFromConstMemory(stateBuffer, size);
	if (!vf) return 0;
	bool ok = mCoreLoadStateNamed(core, vf, SAVESTATE_RTC);
	vf->close(vf);
	return ok ? 1 : 0;
}
