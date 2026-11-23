# dj. hammer

**Consola web de mezcla de dos decks** inspirada en el clásico **PCDJ Red** (el proyecto incluye `img/pcdj.png` como imagen de referencia) y en los flujos de mesa modernos de **Numark / Pioneer / Serato**. Se pincha completamente con el ratón, sobre un chasis metálico gris / plata / negro (paleta en `styles.css`, variables `--chassis`, `--plata`, `--aluminio`, `--lcd`) con cinco pieles seleccionables, incluida una exclusiva **Barça**.

> Documentación válida para la etiqueta **`Gold-DjHammer`** (`5233f67`). Hermana técnica: [HANDOFF.md](HANDOFF.md).

---

## 1. Propósito

Ofrecer en el navegador una mesa de DJ de dos platos con:

- Carga real de archivos del disco (sin subirlos a ningún servidor).
- Mezcla con crossfader de potencia constante, volúmenes, trim y vúmetros.
- Efectos Web Audio por deck y modo `AUTO` para encadenar temas.
- Biblioteca organizada en **recordcases / carpetas** con persistencia local segura.

La aplicación es **estática**: no hay backend, ni build, ni dependencias externas. Todo vive en `index.html`, `styles.css` y `js/*.js`.

---

## 2. Características implementadas hasta `Gold-DjHammer`

### 2.1 Decks simétricos A y B

Cada player (`#player-a`, `#player-b`) expone la misma interfaz:

| Zona | Elemento / ID | Comportamiento |
|---|---|---|
| Estado | `#player-a-status`, `#player-b-status` | `CLOSED`, `LOADING`, `READY`, `PLAYING`, `PAUSED`, `BRAKING`, `ENDED`, `ERROR` |
| LCD | `#player-a-elapsed`, `#player-a-remaining`, `#player-a-msg`, `.lcd-progress` | Transcurrido / restante en `mm:ss.d`, barra de progreso y mensajes de estado |
| INFO | `.lcd-info` | Muestra `artista · título · duración` en la LCD |
| Ficha detallada | `.deck-detail` | Título, artista, carpeta, duración, restante, BPM, pitch y estado en vivo |
| Transporte | `[data-cue]`, `[data-play]`, `[data-expel]`, `[data-track-prev]`, `[data-track-eq]`, `[data-track-rew]`, `[data-track-ff]` | CUE, PLAY/PAUSA, expulsar, pista anterior/anterior, ciclo de EQ, `«` / `»` |
| Pitch | `#player-a-pitch-fader` (`-24` a `+24`, paso `0.5`), `#player-a-pitch`, `[data-pitch-minus]`, `[data-pitch-plus]`, `[data-pitch-default]` | Ajusta `playbackRate = 1 + pitch/100`; `◆` vuelve a `0.0%` |
| TRIM | `#player-a-trim` (`±12 dB`), `#player-a-trim-val`, `#player-a-trim-reset` | Ganancia de entrada guardada por pista; `0 dB` la reinicia |
| EQ 3 bandas | `#player-a-low`, `#player-a-mid`, `#player-a-high` (`±12 dB`), `#player-a-eq-reset` | `lowshelf` 200 Hz + `peaking` 1000 Hz + `highshelf` 3200 Hz |
| Jog | `#player-a-jog`, `#player-a-jog-readout`, `#player-a-jog-reset` | Anillo de posición y aguja giratoria: arrastre circular/horizontal, rueda, doble clic = inicio |
| Vúmetro | `.player-vu` (12 segmentos) | Analizador Web Audio × ganancia del crossfader |
| LEDs | `.led-strip` (12 LEDs) | Cuenta atrás: 1 LED cada 3 s restantes |

Extras de ratón:

