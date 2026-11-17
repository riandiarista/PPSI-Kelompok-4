import test from "node:test";
import assert from "node:assert/strict";
import {
  getLevelMeta,
  calculateProgress,
  LEVEL_META,
  ALL_LEVELS_INFO,
} from "../src/services/pointsService.js";
import {
  calculateLevel,
  calculatePointDelta,
  POINT_RULES,
} from "../src/services/returnService.js";

test("Tingkat Kedisiplinan Peminjam (A3 §3.4.5 / KF-20)", async (t) => {
  await t.test("Poin di bawah 30 adalah Belum Pemula (beginner)", () => {
    assert.equal(calculateLevel(0), "beginner");
    assert.equal(calculateLevel(15), "beginner");
    assert.equal(calculateLevel(29), "beginner");

    const meta = getLevelMeta(25);
    assert.equal(meta.name, "beginner");
    assert.equal(meta.label, "Belum Pemula");
    assert.equal(meta.next, 30);
  });

  await t.test("Poin 30 - 49 adalah Pemula (pemula)", () => {
    assert.equal(calculateLevel(30), "pemula");
    assert.equal(calculateLevel(45), "pemula");
    assert.equal(calculateLevel(49), "pemula");

    const meta = getLevelMeta(40);
    assert.equal(meta.name, "pemula");
    assert.equal(meta.label, "Pemula");
    assert.equal(meta.next, 50);
  });

  await t.test("Poin 50 - 69 adalah Terpercaya (terpercaya)", () => {
    assert.equal(calculateLevel(50), "terpercaya");
    assert.equal(calculateLevel(60), "terpercaya");
    assert.equal(calculateLevel(69), "terpercaya");

    const meta = getLevelMeta(55);
    assert.equal(meta.name, "terpercaya");
    assert.equal(meta.label, "Terpercaya");
    assert.equal(meta.next, 70);
  });

  await t.test("Poin 70+ adalah Teladan (teladan)", () => {
    assert.equal(calculateLevel(70), "teladan");
    assert.equal(calculateLevel(100), "teladan");
    assert.equal(calculateLevel(500), "teladan");

    const meta = getLevelMeta(85);
    assert.equal(meta.name, "teladan");
    assert.equal(meta.label, "Teladan");
    assert.equal(meta.next, null);
  });

  await t.test("Perhitungan progres (%) menuju level selanjutnya", () => {
    // 0 / 30 -> 0%
    assert.equal(calculateProgress(0, getLevelMeta(0)), 0);
    // 15 / 30 -> 50%
    assert.equal(calculateProgress(15, getLevelMeta(15)), 50);
    // 30 di range 30-50 -> 0%
    assert.equal(calculateProgress(30, getLevelMeta(30)), 0);
    // 40 di range 30-50 -> 50%
    assert.equal(calculateProgress(40, getLevelMeta(40)), 50);
    // 60 di range 50-70 -> 50%
    assert.equal(calculateProgress(60, getLevelMeta(60)), 50);
    // 70+ (Teladan / max level) -> 100%
    assert.equal(calculateProgress(70, getLevelMeta(70)), 100);
    assert.equal(calculateProgress(150, getLevelMeta(150)), 100);
  });

  await t.test("Perhitungan delta poin pengembalian (KF-19)", () => {
    // Tepat waktu + baik -> +10
    const onTimeGood = calculatePointDelta({ lateDays: 0, returnCondition: "good" });
    assert.equal(onTimeGood.delta, 10);

    // Tepat waktu + rusak ringan -> +2
    const onTimeMinor = calculatePointDelta({ lateDays: 0, returnCondition: "minor_damage" });
    assert.equal(onTimeMinor.delta, 2);

    // Tepat waktu + rusak besar -> -5 + -20 = -25
    const onTimeMajor = calculatePointDelta({ lateDays: 0, returnCondition: "major_damage" });
    assert.equal(onTimeMajor.delta, -25);

    // Terlambat 3 hari + baik -> -6
    const late3 = calculatePointDelta({ lateDays: 3, returnCondition: "good" });
    assert.equal(late3.delta, -6);
  });
});
