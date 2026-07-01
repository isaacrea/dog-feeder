#include "display.h"
#include "config.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1327.h>
#include <time.h>
#include <string.h>

namespace {
  const int16_t SCREEN_W = 128;
  const int16_t SCREEN_H = 128;

  // SSD1327 is 4-bit grayscale: 0x0 = black ... 0xF = white.
  const uint16_t COL_WHITE = 0xF;
  const uint16_t COL_GRAY  = 0x8;
  const uint16_t COL_DIM   = 0x4;

  // The object is named `oled` (not `display`) to avoid colliding with the
  // display:: namespace.
  Adafruit_SSD1327 oled(SCREEN_W, SCREEN_H, &Wire, /*rst=*/-1, /*clk=*/400000);
  bool s_ok = false;

  void centerText(const char* str, uint8_t size, int16_t y, uint16_t color) {
    oled.setTextSize(size);
    oled.setTextColor(color);
    int16_t x1, y1; uint16_t w, h;
    oled.getTextBounds(str, 0, 0, &x1, &y1, &w, &h);
    oled.setCursor((SCREEN_W - (int16_t)w) / 2, y);
    oled.print(str);
  }

  void leftText(const char* str, uint8_t size, int16_t x, int16_t y, uint16_t color) {
    oled.setTextSize(size);
    oled.setTextColor(color);
    oled.setCursor(x, y);
    oled.print(str);
  }

  // Local wall-clock time as "6:42 PM" with the leading zero stripped.
  void fmtClock(time_t t, char* out, size_t n) {
    struct tm lt; localtime_r(&t, &lt);
    strftime(out, n, "%I:%M %p", &lt);
    if (out[0] == '0') memmove(out, out + 1, strlen(out));
  }

  // A small filled heart: two lobes plus a downward triangle.
  void drawHeart(int16_t cx, int16_t cy, int16_t rr, uint16_t color) {
    oled.fillCircle(cx - rr, cy, rr, color);
    oled.fillCircle(cx + rr, cy, rr, color);
    oled.fillTriangle(cx - 2 * rr, cy, cx + 2 * rr, cy, cx, cy + 2 * rr, color);
  }

  // A Yorkshire terrier face centered on (cx, cy)
  void drawYorkie(int16_t cx, int16_t cy) {
    const uint16_t HAIR = 0x7;   // long steel-gray coat
    const uint16_t EAR  = 0x6;   // ear tips
    const uint16_t FACE = 0xC;   // lighter tan face
    const uint16_t BOW  = 0xF;   // white topknot bow
    const uint16_t DARK = 0x0;   // eyes, nose, mouth

    // Small erect ears poking up (drawn first; the hair overlaps their base).
    oled.fillTriangle(cx - 18, cy - 18, cx - 26, cy - 36, cx - 8, cy - 22, EAR);
    oled.fillTriangle(cx + 18, cy - 18, cx + 26, cy - 36, cx + 8, cy - 22, EAR);

    // Long silky hair: a tall rounded mass plus two pointed side falls.
    oled.fillRoundRect(cx - 28, cy - 24, 56, 54, 22, HAIR);
    oled.fillTriangle(cx - 24, cy + 18, cx - 18, cy + 36, cx - 8, cy + 24, HAIR);
    oled.fillTriangle(cx + 8,  cy + 24, cx + 18, cy + 36, cx + 24, cy + 18, HAIR);

    // Lighter face on top of the hair.
    oled.fillCircle(cx, cy, 19, FACE);

    // Topknot bow at the crown (two loops plus a knot).
    oled.fillTriangle(cx, cy - 26, cx - 13, cy - 32, cx - 13, cy - 20, BOW);
    oled.fillTriangle(cx, cy - 26, cx + 13, cy - 32, cx + 13, cy - 20, BOW);
    oled.fillCircle(cx, cy - 26, 3, BOW);

    // Dark button eyes with a tiny sparkle.
    oled.fillCircle(cx - 8, cy - 2, 4, DARK);
    oled.fillCircle(cx + 8, cy - 2, 4, DARK);
    oled.fillCircle(cx - 9, cy - 3, 1, BOW);
    oled.fillCircle(cx + 7, cy - 3, 1, BOW);

    // Nose and a small smile.
    oled.fillRoundRect(cx - 4, cy + 7, 8, 5, 2, DARK);
    oled.drawFastVLine(cx, cy + 12, 3, DARK);
    oled.drawLine(cx, cy + 15, cx - 5, cy + 13, DARK);
    oled.drawLine(cx, cy + 15, cx + 5, cy + 13, DARK);
  }
}  // namespace

void display::begin() {
  pinMode(NEOPIXEL_I2C_POWER, OUTPUT);

  // Cleanly power-cycle the I2C rail. Coming out of deep sleep the OLED and the
  // bus can return half-powered or hung, so force the rail fully OFF, let it
  // drain, then back ON and give the OLED's regulator time to stabilize.
  digitalWrite(NEOPIXEL_I2C_POWER, LOW);
  delay(60);
  digitalWrite(NEOPIXEL_I2C_POWER, HIGH);
  delay(250);

  Wire.begin();
  Wire.setClock(400000);

  // The first init right after power-up occasionally misses; retry a few times,
  // re-cycling the rail between attempts. (begin() only allocates its buffer
  // once, so repeated calls are safe.)
  s_ok = false;
  for (int attempt = 0; attempt < 3 && !s_ok; attempt++) {
    if (oled.begin(0x3D)) { s_ok = true; break; }
    Serial.printf("OLED init attempt %d failed\n", attempt + 1);
    Wire.end();
    digitalWrite(NEOPIXEL_I2C_POWER, LOW);  delay(80);
    digitalWrite(NEOPIXEL_I2C_POWER, HIGH); delay(250);
    Wire.begin();
    Wire.setClock(400000);
  }
  if (!s_ok) { Serial.println("OLED init FAILED after retries"); return; }

  oled.clearDisplay();
  oled.display();
}

