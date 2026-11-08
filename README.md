# Scrobbleview

Estadísticas de tu historial de Spotify procesadas íntegramente en tu dispositivo.

[Abrir Scrobbleview](https://eybad.github.io/scrobbleview/). La aplicación es estática: no requiere cuenta, servidor de análisis, instalación ni conexión a servicios externos para procesar tus archivos. También podés probarla con datos de ejemplo.

Está hecha con JavaScript y SVG, sin build, dependencias ni CDN.

## Características

- Analiza el historial ampliado de Spotify en archivos JSON o ZIP, sin subirlos.
- Muestra actividad, horarios, hábitos, descubrimientos, sesiones, calendarios y resúmenes por período.
- Permite buscar y ordenar artistas, canciones y álbumes, y abrir sus fichas de detalle.
- Filtra por fechas, entidades y banderas de reproducción, con tiempo escuchado o reproducciones como métrica principal.
- Compara dos períodos: totales, evolución y cambios en rankings y cuotas de artistas, canciones y álbumes.
- Procesa historiales grandes de forma incremental y ejecuta el análisis en un Worker con progreso y cancelación.
- Exporta estadísticas y tablas a CSV dentro de archivos ZIP, con metadata que describe el alcance y los filtros.
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
2. Cargá el ZIP recibido o los archivos `Streaming_History_Audio_*.json`, con el selector o arrastrándolos a la página. Para conocer la interfaz sin archivos propios, elegí **Probar con datos de ejemplo**.
3. En **Resumen**, elegí el período y la métrica principal. Aplicá filtros y recorré las vistas de patrones y períodos; desde los rankings y calendarios podés abrir detalles.
4. En **Explorar**, buscá artistas, canciones o álbumes y ajustá el orden y los umbrales de la tabla. La búsqueda acota esa tabla; los filtros analíticos determinan el conjunto de reproducciones que se analiza.
5. En **Comparar**, elegí un período de referencia anterior, el mismo período del año anterior o fechas manuales. Podés comparar hasta tres artistas, canciones o álbumes a la vez.
6. Exportá estadísticas de todo el historial, de la selección analítica o de la tabla de Explorar. La exportación de tabla incluye todas las coincidencias de la búsqueda y los umbrales, aunque estén paginadas.
7. Si querés, aceptá guardar el historial en el navegador. Podés volver a cargarlo o borrarlo desde la pantalla de inicio.

Las fuentes seleccionadas se concatenan; los períodos que se solapan generan un aviso y los eventos no se deduplican automáticamente. Los ZIP exportados contienen estadísticas agregadas: no reemplazan los JSON originales de Spotify ni se pueden reimportar como historial.

Los archivos seleccionados se procesan localmente. Scrobbleview no incluye telemetría, CDN ni envío de datos. No ofrece inicio en frío sin conexión desde GitHub Pages; para trabajar sin conexión, serví una copia local que ya tenga todos sus archivos.

Los resultados describen el historial cargado. Las duraciones y banderas desconocidas conservan esa condición, y las sesiones usan tiempos estimados. Consultá las [definiciones y limitaciones de las métricas](docs/analysis.md) para interpretar los valores.

## Configuración

Los valores de análisis y los límites de entrada están definidos en [src/defaults.js](src/defaults.js). Incluyen los umbrales de reproducción, límites de bytes y eventos, tamaño de lectura y restricciones para JSON y ZIP. Una carga que supera esos límites se rechaza completa.

## Tests

```sh
node --test
```

Las pruebas automáticas usan datos sintéticos. Para comprobar la interacción en Chromium, serví el repositorio, abrí `http://127.0.0.1:8000/browser-tests/navigation.html` y ejecutá la prueba desde esa página. Cubre navegación, filtros, búsqueda, exportación, cancelación, tamaños de pantalla y caché IndexedDB real.

La cobertura y las verificaciones manuales pendientes están en [docs/testing.md](docs/testing.md). Las definiciones de métricas están en [docs/analysis.md](docs/analysis.md), y sus términos en [CONTEXT.md](CONTEXT.md).
