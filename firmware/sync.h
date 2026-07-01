#pragma once

// Cloud sync burst. Runs once per wake, just before sleeping. Wi-Fi is brought
// up only when there is a reason to (queued events, or an UNKNOWN clock to
// recover); the queue is drained oldest first, an NTP resync is piggybacked
// while the radio is up, then Wi-Fi is dropped. A failed burst is non-fatal:
// anything not sent stays on flash and retries on the next wake.

namespace cloudsync {
  // Cold-boot clock recovery: bring Wi-Fi up briefly and pull NTP so the first
  // feeding gets a real timestamp. No-op once the clock is trusted.
  void recoverClock();

  void flush();
}
