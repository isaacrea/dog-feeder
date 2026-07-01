#pragma once
#include "types.h"

// Produces the (now, confidence) pair the rest of the firmware consumes, and
// behaves correctly across the deep-sleep cycle.
//
// When a DS3231 is present on the I2C bus it is the source of truth: each wake
// reads it (syncFromRtc) and adopts it as the system clock, so time is accurate
// immediately with no drift. NTP then serves only as an occasional trim, and as
// the means of establishing the RTC initially (or after its coin cell dies).
//
// With no DS3231 on the bus the module falls back to software behavior: across a
// button WAKE the ESP32 RTC keeps running so time() stays valid (SYNCED or
// DRIFTING); across a COLD BOOT the clock is gone (UNKNOWN) until NTP recovers
// it. The two cases are distinguished by the wake cause plus a last-synced
// marker held in RTC memory.

namespace timekeeping {
  void begin();                  // call first in setup(): sets TZ, classifies the clock
  void syncFromRtc();            // after the I2C rail is up: adopt the DS3231 if present and valid
  time_t now();                  // best-guess epoch (floor + seconds awake when UNKNOWN)
  ClockConfidence confidence();
  bool hasRtc();                 // true once a DS3231 has answered on the bus
  void onWifiUp();               // force a fresh NTP read; update confidence, floor, and the RTC
  void beforeSleep();            // persist the clock floor before deep sleep
}