- Clic en una LCD **vacía** abre el selector de archivos de ese deck.
- Arrastre del `.lcd-timer` = *seek*; rueda sobre el bloque PITCH = ±`0.5`.
- `«` / `»`: clic = ±10 s; mantener pulsado acelera hasta 120 s.
- `=`: cicla los presets `FLAT → BASS → TREBLE → VOCAL` (filtros *lowshelf* 200 Hz, *peaking* 1000 Hz y *highshelf* 3200 Hz).
- Faders de TRIM/EQ: arrastre o rueda; doble clic los pone a `0 dB`; los botones `0 dB` / `EQ 0` reinician al instante.
- Jog: arrastra el **borde** del círculo para girar (una vuelta ≈ 8 s de audio) o el **centro** para buscar en horizontal; la rueda busca ±0.5 s y el doble clic vuelve al inicio. Sólo mueve `currentTime`: no altera pitch, crossfader, AUTO ni vúmetros.
- `[data-track-prev]` carga la pista anterior/siguiente dentro de la carpeta activa.

El botón PLAY cambia entre `▶` y `❚❚`, CUE se ilumina en el punto de cue y EJECT se deshabilita sin pista cargada.

### 2.2 Rack de efectos por deck (Web Audio API)

Banco `.fx-rack`, un canal por deck (`data-fx-deck="A"` / `"B"`):

| Efecto | Controles | Implementación |
|---|---|---|
| `FILTER` | `[data-filter="off|lp|hp"]`, `[data-cutoff]` (`0-100`, valor `100` = 12.0k), `[data-cutoff-val]`, mando `#fx-a-cutoff-knob` / `#fx-b-cutoff-knob` | `BiquadFilter`; `OFF` usa `allpass`, `LP` usa `lowpass`, `HP` usa `highpass`. Corte mapeado `120 × 100^(v/100)` Hz → 120 Hz…12 kHz. El dial (`window.Dial`) mueve el mismo corte con arrastre/rueda; doble clic = 12 kHz |
| `ECHO` | `[data-echo]` (`OFF`/`ON`), `[data-echo-mix]` (`0-1`, paso `.01`, defecto `.35`), `[data-echo-val]` | `DelayNode` de 0.28 s + realimentación limitada a `0.45` send paralelo hacia el canal |
| `PLATO` | `[data-brake]`, `[data-start]` | Rampa de `playbackRate` por `requestAnimationFrame` (1.4 s al frenar, 0.9 s al arrancar, mínimo `0.1`) |

Cadena de audio de cada deck:

```text
<audio> → MediaElementSource → inputGain (TRIM dB) → trimGain (lineal) → eqLow → eqMid → eqHigh
        → fxFilter → fxDry ─────────────────────→ chGain → analyser → xfade[A|B].gain → master → destination
                    └→ fxDelay ⇄ fxFeedback → fxWet ─┘
```

Los efectos quedan **antes del analizador y del crossfader**: los vúmetros los reflejan, pero no se dobla la atenuación del fader. `BRAKE` y `START` se deshabilitan automáticamente cuando `AUTO` está activo.

### 2.3 Mezclador central

| Control | ID | Rango / defecto |
|---|---|---|
| Volumen A | `#vol-a` | `0-1`, paso `.01`, defecto `.8` |
| Volumen B | `#vol-b` | `0-1`, paso `.01`, defecto `.8` |
| Crossfader | `#crossfader`, `#cf-value` | `-1` = A, `0` = centro (`50%`), `+1` = B |
| Master | `#master`, `#cfg-master` | `0-1`, paso `.01`, defecto `.8` |
| B trim | `#vol-b2` | `0-1`, defecto `1` |
| Vúmetro máster | `#vu-meter` (canvas 90×110) | 12 barras; suma de `A.lv + B.lv` × master |

Curva de potencia constante: `A = cos(((v+1)/2)·π/2)`, `B = sin(((v+1)/2)·π/2)`. Los faders responden a arrastre, clic y rueda; `setMaster()` sincroniza `#master` y `#cfg-master`.

### 2.4 Modo `AUTO`

- Botón `#btn-auto`; ajuste `Crossfade AUTO (s)` en `#dlg-cfg` (`#cfg-crossfade`, 2-20 s, defecto **8 s**).
- Precarga la siguiente pista sin reproducir cuando quedan ≤ 20 s (`nextUnplayed()`, respeta `SHFL` y la carpeta activa).
- Crossfade A ↔ B por pasos y relevo de estado (`ENDED` en el deck saliente, parpadeo verde en el entrante).
- Mover el crossfader con el ratón **cancela inmediatamente** la transición (`setXf(..., { user: true })` → `AutoMode.cancelByUser()`).
- Fin de lista: apaga AUTO y escribe `FIN DE LISTA` en `#mini-viewer`.

