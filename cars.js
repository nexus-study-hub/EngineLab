/**
 * cars.js — EngineLab vehicle database.
 * Pure data. Every numeric value (ratios, torque curves, idle/redline) is tuned
 * to feel representative of the real car's character, not a certified spec sheet.
 *
 * torqueCurve: array of [rpmFraction (0..1 of redline), torqueFactor (0..1 of peak)]
 * sampled and linearly interpolated by physics.js to shape the power delivery.
 */

const CARS = [
  {
    id: "m3e46",
    make: "BMW",
    model: "M3",
    chassis: "E46",
    year: 2003,
    engineName: "S54B32 — 3.2L Inline-6",
    layout: "I6",
    cylinders: 6,
    aspiration: "na",
    displacement: 3.2,
    hp: 333,
    hpRpm: 7900,
    torqueNm: 365,
    torqueRpm: 4900,
    weightKg: 1495,
    drivetrain: "RWD",
    idle: 950,
    redline: 8000,
    limiter: 8100,
    finalDrive: 3.62,
    wheelRadius: 0.318,
    gears: [3.82, 2.20, 1.52, 1.21, 1.00, 0.81],
    accent: "#6fb7ff",
    blurb: "High-strung NA inline-six. Builds slowly, screams late, rewards keeping it lit.",
    torqueCurve: [
      [0, 0.18], [0.12, 0.45], [0.25, 0.65], [0.40, 0.82],
      [0.55, 0.93], [0.62, 1.00], [0.75, 0.97], [0.88, 0.88], [1, 0.62]
    ],
    sound: { grit: 0.45, rasp: 0.65, subBass: 0.25, harmonicSpread: 1.05, turbo: false, blowoff: false, screamFactor: 0.7 }
  },
  {
    id: "gtr35",
    make: "Nissan",
    model: "GT-R",
    chassis: "R35",
    year: 2017,
    engineName: "VR38DETT — 3.8L Twin-Turbo V6",
    layout: "V6",
    cylinders: 6,
    aspiration: "turbo",
    displacement: 3.8,
    hp: 565,
    hpRpm: 6800,
    torqueNm: 633,
    torqueRpm: 5800,
    weightKg: 1752,
    drivetrain: "AWD",
    idle: 800,
    redline: 7000,
    limiter: 7100,
    finalDrive: 3.70,
    wheelRadius: 0.335,
    gears: [4.06, 2.32, 1.62, 1.27, 1.00, 0.80],
    accent: "#7df2c4",
    blurb: "Twin-turbo wall of torque. Short lag, then a flat plateau that just shoves.",
    torqueCurve: [
      [0, 0.12], [0.15, 0.20], [0.28, 0.55], [0.35, 0.85],
      [0.45, 1.00], [0.60, 1.00], [0.75, 0.93], [0.90, 0.80], [1, 0.58]
    ],
    sound: { grit: 0.35, rasp: 0.30, subBass: 0.55, harmonicSpread: 0.85, turbo: true, blowoff: true, boostThreshold: 0.30, screamFactor: 0.4 }
  },
  {
    id: "supramk4",
    make: "Toyota",
    model: "Supra",
    chassis: "MK4 / A80",
    year: 1998,
    engineName: "2JZ-GTE — 3.0L Twin-Turbo I6",
    layout: "I6",
    cylinders: 6,
    aspiration: "turbo",
    displacement: 3.0,
    hp: 320,
    hpRpm: 5600,
    torqueNm: 440,
    torqueRpm: 4000,
    weightKg: 1500,
    drivetrain: "RWD",
    idle: 800,
    redline: 6800,
    limiter: 6900,
    finalDrive: 3.27,
    wheelRadius: 0.32,
    gears: [3.61, 2.08, 1.43, 1.13, 1.00, 0.86],
    accent: "#ff9a4d",
    blurb: "Sequential twin turbos. Lazy down low, then the second turbo lights and it leaps.",
    torqueCurve: [
      [0, 0.10], [0.18, 0.18], [0.30, 0.50], [0.40, 0.88],
      [0.50, 1.00], [0.65, 0.98], [0.80, 0.85], [0.92, 0.70], [1, 0.52]
    ],
    sound: { grit: 0.5, rasp: 0.40, subBass: 0.50, harmonicSpread: 0.90, turbo: true, blowoff: true, boostThreshold: 0.32, screamFactor: 0.45 }
  },
  {
    id: "huracan",
    make: "Lamborghini",
    model: "Huracán",
    chassis: "LP610-4",
    year: 2019,
    engineName: "5.2L NA V10",
    layout: "V10",
    cylinders: 10,
    aspiration: "na",
    displacement: 5.2,
    hp: 610,
    hpRpm: 8250,
    torqueNm: 560,
    torqueRpm: 6500,
    weightKg: 1422,
    drivetrain: "AWD",
    idle: 950,
    redline: 8500,
    limiter: 8600,
    finalDrive: 3.91,
    wheelRadius: 0.345,
    gears: [3.91, 2.29, 1.59, 1.18, 0.96, 0.78],
    accent: "#ffd24d",
    blurb: "Naturally aspirated V10. Fat torque everywhere, and it never stops wanting more revs.",
    torqueCurve: [
      [0, 0.25], [0.15, 0.55], [0.30, 0.78], [0.45, 0.92],
      [0.60, 1.00], [0.75, 0.98], [0.88, 0.90], [1, 0.70]
    ],
    sound: { grit: 0.30, rasp: 0.80, subBass: 0.35, harmonicSpread: 1.25, turbo: false, blowoff: false, screamFactor: 0.9 }
  },
  {
    id: "gt3",
    make: "Porsche",
    model: "911 GT3",
    chassis: "992",
    year: 2022,
    engineName: "4.0L NA Flat-6",
    layout: "H6",
    cylinders: 6,
    aspiration: "na",
    displacement: 4.0,
    hp: 510,
    hpRpm: 8400,
    torqueNm: 470,
    torqueRpm: 6100,
    weightKg: 1435,
    drivetrain: "RWD",
    idle: 900,
    redline: 9000,
    limiter: 9100,
    finalDrive: 3.44,
    wheelRadius: 0.33,
    gears: [3.80, 2.40, 1.72, 1.31, 1.03, 0.84],
    accent: "#ffe14d",
    blurb: "Motorsport-bred flat-six. Highest redline here, and it pulls hard the whole way up.",
    torqueCurve: [
      [0, 0.20], [0.15, 0.50], [0.30, 0.70], [0.45, 0.85],
      [0.60, 0.95], [0.72, 1.00], [0.85, 0.98], [1, 0.85]
    ],
    sound: { grit: 0.35, rasp: 0.55, subBass: 0.20, harmonicSpread: 1.10, turbo: false, blowoff: false, screamFactor: 0.85 }
  }
];

// Lookup helper
function getCarById(id) {
  return CARS.find(c => c.id === id) || CARS[0];
}
