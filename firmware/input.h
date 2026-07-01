#pragma once
#include <Arduino.h>

// Selector switch and confirm button.
//
// The selector is read directly: whichever throw is engaged is the selected
// person, so there is no scrolling state and nothing to debounce on the knob.
// The button is debounced and exposes press, release, and long-hold edges so
// the UI loop can drive confirm and hold-to-override without blocking.

namespace input {

  void begin();   // set pin modes; call once from setup()

  // Index 0..NUM_USERS-1 of the engaged selector throw, or -1 when the knob is
  // between detents or no throw is active. Call at confirm time.
  int selectedUser();

  // Non-blocking button state. `pressed` and `released` are one-shot edges;
  // `heldLong` fires once after OVERRIDE_HOLD_MS of a continuous press;
  // `down` is the current debounced level. Poll every loop while awake.
  struct Button {
    bool pressed;
    bool released;
    bool heldLong;
    bool down;
  };
  Button pollButton();
}
