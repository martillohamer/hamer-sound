// tests/logic.test.js — Contratos de DJ HAMMER sin dependencias externas.
// Executar: node --test tests/
// Los módulos se cargan en un contexto VM con un DOM mínimo: no se necesita
// jsdom, navegador ni instalación de paquetes.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

function makeElement(id = '') {
  const listeners = new Map();
  const set = new Set();
  const el = {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    hidden: false,
    files: null,
    dataset: {},
    style: { setProperty() {} },
    classList: {
      add(...c) { c.forEach(x => set.add(x)); },
      remove(...c) { c.forEach(x => set.delete(x)); },
      toggle(c, force) { force ? set.add(c) : set.delete(c); },
      contains(c) { return set.has(c); }
    },
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    fire(type, ev = {}) { (listeners.get(type) || []).slice().forEach(fn => fn(ev)); },
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild() {},
    removeAttribute() {},
    contains() { return false; },
    closest() { return null; },
    getBoundingClientRect() { return { width: 0, height: 0, left: 0, top: 0 }; },
    click() { el.clicks = (el.clicks || 0) + 1; },
    focus() {}
  };
  return el;
}

function loadScript(file, extra = {}) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const elements = new Map();
  const store = new Map();
  const revoked = [];
  let urlSeq = 0;
  const statuses = [];

  const getEl = (sel) => {
    const key = String(sel).replace(/^#/, '');
    if (!elements.has(key)) elements.set(key, makeElement(key));
    return elements.get(key);
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Number, String, Array, Object, Set, Map, Promise, Boolean,
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    URL: {
      createObjectURL: () => 'blob:test-' + (++urlSeq),
      revokeObjectURL: u => revoked.push(u)
    },
    Audio: class AudioStub {},
    document: {
      querySelector: sel => (String(sel).startsWith('#') ? getEl(sel) : null),
      querySelectorAll: () => [],
      getElementById: id => getEl(id),
      addEventListener() {},
      createElement: () => makeElement(),
      body: makeElement()
    },
    module: { exports: {} },
    setStatus: msg => statuses.push(String(msg)),
    ...extra
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.runInNewContext(source, sandbox, { filename: file });
  return { sandbox, getEl, store, revoked, statuses };
}

// Contexto Web Audio mínimo: sólo lo que audio.js necesita para construir
// master + crossfader. Permite comprobar la curva cos/sen sin navegador.
class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = { connect() {} };
  }
  createGain() { return { gain: { value: 0, setTargetAtTime() {} }, connect() {} }; }
  createBiquadFilter() { return { type: '', frequency: { value: 0, setTargetAtTime() {} }, Q: { value: 1 }, gain: { value: 0, setTargetAtTime() {} }, connect() {} }; }
  createAnalyser() { return { fftSize: 256, frequencyBinCount: 128, getByteTimeDomainData() {}, connect() {} }; }
  createDelay() { return { delayTime: { value: 0 }, connect() {} }; }
  createMediaElementSource() { return { connect() {} }; }
}

// ---------------------------------------------------------------------------
// Web Audio: curva, master, AUTO y sin persistencia de blob:
// ---------------------------------------------------------------------------