### 2.5 Biblioteca, recordcases y persistencia

- Añadir MP3 con `#btn-add` (`#file-input`, acepta `audio/*`, `.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`, `.aac`, `.opus`), arrastrar archivos a la app o `Ctrl+V`.
- Columnas: `✓`, `bpm`, `artist`, `trackname`, `version`, `comment`.
- Recordcases: chips en `#folder-chips` (`Todas` + carpetas con contador), creación con `#btn-folder-new`, gestión en `#dlg-recordcase` (`#btn-folder-edit`, `#rc-list`, `#rc-new-name`, `#rc-add`). La carpeta `Default` es fija.
- Asignación: arrastrar una fila a un chip, menú contextual → «MOVER A RECORDCASE», o selector `#folder-assign` + `#btn-folder-assign`.
- Clic derecho = menú con *Cargar* / *Cargar y reproducir* en A o B; hover de fila = botones `Play A` / `Play B` (cargan **y** reproducen); doble clic = carga y reproduce en el deck preferido.
- Filtro `#lib-filter` (artista, título, nombre, carpeta), `Ocultar ✓` y `Reiniciar ✓`.
- **Persistencia segura**: se guardan metadatos, jamás URLs `blob:`. Tras recargar, las pistas sin archivo salen en cursiva con `⚠`; vuelve a añadir el MP3 original (mismo nombre, tamaño y fecha) para re-enlazar el audio.

### 2.6 Reloj, sesión y contador

| Elemento | Qué muestra |
|---|---|
| `.clock-digits` | Hora del sistema `HH:MM:SS` |
| `#session-time` | Cronómetro `SESIÓN` `HH:MM:SS` |
| `#session-count` | Temas `PINCHADOS` (uno por carga que empieza a sonar) |
| `#btn-session-reset` (`↺ sesión`) | Reinicia reloj y contador; **no** borra las marcas `✓` |
| `#btn-reset` (`Reiniciar ✓`) | Borra solo las marcas `✓`; **no** reinicia la sesión |

### 2.7 Controles generales

`cfg`, `i` (información), `stby` (silencia master sin persistir el silencio) y `exit` (para AUTO, expulsa decks, restaura volumen y centra el crossfader).

### 2.8 Skins y preparación MIDI

| Elemento | Qué hace |
|---|---|
| `#skin-select` (`SKIN`) | Cinco pieles: **Plata/Metálica**, **Azul**, **Rojo**, **Negro oscuro** y **Barça** (azulgrana con granate/dorado). Se guarda en `hammer:skin` y se aplica como `[data-skin]` en `<html>`. Sólo cambia variables CSS: audio y vúmetros intactos |
| `#midi-status` | `MIDI: desconectado` / `listo` / `conectado`. Web MIDI es opcional: sin soporte o sin permiso no se lanza ningún error |
| `#midi-input` | Selector del dispositivo detectado (o `Ninguno`) |
| `cfg → Mapeo Numark NV II` | Tabla `#midi-map-rows` con control, deck, tipo (CC/nota), canal, número y acción. Los números son **provisionales**: confirma cada uno con un monitor MIDI al conectar la NV II |

`window.Midi.onControl` es el punto de enganche: `main.js → wireMidi()` ya traduce la plantilla a PLAY/CUE, pitch, TRIM, EQ, corte de filtro, jog relativo, crossfader y BRAKE/START. Estos dos últimos quedan bloqueados con `AUTO` activo, igual que los botones del rack FX.

---

## 3. Requisitos y entorno

| Requisito | Detalle |
|---|---|
| Navegador | Moderno, con **Web Audio API** (`AudioContext`, `BiquadFilter`, `DelayNode`, `AnalyserNode`) y soporte de `dialog` / `pointer events`. Chrome, Edge o Firefox recientes. **Web MIDI es opcional** y puede requerir permiso/HTTPS |
| Servidor local | `http://localhost:8080` (no abrir con `file://`: los `blob:` y la persistencia se comportan peor) |
| Python | `python3 -m http.server 8080` (Linux/WSL) o `py -m http.server 8080` (Windows) |
| Alternativa | `npx serve -l 8080` o Live Server de VS Code configurado en el puerto 8080 |
| Audio | Archivos locales MP3/WAV/OGG/FLAC/M4A/AAC/OPUS; el navegador decide qué códecs puede decodificar |
| Sin dependencias | No hay `package.json`, bundler ni npm install |

