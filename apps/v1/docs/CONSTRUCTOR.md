# 🏗️ Constructor de Mapas - Guía de Usuario

## Descripción General

El Constructor de Mapas es una herramienta integrada en el Simulador de Tráfico FLUVI que te permite crear, editar, guardar y cargar simulaciones personalizadas desde cero.

## 📋 Características

### ✅ Gestión de Simulaciones
- **Nueva Simulación**: Crea una simulación en blanco
- **Guardar Simulación**: Exporta tu mapa como archivo JSON
- **Cargar Simulación**: Importa mapas guardados anteriormente

### ✅ Construcción de Mapas
- **Agregar Calles**: Crea calles personalizadas con todos sus parámetros
- **Agregar Conexiones**: Conecta calles con diferentes tipos de conexiones
- **Eliminar Calles**: Elimina calles seleccionadas del mapa

## 🎯 Cómo Usar

### 1. Crear una Nueva Simulación

1. Abre el accordion "🏗️ Constructor de Mapas"
2. Haz clic en "➕ Nueva Simulación"
3. Confirma que deseas crear una nueva simulación (esto limpiará el mapa actual)

### 2. Agregar Calles

1. Haz clic en "➕ Agregar Calle"
2. Se abrirá una serie de prompts para ingresar los parámetros:
   - **Nombre**: Nombre descriptivo de la calle (ej: "Av. Principal")
   - **Tamaño**: Número de celdas (ej: 100)
   - **Tipo**: GENERADOR, CONEXION o DEVORADOR
   - **Posición X**: Coordenada horizontal (ej: 500)
   - **Posición Y**: Coordenada vertical (ej: 500)
   - **Ángulo**: Rotación en grados (ej: 0, 90, 180, 270)
   - **Carriles**: Número de carriles (ej: 3)
   - **Probabilidad de generación**: 0.0 a 1.0 (ej: 0.5 para 50%)
   - **Probabilidad de cambio de carril**: 0.0 a 1.0 (ej: 0.02 para 2%)

3. La calle aparecerá en el canvas inmediatamente

### 3. Agregar Conexiones

1. Asegúrate de tener al menos 2 calles creadas
2. Haz clic en "🔗 Agregar Conexión"
3. Sigue los prompts:
   - **Índice de calle origen**: Número de la calle de origen (se muestra una lista)
   - **Índice de calle destino**: Número de la calle de destino
   - **Tipo de conexión**: LINEAL, INCORPORACION o PROBABILISTICA

#### Tipos de Conexión

**LINEAL**: Conexión 1 a 1 entre carriles
- Los carriles se conectan directamente (carril 0 → carril 0, carril 1 → carril 1, etc.)
- No requiere parámetros adicionales

**INCORPORACION**: Múltiples carriles convergen en uno
- Requiere especificar el carril destino
- Requiere posición inicial en el destino
- Ideal para fusiones de tráfico

**PROBABILISTICA**: Conexión con probabilidad de transferencia
- Requiere especificar carril origen y destino
- Requiere probabilidad (0.0 a 1.0)
- Los vehículos se transfieren según la probabilidad especificada

### 4. Editar Calles

1. Selecciona el tipo de objeto "Calle" en el accordion de Configuración
2. Elige la calle del dropdown
3. Activa "Modo Edición" para moverla visualmente
4. O usa "Ajustes Avanzados" para modificar posición/ángulo manualmente

### 5. Eliminar Calles

1. Selecciona la calle que deseas eliminar
2. Haz clic en "🗑️ Eliminar Calle Seleccionada"
3. Confirma la eliminación

### 6. Guardar Simulación

1. Haz clic en "💾 Guardar Simulación"
2. Ingresa un nombre para tu simulación
3. Se descargará un archivo JSON con toda la configuración

**El archivo JSON incluye:**
- Todas las calles con sus parámetros
- Todas las conexiones
- Vértices de curvas (si existen)
- Edificios (si existen)
- Metadata (versión, fecha, nombre)

### 7. Cargar Simulación

