#pragma once

// Deep sleep entry and wake handling for the wake/act/sleep loop. The button is
// the only wake source (ext0 on its GPIO); the selector knob is a passive switch
// read on wake and needs no wakeup wiring.

namespace power {
  enum WakeReason { WAKE_BUTTON, WAKE_COLD };

  WakeReason wakeReason();       // button wake (clock survived) vs. cold boot (clock lost)
  void waitForButtonRelease();   // absorb the still-held wake press so it is not read as a confirm
  void sleepUntilButton();       // arm ext0 on the button and enter deep sleep (does not return)
}
