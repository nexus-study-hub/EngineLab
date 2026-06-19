/**
 * physics.js — EngineLab simulation core.
 *
 * Everything here is framerate-independent (driven by dt in seconds) and
 * intentionally uses abstracted, tuned-for-feel units rather than certified
 * SI engine data — the goal is a convincing manual-transmission feel, not a
 * dyno-accurate model.
 *
 * Public surface: the EngineSim class. script.js feeds it raw input state
 * every animation frame and reads back a snapshot for audio + UI.
 */

const PHYSICS = {
  ENGINE_INERTIA: 0.04,         // lower = quicker-revving engine
  IDLE_TORQUE_FLOOR: 0.10,      // fraction of peak torque available with 0 throttle (keeps idle alive)
  FRICTION_BASE: 0.0000003,     // always-present mechanical friction (small, so power runs cleanly to redline)
  FRICTION_CLOSED_THROTTLE: 0.000009, // extra pumping-loss friction when throttle is closed (engine braking)
  STALL_RPM_FACTOR: 0.32,       // stall if coupled rpm dips below idle * this
  STALL_GRACE: 0.35,            // seconds rpm may sit below stall threshold before stalling
  LIMITER_BOUNCE_BAND: 220,     // rpm band below limiter where torque is restored
  CLUTCH_SMOOTH: 14,            // higher = snappier pedal response
  THROTTLE_SMOOTH_UP: 9,
  THROTTLE_SMOOTH_DOWN: 6,
  BRAKE_SMOOTH: 11,
  MAX_BRAKE_FORCE: 9200,        // N, abstracted
  ROLLING_RESISTANCE: 0.014,
  DRAG_COEF: 0.36,
  FRONTAL_AREA: 2.05,
  AIR_DENSITY: 1.225,
  GRAVITY: 9.81,
  DRIVE_EFFICIENCY: 0.91
};

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function expSmooth(current, target, rate, dt) {
  const t = 1 - Math.exp(-rate * dt);
  return lerp(current, target, t);
}

class EngineSim {
  constructor(car) {
    this.setCar(car);
  }

  setCar(car) {
    this.car = car;
    this.reset();
  }

  reset() {
    const c = this.car;
    this.rpm = c.idle;
    this.speedMps = 0;
    this.gear = 1;
    this.running = true;
    this.stalledTimer = 0;
    this.throttleRaw = 0;
    this.throttle = 0;
    this.brakeRaw = 0;
    this.brake = 0;
    this.clutchRaw = 0;
    this.clutch = 0;
    this.limiterActive = false;
    this.shiftFlashTimer = 0;
    this.backfire = false;
    this._backfireCooldown = 0;
    this._prevThrottleRaw = 0;
    this._prevRpm = this.rpm;
    this.odometerM = 0;
    this.maxRpmSeen = c.idle;
    this.maxSpeedSeen = 0;
    this.totalShifts = 0;
  }

  get speedKmh() { return this.speedMps * 3.6; }
  get rpmFrac() { return clamp(this.rpm / this.car.redline, 0, 1.08); }
  get totalRatio() {
    if (this.gear === 0) return 0;
    return this.car.finalDrive * this.car.gears[this.gear - 1];
  }

  shiftUp() {
    if (this.gear < this.car.gears.length) {
      this.gear += 1;
      this._registerShift();
    }
  }
  shiftDown() {
    if (this.gear > 0) {
      this.gear -= 1;
    } else {
      this.gear = 1;
    }
    this._registerShift();
  }
  setNeutral() {
    this.gear = 0;
    this._registerShift();
  }
  _registerShift() {
    this.shiftFlashTimer = 0.12;
    this.totalShifts++;
  }

  restart() {
    this.running = true;
    this.rpm = this.car.idle;
    this.stalledTimer = 0;
  }

  _torqueFactor(rpmFrac) {
    const curve = this.car.torqueCurve;
    const x = clamp(rpmFrac, 0, 1);
    for (let i = 0; i < curve.length - 1; i++) {
      const [x0, y0] = curve[i];
      const [x1, y1] = curve[i + 1];
      if (x >= x0 && x <= x1) {
        const t = (x - x0) / (x1 - x0 || 1);
        return lerp(y0, y1, t);
      }
    }
    return curve[curve.length - 1][1];
  }