**Notas Windows / WSL**: el proyecto está en `/mnt/c/Users/astur/Desktop/hamer-sound` (equivalente a `C:\Users\astur\Desktop\hamer-sound`). Sirve desde esa carpeta; si usas un servidor en Windows y accedes desde WSL (o al revés), `localhost` es compartido pero conviene verificar el puerto con `curl -I http://localhost:8080`. El primer clic/rueda reanuda el `AudioContext` si el navegador lo dejó en `suspended`.

---

## 4. Estructura del repositorio

```text
hamer-sound/
├── README.md            ← este documento
├── HANDOFF.md            ← guía de relevo técnico
├── index.html            ← chasis, zonas A-E, diálogos, jog/dials y orden de scripts
├── styles.css            ← tema metálico, skins, rejillas y estados visuales
├── img/
│   └── pcdj.png          ← imagen de referencia (no enlazada por la UI)
└── js/
    ├── seg7.js           ← window.renderSeg7 (utilidad SVG, sin usar en la UI actual)
    ├── controls.js       ← window.Fader (sin instancias) y window.Dial (diales de filtro)
    ├── audio.js          ← AudioContext, master, crossfader, getXfGain, persistencia de master
    ├── deck.js           ← class Deck: estado, grafo, EQ, FX, CUE, pitch, jog, VU
    ├── library.js        ← window.Library: archivos, recordcases, filtro, marcas, menú
    ├── skins.js          ← window.Skins: pieles persistentes en hammer:skin
    ├── midi.js           ← window.Midi: Web MIDI seguro y mapeo NV II
    └── main.js           ← arranque, mixer, FX rack, MIDI, AUTO, sesión, VU, botones
```

Los scripts se cargan con `defer` en este orden (importante): `seg7.js → controls.js → audio.js → deck.js → library.js → skins.js → midi.js → main.js`. `audio.js` llama a `initAudio()` al cargar; `main.js` monta los decks y la biblioteca en `DOMContentLoaded`, aislando cada subsistema con un helper `safe(label, fn)`. `skins.js` y `midi.js` son idempotentes y también se inicializan desde ese `safe()`.

### Objetos globales expuestos

| Global | Origen | Uso principal |
|---|---|---|
| `window.ctx`, `window.masterGain` | `audio.js` | Grafo Web Audio |
| `window.xfade`, `window.setXf`, `window.getXfGain` | `audio.js` | Crossfader y vúmetros |
| `window.setMaster`, `window.getMaster` | `audio.js` | Master persistente |
| `window.Deck` | `deck.js` | Constructor de decks (incluye el jog) |
| `window.Library` | `library.js` | Biblioteca y carpetas |
| `window.Dial` | `controls.js` | Mando giratorio reutilizable (arrastre, rueda, doble clic) |
| `window.Skins` | `skins.js` | Pieles: `get()`, `set(id)`, `list` |
| `window.Midi` | `midi.js` | Estado Web MIDI, `mapping` NV II y `onControl` |
| `window.AutoMode`, `window.StateMachine` | `main.js` | Encadenado automático |
| `window.Session` | `main.js` | Reloj, contador y disponibilidad de FX (depurable desde F12) |
| `window.decks` | `main.js` | `{ A, B }` en tiempo de ejecución |

---

## 5. Ejecución en local

```bash
cd /mnt/c/Users/astur/Desktop/hamer-sound
python3 -m http.server 8080
# Windows: py -m http.server 8080
```

Abre <http://localhost:8080>. Tras cambiar código, recarga con **`Ctrl + Shift + R`** y mantén **`F12`** abierto para ver la consola.

---

## 6. Atajos y flujos principales de ratón

