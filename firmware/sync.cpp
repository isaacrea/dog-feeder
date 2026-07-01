#include "sync.h"
#include "config.h"
#include "store.h"
#include "timekeeping.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

namespace {

  bool wifiConnect(uint32_t timeoutMs) {
    if (WiFi.status() == WL_CONNECTED) return true;
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - start) < timeoutMs) {
      delay(100);
    }
    return WiFi.status() == WL_CONNECTED;
  }

  void wifiOff() {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
  }

  int postEvent(const String& json) {
    HTTPClient http;
    http.begin(API_URL);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-api-key", API_KEY);     // ignored until API Gateway requires it
    int code = http.POST((uint8_t*)json.c_str(), json.length());
    http.end();
    return code;
  }

  // Turn a stored event file into the outgoing payload. For an event logged in
  // the current boot, attach `ageSec` (how long ago it happened, measured with
  // the non-drifting awake millisecond clock) so the server can anchor the
  // timestamp to its own reliable clock. Events from an older boot cannot be
  // aged, so they ship their (possibly drifted) device timestamp unchanged.
  String buildPayload(const String& stored) {
    JsonDocument doc;
    if (deserializeJson(doc, stored)) return stored;   // unparseable: send as-is

    if (doc["bootId"].is<uint32_t>() &&
        doc["bootId"].as<uint32_t>() == store::bootId() &&
        doc["uptimeMs"].is<uint32_t>()) {
      uint32_t logged = doc["uptimeMs"].as<uint32_t>();
      uint32_t nowMs  = millis();
      uint32_t ageMs  = (nowMs >= logged) ? (nowMs - logged) : 0;
      doc["ageSec"]   = (ageMs + 500) / 1000;          // server: timestamp = receivedAt - ageSec
    }

    doc.remove("uptimeMs");                            // device-internal, not shipped
    doc.remove("bootId");

    String out;
    serializeJson(doc, out);
    return out;
  }

}  // namespace

void cloudsync::recoverClock() {
  // Only needed when the clock was lost (cold boot). Bring the radio up just
  // long enough for timekeeping to pull NTP, then drop it again.
  if (timekeeping::confidence() != CLOCK_UNKNOWN) return;
  if (!wifiConnect(WIFI_CONNECT_TIMEOUT_MS)) return;
  timekeeping::onWifiUp();
  wifiOff();
}

void cloudsync::flush() {
  bool haveQueue    = store::queueCount() > 0;
  bool recoverClock = timekeeping::confidence() == CLOCK_UNKNOWN;
  if (!haveQueue && !recoverClock) return;             // nothing needs the radio

  if (!wifiConnect(WIFI_CONNECT_TIMEOUT_MS)) return;   // offline: retry on the next wake

  timekeeping::onWifiUp();                             // recover or refresh the clock while up

  String path, json;
  while (store::oldestQueued(path, json)) {
    int code = postEvent(buildPayload(json));
    // Any 2xx response (including the Lambda's idempotent "already stored") means
    // the backend has the event, so the local copy is dropped. On the first
    // failure, stop and leave the rest queued; the next wake resumes from here.
    if (code >= 200 && code < 300) store::removeQueued(path);
    else break;
  }

  wifiOff();
}
