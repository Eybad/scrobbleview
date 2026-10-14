// ports.js — puerto TimeZone
//
// Contrato: función pura {id, offsetMinutes(t)} donde t es epoch en segundos y
// el resultado es el offset en minutos (positivo al este de UTC).
//
// Adapters:
// - intl-tz:      construye la tabla de transiciones por bisección (~1.000
//                 llamadas Intl para todo el dataset), luego lookup binario.
// - offset-table: mecanismo principal — recibe la tabla ya construida.
// - fixed-tz:     offset constante (tests, zonas sin DST).
//
// El aggregate NUNCA crea una tz: siempre la recibe por el puerto (determinismo).