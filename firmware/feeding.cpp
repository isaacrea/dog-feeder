#include "feeding.h"
#include "store.h"
#include <time.h>

bool feeding::sameLocalDay(time_t a, time_t b) {
  if (a == 0 || b == 0) return false;
  struct tm ta, tb;
  localtime_r(&a, &ta);
  localtime_r(&b, &tb);
  return ta.tm_year == tb.tm_year && ta.tm_yday == tb.tm_yday;
}

int feeding::countToday(const FeedState& s, time_t now) {
  // The two snapshot slots fill in order: the first feeding of the day lands in
  // the breakfast slot, the second in dinner. Counting how many are dated today
  // therefore gives how many times the dog has eaten today (0, 1, or 2).
  int n = 0;
  if (sameLocalDay(s.bfastTs, now))  n++;
  if (sameLocalDay(s.dinnerTs, now)) n++;
  return n;
}

feeding::DupCheck feeding::check(time_t now, ClockConfidence conf) {
  DupCheck r = { false, BLOCK_NONE, MEAL_BREAKFAST, "", 0 };
  const FeedState& s = store::state();

  if (conf == CLOCK_UNKNOWN) {
    // No trustworthy wall clock (cold boot after power loss), and RAM is wiped
    // on every deep-sleep wake, so the device cannot reason about what happened
    // today. Rather than guess (and risk either a false warning or a silent
    // double-feed), it does not block here. The wake screen instead surfaces the
    // last recorded feeding so the human can judge it.
    return r;   // blocked = false
  }

  int n = countToday(s, now);
  r.meal = (n == 0) ? MEAL_BREAKFAST : MEAL_DINNER;   // first feeding today is breakfast, otherwise dinner

  if (n >= 2) {
    // Breakfast and dinner are both already logged today: warn before a third.
    r.blocked = true;
    r.reason  = BLOCK_TWICE_TODAY;
    r.prevTs  = s.dinnerTs;                            // the most recent (second) feeding
    strlcpy(r.prevBy, s.dinnerBy, sizeof(r.prevBy));
    return r;
  }

  // Recency guard: a feeding very soon after the previous one is more likely a
  // second person feeding the dog again than a genuine meal. Ordinal counting
  // alone does not catch this (it would simply label the feeding dinner), so the
  // device warns and lets the human confirm with hold-to-override.
  if (s.lastTs != 0 && now >= s.lastTs &&
      (uint32_t)(now - s.lastTs) < MIN_REFEED_GAP_SEC) {
    r.blocked = true;
    r.reason  = BLOCK_RECENT;
    r.prevTs  = s.lastTs;
    strlcpy(r.prevBy, s.lastBy, sizeof(r.prevBy));
  }
  return r;
}

bool feeding::logFeeding(const char* person, time_t now, ClockConfidence conf,
                         float batteryVoltage, bool overridden) {
  FeedEvent ev = {};
  strlcpy(ev.person, person, sizeof(ev.person));
  // With an untrusted clock the feeding cannot be placed within the day, so it
  // is logged as UNKNOWN: recorded and synced, but not assigned to a meal slot,
  // so it cannot overwrite breakfast or dinner with a possibly-wrong timestamp.
  if (conf == CLOCK_UNKNOWN) {
    ev.meal = MEAL_UNKNOWN;
  } else {
    ev.meal = (countToday(store::state(), now) == 0) ? MEAL_BREAKFAST : MEAL_DINNER;
  }
  ev.overridden     = overridden;
  ev.timestamp      = now;
  ev.timeConfidence = conf;
  ev.batteryVoltage = batteryVoltage;

  return store::recordFeeding(ev);
}
