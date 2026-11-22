// midi.js — Integración Web MIDI segura y preparada para la Numark NV II.
// Reglas: nunca lanza si el navegador no soporta Web MIDI o no hay permiso;
// no escribe en localStorage; no toca el grafo de audio por su cuenta.
// La tabla de mapeo es una plantilla: los números son provisionales y deben
// confirmarse con un monitor MIDI al conectar el hardware real.
'use strict';

(function () {
  const NV2_MAPPING = {
    device: 'Numark NV II',
    notice: 'Números CC/nota provisionales: verifícalos con un monitor MIDI al conectar la NV II. ' +
            'Los controles de plato respetan el bloqueo de AUTO en main.js.',
    controls: [
      { id: 'play_a',    deck: 'A', label: 'PLAY/PAUSE A', kind: 'note', channel: 0, number: 115, action: 'playToggle' },
      { id: 'play_b',    deck: 'B', label: 'PLAY/PAUSE B', kind: 'note', channel: 0, number: 116, action: 'playToggle' },
      { id: 'cue_a',     deck: 'A', label: 'CUE A',        kind: 'note', channel: 0, number: 117, action: 'cue' },
      { id: 'cue_b',     deck: 'B', label: 'CUE B',        kind: 'note', channel: 0, number: 118, action: 'cue' },
      { id: 'pitch_a',   deck: 'A', label: 'PITCH A',      kind: 'cc',   channel: 0, number: 21, action: 'pitch',  min: -24, max: 24 },
      { id: 'pitch_b',   deck: 'B', label: 'PITCH B',      kind: 'cc',   channel: 0, number: 22, action: 'pitch',  min: -24, max: 24 },
      { id: 'trim_a',    deck: 'A', label: 'TRIM A',       kind: 'cc',   channel: 0, number: 23, action: 'trimDb', min: -12, max: 12 },
      { id: 'trim_b',    deck: 'B', label: 'TRIM B',       kind: 'cc',   channel: 0, number: 24, action: 'trimDb', min: -12, max: 12 },
      { id: 'eq_low_a',  deck: 'A', label: 'EQ LOW A',     kind: 'cc',   channel: 0, number: 25, action: 'eq', band: 'low',  min: -12, max: 12 },
      { id: 'eq_mid_a',  deck: 'A', label: 'EQ MID A',     kind: 'cc',   channel: 0, number: 26, action: 'eq', band: 'mid',  min: -12, max: 12 },
      { id: 'eq_high_a', deck: 'A', label: 'EQ HIGH A',    kind: 'cc',   channel: 0, number: 27, action: 'eq', band: 'high', min: -12, max: 12 },
      { id: 'eq_low_b',  deck: 'B', label: 'EQ LOW B',     kind: 'cc',   channel: 0, number: 28, action: 'eq', band: 'low',  min: -12, max: 12 },
      { id: 'eq_mid_b',  deck: 'B', label: 'EQ MID B',     kind: 'cc',   channel: 0, number: 29, action: 'eq', band: 'mid',  min: -12, max: 12 },
      { id: 'eq_high_b', deck: 'B', label: 'EQ HIGH B',    kind: 'cc',   channel: 0, number: 30, action: 'eq', band: 'high', min: -12, max: 12 },
      { id: 'filter_a',  deck: 'A', label: 'FILTER A',     kind: 'cc',   channel: 0, number: 41, action: 'filterCutoff' },
      { id: 'filter_b',  deck: 'B', label: 'FILTER B',     kind: 'cc',   channel: 0, number: 42, action: 'filterCutoff' },
      { id: 'jog_a',     deck: 'A', label: 'JOG A (rel.)', kind: 'cc',   channel: 0, number: 43, action: 'jog', relative: true },
      { id: 'jog_b',     deck: 'B', label: 'JOG B (rel.)', kind: 'cc',   channel: 0, number: 44, action: 'jog', relative: true },
      { id: 'xfade',     deck: '—', label: 'CROSSFADER',   kind: 'cc',   channel: 0, number: 45, action: 'xfade', min: -1, max: 1 },
      { id: 'brake_a',   deck: 'A', label: 'BRAKE A',      kind: 'note', channel: 0, number: 119, action: 'brake', noAuto: true },
      { id: 'brake_b',   deck: 'B', label: 'BRAKE B',      kind: 'note', channel: 0, number: 120, action: 'brake', noAuto: true },
      { id: 'start_a',   deck: 'A', label: 'START A',      kind: 'note', channel: 0, number: 121, action: 'start', noAuto: true },
      { id: 'start_b',   deck: 'B', label: 'START B',      kind: 'note', channel: 0, number: 122, action: 'start', noAuto: true }
    ]
  };

  const Midi = {
    mapping: NV2_MAPPING,
    supported: false,
    status: 'off',          // off | ready | connected
    access: null,
    inputs: [],
    activeInput: null,
    selectedId: '',
    onControl: null,        // main.js puede asignar aquí el manejador real
    _inited: false,

    init() {
      if (this._inited) return;
      this._inited = true;

      this._renderMap();

      const select = document.getElementById('midi-input');
      if (select) {
        select.addEventListener('change', () => {
          if (!select.value) {
            this._bind(null);
            this._setStatus('ready', 'Web MIDI listo · ningún dispositivo seleccionado');
            return;
          }
          const input = this.inputs.find(i => String(i.id) === String(select.value));
          if (input) {
            this.selectedId = String(input.id);
            this._bind(input);
            this._setStatus('connected', 'MIDI conectado: ' + (input.name || 'dispositivo'));
          }
        });
      }

      if (!navigator.requestMIDIAccess) {
        this._setStatus('off', 'Web MIDI no soportado por este navegador');
        return;
      }

      this.supported = true;
      this._setStatus('ready', 'Web MIDI listo · esperando controlador');

      try {
        const promise = navigator.requestMIDIAccess({ sysex: false }); // sin SYSEX
        if (!promise || typeof promise.then !== 'function') {
          this._setStatus('off', 'Web MIDI no devolvió acceso');
          return;
        }
        promise.then((access) => {
          this.access = access;
          if (access && typeof access === 'object') {
            try { access.onstatechange = () => this._refresh(access); } catch (_) { /* ignore */ }
            this._refresh(access);
          }
        }).catch((err) => {
          this._setStatus('off', 'Acceso MIDI denegado: ' + ((err && err.name) || 'error'));
        });
      } catch (err) {
        this._setStatus('off', 'Web MIDI no disponible: ' + ((err && err.name) || 'error'));
      }
    },

    _refresh(access) {
      const list = [];
      try { access.inputs.forEach((input) => list.push(input)); } catch (_) { /* ignore */ }
      this.inputs = list;
      this._populateSelect(list);

      if (!list.length) {
        this._bind(null);
        this._setStatus('ready', 'Web MIDI listo · esperando Numark NV II');
        return;
      }

      let chosen = list.find(i => String(i.id) === String(this.selectedId)) || list[0];
      this.selectedId = String(chosen.id);
      this._bind(chosen);
      this._setStatus('connected', 'MIDI conectado: ' + (chosen.name || 'dispositivo'));
    },

    _populateSelect(list) {
      const select = document.getElementById('midi-input');
      if (!select) return;
      select.innerHTML = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'Ninguno';
      select.appendChild(none);
      list.forEach((input) => {
        const opt = document.createElement('option');
        opt.value = String(input.id);
        opt.textContent = input.name || 'Controlador MIDI';
        select.appendChild(opt);
      });
      select.value = this.activeInput ? String(this.activeInput.id) : '';
      select.hidden = false;
    },

    _bind(input) {
      if (this.activeInput && this.activeInput !== input) {
        try { this.activeInput.onmidimessage = null; } catch (_) { /* ignore */ }
      }
      this.activeInput = input || null;
      if (input) {
        try { input.onmidimessage = (e) => this._message(e); }
        catch (err) { console.warn('[midi] no se pudo enlazar el dispositivo:', err); }
      }
      const select = document.getElementById('midi-input');
      if (select) select.value = input ? String(input.id) : '';
    },

    _message(e) {
      const data = e && e.data;
      if (!data || data.length < 3) return;
      const status = data[0] & 0xF0;
      const channel = data[0] & 0x0F;
      const number = data[1];
      const value = data[2];
      let kind;
      if (status === 0xB0) kind = 'cc';                 // Control Change
      else if (status === 0x90 && value > 0) kind = 'note'; // Note On
      else return; // ignora Note Off, clock, sysex, etc.

      const entry = this.mapping.controls.find(c =>
        c.kind === kind && c.channel === channel && c.number === number);
      if (!entry || typeof this.onControl !== 'function') return;

      try { this.onControl(entry, value, this); }
      catch (err) { console.warn('[midi] fallo al despachar ' + entry.id + ':', err); }
    },

    // 0..1 según el rango declarado en la tabla (por defecto 0..127).
    normalize(entry, value) {
      const min = Number.isFinite(entry.min) ? entry.min : 0;
      const max = Number.isFinite(entry.max) ? entry.max : 127;
      const v = Number(value);
      if (!Number.isFinite(v) || max === min) return 0;
      return Math.max(0, Math.min(1, (v - min) / (max - min)));
    },

    _setStatus(state, detail) {
      this.status = state;
      const el = document.getElementById('midi-status');
      if (el) {
        const label = state === 'connected' ? 'MIDI: conectado'
          : state === 'ready' ? 'MIDI: listo' : 'MIDI: desconectado';
        el.textContent = label;
        el.setAttribute('data-midi-state', state);
        el.title = detail || label;
      }
      if (detail && typeof window.setStatus === 'function') window.setStatus(detail);
    },

    _renderMap() {
      const tbody = document.getElementById('midi-map-rows');
      if (tbody) {
        tbody.innerHTML = '';
        this.mapping.controls.forEach(c => {
          const tr = document.createElement('tr');
          [c.label, c.deck, c.kind.toUpperCase(), String(c.channel), String(c.number), c.action]
            .forEach(text => {
              const td = document.createElement('td');
              td.textContent = text;
              tr.appendChild(td);
            });
          tbody.appendChild(tr);
        });
      }
      const note = document.getElementById('midi-map-note');
      if (note) note.textContent = this.mapping.device + ' · ' + this.mapping.notice;
    }
  };

  window.Midi = Midi;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Midi.init());
  } else {
    Midi.init();
  }
})();
