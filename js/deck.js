// deck.js — Clase Deck: audio real, máquina de estados y UI física
'use strict';

if (typeof $ === 'undefined') {
  window.$ = (sel, r = document) => {
    const e = r.querySelector(sel);
    if (!e) console.error('Falta elemento en el HTML:', sel);
    return e;
  };
}

const EQ_PRESETS = [
  { name: 'FLAT', low: 0, high: 0 },
  { name: 'BASS', low: 6, high: -2 },
  { name: 'TREBLE', low: -2, high: 6 },
  { name: 'VOCAL', low: -3, high: 3 }
];

class Deck {
  constructor(options = {}) {
    this.id = (options.id || 'a').toLowerCase(); // 'a' | 'b'
    this.root = options.root || null;
    this.ctx = options.ctx || window.ctx || null;
    this.xfade = options.xfade || window.xfade || null;

    this.state = 'CLOSED';
    this.track = null;
    this.audio = null;

    this.analyser = null;
    this.srcNode = null;
    this.trimGain = null;
    this.chGain = null;
    this.eqLow = null;
    this.eqHigh = null;
    this.usingGraph = false;

    this.volume = 0.8;
    this.trim = 1;
    this.pitch = 0;          // -24 .. +24 (%)
    this.cuePoint = 0;
    this.lv = 0;
    this.eqIndex = 0;
    this.autoplayAfterLoad = false;

    this._initDOM();
    this._initAudio();
    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
  }

  // ---------- DOM ----------
  _initDOM() {
    const r = this.root;
    if (!r) return;
    const q = (sel) => r.querySelector(sel);

    this.elStatus = q('#player-' + this.id + '-status');
    this.elElapsed = q('#player-' + this.id + '-elapsed');
    this.elRemaining = q('#player-' + this.id + '-remaining');
    this.elMessage = q('#player-' + this.id + '-msg');
    this.elVuMeter = q('.player-vu');
    this.elPitchDisplay = q('#player-' + this.id + '-pitch');
    this.elPitchFader = q('#player-' + this.id + '-pitch-fader');
    this.elCueBtn = q('[data-cue]');
    this.elPlayBtn = q('[data-play]');
    this.elExpelBtn = q('[data-expel]');
    this.elLedStrip = q('.led-strip');
    this.elProgress = q('.lcd-progress');

    this.btnPitchMinus = q('[data-pitch-minus]');
    this.btnPitchPlus = q('[data-pitch-plus]');
    this.btnPitchDefault = q('[data-pitch-default]');
    this.elTrackPrev = q('[data-track-prev]');
    this.elTrackEq = q('[data-track-eq]');
    this.elTrackRew = q('[data-track-rew]');
    this.elTrackFf = q('[data-track-ff]');

    this.vuSegments = this.elVuMeter
      ? Array.from(this.elVuMeter.querySelectorAll('.vu-segment'))
      : [];
    this.leds = this.elLedStrip
      ? Array.from(this.elLedStrip.querySelectorAll('.led'))
      : [];
  }