void display::off() {
  if (s_ok) { oled.clearDisplay(); oled.display(); }
  digitalWrite(NEOPIXEL_I2C_POWER, LOW);    // cut OLED power for deep sleep
}

void display::status(const FeedState& s, time_t now, ClockConfidence conf,
                     int sel, float batteryV, size_t pending) {
  if (!s_ok) return;
  oled.clearDisplay();

  if (conf == CLOCK_UNKNOWN) {
    // No trustworthy clock: do not claim meal status or an absolute time.
    centerText("CLOCK NOT SET", 1, 4, COL_WHITE);
    oled.drawFastHLine(0, 18, SCREEN_W, COL_DIM);
    if (s.lastTs != 0) {
      centerText("Last recorded", 1, 28, COL_GRAY);
      centerText(s.lastBy, 2, 44, COL_WHITE);
      centerText("(time unknown)", 1, 72, COL_GRAY);
    } else {
      centerText("No feedings yet", 1, 48, COL_GRAY);
    }
  } else {
    // Today's meal summary.
    char line[28];
    bool bDone = feeding::sameLocalDay(s.bfastTs, now);
    bool dDone = feeding::sameLocalDay(s.dinnerTs, now);
    snprintf(line, sizeof(line), "Bkfst: %s", bDone ? s.bfastBy : "--");
    leftText(line, 1, 2, 2, bDone ? COL_WHITE : COL_DIM);
    snprintf(line, sizeof(line), "Dinner: %s", dDone ? s.dinnerBy : "--");
    leftText(line, 1, 2, 18, dDone ? COL_WHITE : COL_DIM);

    oled.drawFastHLine(0, 34, SCREEN_W, COL_DIM);

    if (s.lastTs != 0) {
      centerText("Last fed", 1, 40, COL_GRAY);
      char t[16]; fmtClock(s.lastTs, t, sizeof(t));
      centerText(t, 2, 52, COL_WHITE);
      char by[24]; snprintf(by, sizeof(by), "by %s", s.lastBy);
      centerText(by, 1, 76, COL_GRAY);
    } else {
      centerText("No feedings yet", 1, 56, COL_GRAY);
    }
  }

  // Prompt and footer indicators.
  oled.drawFastHLine(0, 96, SCREEN_W, COL_DIM);
  char prompt[28];
  if (sel >= 0) snprintf(prompt, sizeof(prompt), "Press to log: %s", USERS[sel]);
  else          snprintf(prompt, sizeof(prompt), "Turn knob to select");
  centerText(prompt, 1, 104, sel >= 0 ? COL_WHITE : COL_GRAY);

  char foot[24];
  if (pending > 0) snprintf(foot, sizeof(foot), "%.1fV  %u to sync", batteryV, (unsigned)pending);
  else             snprintf(foot, sizeof(foot), "%.1fV  synced", batteryV);
  centerText(foot, 1, 118, COL_DIM);

  oled.display();
}

void display::alreadyFed(const feeding::DupCheck& dup, time_t now, int secondsLeft) {
  if (!s_ok) return;
  oled.clearDisplay();

  // "ALREADY FED" is 11 chars; at size 2 (12 px/char) that is 132 px, wider than
  // the 128 px panel, so it would wrap mid-word. Stack it as two lines instead.
  centerText("ALREADY", 2, 4, COL_WHITE);
  centerText("FED", 2, 22, COL_WHITE);
  oled.drawFastHLine(0, 42, SCREEN_W, COL_DIM);

  if (dup.reason == feeding::BLOCK_RECENT) {
    // Relative time makes an accidental double-feed obvious at a glance.
    long ago = (long)(now - dup.prevTs); if (ago < 0) ago = 0;
    char hl[24];
    if      (ago < 60)   snprintf(hl, sizeof(hl), "Fed just now");
    else if (ago < 5400) snprintf(hl, sizeof(hl), "Fed %ldm ago", (ago + 30) / 60);
    else                 snprintf(hl, sizeof(hl), "Fed %.1fh ago", ago / 3600.0);
    centerText(hl, 1, 50, COL_GRAY);
  } else {
    centerText("Fed twice today", 1, 50, COL_GRAY);
  }
  char by[24]; snprintf(by, sizeof(by), "last by %s", dup.prevBy);
  centerText(by, 1, 64, COL_GRAY);
  char t[16]; fmtClock(dup.prevTs, t, sizeof(t));
  char at[24]; snprintf(at, sizeof(at), "at %s", t);
  centerText(at, 1, 78, COL_GRAY);

  centerText("Hold to override", 1, 98, COL_WHITE);
  char cd[24]; snprintf(cd, sizeof(cd), "Returns in %ds", secondsLeft);
  centerText(cd, 1, 114, COL_DIM);
  oled.display();
}

void display::success(const FeedState& s) {
  if (!s_ok) return;
  oled.clearDisplay();

  drawHeart(18, 14, 3, COL_WHITE);
  drawHeart(110, 14, 3, COL_WHITE);
  drawYorkie(64, 40);

  centerText("Thank you!", 2, 80, COL_WHITE);
  char by[24]; snprintf(by, sizeof(by), "fed by %s", s.lastBy);
  centerText(by, 1, 102, COL_GRAY);

  oled.display();
}
