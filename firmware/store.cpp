#include "store.h"
#include "config.h"
#include <Preferences.h>
#include <LittleFS.h>
#include <ArduinoJson.h>   // v7. On v6, swap JsonDocument for StaticJsonDocument<256>.
#include <esp_random.h>    // esp_random() for the per-boot id

namespace {

  Preferences prefs;
  FeedState s;
  uint32_t s_bootId = 0;
  const char* QUEUE_DIR = "/queue";

  void isoUtc(time_t t, char* buf, size_t n) {
    struct tm g;
    gmtime_r(&t, &g);
    strftime(buf, n, "%Y-%m-%dT%H:%M:%SZ", &g);
  }

  // Serialize and write one event to /queue/NNNNNN.json. Zero-padded names keep
  // lexical order equal to chronological order.
  bool writeEventFile(const FeedEvent& ev, uint32_t id) {
    char path[32];
    snprintf(path, sizeof(path), "%s/%06u.json", QUEUE_DIR, id);

    JsonDocument doc;
    doc["eventId"]        = ev.eventId;
    doc["person"]         = ev.person;
    doc["meal"]           = mealName(ev.meal);
    doc["override"]       = ev.overridden;
    char iso[24];
    isoUtc(ev.timestamp, iso, sizeof(iso));
    doc["timestamp"]      = iso;
    doc["timeConfidence"] = confidenceName(ev.timeConfidence);
    doc["batteryVoltage"] = ev.batteryVoltage;
    // Device-internal: how long after boot this was logged, and which boot. The
    // sync layer uses these to age the event accurately; they are not shipped.
    doc["uptimeMs"]       = (uint32_t)millis();
    doc["bootId"]         = s_bootId;

    File f = LittleFS.open(path, "w");
    if (!f) return false;
    size_t written = serializeJson(doc, f);
    f.close();
    if (written == 0) {            // partial or failed write: do not leave junk behind
      LittleFS.remove(path);
      return false;
    }
    return true;
  }

  void saveSnapshot() {
    prefs.putLong64("bfastTs", (int64_t)s.bfastTs);
    prefs.putString("bfastBy", s.bfastBy);
    prefs.putLong64("dinTs",   (int64_t)s.dinnerTs);
    prefs.putString("dinBy",   s.dinnerBy);
    prefs.putLong64("lastTs",  (int64_t)s.lastTs);
    prefs.putString("lastBy",  s.lastBy);
    prefs.putLong64("floor",   (int64_t)s.lastKnownTime);
    // nextEventId is persisted separately, before the event file is written.
  }

  void loadSnapshot() {
    s.bfastTs       = (time_t)prefs.getLong64("bfastTs", 0);
    prefs.getString("bfastBy", s.bfastBy, sizeof(s.bfastBy));
    s.dinnerTs      = (time_t)prefs.getLong64("dinTs", 0);
    prefs.getString("dinBy",   s.dinnerBy, sizeof(s.dinnerBy));
    s.lastTs        = (time_t)prefs.getLong64("lastTs", 0);
    prefs.getString("lastBy",  s.lastBy, sizeof(s.lastBy));
    s.lastKnownTime = (time_t)prefs.getLong64("floor", 0);
    s.nextEventId   = prefs.getUInt("nextId", 1);
  }

}  // namespace

bool store::begin() {
  s_bootId = esp_random();                        // unique per boot (RF-seeded)
  if (!prefs.begin("feeder", /*readOnly=*/false)) return false;
  if (!LittleFS.begin(/*formatOnFail=*/true))     return false;
  if (!LittleFS.exists(QUEUE_DIR)) LittleFS.mkdir(QUEUE_DIR);
  loadSnapshot();
  return true;
}

FeedState& store::state() {
  return s;
}

uint32_t store::bootId() {
  return s_bootId;
}

bool store::recordFeeding(FeedEvent& ev) {
  // 1. Claim an id and persist the counter first. A crash between here and the
  //    file write skips an id number but never reuses one. Ids must stay unique
  //    forever because the backend dedupes on them.
  uint32_t id = s.nextEventId;
  s.nextEventId = id + 1;
  prefs.putUInt("nextId", s.nextEventId);

  snprintf(ev.eventId, sizeof(ev.eventId), "%s-%06u", DEVICE_ID, id);

  // 2. The event reaches flash before anything else changes. From this point on,
  //    power loss cannot lose the feeding; it can only delay its sync.
  if (!writeEventFile(ev, id)) return false;

  // 3. Update the snapshot (RAM first, then NVS).
  s.lastTs = ev.timestamp;
  strlcpy(s.lastBy, ev.person, sizeof(s.lastBy));
  if (ev.meal == MEAL_BREAKFAST) {
    s.bfastTs = ev.timestamp;
    strlcpy(s.bfastBy, ev.person, sizeof(s.bfastBy));
  } else if (ev.meal == MEAL_DINNER) {
    s.dinnerTs = ev.timestamp;
    strlcpy(s.dinnerBy, ev.person, sizeof(s.dinnerBy));
  }
  if (ev.timestamp > s.lastKnownTime) s.lastKnownTime = ev.timestamp;
  saveSnapshot();
  return true;
}

void store::persistTimeFloor(time_t now) {
  if (now > s.lastKnownTime) {
    s.lastKnownTime = now;
    prefs.putLong64("floor", (int64_t)now);
  }
}

size_t store::queueCount() {
  size_t n = 0;
  File dir = LittleFS.open(QUEUE_DIR);
  if (!dir || !dir.isDirectory()) return 0;
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    if (!f.isDirectory()) n++;
  }
  return n;
}

bool store::oldestQueued(String& pathOut, String& jsonOut) {
  String best;
  File dir = LittleFS.open(QUEUE_DIR);
  if (!dir || !dir.isDirectory()) return false;
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    if (f.isDirectory()) continue;
    String name = f.name();                  // zero-padded, so lexical order is oldest-first
    if (best.isEmpty() || name < best) best = name;
  }
  if (best.isEmpty()) return false;

  pathOut = String(QUEUE_DIR) + "/" + best;
  File f = LittleFS.open(pathOut, "r");
  if (!f) return false;
  jsonOut = f.readString();
  f.close();
  return !jsonOut.isEmpty();
}

bool store::removeQueued(const String& path) {
  return LittleFS.remove(path);
}
