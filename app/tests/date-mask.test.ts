/**
 * The MM/YYYY mask must never produce a malformed value.
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  formatMonthYear,
  isCompleteDate,
  maskMonthYear,
  parseMonthYear,
} from "../src/lib/date-mask.ts";

describe("masking typed dates", () => {
  test("digits only get the slash inserted", () => {
    assert.equal(maskMonthYear("082018"), "08/2018");
  });

  test("a typed slash never doubles", () => {
    assert.equal(maskMonthYear("08//2018"), "08/2018");
    assert.equal(maskMonthYear("08/"), "08/");
  });

  test("the slash appears after a valid month, but backspace can remove it", () => {
    assert.equal(maskMonthYear("08"), "08/");
    assert.equal(maskMonthYear("08", true), "08");
  });

  test("a year typed on its own stays a year", () => {
    assert.equal(maskMonthYear("2018"), "2018");
    assert.equal(maskMonthYear("20185"), "2018");
  });

  test("letters and extra digits are dropped", () => {
    assert.equal(maskMonthYear("ab0c8x20189999"), "08/2018");
  });

  test("every masked value is a prefix of a valid shape", () => {
    for (const input of ["1", "12", "123", "1220", "122024", "9", "99", "0", "00", "13", "1999"]) {
      const out = maskMonthYear(input);
      assert.match(out, /^(\d{0,2}|\d{2}\/\d{0,4}|\d{3,4})$/, `${input} → ${out}`);
    }
  });
});

describe("complete values", () => {
  test("accepts empty, MM/YYYY and YYYY only", () => {
    assert.ok(isCompleteDate(""));
    assert.ok(isCompleteDate("08/2018"));
    assert.ok(isCompleteDate("2018"));
    assert.ok(!isCompleteDate("08/20"));
    assert.ok(!isCompleteDate("13/2018"));
  });

  test("parse and format round-trip", () => {
    assert.deepEqual(parseMonthYear("03/2021"), { month: 3, year: 2021 });
    assert.equal(formatMonthYear(3, 2021), "03/2021");
    assert.equal(formatMonthYear(null, 2021), "2021");
    assert.equal(formatMonthYear(5, null), "");
  });
});
