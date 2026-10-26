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