| Acción | Gestor |
|---|---|
| Añadir pistas | `#btn-add`, arrastrar archivos a la app o `Ctrl+V` |
| Cargar y reproducir | Doble clic en fila, botones hover `Play A`/`Play B`, `#btn-load-a` (`→ A`), `#btn-load-b` (`→ B`), `▶→ A/B`, clic derecho → cualquier opción de deck, arrastrar la fila a un player |
| Enlazar MP3 de una pista restaurada | Arrastrar el archivo al deck o a la app, volver a añadirlo, o clic derecho → *Enlazar MP3…* (aparece sólo en pistas `⚠`) |
| Crear carpeta | `#btn-folder-new` o `#btn-folder-edit` → diálogo → `#rc-new-name` + `#rc-add` |
| Filtrar por carpeta | Clic en un chip de `#folder-chips` (`Todas` vuelve a la vista completa) |
| Mover pista a carpeta | Arrastrar la fila al chip, menú contextual o `#folder-assign` + `Mover` |
| Seek | Arrastrar `.lcd-timer`, `«` / `»` (clic o mantenido) |
| Seek con jog | Arrastrar el borde (circular) o el centro (horizontal) del círculo JOG; rueda = ±0.5 s; doble clic / `↺ 0` = inicio |
| TRIM / EQ | Fader, rueda o doble clic (= `0 dB`); botones `0 dB` / `EQ 0` |
| Corte de filtro | Slider `CUT` o dial junto a él; doble clic en el dial = 12 kHz |
| Cambiar piel | Selector `SKIN` de la cabecera (se recuerda al recargar) |
| Pitch | Fader vertical, botones `−`, `+`, `◆`, o rueda sobre el bloque |
| Cancelar AUTO | Mover `#crossfader` durante una transición (también por MIDI) |
| Cerrar menú contextual | `Escape`, clic fuera, scroll de la tabla o pérdida de foco |

---

## 7. Datos guardados en `localStorage`

| Clave | Formato | Escrita por |
|---|---|---|
| `hammer:master` | Número `0-1` | `audio.js → setMaster(v)` (STANDBY usa `store=false`) |
| `hammer:played:v1` | `{ "nombre|tamaño|fecha": true/false }` | `library.js → _writeMap()` |
| `hammer:library:v1` | `{ folders, activeFolder, tracks:[{ id, key, name, title, artist, size, lastModified, version, comment, bpm, folder, played, trimDb }] }` | `library.js → _writeStore()` |
| `hammer:skin` | `silver` / `blue` / `red` / `dark` / `barca` | `skins.js → set(id)` (lista blanca) |

`url` y `missing` **no** se persisten: la URL `blob:` se regenera al volver a añadir el archivo. `midi.js` no escribe nada en `localStorage`.

---

## 8. Verificación rápida

```bash
for f in js/*.js; do node --check "$f" || exit 1; done
git diff --check
node --test tests/logic.test.cjs    # 18 contratos: audio, carga A/B, drops, persistencia y reintento de play()
```

Los tests son JavaScript puro (`node:test`) con un DOM simulado: no requieren dependencias ni navegador. Fijan la curva cos/sen del crossfader, la cancelación de AUTO, la ausencia de `blob:` en `localStorage`, el enrutado A/B, el tratamiento de pistas sin archivo, el mensaje de formato no compatible, el re-enlace, la supresión de clic por deck y la cancelación del reintento de `play()` ante cargas más recientes.

En el navegador (`F12`): consola sin errores, `Application → Local Storage` sin cadenas `blob:`, hora y `SESIÓN` avanzando, `PINCHADOS` subiendo al dar PLAY, FX respondiendo y crossfader y vúmetro intactos con `AUTO`. Comprueba además que las cinco skins se aplican y persisten, que el jog y los diales responden al ratón, y que el estado MIDI no lanza errores sin controlador. Detalle completo en [HANDOFF.md](HANDOFF.md), sección 4.

---

## 9. Enlaces

- [Repositorio remoto](https://github.com/martillohamer/hamer-sound.git)
- [HANDOFF.md — relevo técnico](HANDOFF.md)
- [index.html](index.html) · [styles.css](styles.css)
- [js/skins.js](js/skins.js) · [js/midi.js](js/midi.js) · [js/main.js](js/main.js)
