// 程序化音效模块：全部音效由 Web Audio API 的振荡器 / 噪声缓冲实时合成，不加载任何外部音频文件，离线可用。
// 设计约束：
// - 纯模块单例，不依赖 React 与 DOM 元素；偏好（音量/静音）由外部持有，本模块不读写 localStorage；
// - 必须在首次用户手势中调用 audio.unlock() 解锁 AudioContext，play() 前检查运行状态，suspended 时静默返回；
// - 所有音效 < 400ms、克制、有区分度；同名音效 60ms 内限流，避免一帧多次触发产生刺耳叠加；
// - muted 时不发声也不创建任何音频节点；音量/静音对在播音效实时生效（master gain 平滑过渡）。

/** 游戏内全部音效名。 */
export type SoundName =
  | 'click'
  | 'eat'
  | 'birth'
  | 'death'
  | 'predation'
  | 'droughtWarn'
  | 'rain'
  | 'select'
  | 'success'
  | 'fail'
  | 'spawn';

/** 音频模块对外形状。 */
export interface AudioModule {
  /** 必须在首次用户手势中调用；重复调用安全。 */
  unlock(): void;
  play(name: SoundName): void;
  /** 0..1，超出范围自动裁剪；实时生效。 */
  setVolume(v: number): void;
  /** 实时生效；muted 期间 play() 直接返回，不创建节点。 */
  setMuted(m: boolean): void;
  /** 当前环境是否提供可用的 AudioContext 构造器。 */
  readonly available: boolean;
}

type AudioContextCtor = typeof AudioContext;
type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';
type SynthFn = (v: Voice) => void;

/** window 上可能存在的 AudioContext 构造器（含旧版 Safari 前缀）。 */
interface AudioContextWindow {
  AudioContext?: AudioContextCtor;
  webkitAudioContext?: AudioContextCtor;
}

/** 单例音频引擎：上下文 + 主增益（主增益之后接轻量限幅器防削波）。 */
interface Engine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
}

interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  /** 若提供，频率在整段包络内指数滑向该值。 */
  freqEnd?: number;
  q?: number;
}

interface ToneSpec {
  type: Wave;
  freq: number;
  /** 相对语音起始时刻的偏移（秒）。 */
  at?: number;
  peak: number;
  attack: number;
  hold: number;
  release: number;
  /** 若提供，音高在整段包络内指数滑向该值。 */
  glide?: number;
  filters?: FilterSpec[];
}

interface NoiseSpec {
  at?: number;
  peak: number;
  attack: number;
  hold: number;
  release: number;
  filters?: FilterSpec[];
  /** 噪声缓冲播放速率，>1 更亮更短。 */
  rate?: number;
}

/** 同名音效限流窗口（毫秒）。 */
const REPEAT_WINDOW_MS = 60;
/** 包络结束后多播放一小段再 stop，避免截断爆音。 */
const STOP_MARGIN = 0.03;
/** 指数包络不能到 0，用接近 0 的地板值代替。 */
const SILENCE = 0.0001;
/** 共享白噪声缓冲长度（秒）。 */
const NOISE_SECONDS = 1.5;

let engine: Engine | null = null;
let ctorBroken = false;
let primed = false;
let volume = 0.6;
let muted = false;
const lastPlayed = new Map<SoundName, number>();
const noiseCache = new WeakMap<AudioContext, AudioBuffer>();

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function getCtor(): AudioContextCtor | undefined {
  if (typeof window === 'undefined' || ctorBroken) return undefined;
  const w = window as unknown as AudioContextWindow;
  return w.AudioContext ?? w.webkitAudioContext;
}

