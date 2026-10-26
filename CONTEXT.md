# Scrobbleview

Vocabulario de las estadísticas derivadas del historial que carga cada visitante.

## Términos

**Playback event (reproducción)**:
Un registro de escucha que termina en el timestamp UTC exportado. Sus milisegundos reproducidos expresan tiempo escuchado, no la duración total de la canción. [Definición de los campos de Spotify](https://support.spotify.com/us/article/understanding-your-data/).

**Listening session (sesión de escucha)**:
Un grupo de intervalos estimados de reproducción conectados por pausas de hasta 30 minutos. El inicio de cada intervalo se estima restando su tiempo escuchado al final; cuando ese tiempo se desconoce, solo se conoce el final.

**Listened time (tiempo escuchado)**:
La suma de los milisegundos reproducidos conocidos. Las reproducciones solapadas se cuentan por separado.

**Estimated session duration (duración estimada de sesión)**:
El tiempo transcurrido entre el inicio estimado más temprano y el final más tardío de una sesión. Incluye pausas cortas y no permite reconstruir pausas dentro de una reproducción ni demostrar escucha simultánea.

**Grouped track (canción agrupada)**:
Una canción identificada por su título y el nombre del artista. Distintos URI de Spotify pueden pertenecer a la misma canción agrupada.

**Album track (canción dentro de un álbum)**:
La parte del historial de una canción agrupada atribuida a un álbum. Sus totales y su evolución incluyen únicamente los registros que nombran ese álbum.

**Unknown value (valor desconocido)**:
Un campo ausente, nulo o una duración inválida. No equivale a cero ni a «no». Las medias, medianas y umbrales de duración usan solo duraciones conocidas; las tasas de banderas usan como denominador los registros donde esa bandera es conocida.

**Trackdone ending (final con código trackdone)**:
Un registro cuyo motivo de fin es literalmente `trackdone`. Los demás códigos, incluido `endplay`, se cuentan aparte; un motivo ausente es desconocido. Este conteo no acredita por sí solo que se haya escuchado toda la canción.

**Historical first appearance (primera aparición histórica)**:
La primera reproducción de una canción o artista en todo el historial cargado, conservada al filtrar. No demuestra cuándo la persona conoció esa música. Los promedios por mes activo excluyen meses sin registros.

**Day without records (día sin registros)**:
Un día sin eventos dentro del intervalo entre la primera y última escucha del subconjunto. No cubre automáticamente todo el rango seleccionado ni demuestra ausencia de escucha.

**Short play (reproducción corta)**:
Un registro con duración conocida menor que el umbral corto configurado (10 segundos por defecto). Se incluye en los totales y rankings. Una reproducción significativa alcanza al menos el umbral configurado (30 segundos por defecto); estas definiciones no replican toda la metodología de Spotify.
