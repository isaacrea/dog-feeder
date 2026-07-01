#include "timekeeping.h"
#include "config.h"
#include "store.h"
#include <time.h>
#include <sys/time.h>
#include <Wire.h>
#include <WiFi.h>
#include "esp_sleep.h"

namespace {
  // Held in RTC slow memory: retained across deep sleep, zeroed on cold boot,
  // i.e. the same power domain as the clock it describes. 0 means "never synced".
  // It records the last NTP sync and is used to schedule occasional trims.
  RTC_DATA_ATTR static time_t s_lastSync = 0;

  ClockConfidence s_conf = CLOCK_UNKNOWN;
  uint32_t s_bootMillis = 0;
  bool s_haveRtc = false;

  bool ntpFresh(time_t t) {
    return s_lastSync > 0 && (t - s_lastSync) < (time_t)(NTP_STALE_MS / 1000);
  }

  // ----- DS3231 over I2C (shares the Wire bus with the OLED) -----
  uint8_t bcd2dec(uint8_t b) { return (uint8_t)((b >> 4) * 10 + (b & 0x0F)); }
  uint8_t dec2bcd(uint8_t d) { return (uint8_t)(((d / 10) << 4) | (d % 10)); }

  // Convert UTC broken-down time to a Unix epoch without touching the TZ machinery.
  time_t epochFromUTC(const struct tm& t) {
    static const int cum[12] = {0,31,59,90,120,151,181,212,243,273,304,334};
    long y = t.tm_year + 1900;
    long days = (y - 1970) * 365 + (y - 1969) / 4 - (y - 1901) / 100 + (y - 1601) / 400;
    days += cum[t.tm_mon];
    bool leap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
    if (leap && t.tm_mon >= 2) days += 1;
    days += (t.tm_mday - 1);
    return (time_t)days * 86400 + (time_t)t.tm_hour * 3600 + (time_t)t.tm_min * 60 + t.tm_sec;
  }

  // Read the RTC (stored in UTC). Returns false if the chip does not answer.
  // Sets lostPower from the oscillator-stop flag (coin cell died or never set).
  bool ds3231ReadUTC(struct tm& out, bool& lostPower) {
    Wire.beginTransmission(DS3231_ADDR);
    Wire.write(0x00);
    if (Wire.endTransmission() != 0) return false;
    if (Wire.requestFrom((int)DS3231_ADDR, 7) != 7) return false;
    uint8_t ss = Wire.read(), mm = Wire.read(), hh = Wire.read();
    Wire.read();                                   // day-of-week, unused
    uint8_t dd = Wire.read(), mo = Wire.read(), yy = Wire.read();
    out.tm_sec  = bcd2dec(ss & 0x7F);
    out.tm_min  = bcd2dec(mm & 0x7F);
    out.tm_hour = bcd2dec(hh & 0x3F);              // 24-hour mode
    out.tm_mday = bcd2dec(dd & 0x3F);
    out.tm_mon  = bcd2dec(mo & 0x1F) - 1;          // 0-11
    out.tm_year = bcd2dec(yy) + 100;               // years since 1900 (RTC is 2000-based)
    out.tm_isdst = 0;

    Wire.beginTransmission(DS3231_ADDR);           // status register 0x0F: OSF = bit 7
    Wire.write(0x0F);
    if (Wire.endTransmission() != 0) return false;
    if (Wire.requestFrom((int)DS3231_ADDR, 1) != 1) return false;
    lostPower = (Wire.read() & 0x80) != 0;
    return true;
  }

  // Write a UTC epoch into the RTC and clear the oscillator-stop flag.
  void ds3231WriteUTC(time_t epoch) {
    struct tm t;
    gmtime_r(&epoch, &t);
    Wire.beginTransmission(DS3231_ADDR);
    Wire.write(0x00);
    Wire.write(dec2bcd(t.tm_sec));
    Wire.write(dec2bcd(t.tm_min));
    Wire.write(dec2bcd(t.tm_hour));                // bit 6 = 0 selects 24-hour mode
    Wire.write(dec2bcd(t.tm_wday == 0 ? 7 : t.tm_wday));
    Wire.write(dec2bcd(t.tm_mday));
    Wire.write(dec2bcd(t.tm_mon + 1));             // 1-12
    Wire.write(dec2bcd((uint8_t)((t.tm_year + 1900) % 100)));
    Wire.endTransmission();
    Wire.beginTransmission(DS3231_ADDR);           // clear OSF, disable the 32 kHz output
    Wire.write(0x0F);
    Wire.write(0x00);
    Wire.endTransmission();
  }

