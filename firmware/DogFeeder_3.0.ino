/*
  Dog Feeding Tracker

  Each button press wakes the device, which runs one session (show status, log a
  feeding), syncs over a brief Wi-Fi burst, then returns to deep sleep. RAM is
  wiped on every wake, so the source of truth lives in NVS and LittleFS rather
  than in globals.
*/
#include <Arduino.h>
#include "config.h"
#include "store.h"
#include "feeding.h"
#include "input.h"
#include "timekeeping.h"
#include "sync.h"
#include "power.h"
#include "display.h"

enum UiState { WAKE_STATUS, WARNING, SUCCESS };

static bool commitFeeding(int sel, time_t now, ClockConfidence conf, bool overridden);
static void runSession();

static float readBatteryV() {
  uint32_t mv = analogReadMilliVolts(VBAT_PIN);   // Feather V2 divides VBAT by 2
  return (mv * 2) / 1000.0f;
}

void setup() {
  Serial.begin(115200);

  timekeeping::begin();   // set TZ and a provisional clock guess (used only when no RTC is present)
  store::begin();         // mount NVS and LittleFS, reload the snapshot
  input::begin();

  bool buttonWake = (power::wakeReason() == power::WAKE_BUTTON);

  display::begin();       // power the I2C rail, Wire, and OLED (the DS3231 shares this switched rail)
  timekeeping::syncFromRtc();   // adopt the DS3231 as the clock if it is present and valid

  // If there is still no trustworthy time (no RTC on the bus, or its coin cell
  // died), recover over Wi-Fi before the session so the first feeding is
  // timestamped correctly. With a healthy DS3231 this is skipped entirely, so
  // normal wakes stay instant and fully offline-capable.
  if (timekeeping::confidence() == CLOCK_UNKNOWN) {
    cloudsync::recoverClock();
  }

  if (buttonWake) {
    power::waitForButtonRelease();   // do not let the wake press auto-confirm
  }

  runSession();

  display::off();         // blank and depower the OLED before sleeping
  cloudsync::flush();     // drain the queue and occasionally trim the RTC over NTP
  timekeeping::beforeSleep();
  power::sleepUntilButton();         // deep sleep; the next press resets into setup()
}

void loop() {}            // unused under the wake/act/sleep model

// Waking is already a deliberate act, so the former IDLE and CONFIRM states
// collapse into a single wake screen: it shows status plus "press to log as
// <selected user>", and a press either logs the feeding or routes to the
// override warning.
static void runSession() {
  UiState  st       = WAKE_STATUS;
  UiState  drawn    = (UiState)0xFF;       // force the first draw
  int      drawnSel = -2;
  int      drawnWarnSecs = -1;
  feeding::DupCheck pendingDup = {};
  uint32_t successAt = 0;
  uint32_t lastActivity = millis();

  while ((millis() - lastActivity) < AWAKE_TIMEOUT_MS) {
    input::Button btn = input::pollButton();
    if (btn.pressed || btn.released || btn.heldLong) lastActivity = millis();

    ClockConfidence conf = timekeeping::confidence();
    time_t now = timekeeping::now();
    int    sel = input::selectedUser();

    switch (st) {
      case WAKE_STATUS:
        if (btn.pressed && sel >= 0) {
          feeding::DupCheck dup = feeding::check(now, conf);
          if (dup.blocked) { pendingDup = dup; st = WARNING; }
          else if (commitFeeding(sel, now, conf, false)) { successAt = millis(); st = SUCCESS; }
        }
        break;

      case WARNING:
        if (btn.heldLong) {
          if (commitFeeding(sel, now, conf, true)) { successAt = millis(); st = SUCCESS; }
        } else if ((millis() - lastActivity) >= WARNING_TIMEOUT_MS) {
          st = WAKE_STATUS;
        }
        break;

      case SUCCESS:
        if ((millis() - successAt) > SUCCESS_SCREEN_MS) return;  // done; the caller syncs and sleeps
        break;
    }

    // Seconds left before the warning auto-returns (drives the on-screen count).
    int warnSecs = 0;
    if (st == WARNING) {
      long rem = (long)WARNING_TIMEOUT_MS - (long)(millis() - lastActivity);
      warnSecs = rem > 0 ? (int)((rem + 999) / 1000) : 0;
    }

    // Redraw only on a real change. A full 128x128 push takes about 180 ms over
    // I2C, so redrawing every loop would make the UI sluggish; the warning
    // redraws once per second to advance its countdown.
    bool needDraw = (st != drawn)
                 || (st == WAKE_STATUS && sel != drawnSel)
                 || (st == WARNING && warnSecs != drawnWarnSecs);
    if (needDraw) {
      switch (st) {
        case WAKE_STATUS:
          display::status(store::state(), now, conf, sel, readBatteryV(), store::queueCount());
          break;
        case WARNING:
          display::alreadyFed(pendingDup, now, warnSecs);
          break;
        case SUCCESS:
          display::success(store::state());
          break;
      }
      drawn = st;
      drawnSel = sel;
      drawnWarnSecs = warnSecs;
    }

    delay(5);
  }
  // Timed out on the status screen (a glance, no feeding); the caller syncs and sleeps.
}

static bool commitFeeding(int sel, time_t now, ClockConfidence conf, bool overridden) {
  if (sel < 0) return false;
  return feeding::logFeeding(USERS[sel], now, conf, readBatteryV(), overridden);
}
