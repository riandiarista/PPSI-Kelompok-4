import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSettings,
  describeSettings,
  validateSettingsInput,
} from "../src/services/pointSettingsService.js";
import { calculateLevel, calculatePointDelta } from "../src/services/returnService.js";
import { getLevelMeta, calculateProgress } from "../src/services/pointsService.js";
import { buildDueReminderEmail } from "../src/services/reminderService.js";
import { DEFAULT_POINT_RULES } from "../src/constants/pointRules.js";

const VALID_BODY = {
  point_rules: { ON_TIME_GOOD: 15, ON_TIME_MINOR_DAMAGE: 3, ON_TIME_MAJOR_DAMAGE: -10, MAJOR_DAMAGE_PENALTY: -30, LATE_PER_DAY: -5 },
  levels: { pemula: 40, terpercaya: 80, teladan: 120 },
};

const rowsFrom = (body) => [
  ...Object.entries(body.point_rules).map(([k, v]) => ({ setting_key: k, setting_value: v })),
  { setting_key: "LEVEL_PEMULA_MIN", setting_value: body.levels.pemula },
  { setting_key: "LEVEL_TERPERCAYA_MIN", setting_value: body.levels.terpercaya },
  { setting_key: "LEVEL_TELADAN_MIN", setting_value: body.levels.teladan },
];

test("Aturan poin yang dapat diubah Kadep (point_settings)", async (t) => {
  await t.test("tanpa baris di database memakai nilai bawaan", () => {
    const s = buildSettings([]);
    assert.deepEqual({ ...s.rules }, { ...DEFAULT_POINT_RULES });
    assert.deepEqual(s.levels.map((l) => l.min), [70, 50, 30, 0]);
  });

  await t.test("baris database menimpa nilai bawaan, kunci yang hilang tetap bawaan", () => {
    const s = buildSettings([{ setting_key: "LATE_PER_DAY", setting_value: -4 }, { setting_key: "LEVEL_TELADAN_MIN", setting_value: 90 }]);
    assert.equal(s.rules.LATE_PER_DAY, -4);
    assert.equal(s.rules.ON_TIME_GOOD, 10);
    assert.deepEqual(s.levels.map((l) => l.min), [90, 50, 30, 0]);
  });

  await t.test("perhitungan delta poin memakai aturan yang diberikan", () => {
    const { rules } = buildSettings(rowsFrom(VALID_BODY));
    assert.equal(calculatePointDelta({ lateDays: 0, returnCondition: "good", rules }).delta, 15);
    assert.equal(calculatePointDelta({ lateDays: 0, returnCondition: "minor_damage", rules }).delta, 3);
    assert.equal(calculatePointDelta({ lateDays: 0, returnCondition: "major_damage", rules }).delta, -40);
    assert.equal(calculatePointDelta({ lateDays: 2, returnCondition: "good", rules }).delta, -10);
  });

  await t.test("level & progres memakai ambang yang diberikan", () => {
    const { levels } = buildSettings(rowsFrom(VALID_BODY));
    assert.equal(calculateLevel(39, levels), "beginner");
    assert.equal(calculateLevel(40, levels), "pemula");
    assert.equal(calculateLevel(80, levels), "terpercaya");
    assert.equal(calculateLevel(120, levels), "teladan");

    const meta = getLevelMeta(60, levels);
    assert.equal(meta.name, "pemula");
    assert.equal(meta.min, 40);
    assert.equal(meta.next, 80);
    assert.equal(calculateProgress(60, meta), 50);
    assert.equal(getLevelMeta(500, levels).next, null);
  });

  await t.test("deskripsi level menampilkan rentang sesuai ambang", () => {
    const d = describeSettings(buildSettings(rowsFrom(VALID_BODY)));
    assert.deepEqual(d.levels.map((l) => l.range), ["≥ 120 poin", "80 – 119 poin", "40 – 79 poin", "0 – 39 poin"]);
    assert.equal(d.point_rules.find((r) => r.key === "LATE_PER_DAY").points, -5);
  });

  await t.test("validasi menerima input lengkap dan valid", () => {
    const entries = validateSettingsInput(VALID_BODY);
    assert.equal(entries.length, 8);
    assert.deepEqual(Object.fromEntries(entries).LEVEL_TELADAN_MIN, 120);
  });

  await t.test("validasi menolak nilai kosong, pecahan, tanda salah, dan level tidak berurutan", () => {
    const cases = [
      { ...VALID_BODY, point_rules: { ...VALID_BODY.point_rules, ON_TIME_GOOD: undefined } },
      { ...VALID_BODY, point_rules: { ...VALID_BODY.point_rules, ON_TIME_GOOD: 2.5 } },
      { ...VALID_BODY, point_rules: { ...VALID_BODY.point_rules, LATE_PER_DAY: 3 } },
      { ...VALID_BODY, point_rules: { ...VALID_BODY.point_rules, MAJOR_DAMAGE_PENALTY: 5 } },
      { ...VALID_BODY, levels: { pemula: 50, terpercaya: 50, teladan: 70 } },
      { ...VALID_BODY, levels: { pemula: 0, terpercaya: 50, teladan: 70 } },
    ];
    for (const body of cases) {
      assert.throws(() => validateSettingsInput(body), (err) => err.status === 400);
    }
  });

  await t.test("email pengingat memakai penalti keterlambatan yang berlaku", () => {
    const email = buildDueReminderEmail({
      borrowerName: "Ahmad",
      itemName: "Proyektor",
      dueAt: new Date("2026-11-20T07:00:00.000Z"),
      daysLeft: 1,
      latePerDay: -5,
    });
    assert.match(email.text, /5 poin per hari/);
  });
});
