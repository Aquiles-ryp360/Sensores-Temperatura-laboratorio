#include <Arduino.h>
#include <ArduinoJson.h>
#include <DallasTemperature.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

/*
  Pinout sugerido para el ESP32 + DS18B20

  ESP32 GPIO 4  ---- DATA del DS18B20
  ESP32 3V3     ---- VCC del DS18B20
  ESP32 GND     ---- GND del DS18B20
  Resistencia 4.7k entre DATA (GPIO 4) y 3V3
  ESP32 GPIO 2  ---- LED integrado de actividad
*/

#ifndef WIFI_SSID
#define WIFI_SSID "TU_SSID_WIFI"
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "TU_PASSWORD_WIFI"
#endif

#ifndef MQTT_USER
#define MQTT_USER ""
#endif

#ifndef MQTT_PASSWORD
#define MQTT_PASSWORD ""
#endif

#ifndef SUPABASE_ANON_KEY
#define SUPABASE_ANON_KEY ""
#endif

namespace {

constexpr char WIFI_SSID_VALUE[] = WIFI_SSID;
constexpr char WIFI_PASSWORD_VALUE[] = WIFI_PASSWORD;
constexpr char MQTT_USER_VALUE[] = MQTT_USER;
constexpr char MQTT_PASSWORD_VALUE[] = MQTT_PASSWORD;
constexpr char SUPABASE_ANON_KEY_VALUE[] = SUPABASE_ANON_KEY;

constexpr char SENSOR_ID[] = "pecera_1";
constexpr char MQTT_HOST[] = "pc13fddb.ala.us-east-1.emqxsl.com";
constexpr uint16_t MQTT_PORT = 8883;
constexpr char MQTT_COMMAND_TOPIC[] = "laboratorio/peces/comandos/tanque_1";
constexpr char SUPABASE_INSERT_URL[] =
    "https://capcqltnfycefbkhcune.supabase.co/rest/v1/temperaturas";

constexpr uint8_t ONE_WIRE_PIN = 4;
constexpr uint8_t STATUS_LED_PIN = 2;
constexpr uint8_t LED_ON_LEVEL = HIGH;
constexpr uint8_t LED_OFF_LEVEL = LOW;

constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 10000;
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 15000;
constexpr uint32_t MQTT_RETRY_INTERVAL_MS = 5000;
constexpr uint32_t MQTT_KEEPALIVE_SECONDS = 30;
constexpr uint32_t MQTT_SOCKET_TIMEOUT_SECONDS = 15;
constexpr uint16_t MQTT_BUFFER_SIZE = 256;
constexpr uint32_t HTTP_TIMEOUT_MS = 12000;
constexpr uint32_t LED_BLINK_MS = 120;

WiFiClientSecure mqttSecureClient;
PubSubClient mqttClient(mqttSecureClient);
WiFiClientSecure httpsSecureClient;
OneWire oneWire(ONE_WIRE_PIN);
DallasTemperature temperatureSensor(&oneWire);

bool measurementRequested = false;
bool sensorDetected = false;
unsigned long lastWifiAttemptAt = 0;
unsigned long lastMqttAttemptAt = 0;
unsigned long ledOffAt = 0;
String mqttClientId;

}  // namespace

bool hasRuntimeSecrets() {
  return strlen(MQTT_USER_VALUE) > 0 &&
         strlen(MQTT_PASSWORD_VALUE) > 0 &&
         strlen(SUPABASE_ANON_KEY_VALUE) > 0;
}

bool hasWifiCredentials() {
  return strcmp(WIFI_SSID_VALUE, "TU_SSID_WIFI") != 0 &&
         strcmp(WIFI_PASSWORD_VALUE, "TU_PASSWORD_WIFI") != 0 &&
         strlen(WIFI_SSID_VALUE) > 0;
}

void blinkStatusLed(unsigned long durationMs = LED_BLINK_MS) {
  digitalWrite(STATUS_LED_PIN, LED_ON_LEVEL);
  ledOffAt = millis() + durationMs;
}

void updateStatusLed() {
  if (ledOffAt != 0 && millis() >= ledOffAt) {
    digitalWrite(STATUS_LED_PIN, LED_OFF_LEVEL);
    ledOffAt = 0;
  }
}

String buildMqttClientId() {
  uint64_t chipId = ESP.getEfuseMac();
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "pecera_1_%04X%08X",
           static_cast<uint16_t>(chipId >> 32),
           static_cast<uint32_t>(chipId));
  return String(buffer);
}

void configureSensor() {
  temperatureSensor.begin();
  sensorDetected = temperatureSensor.getDeviceCount() > 0;

  if (sensorDetected) {
    temperatureSensor.setResolution(12);
    Serial.println("[SENSOR] DS18B20 detectado en GPIO 4.");
  } else {
    Serial.println("[SENSOR] No se detecto DS18B20. Revisa cableado y resistencia pull-up.");
  }
}

bool ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  if (!hasWifiCredentials()) {
    Serial.println("[WiFi] Configura WIFI_SSID y WIFI_PASSWORD antes de cargar el firmware.");
    return false;
  }

  const unsigned long now = millis();
  if (now - lastWifiAttemptAt < WIFI_RETRY_INTERVAL_MS) {
    return false;
  }

  lastWifiAttemptAt = now;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID_VALUE, WIFI_PASSWORD_VALUE);

  Serial.printf("[WiFi] Conectando a %s...\n", WIFI_SSID_VALUE);

  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED &&
         millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    updateStatusLed();
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] Conectado. IP: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }

  Serial.println("[WiFi] Conexion no disponible. Reintentando...");
  return false;
}

