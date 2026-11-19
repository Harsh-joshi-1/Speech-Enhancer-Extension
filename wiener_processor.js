/**
 * In-browser Wiener Filter AudioWorkletProcessor.
 * Port of the streaming STFT Wiener speech enhancer to Web Audio API.
 * Operates at 16kHz or browser sample rate, 512-frame STFT with 50% overlap.
 */

class WienerFilterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = 512;
    this.hopSize = 256;
    
    // Hann window
    this.window = new Float32Array(this.frameSize);
    for (let i = 0; i < this.frameSize; i++) {
      this.window[i] = Math.sqrt(0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / this.frameSize)));
    }

    // Buffers
    this.inputBuffer = new Float32Array(this.frameSize);
    this.outputBuffer = new Float32Array(this.frameSize);
    this.inPos = 0;
    this.outPos = 0;
    this.outAvailable = 0;

    // Filter states
    const numBins = Math.floor(this.frameSize / 2) + 1;
    this.noisePsd = null;
    this.speechPsd = null;
    this.noiseAlpha = 0.96;
    this.decisionAlpha = 0.98;
    this.gainFloor = 0.08;
    this.oversubtraction = 1.0;
    this.vadRatio = 2.5;

    // Calibration
    this.calibFrames = 60; // ~1 second
    this.calibCount = 0;
    this.calibAccum = new Float32Array(numBins);

    // Messaging from UI
    this.port.onmessage = (e) => {
      if (e.data.gainFloor !== undefined) this.gainFloor = e.data.gainFloor;
      if (e.data.recalibrate) {
        this.calibCount = 0;
        this.calibAccum.fill(0);
        this.noisePsd = null;
      }
    };
  }

  // Simplified Real-FFT and IFFT for 512 points
  fft(real, imag) {
    const n = real.length;
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        let tr = real[i]; real[i] = real[j]; real[j] = tr;
        let ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
      }
      let k = n >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }

    for (let l = 2; l <= n; l <<= 1) {
      let ang = (-2 * Math.PI) / l;
      let wstep_r = Math.cos(ang);
      let wstep_i = Math.sin(ang);
      for (let i = 0; i < n; i += l) {
        let wr = 1.0, wi = 0.0;
        for (let m = 0; m < (l >> 1); m++) {
          let u_r = real[i + m], u_i = imag[i + m];
          let v_r = real[i + m + (l >> 1)] * wr - imag[i + m + (l >> 1)] * wi;
          let v_i = real[i + m + (l >> 1)] * wi + imag[i + m + (l >> 1)] * wr;
          real[i + m] = u_r + v_r;
          imag[i + m] = u_i + v_i;
          real[i + m + (l >> 1)] = u_r - v_r;
          imag[i + m + (l >> 1)] = u_i - v_i;
          let next_wr = wr * wstep_r - wi * wstep_i;
          wi = wr * wstep_i + wi * wstep_r;
          wr = next_wr;
        }
      }
    }
  }

  ifft(real, imag) {
    const n = real.length;
    for (let i = 0; i < n; i++) imag[i] = -imag[i];
    this.fft(real, imag);
    for (let i = 0; i < n; i++) {
      real[i] = real[i] / n;
      imag[i] = -imag[i] / n;
    }
  }

  processFrame(frameData) {
    const n = this.frameSize;
    const numBins = Math.floor(n / 2) + 1;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);

    // Apply analysis window
    for (let i = 0; i < n; i++) real[i] = frameData[i] * this.window[i];

    this.fft(real, imag);

    // Power spectrum
    const power = new Float32Array(numBins);
    for (let i = 0; i < numBins; i++) {
      power[i] = real[i] * real[i] + imag[i] * imag[i];
    }

    // Calibration phase
    if (this.calibCount < this.calibFrames) {
      for (let i = 0; i < numBins; i++) this.calibAccum[i] += power[i];
      this.calibCount++;
      if (this.calibCount === this.calibFrames) {
        this.noisePsd = new Float32Array(numBins);
        for (let i = 0; i < numBins; i++) {
          this.noisePsd[i] = Math.max(this.calibAccum[i] / this.calibFrames, 1e-12);
        }
        this.speechPsd = new Float32Array(this.noisePsd);
      }
    } else {
      // Noise estimation & VAD
      let frameEnergy = 0, noiseEnergy = 0;
      for (let i = 0; i < numBins; i++) {
        frameEnergy += power[i];
        noiseEnergy += this.noisePsd[i];
      }

      if (frameEnergy < this.vadRatio * noiseEnergy) {
        for (let i = 0; i < numBins; i++) {
          this.noisePsd[i] = this.noiseAlpha * this.noisePsd[i] + (1 - this.noiseAlpha) * power[i];
        }
      }

      // Decision-directed a priori SNR & Wiener gain
      for (let i = 0; i < numBins; i++) {
        const noise = Math.max(this.noisePsd[i], 1e-12);
        const gamma = power[i] / noise; // a posteriori SNR
        const prevPrior = this.speechPsd[i] / noise;
        const prior = this.decisionAlpha * prevPrior + (1 - this.decisionAlpha) * Math.max(gamma - 1, 0);

        let gain = prior / (prior + this.oversubtraction);
        if (gain < this.gainFloor) gain = this.gainFloor;
        if (gain > 1.0) gain = 1.0;

        // Apply gain
        real[i] *= gain;
        imag[i] *= gain;
        if (i > 0 && i < numBins - 1) {
          real[n - i] = real[i];
          imag[n - i] = -imag[i];
        }

        this.speechPsd[i] = gain * gain * power[i];
      }
    }

    // Synthesis
    this.ifft(real, imag);
    for (let i = 0; i < n; i++) real[i] *= this.window[i];

    return real;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;

    const inCh = input[0];
    const outCh = output[0];

    for (let i = 0; i < inCh.length; i++) {
      this.inputBuffer[this.inPos++] = inCh[i];

      // When hop is full, process
      if (this.inPos === this.frameSize) {
        const proc = this.processFrame(this.inputBuffer);

        // Overlap-add
        for (let j = 0; j < this.hopSize; j++) {
          this.outputBuffer[j] += proc[j];
          this.outputBuffer[j + this.hopSize] = proc[j + this.hopSize];
        }

        // Shift input buffer by hopSize
        this.inputBuffer.copyWithin(0, this.hopSize, this.frameSize);
        this.inPos = this.hopSize;
        this.outAvailable += this.hopSize;
      }

      // Deliver to output
      if (this.outAvailable > 0) {
        outCh[i] = this.outputBuffer[0];
        this.outputBuffer.copyWithin(0, 1, this.frameSize);
        this.outputBuffer[this.frameSize - 1] = 0;
        this.outAvailable--;
      } else {
        outCh[i] = inCh[i]; // passthrough until filter warmed up
      }
    }

    return true;
  }
}

registerProcessor("wiener-filter-processor", WienerFilterProcessor);

