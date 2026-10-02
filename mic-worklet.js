/* Microphone capture: downsample to 16 kHz mono PCM16 and post 40 ms chunks (640 samples). */
class MicProc extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.phase = 0;
    this.sum = 0;
    this.cnt = 0;
    this.out = new Int16Array(640);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i];
      this.cnt++;
      this.phase += 1;
      if (this.phase >= this.ratio) {
        let v = this.sum / this.cnt;
        this.sum = 0; this.cnt = 0; this.phase -= this.ratio;
        v = Math.max(-1, Math.min(1, v));
        this.out[this.n++] = v < 0 ? v * 32768 : v * 32767;
        if (this.n === 640) {
          this.port.postMessage(this.out.buffer, [this.out.buffer]);
          this.out = new Int16Array(640);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("mic-proc", MicProc);