  // ---------- Audio ----------
  _initAudio() {
    const a = this.audio = new Audio();
    a.preload = 'metadata';
    a.loop = false;
    // Con grafo Web Audio el volumen se controla en chGain; sin grafo, en el elemento.
    a.volume = 1;

    const xfGain = this._xfadeGain();
    const Ctx = window.initAudio ? window.initAudio() : (window.ctx || this.ctx);
    if (Ctx) this.ctx = Ctx;

    if (this.ctx && xfGain && typeof this.ctx.createMediaElementSource === 'function') {
      try {
        this.srcNode = this.ctx.createMediaElementSource(a);
        this.trimGain = this.ctx.createGain();
        this.chGain = this.ctx.createGain();
        this.eqLow = this.ctx.createBiquadFilter();
        this.eqHigh = this.ctx.createBiquadFilter();
        this.analyser = this.ctx.createAnalyser();

        this.trimGain.gain.value = this.trim;
        this.chGain.gain.value = this.volume;
        this.eqLow.type = 'lowshelf';
        this.eqLow.frequency.value = 200;
        this.eqHigh.type = 'highshelf';
        this.eqHigh.frequency.value = 3200;
        this.analyser.fftSize = 256;
        // Reutilizar el búfer evita allocar 60 veces por segundo por deck.
        this._vuBuf = new Uint8Array(this.analyser.frequencyBinCount);

        this.srcNode.connect(this.trimGain);
        this.trimGain.connect(this.eqLow);
        this.eqLow.connect(this.eqHigh);
        this.eqHigh.connect(this.chGain);
        this.chGain.connect(this.analyser);
        this.analyser.connect(xfGain);

        this.usingGraph = true;
      } catch (err) {
        console.warn('Deck ' + this.id + ': no se pudo montar el grafo Web Audio', err);
        this.usingGraph = false;
      }
    }

    if (!this.usingGraph) {
      console.warn('Deck ' + this.id + ': audio sin grafo (crossfader no aplicable al sonido).');
    }

    // Eventos del elemento de audio
    a.addEventListener('loadedmetadata', () => { this.applyPitch(); this.draw(); });
    a.addEventListener('canplay', () => { if (this.state === 'LOADING') this.setState('READY'); });
    a.addEventListener('play', () => { this.setState('PLAYING'); });
    a.addEventListener('playing', () => { this.setState('PLAYING'); });
    a.addEventListener('pause', () => { if (this.state === 'PLAYING') this.setState('PAUSED'); });
    a.addEventListener('timeupdate', () => this.draw());
    a.addEventListener('ended', () => this._onEnded());
    a.addEventListener('error', () => {
      if (!a.src) return;
      this.setState('ERROR');
      this.showMessage('NOT LOADED! No se pudo decodificar el archivo');
    });

    // Pitch
    if (this.elPitchFader) {
      this.pitch = Number(this.elPitchFader.value) || 0;
      this.elPitchFader.addEventListener('input', () => this.setPitch(Number(this.elPitchFader.value)));
    }
    if (this.btnPitchMinus) this.btnPitchMinus.addEventListener('click', () => this.nudgePitch(-1));
    if (this.btnPitchPlus) this.btnPitchPlus.addEventListener('click', () => this.nudgePitch(1));
    if (this.btnPitchDefault) this.btnPitchDefault.addEventListener('click', () => this.setPitch(0));

    // Transporte
    if (this.elCueBtn) this.elCueBtn.addEventListener('click', () => this.cue());
    if (this.elPlayBtn) this.elPlayBtn.addEventListener('click', () => this._playToggle());
    if (this.elExpelBtn) this.elExpelBtn.addEventListener('click', () => this.eject());
    if (this.elTrackPrev) this.elTrackPrev.addEventListener('click', () => this._adjacent(-1));
    if (this.elTrackEq) this.elTrackEq.addEventListener('click', () => this._cycleEq());

    // Ratón: drag & drop, LCD, barra de progreso, rueda de pitch y «/» con mantenido
    this._bindPointerUI();
  }

