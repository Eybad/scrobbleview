# Scrobbleview

Tus estadísticas de Spotify, en tu dispositivo: web estática con procesamiento local, sin build ni dependencias de producción.

[Abrir la aplicación](https://eybad.github.io/scrobbleview/). Podés probarla con datos sintéticos sin cargar tu historial.

## Características

- Ocho secciones: Resumen, Horarios, Hábitos, Sesiones, Descubrimiento, Años, Calendario y Resumen del período; fichas de artista, canción y álbum.
- Importación de JSON del historial extendido o del ZIP de Spotify, con lectura incremental y validación estricta.
- Filtros por período, día, hora, entidad y banderas «sí», «no» o «desconocido», sin volver a leer los archivos.
- Lectura, cálculos y exportación en un Worker local, con progreso y cancelación. Los detalles de álbum se calculan al abrir su ficha.
- Exportación del historial procesado completo como ZIP de tablas CSV, independientemente de los filtros visibles.
- SVG con alternativas tabulares, navegación por teclado y consideración de movimiento reducido.
- Caché opcional en IndexedDB con consentimiento explícito y botón para borrar.

Los archivos se procesan en el dispositivo: no hay subida, telemetría ni CDN. La caché guarda el historial **en claro**; otros sitios del mismo origen comparten el límite de aislamiento de IndexedDB. `connect-src 'none'` restringe conexiones desde scripts, sin constituir una garantía absoluta ante extensiones o un sitio comprometido.

## Requisitos

- Navegador con ES modules, Workers de módulo, `Intl`, Blob y streams. Para importar ZIP comprimido necesita `DecompressionStream('deflate-raw')`; si no lo admite, extraé los JSON. La exportación usa ZIP sin compresión cuando hace falta.
- Para desarrollo: Node.js ≥24 con ICU completa; para servir localmente, Python 3. En Termux se usan los paquetes compatibles con Android, sin root ni systemd.
- Sin cuentas adicionales, dependencias que instalar ni variables `.env`.

## Empezar

Desde la raíz del checkout:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Abrí `http://127.0.0.1:8000` y elegí los archivos, arrastralos a la zona de carga o usá **Probar con datos de ejemplo**. `file://` no sirve para esta aplicación.

**Sin conexión:** la página debe tener sus recursos ya cargados o servirse desde el checkout local. No hay Service Worker ni garantía de arranque en frío de GitHub Pages sin internet.

## Uso

1. Pedí el historial extendido en la [descarga de datos de Spotify](https://support.spotify.com/us/article/understanding-your-data/).
2. Cargá `Streaming_History_Audio_*.json` o el ZIP que los contiene. Los episodios de podcast se excluyen con avisos.
3. Explorá las secciones y aplicá filtros. Durante el cálculo se ocultan las cifras anteriores; las respuestas obsoletas no reemplazan el estado vigente.
4. Usá **Exportar** para descargar `totals`, `artists`, `tracks`, `albums`, `album_tracks`, `sessions` y `monthly` en CSV dentro de un ZIP. Los prefijos de fórmula se neutralizan.
5. Si querés conservar los datos, aceptá la oferta de guardado. Podés borrarlos desde el inicio; un fallo de borrado se informa y permite reintentar.

Las fuentes se concatenan. Se detectan selecciones con el mismo nombre, tamaño y fecha de modificación; los períodos solapados generan un aviso. No se eliminan reproducciones automáticamente por título y timestamp.

**Cancelar procesamiento** termina el Worker, descarta los datos cargados en memoria y vuelve al inicio; para continuar hay que cargarlos otra vez. No borra una caché previamente guardada. Las cachés antiguas sin información de campos desconocidos requieren reimportar los archivos.

Las definiciones y sus límites están en [Estadísticas y rendimiento](docs/analysis.md) y el [glosario](CONTEXT.md). Los resultados no reproducen automáticamente Spotify Wrapped, charts ni Spotify for Artists.

## Configuración

[src/defaults.js](src/defaults.js) comparte las opciones del parser, fachada y agregación:

| Opción | Valor predeterminado |
| --- | --- |
| `minMs` | 30.000 ms: reproducción significativa |
| `skipThresholdMs` | 10.000 ms: umbral de reproducción corta |
| `sessionGapMinutes` | 30 min: pausa máxima entre intervalos estimados |
| `chunkBytes` | 256 KiB |
| `maxBytes` | 512 MiB, acumulados tras descompresión |
| `maxEvents` | 1.000.000 de registros leídos, incluidos los excluidos |
| `maxTokenBytes` / `maxDepth` | 1 MiB por valor o clave / 64 niveles JSON |
| `maxZipEntries` / `maxCentralBytes` | 4.096 entradas / 8 MiB de directorio ZIP |

Estos límites abortan la carga completa, sin resultados parciales; no garantizan que el dispositivo disponga de memoria suficiente. La zona horaria es la del navegador, construida en `app/analysis-engine.js` sobre el rango real del dataset. La API permite pasar un puerto `tz` propio a `analyze(input, opts)`, con ByteSources o un Dataset ya parseado.

## Tests

```sh
node --test
node --expose-gc bench/aggregate.js 100000 --compact
```

Las pruebas usan datos sintéticos e incluyen parsing por distintos tamaños de chunk, agregación, DST, filtros, exportación, Unicode, fallos de almacenamiento y comunicación real con un Worker de Node. El conteo vigente lo informa el runner.

Serví el checkout y abrí `browser-tests/navigation.html` para ejecutar la regresión de carga, filtros, Atrás/Adelante, comparación, anclas y cancelación sobre el DOM real. La validación de teclado, TalkBack y comportamiento en tu navegador requiere esa ejecución; las pruebas de Node no la sustituyen.

## Estructura del proyecto

```text
src/analyze.js       fachada: ByteSources o Dataset → StatsModel
src/defaults.js      defaults y límites compartidos
src/parse/           scanner incremental → columnas e interners
src/aggregate/       agregación pura con orden UTC y calendario local
src/filters.js       selección y conteos sobre índices derivados
src/export/          CSV y ZIP
src/charts.js        componentes SVG puros
app/analysis-*.js    Worker, motor local, cliente y control de respuestas
app/main.js          rutas, estado y renderizado
app/                 vistas, filtros UI, entrada, caché y demo
browser-tests/       regresión de interacción sin dependencias
bench/               benchmark sintético reproducible
test/                pruebas automáticas
docs/                metodología, límites y mediciones
```
