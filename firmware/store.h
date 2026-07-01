#pragma once
#include "types.h"

// Persistence layer, split across two storage technologies:
//
//   NVS ("feeder" namespace): the FeedState snapshot. Small, fixed shape,
//   wear-leveled, atomic per key.
//
//   LittleFS (/queue/*.json): unsynced events, one small file each, named by
//   zero-padded id so lexical order matches chronological order.
//
// Concurrency contract (no locks required):
//   - The UI task is the only writer of events and of the snapshot.
//   - The sync task only reads queue files and deletes them after a 2xx.
// Because every event is its own file, the two tasks never touch the same bytes.

namespace store {

  // Mount NVS and LittleFS and load the snapshot. Call once from setup().
  bool begin();

  // The in-RAM snapshot. Readable from anywhere; written only via
  // recordFeeding() and persistTimeFloor(), both on the UI task.
  FeedState& state();

  // Persist one feeding and fill ev.eventId. The write ordering is what makes
  // the operation crash-safe:
  //   1. bump and persist the id counter (a crash may skip an id, never reuse one)
  //   2. write the event file to LittleFS; the feeding is durable after this step
  //   3. update the snapshot in RAM and NVS
  // Returns true once the event is on flash. Does not touch the network.
  bool recordFeeding(FeedEvent& ev);

  // Advance the persisted clock floor (real time is at least this, even after
  // power loss). Call every TIME_FLOOR_SAVE_MS while the clock is trusted.
  void persistTimeFloor(time_t now);

  // A random id generated once per boot. Events store it so the sync layer can
  // distinguish events logged in the current boot (which can be aged accurately
  // against millis()) from an older backlog.
  uint32_t bootId();

  // Sync-task-facing queue API (read and delete only).
  size_t queueCount();                                   // for the "sync pending" UI
  bool   oldestQueued(String& pathOut, String& jsonOut); // false when the queue is empty
  bool   removeQueued(const String& path);               // call only after a 2xx
}