void handleMqttMessage(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<128> commandDocument;
  DeserializationError error = deserializeJson(commandDocument, payload, length);

  if (error) {
    Serial.printf("[MQTT] JSON invalido en %s: %s\n", topic, error.c_str());
    return;
  }

  const char* command = commandDocument["comando"] | "";

  if (strcmp(command, "forzar_lectura") != 0) {
    Serial.printf("[MQTT] Comando ignorado en %s.\n", topic);
    return;
  }

  Serial.println("[MQTT] Comando forzar_lectura recibido.");
  blinkStatusLed();
  measurementRequested = true;
}

bool ensureMqttConnected() {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  if (mqttClient.connected()) {
    return true;
  }

  if (!hasRuntimeSecrets()) {
    Serial.println("[MQTT] Faltan MQTT_USER, MQTT_PASSWORD o SUPABASE_ANON_KEY.");
    return false;
  }

  const unsigned long now = millis();
  if (now - lastMqttAttemptAt < MQTT_RETRY_INTERVAL_MS) {
    return false;
  }

  lastMqttAttemptAt = now;

  Serial.printf("[MQTT] Conectando a %s:%u...\n", MQTT_HOST, MQTT_PORT);

  if (mqttClient.connect(mqttClientId.c_str(), MQTT_USER_VALUE, MQTT_PASSWORD_VALUE)) {
    Serial.println("[MQTT] Sesion establecida.");

    if (mqttClient.subscribe(MQTT_COMMAND_TOPIC, 1)) {
      Serial.printf("[MQTT] Suscrito a %s.\n", MQTT_COMMAND_TOPIC);
    } else {
      Serial.println("[MQTT] No se pudo suscribir al topic de comandos.");
    }

    return true;
  }

  Serial.printf("[MQTT] Error de conexion. Estado PubSubClient=%d\n", mqttClient.state());
  return false;
}

float readTemperatureC() {
  temperatureSensor.requestTemperatures();
  float temperature = temperatureSensor.getTempCByIndex(0);

  if (temperature == DEVICE_DISCONNECTED_C || isnan(temperature)) {
    return NAN;
  }

  return temperature;
}

bool postTemperatureToSupabase(float temperature) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  HTTPClient http;
  httpsSecureClient.setInsecure();

  if (!http.begin(httpsSecureClient, SUPABASE_INSERT_URL)) {
    Serial.println("[HTTP] No se pudo abrir la conexion HTTPS con Supabase.");
    return false;
  }

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY_VALUE);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY_VALUE);
  http.addHeader("Prefer", "return=minimal");

  StaticJsonDocument<128> payloadDocument;
  payloadDocument["sensor_id"] = SENSOR_ID;
  payloadDocument["valor_temp"] = temperature;

  String payload;
  serializeJson(payloadDocument, payload);

  int httpCode = http.POST(payload);

  if (httpCode >= 200 && httpCode < 300) {
    http.end();
    return true;
  }

  Serial.printf("[HTTP] Error al insertar en Supabase. Codigo=%d\n", httpCode);
  if (httpCode > 0) {
    Serial.println(http.getString());
  } else {
    Serial.println(http.errorToString(httpCode));
  }

  http.end();
  return false;
}

void takeImmediateMeasurement() {
  measurementRequested = false;

  if (!sensorDetected) {
    Serial.println("[SENSOR] No hay DS18B20 disponible para leer.");
    return;
  }

  if (!ensureWiFiConnected()) {
    Serial.println("[FLOW] Sin WiFi, no se puede tomar ni enviar la lectura.");
    return;
  }

  float temperature = readTemperatureC();
  if (isnan(temperature)) {
    Serial.println("[SENSOR] Lectura invalida del DS18B20.");
    return;
  }

  Serial.printf("[SENSOR] Lectura inmediata: %.2f C\n", temperature);

  bool sent = postTemperatureToSupabase(temperature);
  if (sent) {
    Serial.println("[FLOW] Dato enviado a Supabase.");
    blinkStatusLed(250);
  } else {
    Serial.println("[FLOW] No se pudo enviar la lectura a Supabase.");
  }
}

void setup() {
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LED_OFF_LEVEL);

  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("=== Sensores-Temperatura-laboratorio / ESP32 ===");

  mqttClientId = buildMqttClientId();

  configureSensor();

  mqttSecureClient.setInsecure();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(handleMqttMessage);
  mqttClient.setKeepAlive(MQTT_KEEPALIVE_SECONDS);
  mqttClient.setSocketTimeout(MQTT_SOCKET_TIMEOUT_SECONDS);
  mqttClient.setBufferSize(MQTT_BUFFER_SIZE);

  ensureWiFiConnected();
  ensureMqttConnected();
}

void loop() {
  updateStatusLed();

  bool wifiReady = ensureWiFiConnected();
  if (!wifiReady) {
    delay(50);
    return;
  }

  ensureMqttConnected();
  mqttClient.loop();

  if (measurementRequested) {
    takeImmediateMeasurement();
  }

  delay(10);
}
