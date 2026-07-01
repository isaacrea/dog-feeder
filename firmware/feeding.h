#pragma once
#include "types.h"
#include "config.h"

// Ordinal meal assignment, duplicate detection, and event creation.
//
// The dog is fed twice a day: the first feeding of the day is breakfast, the
// second is dinner. Meals are assigned by order, not by clock window, so feeding
// early or late never mislabels the meal, and there is no "extra" category.
//
// This module knows nothing about Wi-Fi, the sync task, or the display. It takes
// the current time and clock confidence as inputs rather than querying a clock
// module, which keeps it unit-testable and free of hidden dependencies.

namespace feeding {

  // Why a feeding was blocked; drives the warning screen's message.
  enum BlockReason : uint8_t {
    BLOCK_NONE = 0,
    BLOCK_TWICE_TODAY,   // breakfast and dinner are both already logged today
    BLOCK_RECENT,        // the last feeding was very recent (likely a double-feed)
  };

  // Result of the duplicate check, carrying everything the warning screen needs.
  struct DupCheck {
    bool        blocked;    // true when the "already fed, hold to override" screen should show
    BlockReason reason;     // why (meaningful only when blocked)
    Meal        meal;       // the meal this feeding would be recorded as
    char        prevBy[16]; // who logged the most recent feeding (when blocked)
    time_t      prevTs;     // when it was logged (when blocked)
  };

  // Same calendar day in local time (year and day-of-year). Zero never matches.
  bool sameLocalDay(time_t a, time_t b);

  // How many of today's two meal slots are already filled (0, 1, or 2).
  // Computed from the snapshot timestamps; no flags and no midnight reset task.
  int countToday(const FeedState& s, time_t now);

  // Whether a feeding at the current moment should trigger the duplicate warning:
  //   SYNCED or DRIFTING: warn once both meals are already logged today.
  //   UNKNOWN:            never blocks; the wake screen surfaces the last feeding
  //                       so the human can judge it. An uncertain clock degrades
  //                       the check but never blocks feeding the dog.
  DupCheck check(time_t now, ClockConfidence conf);

  // Build and persist a feeding event. `now` is the caller's best-guess time
  // (clock floor plus uptime when confidence is UNKNOWN). Returns false only when
  // the flash write fails, never because of network or clock state. The caller
  // signals the sync task after this returns.
  bool logFeeding(const char* person, time_t now, ClockConfidence conf,
                  float batteryVoltage, bool overridden);
}
