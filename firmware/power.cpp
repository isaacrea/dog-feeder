#include "power.h"
#include "config.h"
#include <Arduino.h>
#include "esp_sleep.h"
#include "driver/rtc_io.h"

power::WakeReason power::wakeReason() {
  return (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT0)
           ? WAKE_BUTTON
           : WAKE_COLD;
}

void power::waitForButtonRelease() {
  // The press that triggered the wake is probably still held. Wait for it to
  // lift (with a safety timeout) so the debouncer does not immediately read it
  // as a fresh confirm and log a feeding the instant the screen comes up.
  uint32_t start = millis();
  while (digitalRead(PIN_BUTTON) == LOW && (millis() - start) < 3000) {
    delay(5);
  }
}

void power::sleepUntilButton() {
  // Keep the button's pull-up alive in the RTC domain through sleep, then wake
  // when it is pulled LOW (pressed).
  gpio_num_t pin = (gpio_num_t)PIN_BUTTON;
  rtc_gpio_pullup_en(pin);
  rtc_gpio_pulldown_dis(pin);
  esp_sleep_enable_ext0_wakeup(pin, 0);   // 0 = wake on LOW
  esp_deep_sleep_start();                 // does not return; the chip resets into setup() on wake
}