  // ---------- Interacción con el ratón ----------
  _bindPointerUI() {
    const r = this.root;
    if (!r) return;
    r.classList.add('drop-target');

    const dragTypes = (e) => {
      const dt = e.dataTransfer;
      const types = dt ? Array.from(dt.types || []) : [];
      return {
        files: types.includes('Files') || !!(dt && dt.files && dt.files.length),
        row: types.includes('text/plain')
      };
    };

    // Un archivo del explorador o una fila de la biblioteca pueden caer en este deck.
    // stopPropagation() evita que el manejador global de la app vuelva a añadir el archivo.
    const acceptDrag = (e) => {
      const t = dragTypes(e);
      if (!t.files && !t.row) return false;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      r.classList.add('drag-over');
      return true;
    };
    r.addEventListener('dragenter', acceptDrag);
    r.addEventListener('dragover', acceptDrag);
    r.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget || !r.contains(e.relatedTarget)) r.classList.remove('drag-over');
    });
    r.addEventListener('drop', (e) => {
      const t = dragTypes(e);
      if (!t.files && !t.row) return;
      e.preventDefault();
      e.stopPropagation();
      r.classList.remove('drag-over');

      // Archivos: se añaden a la biblioteca y el primero se carga en este deck.
      if (t.files && e.dataTransfer.files && e.dataTransfer.files.length) {
        const lib = window.Library;
        const tracks = lib && typeof lib.addFiles === 'function'
          ? lib.addFiles(e.dataTransfer.files) : [];
        if (tracks.length) {
          if (typeof lib.select === 'function') lib.select(tracks[0]);
          this.load(tracks[0]);
          this.showMessage(tracks[0].name);
          window.setStatus && window.setStatus('Player ' + this.id.toUpperCase() + ' ← ' + tracks[0].title);
        }
        return;
      }

      // Fila de la biblioteca: arrastrar y soltar también carga en este deck.
      const id = e.dataTransfer && e.dataTransfer.getData('text/plain');
      if (!id || !window.Library) return;
      const track = window.Library.tracks.find(t => String(t.id) === String(id));
      if (track) {
        window.Library.select(track);
        this.load(track);
        this.showMessage(track.name);
        window.setStatus && window.setStatus(track.title + ' → Player ' + this.id.toUpperCase());
      }
    });

    // Clic en una LCD vacía (CLOSED): selector de archivos directo para este deck.
    const lcd = r.querySelector('.lcd');
    this.elLcd = lcd;
    if (lcd) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.opus';
      input.multiple = true;
      input.hidden = true;
      input.className = 'deck-file-input';
      r.appendChild(input);
      this.elFileInput = input;

      input.addEventListener('change', () => {
        const lib = window.Library;
        const tracks = lib && typeof lib.addFiles === 'function'
          ? lib.addFiles(input.files) : [];
        if (tracks.length) {
          if (typeof lib.select === 'function') lib.select(tracks[0]);
          this.load(tracks[0]);
          this.showMessage(tracks[0].name);
        }
        input.value = '';
      });

      lcd.addEventListener('click', (e) => {
        if (e.target.closest('.lcd-info')) return;              // INFO tiene su propio listener
        if (this.track && e.target.closest('.lcd-timer')) return; // el timer es zona de seek
        if (this.track) return;                                 // LCD ocupada: no se recarga
        e.preventDefault();
        input.click();
      });

      const timer = r.querySelector('.lcd-timer');
      if (timer) this._bindLcdSeek(timer);
    }

    // Rueda del ratón sobre el fader de pitch (y sobre todo el bloque PITCH).
    if (this.elPitchFader) {
      const onPitchWheel = (e) => {
        e.preventDefault();
        const step = Number(this.elPitchFader.step) || 0.5;
        this.nudgePitch((e.deltaY > 0 ? -1 : 1) * step);
      };
      this.elPitchFader.addEventListener('wheel', onPitchWheel, { passive: false });
      const pitchBlock = r.querySelector('.pitch-block');
      if (pitchBlock) {
        pitchBlock.addEventListener('wheel', (e) => {
          if (e.target !== this.elPitchFader) onPitchWheel(e);
        }, { passive: false });
      }
    }

    // « y »: clic = ±10 s; mantener pulsado = saltos cada vez mayores.
    this._bindSeekHold(this.elTrackRew, -1);
    this._bindSeekHold(this.elTrackFf, 1);
  }

  _bindLcdSeek(timer) {
    let dragging = false;
    const seekFromEvent = (e) => {
      const a = this.audio;
      if (!a || !Number.isFinite(a.duration) || a.duration <= 0) return;
      const box = timer.getBoundingClientRect();
      if (!box || !box.width) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
      this._seekTo(ratio * a.duration);
    };
    timer.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!this.track || !Number.isFinite(this.audio.duration)) return;
      dragging = true;
      try { timer.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      seekFromEvent(e);
      e.preventDefault();
    });
    timer.addEventListener('pointermove', (e) => { if (dragging) seekFromEvent(e); });
    const stop = (e) => {
      dragging = false;
      try { timer.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    };
    timer.addEventListener('pointerup', stop);
    timer.addEventListener('pointercancel', stop);
  }

  _bindSeekHold(btn, dir) {
    if (!btn) return;
    let delayTimer = null, repeatTimer = null, step = 10, repeated = false;

    const stop = () => {
      if (delayTimer) { clearTimeout(delayTimer); delayTimer = null; }
      if (repeatTimer) { clearTimeout(repeatTimer); repeatTimer = null; }
    };
    const start = (e) => {
      if (e.type === 'mousedown' && e.button !== 0) return;
      stop();
      step = 10;
      repeated = false;
      delayTimer = setTimeout(() => {
        const tick = () => {
          this.seek(dir * step);
          step = Math.min(120, step * 1.6);
          repeated = true;
          repeatTimer = setTimeout(tick, 90);
        };
        tick();
      }, 250);
    };

    btn.addEventListener('mousedown', start);
    btn.addEventListener('touchstart', start, { passive: false });
    btn.addEventListener('mouseleave', stop);
    document.addEventListener('mouseup', stop);
    document.addEventListener('touchend', stop);
    btn.addEventListener('click', () => {
      stop();
      if (!repeated) this.seek(dir * 10);
      repeated = false;
    });
  }

  _xfadeGain() {
    if (!this.xfade) return null;
    const key = this.id.toUpperCase();
    const slot = this.xfade[key] || this.xfade[this.id];
    return slot ? slot.gain : null;
  }

  // ---------- Estados ----------
  setState(s) {
    this.state = s;
    if (this.elStatus) this.elStatus.textContent = s;
    this.draw();
  }

  showMessage(text) {
    if (this.elMessage) this.elMessage.textContent = text;
  }

  get info() {
    if (!this.track) return '';
    const d = this.audio && Number.isFinite(this.audio.duration) ? this._formatTime(this.audio.duration) : '--:--.-';
    return [this.track.artist, this.track.title, d].filter(Boolean).join(' · ');
  }

  // ---------- Carga y reproducción ----------
  load(track, autoplay = false) {
    if (!track || !track.url) return Promise.resolve(false);
    this.track = track;
    this.autoplayAfterLoad = autoplay;
    this.cuePoint = 0;
    this.setState('LOADING');
    this.showMessage(track.name || '-- cargando --');
    this.audio.src = track.url;
    this.audio.load();
    this.applyPitch();

    return new Promise((resolve) => {
      const done = (ok) => {
        this.audio.removeEventListener('canplay', onReady);
        this.audio.removeEventListener('error', onErr);
        if (ok && this.autoplayAfterLoad) {
          this.autoplayAfterLoad = false;
          this.play();
        }
        resolve(ok);
      };
      const onReady = () => done(true);
      const onErr = () => done(false);
      this.audio.addEventListener('canplay', onReady);
      this.audio.addEventListener('error', onErr);
    });
  }

  play() {
    if (!this.audio.src) {
      if (this.track && this.track.url) return this.load(this.track, true);
      return Promise.resolve(false);
    }
    const p = this.audio.play();
    if (!p) { this.setState('PLAYING'); return Promise.resolve(true); }
    return p.then(() => { this.setState('PLAYING'); return true; })
      .catch((err) => {
        // Autoplay bloqueado o archivo no reproducible
        this.showMessage('PLAY ERROR: ' + (err && err.name ? err.name : 'desconocido'));
        return false;
      });
  }

  pause() {
    if (this.audio && !this.audio.paused) this.audio.pause();
    if (this.state === 'PLAYING') this.setState('PAUSED');
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      try { this.audio.currentTime = 0; } catch (_) { /* ignore */ }
    }
    this.setState('CLOSED');
  }

  eject() {
    this.stop();
    if (this.audio) {
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    this.track = null;
    this.cuePoint = 0;
    this.lv = 0;
    this.showMessage('-- sin pista --');
    if (this.elMessage) this.elMessage.textContent = '-- sin pista --';
    this.leds.forEach(led => { led.style.background = 'var(--led-off)'; });
  }

  _playToggle() {
    if (!this.audio.src) { this.play(); return; }
    if (this.state === 'PLAYING') this.pause();
    else this.play();
  }

  _onEnded() {
    this.setState('ENDED');
    this.leds.forEach(led => { led.style.background = 'var(--led-red)'; });
    if (window.Library) window.Library.markPlayed(this.track);
    if (typeof window.onDeckEnded === 'function') window.onDeckEnded(this);
  }

  // ---------- CUE ----------
  cue() {
    if (!this.audio.src || !this.track) {
      this.showMessage('NOT LOADED! Invalid floating point operation');
      return;
    }
    const t = this.audio.currentTime || 0;
    const atCue = Math.abs(t - this.cuePoint) < 0.2;

    if (!atCue) {
      // Volver al punto cue
      this._seekTo(this.cuePoint);
      this.showMessage('CUE  ' + this._formatTime(this.cuePoint));
    } else if (this.state === 'PLAYING') {
      // En el punto cue y sonando: pausar (comportamiento clásico de deck)
      this.pause();
      this.showMessage('CUE  ' + this._formatTime(this.cuePoint) + '  (PAUSA)');
    } else {
      // En el punto cue y parado: marcar aquí el nuevo punto cue
      this.cuePoint = t;
      this.showMessage('CUE SET  ' + this._formatTime(t));
    }
  }

  // ---------- Pitch ----------
  setPitch(v) {
    v = Math.max(-24, Math.min(24, Number(v) || 0));
    this.pitch = v;
    if (this.elPitchFader) this.elPitchFader.value = String(v);
    if (this.elPitchDisplay) {
      this.elPitchDisplay.textContent = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    }
    this.applyPitch();
    return v;
  }

  applyPitch() {
    if (this.audio) this.audio.playbackRate = 1 + this.pitch / 100;
  }

  nudgePitch(delta) { this.setPitch(this.pitch + delta); }
  resetPitch() { this.setPitch(0); }

  // ---------- Volumen / trim / EQ ----------
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.usingGraph && this.chGain) this.chGain.gain.value = this.volume;
    else if (this.audio) this.audio.volume = this.volume * this.trim;
  }

  setTrim(v) {
    this.trim = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.usingGraph && this.trimGain) this.trimGain.gain.value = this.trim;
    else if (this.audio) this.audio.volume = this.volume * this.trim;
  }

  _cycleEq() {
    this.eqIndex = (this.eqIndex + 1) % EQ_PRESETS.length;
    const p = EQ_PRESETS[this.eqIndex];
    if (this.eqLow) this.eqLow.gain.value = p.low;
    if (this.eqHigh) this.eqHigh.gain.value = p.high;
    if (this.elTrackEq) this.elTrackEq.classList.toggle('active', this.eqIndex !== 0);
    this.showMessage('EQ  ' + p.name);
  }

  // ---------- Navegación / seek ----------
  seek(delta) {
    if (!this.audio.src || !Number.isFinite(this.audio.duration)) return;
    this._seekTo(this.audio.currentTime + delta);
  }

  _seekTo(t) {
    if (!Number.isFinite(this.audio.duration)) return;
    const d = this.audio.duration;
    try { this.audio.currentTime = Math.max(0, Math.min(d - 0.05, t)); } catch (_) { /* ignore */ }
    this.draw();
  }

  _adjacent(dir) {
    if (window.Library && typeof window.Library.loadAdjacent === 'function') {
      window.Library.loadAdjacent(this.id, dir);
    }
  }

  // ---------- Bucle de dibujo ----------
  _tick() {
    this.draw();
    this._raf = requestAnimationFrame(this._tick);
  }

  draw() {
    const a = this.audio;
    if (!a) return;
    const d = a.duration;
    const ok = Number.isFinite(d) && d > 0;
    const cur = a.currentTime || 0;

    if (this.elElapsed) this.elElapsed.textContent = ok ? this._formatTime(cur) : '00:00.0';
    if (this.elRemaining) this.elRemaining.textContent = ok ? '-' + this._formatTime(d - cur) : '-00:00.0';
    if (this.elProgress) this.elProgress.style.width = ok ? (cur / d * 100).toFixed(2) + '%' : '0%';
    if (this.elStatus) this.elStatus.textContent = this.state;
    if (this.elLcd) this.elLcd.classList.toggle('lcd-loadable', !this.track);

    this._updateVu();
    this._updateLEDs();
  }

  _formatTime(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const tenth = Math.floor((s % 1) * 10);
    return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + tenth;
  }

  _updateVu() {
    let level = 0;
    if (this.analyser && this.usingGraph) {
      const buf = this._vuBuf;
      this.analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      level = peak / 128;
    } else if (this.state === 'PLAYING') {
      // Vúmetro visual aunque no haya Web Audio
      level = 0.35 + 0.22 * Math.abs(Math.sin(performance.now() / 130 + (this.id === 'b' ? 1 : 0)));
    }

    // El analizador está después de VOL/TRIM/EQ pero antes del crossfader.
    // Aplicamos su ganancia para que el vúmetro del player baje al mover
    // el crossfader con ratón o rueda, igual que el sonido que se escucha.
    if (level > 0 && window.getXfGain) level *= window.getXfGain(this.id);

    // Ataque rápido / caída suave: lectura fluida sin parpadeos.
    this.lv = Math.max(this.lv * 0.86, Math.min(1, level));

    const n = this.vuSegments.length;
    for (let i = 0; i < n; i++) {
      const lit = this.lv >= (i + 1) / n;
      const seg = this.vuSegments[i];
      seg.style.background = lit
        ? (i >= n - 2 ? 'var(--led-rojo)' : i >= n - 4 ? '#ec3' : 'var(--led-verde)')
        : 'var(--vu-off)';
    }
  }

  _updateLEDs() {
    if (!this.track || !this.audio || !this.leds.length) return;
    const d = this.audio.duration || 0;
    const cur = this.audio.currentTime || 0;
    const remaining = Math.max(0, d - cur);
    const lit = Math.min(this.leds.length, Math.floor(remaining / 3));
    this.leds.forEach((led, i) => {
      led.style.background = i < lit ? 'var(--led-rojo)' : 'var(--led-off)';
    });
  }
}

window.Deck = Deck;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Deck };
}
