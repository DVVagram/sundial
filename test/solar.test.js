"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Solar = require("../src/solar.js");

const utc = (iso) => new Date(iso);

test("declination tracks the seasons", () => {
  // The approximation should land within a tenth of a degree of the axial tilt.
  assert.ok(Math.abs(Solar.declination(utc("2026-06-21T12:00:00Z")) - 23.44) < 0.1);
  assert.ok(Math.abs(Solar.declination(utc("2026-12-21T12:00:00Z")) + 23.44) < 0.1);
  assert.ok(Math.abs(Solar.declination(utc("2026-03-20T12:00:00Z"))) < 0.5);
});

test("equation of time hits its known extremes", () => {
  // The sundial runs about 16 minutes fast in early November and 14 slow in
  // mid-February; the two crossings are mid-April and early September.
  assert.ok(Math.abs(Solar.equationOfTime(utc("2026-11-03T12:00:00Z")) - 16.4) < 0.7);
  assert.ok(Math.abs(Solar.equationOfTime(utc("2026-02-11T12:00:00Z")) + 14.2) < 0.7);
  assert.ok(Math.abs(Solar.equationOfTime(utc("2026-05-14T12:00:00Z")) - 3.7) < 0.7);
  assert.ok(Math.abs(Solar.equationOfTime(utc("2026-07-26T12:00:00Z")) + 6.5) < 0.7);
});

test("day length matches published values", () => {
  // 40°N on the June solstice: 15 h 01 m.
  assert.ok(Math.abs(Solar.dayLength(utc("2026-06-21T12:00:00Z"), 40) - 15.01) < 0.05);
  // Greenwich on the June solstice: 16 h 38 m.
  assert.ok(Math.abs(Solar.dayLength(utc("2026-06-21T12:00:00Z"), 51.4779) - 16.64) < 0.06);
  // On the equator refraction alone gives about 12 h 07 m all year.
  assert.ok(Math.abs(Solar.dayLength(utc("2026-03-20T12:00:00Z"), 0) - 12.11) < 0.02);
});

test("polar day and polar night are reported as 24 h and 0 h", () => {
  assert.equal(Solar.dayLength(utc("2026-06-21T12:00:00Z"), 80), 24);
  assert.equal(Solar.dayLength(utc("2026-12-21T12:00:00Z"), 80), 0);
});

test("solar noon for New York on 3 November is about 11:40", () => {
  const noon = Solar.solarNoon(utc("2026-11-03T12:00:00Z"), -74.006, -300);
  assert.ok(Math.abs(noon - 700) < 4, `expected ~700 minutes, got ${noon}`);
  assert.equal(Solar.formatMinutes(noon), "11:40");
});

test("the sun is due south at noon in the northern mid-latitudes", () => {
  // New York in June is on daylight time (UTC-4).
  const day = new Date(Date.UTC(2026, 5, 21, 12));
  const noon = Solar.solarNoon(day, -74.006, -240);
  const moment = Solar.utcFromWallClock(2026, 5, 21, noon, -240);
  const pos = Solar.sunPosition(moment, 40, -74.006, -240);
  assert.ok(Math.abs(pos.azimuth - 180) < 1.5, `azimuth ${pos.azimuth}`);
  assert.ok(Math.abs(pos.altitude - 73.44) < 0.6, `altitude ${pos.altitude}`);
});

test("the sun is due north at noon in the southern mid-latitudes", () => {
  const day = new Date(Date.UTC(2026, 5, 21, 12));
  const noon = Solar.solarNoon(day, 151, 600);
  const moment = Solar.utcFromWallClock(2026, 5, 21, noon, 600);
  const pos = Solar.sunPosition(moment, -33, 151, 600);
  const distanceToNorth = Math.min(pos.azimuth, 360 - pos.azimuth);
  assert.ok(distanceToNorth < 1.5, `azimuth ${pos.azimuth}`);
});

test("equinox noon altitude is 90° minus the latitude", () => {
  const day = new Date(Date.UTC(2026, 2, 20, 12));
  for (const lat of [-45, 0, 30, 60]) {
    const noon = Solar.solarNoon(day, 0, 0);
    const moment = Solar.utcFromWallClock(2026, 2, 20, noon, 0);
    const pos = Solar.sunPosition(moment, lat, 0, 0);
    assert.ok(Math.abs(pos.altitude - (90 - Math.abs(lat))) < 0.6, `lat ${lat}: ${pos.altitude}`);
  }
});

test("the sun path samples a whole day", () => {
  const day = new Date(Date.UTC(2026, 5, 21, 12));
  // Greenwich in June is on British Summer Time (UTC+1).
  const noon = Solar.solarNoon(day, 0, 60);
  const path = Solar.sunPath(day, 51.4779, 0, 60, 4);
  assert.equal(path.length, 361);
  const peak = path.reduce((a, b) => (b.altitude > a.altitude ? b : a));
  assert.ok(Math.abs(peak.minutes - noon) < 6, `peak ${peak.minutes}, noon ${noon}`);
  assert.ok(peak.altitude > 60);
});

test("the analemma spans a year and the equation of time extremes", () => {
  const points = Solar.analemma(2026);
  assert.equal(points.length, 365);
  const eots = points.map((p) => p.eot);
  assert.ok(Math.min(...eots) < -13);
  assert.ok(Math.max(...eots) > 15);
});

test("wall-clock conversion round-trips through UTC", () => {
  const moment = Solar.utcFromWallClock(2026, 10, 3, 720, -300);
  assert.equal(moment.toISOString(), "2026-11-03T17:00:00.000Z");
  assert.ok(Math.abs(Solar.wallMinutes(moment, -300) - 720) < 1e-6);
});

test("formatMinutes wraps around midnight", () => {
  assert.equal(Solar.formatMinutes(0), "00:00");
  assert.equal(Solar.formatMinutes(1439), "23:59");
  assert.equal(Solar.formatMinutes(1440), "00:00");
  assert.equal(Solar.formatMinutes(-30), "23:30");
});
