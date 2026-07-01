#pragma once
#include "types.h"
#include "feeding.h"

// Drives the SSD1327 128x128 grayscale OLED (Adafruit 1.5", I2C address 0x3D).
//
// On the Feather V2 the I2C/STEMMA rail is powered through NEOPIXEL_I2C_POWER,
// so begin() drives it HIGH before talking to the panel and off() drops it
// before deep sleep to save current. A full-frame push takes about 180 ms over
// I2C, so the caller redraws only on change rather than every loop.

namespace display {
  void begin();   // power the I2C rail and initialize the panel
  void off();     // blank the panel and cut I2C power before deep sleep

  // Wake screen: today's meal status, the last feeding, and a
  // "press to log as <selected user>" prompt. Shows a clock-not-set notice
  // (and hides the untrustworthy status/time fields) when conf is UNKNOWN.
  void status(const FeedState& s, time_t now, ClockConfidence conf,
              int selectedUser, float batteryV, size_t pending);

  // Duplicate warning with the hold-to-override prompt.
  void alreadyFed(const feeding::DupCheck& dup, time_t now, int secondsLeft);

  // Confirmation shown right after a feeding is logged.
  void success(const FeedState& s);
}