/** 惰性创建音频引擎；失败仅此一次，之后 available 为 false。 */
function ensureEngine(): Engine | null {
  if (engine) return engine;
  const Ctor = getCtor();
  if (!Ctor) return null;
  try {
    const ctx = new Ctor({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    // 轻量限幅：多音效同帧叠放时防止削波
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 12;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    engine = { ctx, master };
    return engine;
  } catch {
    ctorBroken = true;
    return null;
  }
}

function resumeContext(ctx: AudioContext): void {
  try {
    void Promise.resolve(ctx.resume()).catch(() => undefined);
  } catch {
    // 忽略：环境不支持或拒绝恢复时仅表现为无声
  }
}

/** 主增益实时跟随 volume / muted。 */
function applyGain(): void {
  if (!engine) return;
  const target = muted ? 0 : volume;
  engine.master.gain.setTargetAtTime(target, engine.ctx.currentTime, 0.015);
}

/**
 * 一次发音的节点集合：内部增益总线连到 master，
 * 所有被跟踪的节点在最后一个声源播放结束后统一断开并释放。
 */
class Voice {
  readonly ctx: AudioContext;
  readonly t0: number;
  readonly out: GainNode;
  private readonly owned: AudioNode[] = [];
  private pending = 0;

  constructor(engine: Engine) {
    this.ctx = engine.ctx;
    this.t0 = engine.ctx.currentTime;
    const out = engine.ctx.createGain();
    out.gain.value = 1;
    out.connect(engine.master);
    this.out = out;
    this.owned.push(out);
  }

  /** 登记节点，随语音结束一起释放。 */
  keep<T extends AudioNode>(node: T): T {
    this.owned.push(node);
    return node;
  }

  /** 安排声源停止，并在其播放结束后释放整条链。 */
  end(source: AudioScheduledSourceNode, at: number): void {
    this.pending += 1;
    try {
      source.stop(Math.max(at, this.t0 + 0.01));
    } catch {
      // 忽略：上下文已关闭等异常场景
    }
    source.addEventListener(
      'ended',
      () => {
        this.pending -= 1;
        if (this.pending <= 0) this.dispose();
      },
      { once: true },
    );
  }

  /** 立即断开并释放本语音所有节点。 */
  dispose(): void {
    for (const n of this.owned) {
      try {
        n.disconnect();
      } catch {
        // 忽略：重复断开无副作用
      }
    }
    this.owned.length = 0;
  }
}

/** ADSR 包络（指数斜坡，峰值与尾音都不为 0），返回包络结束时刻。 */
function adsr(param: AudioParam, t0: number, peak: number, attack: number, hold: number, release: number): number {
  const top = Math.max(peak, SILENCE * 2);
  const a = Math.max(attack, 0.001);
  const end = t0 + a + hold + release;
  param.setValueAtTime(SILENCE, t0);
  param.exponentialRampToValueAtTime(top, t0 + a);
  if (hold > 0) {
    param.setValueAtTime(top, t0 + a + hold);
  }
  param.exponentialRampToValueAtTime(SILENCE, end);
  return end;
}

/** 按需串接滤波器，返回链路末端节点。 */
function applyFilters(v: Voice, src: AudioNode, at: number, dur: number, filters: FilterSpec[] | undefined): AudioNode {
  let prev = src;
  for (const fs of filters ?? []) {
    const f = v.keep(v.ctx.createBiquadFilter());
    f.type = fs.type;
    f.frequency.setValueAtTime(Math.max(fs.freq, 1), at);
    if (fs.freqEnd !== undefined && fs.freqEnd > 0) {
      f.frequency.exponentialRampToValueAtTime(fs.freqEnd, at + dur);
    }
    if (fs.q !== undefined) f.Q.value = fs.q;
    prev.connect(f);
    prev = f;
  }
  return prev;
}

/** 单音：振荡器 + 可选滤波器 + ADSR 包络，返回包络结束时刻。 */
function tone(v: Voice, spec: ToneSpec): number {
  const at = v.t0 + (spec.at ?? 0);
  const dur = spec.attack + spec.hold + spec.release;
  const osc = v.keep(v.ctx.createOscillator());
  osc.type = spec.type;
  osc.frequency.setValueAtTime(Math.max(spec.freq, 1), at);
  if (spec.glide !== undefined && spec.glide > 0) {
    osc.frequency.exponentialRampToValueAtTime(spec.glide, at + dur);
  }
  const tail = applyFilters(v, osc, at, dur, spec.filters);
  const g = v.keep(v.ctx.createGain());
  tail.connect(g).connect(v.out);
  const end = adsr(g.gain, at, spec.peak, spec.attack, spec.hold, spec.release);
  v.end(osc, end + STOP_MARGIN);
  return end;
}

/** 噪声爆发：共享白噪声缓冲随机偏移 + 可选滤波器 + ADSR 包络，返回包络结束时刻。 */
function noiseBurst(v: Voice, spec: NoiseSpec): number {
  const at = v.t0 + (spec.at ?? 0);
  const dur = spec.attack + spec.hold + spec.release;
  const buf = getNoise(v.ctx);
  const src = v.keep(v.ctx.createBufferSource());
  src.buffer = buf;
  if (spec.rate !== undefined) src.playbackRate.value = spec.rate;
  const maxOffset = Math.max(0, buf.duration - dur - 0.05);
  src.start(at, maxOffset > 0 ? Math.random() * maxOffset : 0);
  const tail = applyFilters(v, src, at, dur, spec.filters);
  const g = v.keep(v.ctx.createGain());
  tail.connect(g).connect(v.out);
  const end = adsr(g.gain, at, spec.peak, spec.attack, spec.hold, spec.release);
  v.end(src, end + STOP_MARGIN);
  return end;
}

/** 每个上下文缓存一份白噪声缓冲（~1.5s 单声道）。 */
function getNoise(ctx: AudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const len = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

// ---------------------------------------------------------------------------
// 音效设计清单（全部 < 400ms，振荡器/噪声 + 增益包络实时合成）
// ---------------------------------------------------------------------------
const SYNTHS: Record<SoundName, SynthFn> = {
  // click：极短方波嘀嗒，1150→540Hz 急坠，约 47ms
  click(v) {
    tone(v, { type: 'square', freq: 1150, glide: 540, peak: 0.3, attack: 0.002, hold: 0, release: 0.045 });
  },

  // eat：短促木质嗒声 = 带通噪声（1500→620Hz，"木"）+ 三角波 thock（250→120Hz），约 80ms
  eat(v) {
    noiseBurst(v, {
      peak: 0.45,
      attack: 0.002,
      hold: 0.006,
      release: 0.072,
      filters: [{ type: 'bandpass', freq: 1500, freqEnd: 620, q: 5 }],
    });
    tone(v, {
      type: 'triangle',
      freq: 250,
      glide: 120,
      peak: 0.3,
      attack: 0.002,
      hold: 0.004,
      release: 0.058,
      filters: [{ type: 'lowpass', freq: 900 }],
    });
  },

  // birth：两声上行悦耳音，C5(523)→G5(784) 纯正弦，约 334ms
  birth(v) {
    tone(v, { type: 'sine', freq: 523.25, peak: 0.34, attack: 0.014, hold: 0.03, release: 0.15 });
    tone(v, { type: 'sine', freq: 783.99, at: 0.13, peak: 0.36, attack: 0.014, hold: 0.03, release: 0.16 });
  },

  // death：下行闷音，低通锯齿 300→70Hz，约 308ms
  death(v) {
    tone(v, {
      type: 'sawtooth',
      freq: 300,
      glide: 70,
      peak: 0.34,
      attack: 0.008,
      hold: 0.02,
      release: 0.28,
      filters: [{ type: 'lowpass', freq: 720 }],
    });
  },

  // predation：低沉冲击（正弦 150→45Hz）+ 低通噪声撕裂（1000→260Hz），约 204ms
  predation(v) {
    tone(v, { type: 'sine', freq: 150, glide: 45, peak: 0.5, attack: 0.002, hold: 0.02, release: 0.15 });
    noiseBurst(v, {
      peak: 0.28,
      attack: 0.002,
      hold: 0.012,
      release: 0.19,
      filters: [{ type: 'lowpass', freq: 1000, freqEnd: 260, q: 0.8 }],
    });
  },

  // droughtWarn：低频双音警示，A3(220)→G#3(196) 半音双响，约 362ms
  droughtWarn(v) {
    tone(v, {
      type: 'square',
      freq: 220,
      peak: 0.26,
      attack: 0.012,
      hold: 0.1,
      release: 0.06,
      filters: [{ type: 'lowpass', freq: 1400 }],
    });
    tone(v, {
      type: 'square',
      freq: 196,
      at: 0.19,
      peak: 0.26,
      attack: 0.012,
      hold: 0.1,
      release: 0.06,
      filters: [{ type: 'lowpass', freq: 1400 }],
    });
  },

  // rain：白噪声渐弱，低通主体(2400Hz) + 高通嘶声(4200Hz)，约 360ms
  rain(v) {
    noiseBurst(v, {
      peak: 0.34,
      attack: 0.03,
      hold: 0.02,
      release: 0.31,
      filters: [{ type: 'lowpass', freq: 2400 }],
    });
    noiseBurst(v, {
      peak: 0.1,
      attack: 0.04,
      hold: 0.02,
      release: 0.28,
      filters: [{ type: 'highpass', freq: 4200 }],
    });
  },

  // select：比 click 更轻柔更短的正弦点选，1660→1980Hz 微升，约 33ms
  select(v) {
    tone(v, { type: 'sine', freq: 1660, glide: 1980, peak: 0.18, attack: 0.003, hold: 0.004, release: 0.026 });
  },

  // success：大三和弦上行琶音 C5-E5-G5（三角波）+ 高音闪光，约 348ms
  success(v) {
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i) => {
      tone(v, { type: 'triangle', freq: f, at: i * 0.08, peak: 0.26, attack: 0.008, hold: 0.03, release: 0.15 });
    });
    tone(v, { type: 'sine', freq: 1567.98, at: 0.16, peak: 0.07, attack: 0.01, hold: 0.01, release: 0.13 });
  },

  // fail：下行不谐和音，G4-F#4-D#4，每个音叠加半音上方方波制造拍频不谐，约 356ms
  fail(v) {
    const roots = [392.0, 369.99, 311.13];
    roots.forEach((f, i) => {
      const at = i * 0.1;
      tone(v, {
        type: 'sawtooth',
        freq: f,
        at,
        peak: 0.24,
        attack: 0.006,
        hold: 0.02,
        release: 0.13,
        filters: [{ type: 'lowpass', freq: 1300 }],
      });
      tone(v, {
        type: 'square',
        freq: f * 1.0595,
        at,
        peak: 0.1,
        attack: 0.006,
        hold: 0.02,
        release: 0.12,
        filters: [{ type: 'lowpass', freq: 1300 }],
      });
    });
  },

  // spawn：轻柔魔法感上行，E5-B5-E6 正弦琶音 + 高音(2637Hz)闪光，约 379ms
  spawn(v) {
    const notes = [659.25, 987.77, 1318.51];
    notes.forEach((f, i) => {
      tone(v, { type: 'sine', freq: f, at: i * 0.08, peak: 0.24, attack: 0.014, hold: 0.015, release: 0.19 });
    });
    tone(v, { type: 'sine', freq: 2637.02, at: 0.16, peak: 0.06, attack: 0.012, hold: 0, release: 0.14 });
  },
};

export const audio: AudioModule = {
  unlock(): void {
    const e = ensureEngine();
    if (!e) return;
    if (e.ctx.state === 'suspended') resumeContext(e.ctx);
    // 旧版 iOS/Safari 需要在用户手势内播放一段 1 采样静音才能真正解锁；
    // muted 时不创建任何节点（现代浏览器仅 resume() 已足够）。
    if (!primed && !muted) {
      primed = true;
      try {
        const silent = e.ctx.createBuffer(1, 1, e.ctx.sampleRate);
        const src = e.ctx.createBufferSource();
        src.buffer = silent;
        src.connect(e.ctx.destination);
        src.start(0);
      } catch {
        // 忽略：解锁技巧失败时仅表现为无声
      }
    }
  },

  play(name: SoundName): void {
    // 未解锁（或环境不可用/构造失败）时直接返回：不创建上下文、不创建任何节点
    if (muted || !engine) return;
    // 被浏览器挂起（自动播放策略）时静默返回，等 unlock() 恢复
    if (engine.ctx.state !== 'running') return;
    const synth: SynthFn | undefined = SYNTHS[name];
    if (!synth) return;
    // 同名音效限流：一帧多次触发只发一次
    const now = nowMs();
    const last = lastPlayed.get(name);
    if (last !== undefined && now - last < REPEAT_WINDOW_MS) return;
    lastPlayed.set(name, now);
    const v = new Voice(engine);
    try {
      synth(v);
    } catch {
      v.dispose();
    }
  },

  setVolume(v: number): void {
    volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : volume;
    applyGain();
  },

  setMuted(m: boolean): void {
    muted = !!m;
    applyGain();
  },

  get available(): boolean {
    return getCtor() !== undefined;
  },
};