test('setXf usa la curva cos/sen de potencia constante', () => {
  const { sandbox } = loadScript('js/audio.js', { AudioContext: FakeAudioContext });
  const A = sandbox.xfade.A.gain.gain;
  const B = sandbox.xfade.B.gain.gain;

  sandbox.setXf(-1);
  assert.ok(Math.abs(A.value - 1) < 1e-9, 'A = 1 con el fader al lado A');
  assert.ok(Math.abs(B.value) < 1e-9, 'B = 0 con el fader al lado A');

  sandbox.setXf(0);
  assert.ok(Math.abs(A.value - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(B.value - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(A.value * A.value + B.value * B.value - 1) < 1e-9, 'A² + B² = 1');

  sandbox.setXf(1);
  assert.ok(Math.abs(A.value) < 1e-9);
  assert.ok(Math.abs(B.value - 1) < 1e-9);
  assert.equal(sandbox.getXfGain('b'), B.value);
});

test('mover el crossfader con user:true cancela AUTO', () => {
  let cancels = 0;
  const { sandbox } = loadScript('js/audio.js', {
    AudioContext: FakeAudioContext,
    AutoMode: { cancelByUser: () => { cancels++; } }
  });
  sandbox.setXf(0.3, { user: true });
  assert.equal(cancels, 1);
  sandbox.setXf(0.4, { fromSlider: true }); // ruta del slider AUTO: sin cancelar
  assert.equal(cancels, 1);
});

test('setMaster sincroniza controles, respeta STANDBY y nunca persiste blob', () => {
  const { sandbox, store, getEl } = loadScript('js/audio.js', { AudioContext: FakeAudioContext });
  sandbox.setMaster(0.4);
  assert.equal(store.get('hammer:master'), '0.4');
  for (const id of ['master', 'cfg-master', 'main-level']) {
    assert.equal(getEl(id).value, '0.4', id + ' refleja el master');
  }
  assert.equal(getEl('main-out').textContent, '40%');
  assert.equal(sandbox.getMaster(), 0.4);

  sandbox.setMaster(0, false); // STANDBY: silencio sin persistir
  assert.equal(store.get('hammer:master'), '0.4');
  assert.equal(sandbox.masterGain.gain.value, 0);
  assert.ok(!JSON.stringify([...store]).includes('blob:'));
});

// ---------------------------------------------------------------------------
// Biblioteca: metadatos, pistas sin archivo, enrutado y re-enlace.
// ---------------------------------------------------------------------------

function libraryFixture() {
  const fx = loadScript('js/library.js');
  const Lib = fx.sandbox.Library;
  const calls = [];
  const decks = {};
  for (const id of ['A', 'B']) {
    decks[id] = {
      id: id.toLowerCase(),
      audio: { src: '', paused: true },
      load(track, autoplay) {
        calls.push({ deck: id, trackId: track && track.id, autoplay });
        return Promise.resolve(true);
      },
      notifyMissing(track) { calls.push({ deck: id, missing: track && track.id }); },
      showMessage() {}
    };
  }
  fx.sandbox.decks = decks;
  Lib.tracks = [];
  Lib.folders = [{ id: 'default', name: 'Default' }];
  return { ...fx, Lib, calls, decks };
}

test('el store guarda solo metadatos: jamás una URL blob:', () => {
  const { Lib, store } = libraryFixture();
  Lib.tracks = [{
    id: 1, key: 'a|1|2', name: 'a', title: 'A', artist: '', size: 1,
    lastModified: 2, url: 'blob:SECRETO', missing: false, played: false, folder: 'default'
  }];
  Lib._writeStore();
  const raw = store.get(Lib.libKey);
  assert.ok(raw && !raw.includes('blob:'), 'no se serializó la URL');
  assert.ok(raw.includes('"title":"A"'), 'se conservan los metadatos');
});

test('_restore devuelve pistas sin archivo como url:null / missing:true', () => {
  const { Lib, store } = libraryFixture();
  store.set(Lib.libKey, JSON.stringify({
    folders: [{ id: 'default', name: 'Default' }],
    activeFolder: 'all',
    tracks: [{ id: 1, name: 'a', title: 'A', size: 1, lastModified: 2, folder: 'default' }]
  }));
  Lib._restore();
  assert.equal(Lib.tracks.length, 1);
  assert.equal(Lib.tracks[0].url, null);
  assert.equal(Lib.tracks[0].missing, true);
});

test('loadTo enruta a A y a B por el mismo camino con autoplay', () => {
  const { Lib, calls } = libraryFixture();
  const a = { id: 1, title: 'A', url: 'blob:1', folder: 'default' };
  const b = { id: 2, title: 'B', url: 'blob:2', folder: 'default' };
  Lib.tracks = [a, b];
  Lib.loadTo(a, 'A', true);
  Lib.loadTo(b, 'B', true);
  assert.deepEqual(calls.map(c => [c.deck, c.trackId, c.autoplay]), [
    ['A', 1, true], ['B', 2, true]
  ], 'simetría A/B: mismo núcleo, mismo autoplay');
});

test('una pista restaurada sin archivo NO carga ni abre el selector', () => {
  const { Lib, calls, getEl } = libraryFixture();
  const missing = { id: 1, title: 'Vieja', url: null, missing: true, folder: 'default' };
  Lib.tracks = [missing];
  Lib._relinkInput = getEl('relink-file-input');

  assert.equal(Lib.loadTo(missing, 'A', true), false);
  assert.equal(Lib.dropTo(missing.id, 'B', true, null), false);
  assert.ok(calls.some(c => c.missing === 1), 'aviso en el deck');
  assert.ok(!calls.some(c => c.trackId), 'ninguna llamada a Deck.load()');
  assert.equal(Lib._relinkInput.clicks || 0, 0, 'el drop nunca abre el selector');
});

test('un archivo no compatible avisa con claridad y no carga nada', () => {
  const { Lib, calls, statuses } = libraryFixture();
  const file = { name: 'notas.txt', type: 'text/plain', size: 10, lastModified: 1 };
  const ev = {
    dataTransfer: { files: [file], types: ['Files'], getData: () => '' }
  };
  assert.equal(Lib.dropTo(null, 'A', true, ev), false);
  assert.ok(!calls.some(c => c.trackId));
  assert.ok(statuses.some(s => s.includes('Formato no compatible')),
    'mensaje.clear: ' + JSON.stringify(statuses));
  assert.ok(!statuses.some(s => s.includes('No se pudo identificar')),
    'el aviso claro no debe ser sobrescrito');
});

test('relink conserva la identidad y no revoca una URL en uso', () => {
  const { Lib, decks, revoked, store } = libraryFixture();
  const old = 'blob:en-uso';
  const track = {
    id: 1, name: 'x', title: 'X', size: 1, lastModified: 2,
    key: 'x|1|2', url: old, missing: false, folder: 'default'
  };
  Lib.tracks = [track];
  decks.A.audio.src = old; // el deck A todavía la está usando
  const file = { name: 'x.mp3', type: 'audio/mpeg', size: 1, lastModified: 2 };

  assert.equal(Lib.relink(track, file), true);
  assert.equal(revoked.length, 0, 'no se revocó una URL en uso');
  assert.ok(track.url.startsWith('blob:'));
  assert.equal(track.missing, false);
  assert.ok(!store.get(Lib.libKey).includes('blob:'));
});

test('AUTO solo elige pistas con archivo en la sesión', () => {
  const { Lib } = libraryFixture();
  Lib.tracks = [
    { id: 1, url: 'blob:1', played: false },
    { id: 2, url: null, missing: true, played: false },
    { id: 3, url: 'blob:3', played: true }
  ];
  const next = Lib.nextUnplayed();
  assert.equal(next && next.id, 1, 'ignora la pista restaurada y la ya reproducida');
  assert.equal(Lib.nextUnplayed(1), null);
});

test('la supresión de clic de LCD es por deck, no global', () => {
  const { Lib } = libraryFixture();
  Lib.markDrop('A');
  assert.equal(Lib.shouldIgnoreLcdClick('A'), true);
  assert.equal(Lib.shouldIgnoreLcdClick('A'), false, 'se consume una sola vez');
  assert.equal(Lib.shouldIgnoreLcdClick('B'), false, 'B nunca queda afectado');
});

test('select(track, false) no repinta la tabla (preserva dblclick)', () => {
  const { Lib, getEl } = libraryFixture();
  const tbody = getEl('library-rows');
  const row = makeElement();
  row.dataset.id = '1';
  tbody.querySelectorAll = () => [row];
  tbody.innerHTML = '<tr data-id="1"></tr>';

  Lib.select({ id: 1, title: 'A' }, false);
  assert.equal(tbody.innerHTML, '<tr data-id="1"></tr>', 'sin innerHTML nuevo');
  assert.equal(row.classList.contains('sel'), true);
});

// ---------------------------------------------------------------------------
// Reintento de play(): no debe generar reproducciones fantasma.
// ---------------------------------------------------------------------------

function retryFixture() {
  const { sandbox } = loadScript('js/deck.js');
  const listeners = new Map();
  const audio = {
    src: 'blob:original',
    readyState: 0,
    paused: true,
    addEventListener(t, fn) {
      if (!listeners.has(t)) listeners.set(t, []);
      listeners.get(t).push(fn);
    },
    removeEventListener(t, fn) {
      const arr = listeners.get(t) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    fire(t) { (listeners.get(t) || []).slice().forEach(fn => fn()); }
  };
  const played = [];
  const deck = Object.create(sandbox.Deck.prototype);
  deck.id = 'a';
  deck.audio = audio;
  deck.track = { id: 1 };
  deck._loadToken = 5;
  deck.play = (retry) => { played.push(retry); return Promise.resolve(true); };
  return { deck, audio, played };
}

test('el reintento tras AbortError reproduce la pista original una sola vez', async () => {
  const { deck, audio, played } = retryFixture();
  const result = deck._retryPlayAfterAbort();
  audio.fire('canplay');
  assert.equal(await result, true);
  assert.deepEqual(played, [false]);
});

test('el reintento se cancela si mientras tanto se cargó otra pista', async () => {
  const { deck, audio, played } = retryFixture();
  const result = deck._retryPlayAfterAbort();
  deck._loadToken = 6;      // nueva carga
  audio.src = 'blob:nueva';
  audio.fire('canplay');
  assert.equal(await result, false);
  assert.deepEqual(played, [], 'no se reproduce la pista nueva por accidente');
});

test('el reintento se cancela si se expulsó el plato', async () => {
  const { deck, audio, played } = retryFixture();
  const result = deck._retryPlayAfterAbort();
  deck.track = null;
  audio.fire('loadeddata');
  assert.equal(await result, false);
  assert.deepEqual(played, []);
});

// ---------------------------------------------------------------------------
// Estructura HTML/guardias: comprobaciones estáticas de los contratos.
// ---------------------------------------------------------------------------

test('index.html mantiene simetría A/B de IDs', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const keys = new Set([...ids]
    .filter(x => x.startsWith('player-a-'))
    .map(x => x.slice('player-a-'.length)));
  assert.ok(keys.size > 10, 'hay controles por deck');
  for (const key of keys) {
    assert.ok(ids.has('player-b-' + key), 'falta player-b-' + key);
  }
});

test('los tres mecanismos de carga convergen en Library.loadTo/dropTo', () => {
  const lib = fs.readFileSync(path.join(ROOT, 'js/library.js'), 'utf8');
  const deck = fs.readFileSync(path.join(ROOT, 'js/deck.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  assert.match(lib, /data-quick-deck[\s\S]{0,200}self\.loadTo\(track, quick\.dataset\.quickDeck, true\)/);
  assert.match(lib, /addEventListener\('dblclick'[\s\S]{0,400}self\.loadTo\(track, self\._preferredDeck\(\), true\)/);
  assert.match(lib, /self\.loadTo\(track, deck, autoplay\)/); // menú contextual
  assert.match(lib, /self\.dropTo\(id, deckId, true, e\)/);
  assert.match(deck, /lib\.dropTo\(id, this\.id, true, e\)/);
  assert.match(html, /data-ctx-deck="A"/);
  assert.match(html, /data-ctx-deck="B"/);
  assert.equal((html.match(/data-ctx-deck=/g) || []).length, 2,
    'un menú, una opción por deck (sin duplicados)');
});

test('ningún módulo persiste URLs blob: en localStorage', () => {
  const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
    const writes = src.match(/localStorage\.setItem\([^;]+/g) || [];
    for (const w of writes) {
      assert.ok(!/blob:|createObjectURL|\.url\b/.test(w), f + ': ' + w);
    }
  }
});
