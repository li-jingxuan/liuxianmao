export function createAudioContext() {
  const Context = globalThis.AudioContext ??
    (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) throw new Error("当前浏览器不支持 Web Audio");
  return new Context();
}

export async function resumeAudioContext(context: AudioContext, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (context.state === "running") return;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    await Promise.race([
      context.resume(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("音频启动超时，请重试")), 5_000);
        cancel = () => reject(signal?.reason);
        signal?.addEventListener("abort", cancel, { once: true });
      }),
    ]);
    signal?.throwIfAborted();
    if ((context.state as string) !== "running") throw new Error("音频未启动，请重试");
  } finally {
    clearTimeout(timeout);
    if (cancel) signal?.removeEventListener("abort", cancel);
  }
}

interface ClickVoice {
  when: number;
  source: OscillatorNode;
  disconnect(): void;
}

// 点击走独立的节点链，试听与吉他共用 AudioContext 的时间轴。停止或关闭时立即断开已排程的节点，
// 避免下一声漏出；重音切换只重排尚未响起的点击，不截断已经开始的这声。
export class MetronomeClickAudio {
  private voices = new Set<ClickVoice>();

  schedule(context: AudioContext, when: number, accent: boolean) {
    const source = context.createOscillator();
    let gain: GainNode | undefined;
    const voice: ClickVoice = {
      when, source,
      disconnect: () => {
        source.onended = null;
        source.disconnect();
        gain?.disconnect();
        this.voices.delete(voice);
      },
    };
    try {
      gain = context.createGain();
      source.type = "sine";
      source.frequency.value = accent ? 1300 : 920;
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(accent ? 0.26 : 0.15, when + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.045);
      source.connect(gain);
      gain.connect(context.destination);
      source.onended = voice.disconnect;
      source.start(when);
      this.voices.add(voice);
      source.stop(when + 0.05);
    } catch (error) {
      voice.disconnect();
      throw error;
    }
  }

  cancel(from = -Infinity) {
    for (const voice of this.voices) {
      if (voice.when < from) continue;
      voice.disconnect();
      try { voice.source.stop(); } catch { /* 音频设备关闭时节点已失效，断开即可停止输出。 */ }
    }
  }
}
