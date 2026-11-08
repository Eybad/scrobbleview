# Scrobbleview

Estadísticas de tu historial de Spotify procesadas íntegramente en tu dispositivo.

[Abrir Scrobbleview](https://eybad.github.io/scrobbleview/). La aplicación es estática: no requiere cuenta, servidor de análisis, instalación ni conexión a servicios externos para procesar tus archivos. También podés probarla con datos de ejemplo.

## Características

- Analiza el historial ampliado de Spotify en archivos JSON o ZIP, sin subirlos.
- Explora actividad, artistas, canciones, álbumes, sesiones, años y calendarios mediante filtros.
- Procesa historiales grandes de forma incremental y ejecuta el análisis en un Worker con progreso y cancelación.
- Exporta estadísticas y tablas a CSV dentro de archivos ZIP.
- Ofrece una caché opcional en el dispositivo, solo después de pedir consentimiento y con opción para borrarla.

La caché guarda datos en claro en el almacenamiento del navegador. Si la activás, cualquier persona con acceso al perfil del navegador podría acceder a esos datos.

## Requisitos

- Un navegador moderno compatible con módulos JavaScript, Workers y streams.
- Para importar ZIP comprimidos, compatibilidad con `DecompressionStream('deflate-raw')`. Si falta, extraé los JSON antes de cargarlos.
- Para desarrollo: Node.js 24 o posterior y Python 3 para servir el sitio localmente.
- No hay dependencias de producción ni variables de entorno.

## Empezar

Desde la raíz del repositorio:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Abrí `http://127.0.0.1:8000`. No uses `file://`: el navegador necesita servir los módulos y el Worker desde HTTP.

## Uso

1. Solicitá a Spotify una copia de tu [historial de reproducción ampliado](https://support.spotify.com/us/article/understanding-your-data/).
2. Cargá el ZIP recibido o los archivos `Streaming_History_Audio_*.json`.
3. Explorá las vistas y aplicá filtros. Las fuentes seleccionadas se concatenan; los períodos que se solapan generan un aviso y los eventos no se deduplican automáticamente.
4. Exportá el historial completo, la selección analítica o los resultados de una tabla.
5. Si querés, aceptá guardar el historial en el navegador. Podés borrarlo desde la pantalla de inicio.

Los archivos seleccionados se procesan localmente. Scrobbleview no incluye telemetría, CDN ni envío de datos. No ofrece inicio en frío sin conexión desde GitHub Pages; para trabajar sin conexión, serví una copia local que ya tenga todos sus archivos.

## Configuración

Los valores de análisis y los límites de entrada están definidos en [src/defaults.js](src/defaults.js). Incluyen los umbrales de reproducción, límites de bytes y eventos, tamaño de lectura y restricciones para JSON y ZIP. Una carga que supera esos límites se rechaza completa.

## Tests

```sh
node --test
```

Las pruebas automáticas usan datos sintéticos. Para comprobar la interacción en Chromium, serví el repositorio y abrí `browser-tests/navigation.html`. La matriz de cobertura y las limitaciones de las verificaciones están en [docs/testing.md](docs/testing.md). Las definiciones de métricas están en [docs/analysis.md](docs/analysis.md), y sus términos en [CONTEXT.md](CONTEXT.md).
