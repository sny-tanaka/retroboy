// 倍速のとき、音の高さを変えずに短くする（タイムストレッチ）。このアプリで足した。
//
// やり方は WSOLA: 入力から長さ FRAME の区間を切り出し、ハン窓をかけて半分（HOP）ずつ重ねて足す。
// 出力では区間を HOP ずつ進め、入力では HOP × 速さずつ進めるので、長さが 1/速さ になる（高さはそのまま）。
// 区間を切り出す位置は、予定の位置の前後 SEARCH の中で、ひとつ前の区間の続きと波の形が一番そろう所を
// 選ぶ（ずれたまま重ねると、打ち消し合って音がうなったり濁ったりするため）。重なりはハン窓どうしの
// クロスフェード（足すとちょうど 1）なので、つなぎ目でプチッとならない。
//
// ×1 のときは何もせず、受け取った配列をそのまま返す。×1 との行き来ではプチッとならないようにする:
// - ×1 → 倍速: 最初の区間は窓の立ち上がりをかけず、直前に鳴らした ×1 の音にそのまま続ける。
// - 倍速 → ×1: 残りの出力を出し切り、最後の区間の続きを入力から少し（SEARCH の 2 倍まで）読み、波の形が
//   ×1 の音とそろう所から HOP の長さで重ねる。読まなかった先読みの入力（数十 ms まで）は捨てる。
// ×1.5 と ×2 の行き来は、入力を進める幅が変わるだけで、そのままつながる。

// 秒。区間の長さ。ゲームボーイの低い音（60Hz ほど、1 周期 17ms）でも 1 周期より長くなるように
const FRAME_SEC = 0.03;
// 秒。区間を探す範囲（前後）。1 周期の半分ほどあれば、どんな高さの音でも形のそろう所が見つかる
const SEARCH_SEC = 0.009;
// 区間の位置は、まずこの間隔（48kHz なら 4 サンプルおき）で粗く探し、そのあと一番だった所の前後を
// 1 サンプルずつ探す。倍速は端末がいちばん忙しいときなので、比べる手間をできるだけ減らす
const COARSE_RATE = 12000;

class SampleQueue {
    // 速さのため、たくさん読む所では at() を通さず data[pos - start] を直接読む
    data: Float32Array;
    // data[0] の、入力の始めからの位置
    start = 0;
    length = 0;

    constructor(capacity: number) {
        this.data = new Float32Array(capacity);
    }

    get end(): number {
        return this.start + this.length;
    }

    /** 入力の始めからの位置 pos のサンプル */
    at(pos: number): number {
        return this.data[pos - this.start];
    }

    push(samples: Float32Array): void {
        this.reserve(samples.length);
        this.data.set(samples, this.length);
        this.length += samples.length;
    }

    /** a と b を足したものを足す */
    pushSum(a: Float32Array, b: Float32Array): void {
        this.reserve(a.length);
        const { data, length } = this;
        for (let i = 0; i < a.length; i++) {
            data[length + i] = a[i] + b[i];
        }
        this.length += a.length;
    }

    private reserve(count: number): void {
        if (this.length + count <= this.data.length) return;
        const grown = new Float32Array(
            Math.max(this.data.length * 2, this.length + count),
        );
        grown.set(this.data.subarray(0, this.length));
        this.data = grown;
    }

    /** 位置 pos より前を捨てる */
    dropBefore(pos: number): void {
        const count = Math.min(Math.max(pos - this.start, 0), this.length);
        if (count === 0) return;
        this.data.copyWithin(0, count, this.length);
        this.start += count;
        this.length -= count;
    }

    /** 先頭から count 個を取り出す */
    shift(count: number): Float32Array {
        const taken = this.data.slice(0, count);
        this.dropBefore(this.start + count);
        return taken;
    }

    clear(): void {
        this.start = 0;
        this.length = 0;
    }
}

export class TimeStretcher {
    readonly sampleRate: number;
    private readonly frame: number;
    private readonly hop: number;
    private readonly search: number;
    private readonly coarseStep: number;
    // ハン窓（周期型）。window[i] + window[i + hop] = 1
    private readonly window: Float32Array;

