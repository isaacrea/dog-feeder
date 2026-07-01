#pragma once
#include <Arduino.h>
#include <time.h>

// Shared enums and structs used by store, feeding, timekeeping, and sync. Kept
// in its own header so store.h and feeding.h need not depend on each other.

enum Meal : uint8_t {
  MEAL_BREAKFAST = 0,   // first feeding of the day
  MEAL_DINNER    = 1,   // second (or any later) feeding of the day
  MEAL_UNKNOWN   = 2,   // clock not set yet: logged but not assigned to a slot
};

enum ClockConfidence : uint8_t {
  CLOCK_SYNCED   = 0,   // NTP within the last 24 h; fully trusted
  CLOCK_DRIFTING = 1,   // running on the internal clock since last sync; still usable
  CLOCK_UNKNOWN  = 2,   // booted after power loss, no sync yet; meal status untrusted
};

inline const char* mealName(Meal m) {
  switch (m) {
    case MEAL_BREAKFAST: return "breakfast";
    case MEAL_DINNER:    return "dinner";
    default:             return "unknown";
  }
}

inline const char* confidenceName(ClockConfidence c) {
  switch (c) {
    case CLOCK_SYNCED:   return "synced";
    case CLOCK_DRIFTING: return "drifting";
    default:             return "unknown";
  }
}

// One feeding, in the exact form persisted to LittleFS and synced to AWS.
struct FeedEvent {
  char  eventId[32];               // e.g. "feeder1-000042"; idempotency key for the backend
  char  person[16];
  Meal  meal;
  bool  overridden;                // logged via hold-to-override
  time_t timestamp;                // epoch seconds (best guess when the clock is unknown)
  ClockConfidence timeConfidence;  // how far to trust `timestamp`
  float batteryVoltage;
};

// Snapshot of device state. The single source of truth, mirrored in NVS so it
// survives reboots and power loss. Meal status is computed from these
// timestamps; there are no "breakfastDone" flags to reset at midnight.
struct FeedState {
  time_t   bfastTs  = 0;  char bfastBy[16]  = "";
  time_t   dinnerTs = 0;  char dinnerBy[16] = "";
  time_t   lastTs   = 0;  char lastBy[16]   = "";
  time_t   lastKnownTime = 0;   // clock floor: real time is at least this
  uint32_t nextEventId   = 1;   // monotonic, never reused
};
