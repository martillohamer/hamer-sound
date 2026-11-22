# dj. hammer

**Consola web de mezcla de dos decks** inspirada en el clásico **PCDJ Red** (el proyecto incluye `img/pcdj.png` como imagen de referencia) y en los flujos de mesa modernos de **Numark / Pioneer / Serato**. Se pincha completamente con el ratón, sobre un chasis metálico gris / plata / negro (paleta en `styles.css`, variables `--chassis`, `--plata`, `--aluminio`, `--lcd`).

> Documentación válida para la etiqueta **`Silver-DjHammer`** (`39ac181`). Hermana técnica: [HANDOFF.md](HANDOFF.md).

---

## 1. Propósito

Ofrecer en el navegador una mesa de DJ de dos platos con:

- Carga real de archivos del disco (sin subirlos a ningún servidor).
- Mezcla con crossfader de potencia constante, volúmenes, trim y vúmetros.
- Efectos Web Audio por deck y modo `AUTO` para encadenar temas.
- Biblioteca organizada en **recordcases / carpetas** con persistencia local segura.

La aplicación es **estática**: no hay backend, ni build, ni dependencias externas. Todo vive en `index.html`, `styles.css` y `js/*.js`.

---

## 2. Características implementadas hasta `Silver-DjHammer`

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
| Vúmetro | `.player-vu` (12 segmentos) | Analizador Web Audio × ganancia del crossfader |
| LEDs | `.led-strip` (12 LEDs) | Cuenta atrás: 1 LED cada 3 s restantes |

Extras de ratón:

- Clic en una LCD **vacía** abre el selector de archivos de ese deck.
- Arrastre del `.lcd-timer` = *seek*; rueda sobre el bloque PITCH = ±`0.5`.
- `«` / `»`: clic = ±10 s; mantener pulsado acelera hasta 120 s.
- `=`: cicla los presets `FLAT → BASS → TREBLE → VOCAL` (filtros *lowshelf* 200 Hz y *highshelf* 3200 Hz).
- `[data-track-prev]` carga la pista anterior/siguiente dentro de la carpeta activa.

El botón PLAY cambia entre `▶` y `❚❚`, CUE se ilumina en el punto de cue y EJECT se deshabilita sin pista cargada.

### 2.2 Rack de efectos por deck (Web Audio API)

Banco `.fx-rack`, un canal por deck (`data-fx-deck="A"` / `"B"`):

| Efecto | Controles | Implementación |
|---|---|---|
| `FILTER` | `[data-filter="off|lp|hp"]`, `[data-cutoff]` (`0-100`, valor `100` = 12.0k), `[data-cutoff-val]` | `BiquadFilter`; `OFF` usa `allpass`, `LP` usa `lowpass`, `HP` usa `highpass`. Corte mapeado `120 × 100^(v/100)` Hz → 120 Hz…12 kHz |
| `ECHO` | `[data-echo]` (`OFF`/`ON`), `[data-echo-mix]` (`0-1`, paso `.01`, defecto `.35`), `[data-echo-val]` | `DelayNode` de 0.28 s + realimentación limitada a `0.45` send paralelo hacia el canal |
| `PLATO` | `[data-brake]`, `[data-start]` | Rampa de `playbackRate` por `requestAnimationFrame` (1.4 s al frenar, 0.9 s al arrancar, mínimo `0.1`) |

Cadena de audio de cada deck:

