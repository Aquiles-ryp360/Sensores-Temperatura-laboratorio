#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

// Credenciales WiFi
const char* WIFI_SSID = "TU_SSID";
const char* WIFI_PASSWORD = "TU_PASSWORD";

// Configuracion de Supabase
const char* SUPABASE_URL = "https://TU-PROJECT-REF.supabase.co";
const char* SUPABASE_API_KEY = "TU_SUPABASE_API_KEY";
const char* SENSOR_ID = "sensor-temp-001";

// Si tu proyecto usa una key anon antigua en formato JWT, cambia a true.
// Si usas una publishable key nueva, dejalo en false.
const bool SUPABASE_KEY_IS_LEGACY_JWT = false;

const unsigned long INTERVALO_ENVIO_MS = 5UL * 60UL * 1000UL;  // 5 minutos
unsigned long ultimoEnvio = 0;

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.printf("Conectando a WiFi: %s", WIFI_SSID);

  uint8_t intentos = 0;
  while (WiFi.status() != WL_CONNECTED && intentos < 30) {
    delay(500);
    Serial.print(".");
    intentos++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("WiFi conectado.");
    Serial.print("IP local: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println();
    Serial.println("No se pudo conectar a WiFi. Se reintentara en el loop.");
  }
}

float leerTemperaturaSimulada() {
  // Simula una lectura entre 22.0 C y 32.0 C
  return random(220, 321) / 10.0f;
}

bool enviarTemperatura(float temperatura) {
  if (WiFi.status() != WL_CONNECTED) {
    conectarWiFi();
    if (WiFi.status() != WL_CONNECTED) {
      return false;
    }
  }

  WiFiClientSecure secureClient;
  secureClient.setInsecure();  // Reemplazar por validacion de certificado en produccion.

  HTTPClient http;
  const String endpoint = String(SUPABASE_URL) + "/rest/v1/temperaturas";

  if (!http.begin(secureClient, endpoint)) {
    Serial.println("No se pudo iniciar la conexion HTTPS con Supabase.");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_API_KEY);

  if (SUPABASE_KEY_IS_LEGACY_JWT) {
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_API_KEY);
  }

  // Reduce el payload de respuesta del API.
  http.addHeader("Prefer", "return=minimal");

  char payload[128];
  snprintf(
      payload,
      sizeof(payload),
      "{\"valor_temp\":%.2f,\"sensor_id\":\"%s\"}",
      temperatura,
      SENSOR_ID);

  const int httpCode = http.POST(reinterpret_cast<uint8_t*>(payload), strlen(payload));

  if (httpCode > 0) {
    Serial.printf("POST %s -> HTTP %d\n", endpoint.c_str(), httpCode);

    if (httpCode >= 200 && httpCode < 300) {
      http.end();
      return true;
    }

    Serial.println("Respuesta de error:");
    Serial.println(http.getString());
  } else {
    Serial.print("Fallo en HTTP POST: ");
    Serial.println(http.errorToString(httpCode));
  }

  http.end();
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  randomSeed(micros());
  conectarWiFi();

  // Fuerza el primer envio apenas arranca el equipo.
  ultimoEnvio = millis() - INTERVALO_ENVIO_MS;
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    conectarWiFi();
  }

  const unsigned long ahora = millis();
  if (ahora - ultimoEnvio >= INTERVALO_ENVIO_MS) {
    ultimoEnvio = ahora;

    const float temperatura = leerTemperaturaSimulada();
    Serial.printf("Temperatura simulada: %.2f C\n", temperatura);

    const bool enviado = enviarTemperatura(temperatura);
    Serial.println(enviado ? "Envio exitoso a Supabase." : "No se pudo enviar la lectura.");
  }

  delay(1000);
}