  _engineTorqueNm(rpm, throttle) {
    if (throttle < 0.03) return 0; // closed throttle: no positive torque, only friction/engine-braking
    const frac = rpm / this.car.redline;
    const curveFactor = this._torqueFactor(frac);
    const throttleFactor = PHYSICS.IDLE_TORQUE_FLOOR + throttle * (1 - PHYSICS.IDLE_TORQUE_FLOOR);
    return this.car.torqueNm * curveFactor * throttleFactor;
  }

  _frictionTorque(rpm, throttle) {
    const coef = PHYSICS.FRICTION_BASE + (1 - clamp(throttle, 0, 1)) * PHYSICS.FRICTION_CLOSED_THROTTLE;
    return rpm * coef * rpm;
  }

  /**
   * Advance simulation by dt seconds given current raw inputs.
   * inputs: { throttle: 0..1, brake: 0..1, clutch: 0..1 (1 = pedal pressed/disengaged) }
   */
  update(dt, inputs) {
    if (dt <= 0) return this.snapshot();
    dt = Math.min(dt, 0.05);

    const c = this.car;

    this.throttleRaw = clamp(inputs.throttle, 0, 1);
    this.brakeRaw = clamp(inputs.brake, 0, 1);
    this.clutchRaw = clamp(inputs.clutch, 0, 1);

    const throttleRate = this.throttleRaw > this.throttle ? PHYSICS.THROTTLE_SMOOTH_UP : PHYSICS.THROTTLE_SMOOTH_DOWN;
    this.throttle = expSmooth(this.throttle, this.throttleRaw, throttleRate, dt);
    this.brake = expSmooth(this.brake, this.brakeRaw, PHYSICS.BRAKE_SMOOTH, dt);
    this.clutch = expSmooth(this.clutch, this.clutchRaw, PHYSICS.CLUTCH_SMOOTH, dt);

    this._prevRpm = this.rpm;

    if (!this.running) {
      this.rpm = expSmooth(this.rpm, 0, 8, dt);
      this._applyVehicleDynamics(dt, 0, false);
      this.limiterActive = false;
      this.backfire = false;
      return this.snapshot();
    }

    const coupled = this.gear !== 0 && this.clutch < 0.97;
    const limiterRpm = c.limiter;
    let throttleForTorque = this.throttle;

    if (this.rpm >= limiterRpm) this.limiterActive = true;
    else if (this.rpm <= limiterRpm - PHYSICS.LIMITER_BOUNCE_BAND) this.limiterActive = false;
    if (this.limiterActive) throttleForTorque = 0;

    let engineTorque = this._engineTorqueNm(this.rpm, throttleForTorque);

    if (coupled) {
      const wheelRadPerSec = this.speedMps / c.wheelRadius;
      const wheelRpm = (wheelRadPerSec * 60) / (2 * Math.PI);
      const driveRpm = wheelRpm * this.totalRatio;

      const lockStrength = 1 - this.clutch;
      const slipRate = lerp(3.5, 26, lockStrength);

      const freeRevTarget = this._freeRevIntegrate(dt, engineTorque, throttleForTorque);
      const targetRpm = lerp(freeRevTarget, Math.max(driveRpm, 0), lockStrength);
      this.rpm = expSmooth(this.rpm, targetRpm, slipRate, dt);
      this.rpm = clamp(this.rpm, 0, c.limiter + 400);

      const aboutToStall = lockStrength > 0.6 && this.rpm < c.idle * PHYSICS.STALL_RPM_FACTOR && this.throttle < 0.5;
      if (aboutToStall) {
        this.stalledTimer += dt;
        if (this.stalledTimer > PHYSICS.STALL_GRACE) {
          this.running = false;
          this.rpm = 0;
          this.stalledTimer = 0;
        }
      } else {
        this.stalledTimer = Math.max(0, this.stalledTimer - dt * 2);
      }

      this._applyVehicleDynamics(dt, engineTorque * lockStrength, true);
    } else {
      this.rpm = this._freeRevIntegrate(dt, engineTorque, throttleForTorque);
      this.stalledTimer = 0;
      this._applyVehicleDynamics(dt, 0, false);
    }

    this.rpm = clamp(this.rpm, 0, c.limiter + 500);
    this.maxRpmSeen = Math.max(this.maxRpmSeen, this.rpm);
    this.maxSpeedSeen = Math.max(this.maxSpeedSeen, this.speedKmh);

    this._backfireCooldown = Math.max(0, this._backfireCooldown - dt);
    this.backfire = false;
    if (
      this._backfireCooldown <= 0 &&
      this.rpm > c.redline * 0.55 &&
      this.throttleRaw < 0.05 &&
      this._prevThrottleRaw > 0.55
    ) {
      const chance = c.sound.turbo ? 0.85 : 0.35;
      if (Math.random() < chance) {
        this.backfire = true;
        this._backfireCooldown = 0.45;
      }
    }
    this._prevThrottleRaw = this.throttleRaw;

    if (this.shiftFlashTimer > 0) this.shiftFlashTimer = Math.max(0, this.shiftFlashTimer - dt);

    return this.snapshot();
  }