```text
<audio> → MediaElementSource → trimGain → eqLow → eqHigh
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

---

## 3. Requisitos y entorno

| Requisito | Detalle |
|---|---|
| Navegador | Moderno, con **Web Audio API** (`AudioContext`, `BiquadFilter`, `DelayNode`, `AnalyserNode`) y soporte de `dialog` / `pointer events`. Chrome, Edge o Firefox recientes |
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
├── index.html            ← chasis, zonas A-E, diálogos y orden de scripts
├── styles.css            ← tema metálico, rejillas y estados visuales
├── img/
│   └── pcdj.png          ← imagen de referencia (no enlazada por la UI)
└── js/
    ├── seg7.js           ← window.renderSeg7 (utilidad SVG, sin usar en la UI actual)
    ├── controls.js       ← window.Fader (clase de fader dibujado, sin instancias hoy)
    ├── audio.js          ← AudioContext, master, crossfader, getXfGain, persistencia de master
    ├── deck.js           ← class Deck: estado, grafo de audio, FX, CUE, pitch, VU
    ├── library.js        ← window.Library: archivos, recordcases, filtro, marcas, menú
    └── main.js           ← arranque, mixer, FX rack, AUTO, sesión, VU máster, botones
```

Los scripts se cargan con `defer` en este orden (importante): `seg7.js → controls.js → audio.js → deck.js → library.js → main.js`. `audio.js` llama a `initAudio()` al cargar; `main.js` monta los decks y la biblioteca en `DOMContentLoaded`, aislando cada subsistema con un helper `safe(label, fn)`.

### Objetos globales expuestos

| Global | Origen | Uso principal |
|---|---|---|
| `window.ctx`, `window.masterGain` | `audio.js` | Grafo Web Audio |
| `window.xfade`, `window.setXf`, `window.getXfGain` | `audio.js` | Crossfader y vúmetros |
| `window.setMaster`, `window.getMaster` | `audio.js` | Master persistente |
| `window.Deck` | `deck.js` | Constructor de decks |
| `window.Library` | `library.js` | Biblioteca y carpetas |
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
| Cargar y reproducir | Doble clic en fila, botones hover `Play A`/`Play B`, clic derecho → *Play A/B (Cargar y reproducir)* |
| Cargar sin reproducir | `#btn-load-a` (`→ A`), `#btn-load-b` (`→ B`), clic derecho → *Cargar en Play A/B*, arrastrar fila a un player |
| Crear carpeta | `#btn-folder-new` o `#btn-folder-edit` → diálogo → `#rc-new-name` + `#rc-add` |
| Filtrar por carpeta | Clic en un chip de `#folder-chips` (`Todas` vuelve a la vista completa) |
| Mover pista a carpeta | Arrastrar la fila al chip, menú contextual o `#folder-assign` + `Mover` |
| Seek | Arrastrar `.lcd-timer`, `«` / `»` (clic o mantenido) |
| Pitch | Fader vertical, botones `−`, `+`, `◆`, o rueda sobre el bloque |
| Cancelar AUTO | Mover `#crossfader` durante una transición |
| Cerrar menú contextual | `Escape`, clic fuera, scroll de la tabla o pérdida de foco |

---

## 7. Datos guardados en `localStorage`

| Clave | Formato | Escrita por |
|---|---|---|
| `hammer:master` | Número `0-1` | `audio.js → setMaster(v)` (STANDBY usa `store=false`) |
| `hammer:played:v1` | `{ "nombre|tamaño|fecha": true/false }` | `library.js → _writeMap()` |
| `hammer:library:v1` | `{ folders, activeFolder, tracks:[{ id, key, name, title, artist, size, lastModified, version, comment, bpm, folder, played }] }` | `library.js → _writeStore()` |

`url` y `missing` **no** se persisten: la URL `blob:` se regenera al volver a añadir el archivo.

---

## 8. Verificación rápida

```bash
for f in js/*.js; do node --check "$f" || exit 1; done
```

En el navegador (`F12`): consola sin errores, `Application → Local Storage` sin cadenas `blob:`, hora y `SESIÓN` avanzando, `PINCHADOS` subiendo al dar PLAY, FX respondiendo y crossfader y vúmetro intactos con `AUTO`.

---

## 9. Enlaces

- [Repositorio remoto](https://github.com/martillohamer/hamer-sound.git)
- [HANDOFF.md — relevo técnico](HANDOFF.md)
- [index.html](index.html) · [styles.css](styles.css) · [js/main.js](js/main.js)