    // 倍速の処理の途中か（false なら ×1 の素通し）
    private active = false;
    private readonly inLeft: SampleQueue;
    private readonly inRight: SampleQueue;
    // 波の形を比べる用の左右を足した音
    private readonly inMid: SampleQueue;
    // 次の区間を切り出す予定の位置（入力の始めから。端数あり）
    private nextTarget = 0;
    // ひとつ前の区間を切り出した位置。-1 ならまだ無い（倍速の最初の区間）
    private prevPos = -1;
    // ひとつ前の区間の後ろ半分に、窓の下がりをかけたもの。次の区間の前半と足す
    private readonly tailLeft: Float32Array;
    private readonly tailRight: Float32Array;
    private readonly outLeft: SampleQueue;
    private readonly outRight: SampleQueue;
    // 出す長さの端数（次に持ち越す）
    private owed = 0;

    // 倍速 → ×1 で重ねる、最後の区間の窓の下がり。fadePos がその長さに届いたら素通しに戻る
    private fadeLeft: Float32Array | null = null;
    private fadeRight: Float32Array | null = null;
    private fadePos = 0;

    constructor(sampleRate: number) {
        this.sampleRate = sampleRate;
        this.hop = Math.round((FRAME_SEC * sampleRate) / 2);
        this.frame = this.hop * 2;
        this.search = Math.round(SEARCH_SEC * sampleRate);
        this.coarseStep = Math.max(1, Math.round(sampleRate / COARSE_RATE));
        this.window = new Float32Array(this.frame);
        for (let i = 0; i < this.frame; i++) {
            this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.frame);
        }
        const capacity = this.frame * 4;
        this.inLeft = new SampleQueue(capacity);
        this.inRight = new SampleQueue(capacity);
        this.inMid = new SampleQueue(capacity);
        this.outLeft = new SampleQueue(capacity);
        this.outRight = new SampleQueue(capacity);
        this.tailLeft = new Float32Array(this.hop);
        this.tailRight = new Float32Array(this.hop);
    }

    /**
     * コアが出した 1 バッファを、速さ speed で鳴らす音にする。返す音は等速（playbackRate = 1）で鳴らす。
     * ×1 で切り替えの後始末も無いときは、受け取った配列をそのまま返す。倍速では空の配列を返すこともある
     * （切り替えた直後、最初の区間に足りるだけ入力がたまるまで）。
     */
    process(
        left: Float32Array,
        right: Float32Array,
        speed: number,
    ): [Float32Array, Float32Array] {
        if (speed === 1) {
            if (this.active) {
                return this.finishStretching(left, right);
            }
            if (this.fadeLeft) {
                const outLeft = left.slice();
                const outRight = right.slice();
                this.fadeIn(outLeft, 0, 0);
                this.fadeIn(outRight, 0, 1);
                return [outLeft, outRight];
            }
            return [left, right];
        }

        if (!this.active) {
            this.startStretching();
        }
        this.pushInput(left, right);
        while (this.placeNextFrame(speed)) {
            // 入力が足りるだけ区間を重ねる
        }

        // 1 回に出すのは、受け取った長さの 1/speed（端数は次へ持ち越す）。できた音が足りないときは
        // あるだけ出し、足りなかった分は持ち越さない。持ち越すと出す音がたまらず、出す長さが毎回
        // 0 と HOP の間でばらつく（ゲームの進みもがたつく）。持ち越さないと、その分だけ出す音に
        // 余裕がたまり、そのあとは毎回同じ長さで出せる
        this.owed += left.length / speed;
        const want = Math.floor(this.owed);
        this.owed -= want;
        const count = Math.min(this.outLeft.length, want);
        return [this.outLeft.shift(count), this.outRight.shift(count)];
    }

    private startStretching(): void {
        this.active = true;
        this.clearInput();
        this.outLeft.clear();
        this.outRight.clear();
        this.nextTarget = 0;
        this.prevPos = -1;
        this.tailLeft.fill(0);
        this.tailRight.fill(0);
        this.owed = 0;
        // ×1 に戻した直後の重ね合わせが残っていても、そこで打ち切る（入力はそのまま続いている）
        this.fadeLeft = null;
        this.fadeRight = null;
    }

    // 倍速 → ×1。残りの出力のあとに、最後の区間の続きを少し出し、それを下げながら ×1 の音を上げて重ねる
    private finishStretching(
        left: Float32Array,
        right: Float32Array,
    ): [Float32Array, Float32Array] {
        this.active = false;
        // まだ区間を 1 つも作っていなければ、ためた入力は ×1 の音の続きなので、そのまま出す
        if (this.prevPos < 0) {
            const pending = this.inLeft.length;
            const outLeft = new Float32Array(pending + left.length);
            const outRight = new Float32Array(pending + right.length);
            outLeft.set(this.inLeft.shift(pending));
            outRight.set(this.inRight.shift(pending));
            outLeft.set(left, pending);
            outRight.set(right, pending);
            this.clearInput();
            return [outLeft, outRight];
        }

        // 出し終えた音は、入力の prevPos + hop の所までつながっている。そこから入力をそのまま読み続けると
        // 切れ目なく続く。読み続ける長さ bridge を、続きの波の形が ×1 の音（入力の end から）とそろうように
        // 選び、そこから hop の長さで重ねる（そろえないと、高さのそろった音どうしでも打ち消し合って一瞬細る）
        const from = this.inMid.end;
        this.pushInput(left, right);
        const base = this.prevPos + this.hop;
        const compare = Math.min(this.hop, left.length);
        const longest = Math.min(
            this.search * 2,
            this.inMid.end - this.hop - base,
        );
        const bridge =
            this.findBestPos(from, base, base + longest, compare) - base;

        const pending = this.outLeft.length;
        const outLeft = new Float32Array(pending + bridge + left.length);
        const outRight = new Float32Array(pending + bridge + right.length);
        outLeft.set(this.outLeft.shift(pending));
        outRight.set(this.outRight.shift(pending));
        for (let i = 0; i < bridge; i++) {
            outLeft[pending + i] = this.inLeft.at(base + i);
            outRight[pending + i] = this.inRight.at(base + i);
        }
        outLeft.set(left, pending + bridge);
        outRight.set(right, pending + bridge);
        this.fadeLeft = new Float32Array(this.hop);
        this.fadeRight = new Float32Array(this.hop);
        for (let i = 0; i < this.hop; i++) {
            const fall = this.window[this.hop + i];
            this.fadeLeft[i] = this.inLeft.at(base + bridge + i) * fall;
            this.fadeRight[i] = this.inRight.at(base + bridge + i) * fall;
        }
        this.fadePos = 0;
        this.fadeIn(outLeft, pending + bridge, 0);
        this.fadeIn(outRight, pending + bridge, 1);
        this.clearInput();
        return [outLeft, outRight];
    }

    private pushInput(left: Float32Array, right: Float32Array): void {
        this.inLeft.push(left);
        this.inRight.push(right);
        this.inMid.pushSum(left, right);
    }

    private clearInput(): void {
        this.inLeft.clear();
        this.inRight.clear();
        this.inMid.clear();
    }

    // channel[from] から先の ×1 の音に、立ち上がりの窓をかけて、残っている下がりを足す
    private fadeIn(channel: Float32Array, from: number, c: number): void {
        const fade = c === 0 ? this.fadeLeft : this.fadeRight;
        if (!fade) return;
        let pos = this.fadePos;
        for (let i = from; i < channel.length && pos < this.hop; i++, pos++) {
            channel[i] = channel[i] * this.window[pos] + fade[pos];
        }
        // 左右は同じ長さなので、右を終えたところで進める
        if (c === 1) {
            this.fadePos = pos;
            if (pos >= this.hop) {
                this.fadeLeft = null;
                this.fadeRight = null;
            }
        }
    }

    // 入力が足りれば次の区間を選んで重ね、HOP 個の出力をためる。足りなければ false
    private placeNextFrame(speed: number): boolean {
        const target = Math.round(this.nextTarget);
        const first = this.prevPos < 0;
        const reach = first ? 0 : this.search;
        if (target + reach + this.frame > this.inMid.end) {
            return false;
        }
        // 波の形を比べるのは、重なりの真ん中の半分だけ（両端は片方の窓がほぼ 0 で、ずれても目立たない）
        const skip = Math.floor(this.hop / 4);
        const pos = first
            ? target
            : this.findBestPos(
                  this.prevPos + this.hop + skip,
                  Math.max(target - this.search, this.inMid.start) + skip,
                  target + this.search + skip,
                  Math.floor(this.hop / 2),
              ) - skip;

        const { hop, window, tailLeft, tailRight } = this;
        const left = this.inLeft.data;
        const right = this.inRight.data;
        const at = pos - this.inLeft.start;
        for (let i = 0; i < hop; i++) {
            // 最初の区間は立ち上がりの窓をかけない（直前の ×1 の音にそのまま続く）
            const rise = first ? 1 : window[i];
            tailLeft[i] += left[at + i] * rise;
            tailRight[i] += right[at + i] * rise;
        }
        this.outLeft.push(tailLeft);
        this.outRight.push(tailRight);
        for (let i = 0; i < hop; i++) {
            const fall = window[hop + i];
            tailLeft[i] = left[at + hop + i] * fall;
            tailRight[i] = right[at + hop + i] * fall;
        }

        this.prevPos = pos;
        this.nextTarget += hop * speed;
        // 次に要るのは、この区間の続き（pos + hop から）と、次の予定の位置の前後
        const keepFrom = Math.min(
            pos + hop,
            Math.round(this.nextTarget) - this.search,
        );
        this.inLeft.dropBefore(keepFrom);
        this.inRight.dropBefore(keepFrom);
        this.inMid.dropBefore(keepFrom);
        return true;
    }

    // lowest から highest の中で、入力の ref から length 個と波の形が一番そろう位置
    private findBestPos(
        ref: number,
        lowest: number,
        highest: number,
        length: number,
    ): number {
        const step = this.coarseStep;
        const mid = this.inMid.data;
        const a = ref - this.inMid.start;
        const lo = lowest - this.inMid.start;
        const hi = highest - this.inMid.start;

        // 粗く: 候補は step おき、比べるサンプルは step の 2 倍おき。候補の音の大きさは、候補を
        // 2 つ進めるごとに端の 1 サンプルを入れ替えるだけで求まるので、偶数番目と奇数番目の候補で分けて持つ
        const sparse = step * 2;
        const points = Math.ceil(length / sparse);
        let best = lowest;
        let bestScore = -Infinity;
        for (let phase = 0; phase < 2; phase++) {
            const first = lo + phase * step;
            let energy = 0;
            for (let k = 0; k < points; k++) {
                const x = mid[first + k * sparse];
                energy += x * x;
            }
            for (let b = first; b <= hi; b += sparse) {
                let dot = 0;
                for (let k = 0; k < points; k++) {
                    dot += mid[a + k * sparse] * mid[b + k * sparse];
                }
                const score = dot / Math.sqrt(Math.max(energy, 0) + 1e-9);
                if (score > bestScore) {
                    bestScore = score;
                    best = b + this.inMid.start;
                }
                const out = mid[b];
                const next = mid[b + points * sparse];
                energy += next * next - out * out;
            }
        }
        // 粗く探して一番だった所の前後を 1 サンプルずつ、比べるサンプルを 2 つおきにして比べ直す
        const center = best;
        bestScore = -Infinity;
        const from = Math.max(center - step + 1, lowest);
        const to = Math.min(center + step - 1, highest);
        for (let p = from; p <= to; p++) {
            const score = this.similarity(ref, p, 2, length);
            if (score > bestScore) {
                bestScore = score;
                best = p;
            }
        }
        return best;
    }

    // 正規化した相互相関（候補の音の大きさで割る。大きい所ばかり選ばないため）
    private similarity(
        ref: number,
        p: number,
        step: number,
        length: number,
    ): number {
        let dot = 0;
        let energy = 0;
        const mid = this.inMid.data;
        const a = ref - this.inMid.start;
        const b = p - this.inMid.start;
        for (let i = 0; i < length; i += step) {
            const x = mid[b + i];
            dot += mid[a + i] * x;
            energy += x * x;
        }
        return dot / Math.sqrt(energy + 1e-9);
    }
}