1. Haz clic en "📂 Cargar Simulación"
2. Selecciona un archivo JSON guardado anteriormente
3. Confirma que deseas cargar (esto reemplazará la simulación actual)
4. La simulación se cargará completamente con:
   - Todas las calles en sus posiciones originales
   - Todas las conexiones restauradas
   - Curvas y vértices restaurados
   - Edificios restaurados

## 📝 Formato del Archivo JSON

```json
{
  "version": "1.0",
  "nombre": "Mi Simulación",
  "fecha": "2025-10-09T12:00:00.000Z",
  "calles": [
    {
      "nombre": "Av. Principal",
      "tamano": 100,
      "tipo": "CONEXION",
      "x": 500,
      "y": 500,
      "angulo": 0,
      "probabilidadGeneracion": 0.5,
      "carriles": 3,
      "probabilidadSaltoDeCarril": 0.02,
      "vertices": [],
      "esCurva": false
    }
  ],
  "conexiones": [
    {
      "origenIdx": 0,
      "destinoIdx": 1,
      "tipo": "LINEAL",
      "detalles": [...]
    }
  ],
  "edificios": [...]
}
```

## 💡 Consejos y Mejores Prácticas

### Planificación
1. **Dibuja tu mapa primero**: Boceta tu diseño en papel antes de empezar
2. **Usa nombres descriptivos**: Facilita identificar calles posteriormente
3. **Organiza por secciones**: Crea una sección a la vez (norte, sur, este, oeste)

### Posicionamiento
1. **Usa coordenadas múltiplos de 50**: Facilita alinear calles
2. **Ángulos comunes**: 0°, 90°, 180°, 270° para calles ortogonales
3. **Verifica con Modo Edición**: Usa el modo edición para ajustar posiciones visualmente

### Conexiones
1. **Conecta en orden lógico**: Sigue el flujo del tráfico
2. **Verifica los índices**: Usa "Mostrar Conexiones" para verificar visualmente
3. **Prueba las probabilísticas**: Ajusta las probabilidades para balancear el tráfico

### Guardar/Cargar
1. **Guarda versiones**: Crea múltiples versiones de tu mapa (v1, v2, v3)
2. **Usa nombres descriptivos**: "campus_norte_v2.json" es mejor que "mapa1.json"
3. **Respaldo regular**: Guarda frecuentemente durante la construcción

## 🐛 Solución de Problemas

### La calle no aparece
- Verifica que las coordenadas estén dentro del canvas
- Usa el scroll/zoom para encontrarla
- Revisa el minimapa para ubicación global

### Las conexiones no funcionan
- Asegúrate de que los índices sean correctos
- Verifica que las calles estén suficientemente cerca
- Usa "Mostrar Conexiones" para verificar visualmente

### Error al cargar JSON
- Verifica que el archivo sea un JSON válido
- Asegúrate de que tenga la estructura correcta
- Verifica que la versión sea compatible (v1.0)

### Simulación se comporta extraño
- Reinicializa intersecciones desde la consola: `inicializarIntersecciones()`
- Verifica probabilidades (deben estar entre 0 y 1)
- Revisa que no haya calles superpuestas sin intersecciones

## 🚀 Funciones Avanzadas

### Edición de JSON Manual
Puedes editar el archivo JSON manualmente para:
- Ajustar posiciones de múltiples calles
- Copiar/pegar secciones de mapas
- Crear patrones repetitivos

### Importar Secciones
1. Guarda diferentes secciones como archivos separados
2. Combínalos manualmente en un editor de texto
3. Ajusta los índices de conexiones

### Plantillas
Crea plantillas de patrones comunes:
- Intersección en T
- Rotonda
- Autopista con salidas
- Red urbana básica

## 📞 Soporte

Para más ayuda, consulta:
- Modal de instrucciones (botón 📚 Ver Guía Completa)
- CLAUDE.md para arquitectura del código
- Consola del navegador para mensajes de debug

---

**Versión**: 1.0
**Última actualización**: Octubre 2025
**Compatibilidad**: Simulador de Tráfico FLUVI v1.0+