  // getLocalTime() returns immediately once the clock merely looks set, so it
  // will not wait for a fresh NTP reply when the RTC has already set the time
  // (the reason a naive resync never actually corrects anything). Parking the
  // clock before 2016 forces getLocalTime to block until SNTP truly delivers;
  // on failure the previous time is restored. Returns true only when a genuine
  // NTP time arrived.
  bool forceNtp(uint32_t timeoutMs) {
    struct timeval saved;  gettimeofday(&saved, nullptr);
    struct timeval parked; parked.tv_sec = 100000; parked.tv_usec = 0;   // 1970, so getLocalTime waits
    settimeofday(&parked, nullptr);
    struct tm tm;
    if (getLocalTime(&tm, timeoutMs)) return true;                        // SNTP set a real time
    settimeofday(&saved, nullptr);                                        // NTP failed: keep the prior time
    return false;
  }
}

void timekeeping::begin() {
  s_bootMillis = millis();

  // Set the TZ and NTP servers. With no Wi-Fi yet this only enables local-time
  // conversion (so day-boundary math is Central, with DST); the NTP sync itself
  // happens later in onWifiUp(). The payload timestamp stays UTC because
  // store.cpp formats it with gmtime_r.
  configTzTime(TZ_STRING, NTP_SERVER1, NTP_SERVER2);

  bool wokeFromSleep = (esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_UNDEFINED);
  if (wokeFromSleep && s_lastSync > 0) {
    // The RTC kept running and a previous sync exists, so the clock is still good.
    time_t t = time(nullptr);
    s_conf = ntpFresh(t) ? CLOCK_SYNCED : CLOCK_DRIFTING;
  } else {
    // Cold boot: power was lost, so the clock is gone until NTP recovers it.
    s_conf = CLOCK_UNKNOWN;
  }
}

void timekeeping::syncFromRtc() {
  // Runs after display::begin() has powered the I2C rail and started Wire, so
  // the DS3231 (on the same switched rail as the OLED) is awake and readable.
  struct tm t; bool lost = false;
  if (!ds3231ReadUTC(t, lost)) {
    s_haveRtc = false;            // no RTC on the bus: keep begin()'s software guess
    return;
  }
  s_haveRtc = true;
  time_t e = epochFromUTC(t);
  if (!lost && e >= (time_t)MIN_VALID_EPOCH) {
    struct timeval tv; tv.tv_sec = e; tv.tv_usec = 0;
    settimeofday(&tv, nullptr);   // adopt the hardware clock as the system clock
    s_conf = CLOCK_SYNCED;        // a valid RTC is trusted immediately, no NTP needed
  } else {
    s_conf = CLOCK_UNKNOWN;       // coin cell died or never set: NTP must establish it
  }
}

bool timekeeping::hasRtc() { return s_haveRtc; }

time_t timekeeping::now() {
  if (s_conf == CLOCK_UNKNOWN) {
    // time() is untrusted here; anchor to the persisted floor plus seconds awake.
    // This is a lower bound on real time, good enough to stamp the event and let
    // the backend flag it via timeConfidence.
    return store::state().lastKnownTime + (time_t)((millis() - s_bootMillis) / 1000);
  }
  return time(nullptr);
}

ClockConfidence timekeeping::confidence() { return s_conf; }

void timekeeping::onWifiUp() {
  if (WiFi.status() != WL_CONNECTED) return;

  // With the DS3231 present the clock barely drifts, so NTP is only a daily
  // trim; without it, fall back to the tighter resync. Always sync while the
  // time is still unknown (dead or absent RTC on a cold boot).
  uint32_t interval = s_haveRtc ? NTP_TRIM_MS : NTP_RESYNC_MS;
  time_t t = time(nullptr);
  if (s_conf != CLOCK_UNKNOWN && s_lastSync > 0 &&
      (t - s_lastSync) < (time_t)(interval / 1000)) {
    return;                                       // synced or trimmed recently enough
  }

  // Force a genuine NTP reply (not just a read-back of the already-set clock),
  // then adopt it everywhere: system clock, floor, and the hardware RTC.
  if (forceNtp(5000)) {
    time_t now = time(nullptr);
    s_lastSync = now;
    s_conf = CLOCK_SYNCED;
    store::persistTimeFloor(now);
    if (s_haveRtc) ds3231WriteUTC(now);           // trim or establish the DS3231
  }
}

void timekeeping::beforeSleep() {
  store::persistTimeFloor(now());
}
