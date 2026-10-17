// Plays the song and is the program's clock.
//
// The avatar's pose is a function of "where in the song are we", so that
// answer has to come from the audio hardware, not from a timer: a
// setInterval or rAF clock drifts away from the music within a minute and
// stops dead whenever the tab is throttled. `time()` reads the
// AudioContext clock and subtracts the output latency, i.e. it names the
// sample leaving the speaker right now. What latency the browser does not
// report (Bluetooth on Safari, mostly) is what the screen's offset nudge
// is for.
//
// The song is decoded on an OfflineAudioContext, which needs no user
// gesture; the AudioContext that plays it is only created inside the tap
// that starts playback. A context created any earlier starts suspended,
// and iOS may keep it that way — with the clock stopped, so would the
// avatar.
//
// The music is the foreground here, unlike the guided session's
// background loops, so the teacher's voice ducks it only part way: the
// beat has to stay audible while someone is talking over it.

/** Music level while the teacher speaks. */
export const GROOVE_DUCK = 0.5;
/** How far ahead metronome clicks are scheduled, in seconds. */
const LOOKAHEAD = 0.15;
/** Decode rate. Most files are already at it, so decoding rarely resamples;
 *  the playing context converts to the device rate as it plays. */
const DECODE_RATE = 44100;

export class GroovePlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** Context time at which song time 0 would have played. */
  private origin = 0;
  /** Song time while stopped or paused. */
  private held = 0;
  private ducks = 0;
  private clickGrid: number[] | null = null;
  private clickDownbeat = 0;
  private clickTimer: number | null = null;
  private nextClick = 0;
  private endedHandler: (() => void) | null = null;

  async load(data: ArrayBuffer): Promise<AudioBuffer> {
    this.stop();
    const decoder = new OfflineAudioContext(2, 1, DECODE_RATE);
    this.buffer = await decoder.decodeAudioData(data);
    this.held = 0;
    return this.buffer;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get playing(): boolean {
    return this.source !== null;
  }

  onEnded(handler: (() => void) | null): void {
    this.endedHandler = handler;
  }

  /** Song time, in seconds, of what is audible now. */
  time(): number {
    if (!this.source || !this.ctx) return this.held;
    const latency = (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0);
    return Math.max(0, this.ctx.currentTime - latency - this.origin);
  }

  /** Call from the tap that starts or resumes playback. */
  play(from = this.held): void {
    if (!this.buffer) return;
    this.halt();
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.ducks > 0 ? GROOVE_DUCK : 1;
      this.master.connect(this.ctx.destination);
    }
    const ctx = this.ctx;
    void ctx.resume().catch(() => {});
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.master!);
    const start = Math.max(0, Math.min(from, this.buffer.duration));
    source.start(0, start);
    this.origin = ctx.currentTime - start;
    source.onended = () => {
      // `stop()` fires this too; only a source that ran out is the end.
      if (this.source !== source) return;
      this.source = null;
      this.held = this.buffer?.duration ?? 0;
      this.stopClicks();
      this.endedHandler?.();
    };
    this.source = source;
    this.nextClick = 0;
    if (this.clickGrid) this.startClicks();
  }

  pause(): void {
    if (!this.source) return;
    this.held = this.time();
    this.halt();
  }

  stop(): void {
    this.halt();
    this.held = 0;
  }

  private halt(): void {
    const source = this.source;
    this.source = null;
    this.stopClicks();
    try {
      source?.stop();
    } catch {
      /* never started */
    }
  }

  /** Counted, like the guided session's mixer: overlapping speech needs as
   *  many releases and can never leave the music stuck low. */
  duck(): void {
    this.ducks++;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(GROOVE_DUCK, this.ctx.currentTime, 0.05);
    }
  }

  release(): void {
    this.ducks = Math.max(0, this.ducks - 1);
    if (this.ducks === 0 && this.ctx && this.master) {
      this.master.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3);
    }
  }

  /** A click on every beat of `grid` (a higher one on each bar), for
   *  checking the grid by ear. Null turns it off. */
  setClicks(grid: number[] | null, downbeat = 0): void {
    this.clickGrid = grid;
    this.clickDownbeat = downbeat;
    this.nextClick = 0;
    if (grid && this.source) this.startClicks();
    else this.stopClicks();
  }

  private startClicks(): void {
    this.stopClicks();
    this.clickTimer = window.setInterval(() => this.scheduleClicks(), 40);
    this.scheduleClicks();
  }

  private stopClicks(): void {
    if (this.clickTimer !== null) window.clearInterval(this.clickTimer);
    this.clickTimer = null;
  }

  private scheduleClicks(): void {
    const grid = this.clickGrid;
    const ctx = this.ctx;
    if (!grid || !this.source || !ctx) return;
    // Scheduled against the context clock, so the clicks share the music's
    // latency and line up with it exactly as the speaker plays them.
    const songNow = ctx.currentTime - this.origin;
    while (this.nextClick < grid.length && grid[this.nextClick]! < songNow) this.nextClick++;
    while (this.nextClick < grid.length && grid[this.nextClick]! < songNow + LOOKAHEAD) {
      const at = this.origin + grid[this.nextClick]!;
      const bar = (((this.nextClick - this.clickDownbeat) % 4) + 4) % 4;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = bar === 0 ? 1760 : 1100;
      gain.gain.setValueAtTime(0.5, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.06);
      this.nextClick++;
    }
  }

  dispose(): void {
    this.endedHandler = null;
    this.stop();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.master = null;
  }
}
