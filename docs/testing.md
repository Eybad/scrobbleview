# Pruebas y verificación

## Pruebas automáticas

Requieren Node.js 24 o posterior. Desde la raíz del repositorio, ejecutá:

```sh
node --test
```

Las pruebas usan fixtures sintéticos; no cargan historiales personales. Cubren parsing y validación, estadísticas, filtros, rutas, vistas, exportaciones, almacenamiento y comunicación con el Worker. El resultado del comando informa la cantidad de pruebas de cada ejecución.

## Prueba en navegador

Serví el repositorio por HTTP local y abrí `browser-tests/navigation.html`. El harness proporciona un historial sintético y comprueba los recorridos de importación, filtros, navegación, vistas de detalle, exportación y preferencias, además de flujos de caché en el navegador.

Esta prueba automatizada no sustituye la revisión manual en otros navegadores, lectores de pantalla ni dispositivos táctiles. Al cambiar la interfaz, revisá también el teclado, el foco visible, el zoom, el movimiento reducido y la vista en pantallas estrechas.

## Documentación relacionada

- [Definiciones estadísticas, procesamiento y límites](analysis.md).
- [Glosario del proyecto](../CONTEXT.md).
