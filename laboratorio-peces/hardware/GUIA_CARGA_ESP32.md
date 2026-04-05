# Guia de Carga del Firmware ESP32

Esta guia deja documentado el flujo completo para compilar, cargar y probar el firmware real del proyecto `Sensores-Temperatura-laboratorio`.

## 1. Que hace este firmware

El ESP32:

- se conecta al WiFi del laboratorio
- mantiene una sesion MQTT persistente con EMQX Cloud
- escucha el topic `laboratorio/peces/comandos/tanque_1`
- al recibir `{"comando":"forzar_lectura"}`:
  - lee la temperatura desde un DS18B20 en `GPIO 4`
  - la envia por HTTPS a Supabase
  - parpadea el LED integrado en `GPIO 2`

## 2. Archivos importantes

- `platformio.ini`
- `src/main.cpp`
- `scripts/load_env.py`
- `../web/.env`

## 3. Requisitos previos

Necesitas:

- un ESP32 compatible con `esp32dev`
- cable USB de datos
- sensor DS18B20
- resistencia `4.7k`
- VS Code con PlatformIO IDE o `pio` instalado en terminal

## 4. Conexion de pines

Conexion sugerida:

- `ESP32 GPIO 4` -> `DATA` del DS18B20
- `ESP32 3V3` -> `VCC` del DS18B20
- `ESP32 GND` -> `GND` del DS18B20
- resistencia `4.7k` entre `DATA (GPIO 4)` y `3V3`
- `GPIO 2` queda como LED integrado de actividad

## 5. Variables que ya toma automaticamente

El script `scripts/load_env.py` lee desde `../web/.env` estas variables y las inyecta al firmware al compilar:

- `VITE_MQTT_USER`
- `VITE_MQTT_PASSWORD`
- `VITE_SUPABASE_ANON_KEY`

No necesitas copiarlas manualmente al firmware.

## 6. Lo unico que debes poner manualmente

Abre `platformio.ini` y revisa estos `build_flags`:

```ini
build_flags =
  -DWIFI_SSID=\"TU_SSID_WIFI\"
  -DWIFI_PASSWORD=\"TU_PASSWORD_WIFI\"
```

Reemplaza:

- `TU_SSID_WIFI`
- `TU_PASSWORD_WIFI`

por los datos reales del WiFi del laboratorio.

## 7. Verifica el .env del frontend

Antes de compilar, confirma que `../web/.env` tenga al menos:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_MQTT_HOST`
- `VITE_MQTT_USER`
- `VITE_MQTT_PASSWORD`

## 8. Entrar a la carpeta correcta

Desde terminal:

```bash
cd "/home/kimdokja/Documents/Sensores peces/laboratorio-peces/hardware"
```

## 9. Detectar el puerto del ESP32

Conecta el ESP32 por USB y revisa:

```bash
pio device list
```

Si no tienes `pio` global, desde la extension de PlatformIO en VS Code tambien puedes verlo en la seccion de dispositivos.

En Linux normalmente aparece como algo tipo:

- `/dev/ttyUSB0`
- `/dev/ttyACM0`

## 10. Compilar el firmware

```bash
pio run
```

Si todo esta bien, deberias ver al final:

```text
[SUCCESS]
```

## 11. Subir el firmware al ESP32

```bash
pio run -t upload
```

Si quieres forzar un puerto especifico:

```bash
pio run -t upload --upload-port /dev/ttyUSB0
```

## 12. Abrir el monitor serial

```bash
pio device monitor -b 115200
```

Si quieres un puerto especifico:

```bash
pio device monitor -b 115200 --port /dev/ttyUSB0
```

## 13. Que deberias ver en el monitor serial

Mensajes esperados:

- arranque del firmware
- deteccion del sensor DS18B20
- conexion a WiFi
- conexion MQTT a `pc13fddb.ala.us-east-1.emqxsl.com`
- suscripcion al topic `laboratorio/peces/comandos/tanque_1`

Cuando presiones el boton en la web:

- `Comando forzar_lectura recibido`
- lectura de temperatura
- confirmacion de envio a Supabase

## 14. Como probarlo de extremo a extremo

1. Asegurate de que la web este levantada o desplegada.
2. Asegurate de que el ESP32 este encendido y conectado.
3. Abre el monitor serial.
4. En la web presiona `Forzar Lectura de Hardware`.
5. Espera unos segundos.
6. La grafica deberia refrescarse sola y el dato nuevo deberia aparecer.

## 15. Si falla la carga

Prueba estos pasos:

- usa otro cable USB
- cambia el puerto USB
- cierra cualquier monitor serial abierto antes de subir
- repite con puerto explicito:

```bash
pio run -t upload --upload-port /dev/ttyUSB0
```

- si el ESP32 no entra en modo bootloader, manten presionado `BOOT` durante el inicio de la carga y sueltalo cuando empiece a escribir

## 16. Si compila pero no manda datos

Revisa en este orden:

1. `WIFI_SSID` y `WIFI_PASSWORD`
2. cableado del DS18B20
3. resistencia `4.7k`
4. variables MQTT en `../web/.env`
5. `VITE_SUPABASE_ANON_KEY`
6. acceso saliente del WiFi del laboratorio a internet

## 17. Comandos resumen

Compilar:

```bash
cd "/home/kimdokja/Documents/Sensores peces/laboratorio-peces/hardware" && pio run
```

Subir:

```bash
cd "/home/kimdokja/Documents/Sensores peces/laboratorio-peces/hardware" && pio run -t upload
```

Monitor serial:

```bash
cd "/home/kimdokja/Documents/Sensores peces/laboratorio-peces/hardware" && pio device monitor -b 115200
```

## 18. Nota final

El firmware ya esta preparado para:

- WiFi con reconexion automatica
- MQTT seguro persistente
- lectura real por DS18B20
- envio HTTPS a Supabase
- feedback visual con el LED integrado

Lo unico pendiente antes de cargar en un ESP32 real es poner el WiFi verdadero del laboratorio en `platformio.ini`.
