/*!
 * solar.js — solar position math with no dependencies.
 *
 * Based on the NOAA Solar Calculator equations, which follow Meeus,
 * "Astronomical Algorithms". Typical accuracy is about ±0.5° in position and
 * ±1 minute in sunrise/sunset at latitudes below the polar circles.
 *
 * Works as a plain <script> (defines window.Solar) and in Node (CommonJS).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Solar = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const MS_PER_DAY = 86400000;
  const J1970 = 2440587.5;
  const J2000 = 2451545.0;

  // The sun's centre sits this far below the geometric horizon at sunrise and
  // sunset: half its disc plus average atmospheric refraction.
  const SUNRISE_ALTITUDE = -0.833;

  function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }

  /** A UTC Date for a wall-clock time at a place with the given UTC offset. */
  function utcFromWallClock(year, monthIndex, day, minutes, tzOffsetMinutes) {
    return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0) + minutes * 60000 - tzOffsetMinutes * 60000);
  }

  /** Day of the year, 1–366, in UTC. */
  function dayOfYear(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 1);
    const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return Math.floor((midnight - start) / MS_PER_DAY) + 1;
  }

  /**
   * Fractional year in radians: the position in the annual cycle, where 0 is
   * roughly 1 January. NOAA's approximation uses a 365-day year.
   */
  function fractionalYear(date) {
    const doy = dayOfYear(date);
    const hoursUTC =
      date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    return (2 * Math.PI / 365) * (doy - 1 + (hoursUTC - 12) / 24);
  }

  /** Equation of time, in minutes. Positive means the sundial runs ahead. */
  function equationOfTime(date) {
    const g = fractionalYear(date);
    return 229.18 * (
      0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g)
    );
  }

  /** Solar declination in degrees: the sun's latitude above the celestial equator. */
  function declination(date) {
    const g = fractionalYear(date);
    return DEG * (
      0.006918 -
      0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) -
      0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) -
      0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)
    );
  }

  /** Local wall-clock minutes at this instant for a place with the given UTC offset. */
  function wallMinutes(date, tzOffsetMinutes) {
    return (
      date.getUTCHours() * 60 +
      date.getUTCMinutes() +
      date.getUTCSeconds() / 60 +
      tzOffsetMinutes
    );
  }

  /** Hour angle in degrees: 0 at solar noon, negative in the morning. */
  function hourAngle(date, lonDeg, tzOffsetMinutes) {
    const trueSolarTime =
      wallMinutes(date, tzOffsetMinutes) +
      equationOfTime(date) +
      4 * lonDeg -
      tzOffsetMinutes;
    return trueSolarTime / 4 - 180;
  }

  /**
   * Where the sun is, as seen from a point on the ground.
   * Altitude is degrees above the horizon; azimuth is degrees clockwise from north.
   */
  function sunPosition(date, latDeg, lonDeg, tzOffsetMinutes) {
    const phi = latDeg * RAD;
    const dec = declination(date) * RAD;
    const H = hourAngle(date, lonDeg, tzOffsetMinutes) * RAD;

    const cosZenith =
      Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
    const zenith = Math.acos(clamp(cosZenith, -1, 1));

    // Azimuth measured from south, then rotated so 0° is north.
    const azFromSouth = Math.atan2(
      Math.sin(H),
      Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)
    );

    return {
      altitude: 90 - zenith * DEG,
      azimuth: ((azFromSouth * DEG + 180) % 360 + 360) % 360,
      zenith: zenith * DEG,
      declination: declination(date),
      hourAngle: hourAngle(date, lonDeg, tzOffsetMinutes)
    };
  }

  /** Local wall-clock minutes of solar noon. */
  function solarNoon(date, lonDeg, tzOffsetMinutes) {
    return 720 - 4 * lonDeg - equationOfTime(date) + tzOffsetMinutes;
  }

  /** Hours of daylight, from the sunrise hour angle. 0 and 24 mean polar night/day. */
  function dayLength(date, latDeg) {
    const phi = latDeg * RAD;
    const dec = declination(date) * RAD;
    const cosH0 =
      Math.cos((90 - SUNRISE_ALTITUDE) * RAD) / (Math.cos(phi) * Math.cos(dec)) -
      Math.tan(phi) * Math.tan(dec);

    if (cosH0 >= 1) return 0;
    if (cosH0 <= -1) return 24;
    return 2 * Math.acos(cosH0) * DEG / 15;
  }

  /** Sunrise, solar noon and sunset as local wall-clock minutes, plus day length in hours. */
  function sunTimes(date, latDeg, lonDeg, tzOffsetMinutes) {
    const noon = solarNoon(date, lonDeg, tzOffsetMinutes);
    const length = dayLength(date, latDeg);
    const half = (length * 60) / 2;
    return {
      solarNoon: noon,
      sunrise: noon - half,
      sunset: noon + half,
      dayLength: length
    };
  }

  /**
   * The sun's track across the sky for one day, sampled every `stepMinutes`.
   * `date` only supplies the calendar day.
   */
  function sunPath(date, latDeg, lonDeg, tzOffsetMinutes, stepMinutes) {
    const step = stepMinutes || 4;
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = date.getUTCDate();
    const points = [];
    for (let minutes = 0; minutes <= 1440; minutes += step) {
      const moment = utcFromWallClock(y, m, d, minutes, tzOffsetMinutes);
      const pos = sunPosition(moment, latDeg, lonDeg, tzOffsetMinutes);
      points.push({ minutes: minutes, altitude: pos.altitude, azimuth: pos.azimuth });
    }
    return points;
  }

  /**
   * The analemma for a year: the sun's noon position, plotted as equation of
   * time (minutes) against declination (degrees).
   */
  function analemma(year) {
    const points = [];
    for (let doy = 1; doy <= 365; doy++) {
      const date = new Date(Date.UTC(year, 0, doy, 12, 0, 0));
      points.push({
        date: date,
        dayOfYear: doy,
        eot: equationOfTime(date),
        declination: declination(date)
      });
    }
    return points;
  }

  /** Julian day number for a Date. */
  function julianDay(date) {
    return date.getTime() / MS_PER_DAY + J1970;
  }

  /** Format minutes after midnight as HH:MM, wrapping around the day. */
  function formatMinutes(minutes) {
    const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  return {
    RAD: RAD,
    DEG: DEG,
    J2000: J2000,
    SUNRISE_ALTITUDE: SUNRISE_ALTITUDE,
    utcFromWallClock: utcFromWallClock,
    dayOfYear: dayOfYear,
    fractionalYear: fractionalYear,
    equationOfTime: equationOfTime,
    declination: declination,
    wallMinutes: wallMinutes,
    hourAngle: hourAngle,
    sunPosition: sunPosition,
    solarNoon: solarNoon,
    dayLength: dayLength,
    sunTimes: sunTimes,
    sunPath: sunPath,
    analemma: analemma,
    julianDay: julianDay,
    formatMinutes: formatMinutes
  };
});