  _freeRevIntegrate(dt, engineTorque, throttle) {
    const c = this.car;
    const friction = this._frictionTorque(this.rpm, throttle);
    const omega = this.rpm * (2 * Math.PI) / 60;
    const domega = (engineTorque - friction) / (PHYSICS.ENGINE_INERTIA * 1000);
    let newOmega = omega + domega * dt * 60;
    newOmega = Math.max(0, newOmega);
    let newRpm = (newOmega * 60) / (2 * Math.PI);

    if (this.throttle < 0.04 && newRpm < c.idle * 1.15) {
      newRpm = expSmooth(newRpm, c.idle, 5, dt);
    }
    return clamp(newRpm, 0, c.limiter + 400);
  }

  _applyVehicleDynamics(dt, engineTorqueForDrive, coupled) {
    const c = this.car;
    const v = this.speedMps;

    let driveForce = 0;
    if (coupled && this.gear !== 0) {
      const wheelTorque = engineTorqueForDrive * this.totalRatio * PHYSICS.DRIVE_EFFICIENCY;
      driveForce = wheelTorque / c.wheelRadius;
      const tractionCap = c.weightKg * PHYSICS.GRAVITY * 1.05;
      driveForce = clamp(driveForce, -tractionCap, tractionCap);
    }

    const drag = 0.5 * PHYSICS.DRAG_COEF * PHYSICS.FRONTAL_AREA * PHYSICS.AIR_DENSITY * v * v;
    const rolling = PHYSICS.ROLLING_RESISTANCE * c.weightKg * PHYSICS.GRAVITY;
    const brakeForce = this.brake * PHYSICS.MAX_BRAKE_FORCE;

    let resistive = drag + rolling + (v > 0.02 ? brakeForce : 0);
    let netForce = driveForce - (v > 0 ? resistive : 0);

    const accel = netForce / c.weightKg;
    let newV = v + accel * dt;
    newV = Math.max(0, newV);

    this.speedMps = newV;
    this.odometerM += newV * dt;
  }

  snapshot() {
    return {
      rpm: this.rpm,
      rpmFrac: this.rpmFrac,
      speedKmh: this.speedKmh,
      gear: this.gear,
      throttle: this.throttle,
      throttleRaw: this.throttleRaw,
      brake: this.brake,
      clutch: this.clutch,
      running: this.running,
      limiterActive: this.limiterActive,
      shiftFlash: this.shiftFlashTimer > 0,
      backfire: this.backfire,
      stalling: this.stalledTimer > 0,
      maxRpmSeen: this.maxRpmSeen,
      maxSpeedSeen: this.maxSpeedSeen,
      totalShifts: this.totalShifts,
      odometerM: this.odometerM,
      car: this.car
    };
  }
}
