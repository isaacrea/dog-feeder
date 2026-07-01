#include "input.h"
#include "config.h"

namespace {
  bool     s_lastRaw   = false;   // last raw sample (true = pressed)
  bool     s_stable    = false;   // last accepted, debounced level
  uint32_t s_lastEdge  = 0;       // time the raw level last changed
  uint32_t s_pressTime = 0;       // time the current press began
  bool     s_longSent  = false;   // whether heldLong has already fired for this press
  const uint32_t DEBOUNCE_MS = 30;
}

void input::begin() {
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  for (uint8_t i = 0; i < NUM_USERS; i++) {
    pinMode(SELECTOR_PINS[i], INPUT_PULLUP);
  }
}

int input::selectedUser() {
  for (uint8_t i = 0; i < NUM_USERS; i++) {
    if (digitalRead(SELECTOR_PINS[i]) == LOW) return i;  // active-LOW throw
  }
  return -1;  // knob between detents
}

input::Button input::pollButton() {
  Button b = { false, false, false, false };
  bool raw = (digitalRead(PIN_BUTTON) == LOW);   // active-LOW reads as pressed
  uint32_t now = millis();

  if (raw != s_lastRaw) {
    s_lastRaw  = raw;
    s_lastEdge = now;                            // level changed: restart the debounce timer
  } else if ((now - s_lastEdge) >= DEBOUNCE_MS && raw != s_stable) {
    s_stable = raw;                              // level held long enough: accept it
    if (s_stable) {
      b.pressed   = true;
      s_pressTime = now;
      s_longSent  = false;
    } else {
      b.released = true;
    }
  }

  b.down = s_stable;
  if (s_stable && !s_longSent && (now - s_pressTime) >= OVERRIDE_HOLD_MS) {
    b.heldLong = true;
    s_longSent = true;                           // fire once per hold
  }
  return b;
}
