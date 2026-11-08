// Цвет акцента из настроек внешнего вида.
const tint = () => window.quadTint ?? '255,255,255';

// Сцена с четырьмя струнами и звёздами. Её используют заставка и экран волны.
class StringsScene {
  // Таймлайн появления, мс.
  static GATHER = 1600;
  static BURST = 1100;
  static FIRST_PLUCK_AT = StringsScene.GATHER + 520;
  static PLUCK_GAP = 120;

  // Вращение рамки, рад/мс, и закрутка на вылете.
  static SPIN = 0.00022;
  static SPIN_IN = 1.1;

  // Физика струн.
  static POINTS = 64;
  static STEPS_PER_MS = 0.6;
  static MAX_STEPS = 30;
  static TENSION = 0.49;
  static STIFFNESS = 0.02;
  static DAMPING = 0.9982;
  static MAX_AMPLITUDE = 20;

  // Внешний вид.
  static LINE_ALPHA = 0.85;
  static LINE_FADE_STOP = 0.16;
  static OPEN_CORNERS = 0.74;
  static DUST_COUNT = 170;
  static DUST_TAIL = 5;
  static DUST_SETTLE = 3200;
  static ECHO_SHAPES = 8;
  static ECHO_INTERVAL = 16;
  static ECHO_ALPHA = 0.22;

  constructor(canvas) {
    const { POINTS, ECHO_SHAPES } = StringsScene;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.strings = Array.from({ length: 4 }, () => ({
      y: new Float32Array(POINTS),
      v: new Float32Array(POINTS),
      // Отклонение от музыки: складывается с физикой щипков, но ею не затухает.
      audio: new Float32Array(POINTS),
      shown: new Float32Array(POINTS),
      shapes: Array.from({ length: ECHO_SHAPES }, () => new Float32Array(POINTS)),
    }));
    this.dust = [];
    // Дрожь звёздного фона. Меняется только при рисовании и на сам полёт звёзд не влияет.
    this.shakeX = 0;
    this.shakeY = 0;
    this.pulse = 1;
    this.clock = 0;
    this.startClock = 0;
    this.stepDebt = 0;
    this.echoDebt = 0;
    this.plucksDone = 0;
    this.nextIdlePluck = 0;
    this.pointer = null;
    this.width = 0;
    this.height = 0;
    this.centerX = 0;
    this.centerY = 0;
    this.half = 0;
  }

  static clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }

  static easeOutExpo(t) {
    return t >= 1 ? 1 : 1 - 2 ** (-10 * t);
  }

  static easeOutBack(t) {
    return 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
  }

  reset(startClock) {
    this.clock = startClock;
    this.startClock = startClock;
    this.stepDebt = 0;
    this.echoDebt = 0;
    this.plucksDone = 0;
    this.pointer = null;
    this.strings.forEach(({ y, v, audio, shown, shapes }) => {
      y.fill(0);
      v.fill(0);
      audio.fill(0);
      shown.fill(0);
      shapes.forEach((shape) => shape.fill(0));
    });
    this.dust = this.createDust();
  }

  setBounds(width, height, centerX, centerY, half) {
    const ratio = window.devicePixelRatio || 1;
    Object.assign(this, { width, height, centerX, centerY, half });
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  // Холст на всё окно держит несколько мегабайт, пока он не нужен, память лучше отдать.
  release() {
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  /* Геометрия */

  quadAngle() {
    const { GATHER, BURST, SPIN, SPIN_IN, clamp01, easeOutExpo } = StringsScene;
    const since = this.clock - GATHER;
    return since * SPIN - SPIN_IN * (1 - easeOutExpo(clamp01(since / BURST)));
  }

  // Концы линий идут по кругу по часовой стрелке, поэтому поворот на 90° переводит
  // каждую линию точно в следующую. На этом держится переход в линии приложения.
  quadEnds(distance) {
    const length = distance * StringsScene.OPEN_CORNERS;
    const cos = Math.cos(this.quadAngle());
    const sin = Math.sin(this.quadAngle());
    const turn = (x, y) => [
      this.centerX + 0.5 + x * cos - y * sin,
      this.centerY + 0.5 + x * sin + y * cos,
    ];
    return [
      [...turn(-length, -distance), ...turn(length, -distance)],
      [...turn(distance, -length), ...turn(distance, length)],
      [...turn(length, distance), ...turn(-length, distance)],
      [...turn(-distance, length), ...turn(-distance, -length)],
    ];
  }

  /* Струны */

  pluck(string, position, amount) {
    if (this.reducedMotion) return;
    const { POINTS, MAX_AMPLITUDE } = StringsScene;
    for (let i = 1; i < POINTS - 1; i += 1) {
      const x = i / (POINTS - 1);
      const shape = Math.exp(-(((x - position) / 0.22) ** 2)) * Math.sin(Math.PI * x);
      const next = string.y[i] + amount * shape;
      string.y[i] = Math.max(-MAX_AMPLITUDE, Math.min(MAX_AMPLITUDE, next));
    }
  }

  pluckAt(index, position, amount) {
    this.pluck(this.strings[index], position, amount);
    const [ax, ay, bx, by] = this.quadEnds(this.half)[index];
    const x = ax + (bx - ax) * position;
    const y = ay + (by - ay) * position;
    this.kickDust(x, y, Math.abs(amount) * 0.12);
  }

  pluckAll(amount) {
    this.strings.forEach((_string, index) => {
      this.pluckAt(index, 0.5, index % 2 === 0 ? amount : -amount);
    });
  }

  advanceStrings(ms) {
    const {
      STEPS_PER_MS, MAX_STEPS, POINTS, TENSION, STIFFNESS, DAMPING, ECHO_INTERVAL,
    } = StringsScene;

    this.stepDebt += ms * STEPS_PER_MS;
    const steps = Math.min(Math.floor(this.stepDebt), MAX_STEPS);
    this.stepDebt -= Math.floor(this.stepDebt);

    for (const { y, v } of this.strings) {
      for (let step = 0; step < steps; step += 1) {
        for (let i = 1; i < POINTS - 1; i += 1) {
          v[i] += TENSION * (y[i - 1] - 2 * y[i] + y[i + 1])
            + STIFFNESS * (v[i - 1] - 2 * v[i] + v[i + 1]);
        }
        for (let i = 1; i < POINTS - 1; i += 1) {
          v[i] *= DAMPING;
          y[i] += v[i];
        }
      }
    }

    for (const { y, audio, shown } of this.strings) {
      for (let i = 0; i < POINTS; i += 1) shown[i] = y[i] + audio[i];
    }

    this.echoDebt += ms;
    if (this.echoDebt >= ECHO_INTERVAL) {
      this.echoDebt %= ECHO_INTERVAL;
      for (const { shown, shapes } of this.strings) {
        const oldest = shapes.pop();
        oldest.set(shown);
        shapes.unshift(oldest);
      }
    }
  }

  // Возвращает наибольшее отклонение, чтобы яркость свечения шла от силы щипка.
  traceLine(ends, shape, wobble) {
    const { POINTS } = StringsScene;
    const [ax, ay, bx, by] = ends;
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;

    this.ctx.beginPath();
    let energy = 0;
    for (let i = 0; i < POINTS; i += 1) {
      const t = i / (POINTS - 1);
      const offset = shape ? shape[i] * wobble : 0;
      energy = Math.max(energy, Math.abs(offset));
      const x = ax + dx * t + nx * offset;
      const y = ay + dy * t + ny * offset;
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    return energy;
  }

  drawLine(ends, alpha, string, wobble) {
    const { LINE_FADE_STOP, ECHO_ALPHA, ECHO_SHAPES, clamp01 } = StringsScene;
    const { ctx } = this;
    const [ax, ay, bx, by] = ends;
    const gradient = ctx.createLinearGradient(ax, ay, bx, by);
    gradient.addColorStop(0, `rgba(${tint()},0)`);
    gradient.addColorStop(LINE_FADE_STOP, `rgba(${tint()},${alpha})`);
    gradient.addColorStop(1 - LINE_FADE_STOP, `rgba(${tint()},${alpha})`);
    gradient.addColorStop(1, `rgba(${tint()},0)`);

    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1;

    if (string) {
      string.shapes.forEach((shape, age) => {
        ctx.globalAlpha = ECHO_ALPHA * (1 - (age + 1) / (ECHO_SHAPES + 1));
        this.traceLine(ends, shape, wobble);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    const energy = this.traceLine(ends, string && string.shown, wobble);
    ctx.stroke();

    const glow = clamp01(energy / 14);
    if (glow > 0.02) {
      ctx.globalAlpha = glow * 0.22;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawQuad() {
    const { GATHER, BURST, LINE_ALPHA, clamp01, easeOutBack } = StringsScene;
    const progress = clamp01((this.clock - GATHER) / BURST);
    if (progress <= 0) return;
    this.quadEnds(this.half * easeOutBack(progress)).forEach((line, index) => {
      this.drawLine(line, LINE_ALPHA, this.strings[index], 1);
    });
  }

  /* Звёзды */

  createDust() {
    const { DUST_COUNT, GATHER } = StringsScene;
    return Array.from({ length: DUST_COUNT }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: 0.12 + Math.random() ** 0.7 * 0.95,
      drift: (Math.random() - 0.5) * 0.00006,
      swirl: 1.2 + Math.random() * 2.2,
      delay: Math.random() * GATHER * 0.45,
      size: 0.7 + Math.random() * 1,
      alpha: 0.18 + Math.random() * 0.5,
      twinkle: 0.0008 + Math.random() * 0.002,
      phase: Math.random() * Math.PI * 2,
      x: 0,
      y: 0,
      offsetX: 0,
      offsetY: 0,
      velocityX: 0,
      velocityY: 0,
    }));
  }

  drawDust(ms, fade) {
    const { GATHER, DUST_SETTLE, DUST_TAIL, clamp01 } = StringsScene;
    const { ctx, clock } = this;
    const reach = Math.hypot(this.width, this.height) / 2;
    const friction = 0.94 ** (ms / 16.7);
    const spring = 0.985 ** (ms / 16.7);

    for (const particle of this.dust) {
      particle.angle += particle.drift * ms;
      let radius = particle.radius * reach;
      let { angle } = particle;
      let alpha = particle.alpha;

      if (clock < GATHER) {
        const local = clamp01((clock - particle.delay) / (GATHER - particle.delay));
        const eased = local ** 3;
        radius *= 1 - eased;
        angle += particle.swirl * eased;
        alpha *= clamp01((clock - this.startClock) / 500);
      } else {
        // Скорость плавно сходит к нулю и вращение продолжается в ту же сторону, что при сборе.
        const settle = 1 - (1 - clamp01((clock - GATHER) / DUST_SETTLE)) ** 4;
        radius *= settle;
        angle += particle.swirl * (1 + settle);
      }

      particle.velocityX *= friction;
      particle.velocityY *= friction;
      particle.offsetX = (particle.offsetX + particle.velocityX) * spring;
      particle.offsetY = (particle.offsetY + particle.velocityY) * spring;

      const previousX = particle.x;
      const previousY = particle.y;
      particle.x = this.centerX + Math.cos(angle) * radius + particle.offsetX;
      particle.y = this.centerY + Math.sin(angle) * radius + particle.offsetY;

      const shimmer = 0.6 + 0.4 * Math.sin(clock * particle.twinkle + particle.phase);
      const stepX = particle.x - previousX;
      const stepY = particle.y - previousY;
      const tail = Math.hypot(stepX, stepY) < 200 ? DUST_TAIL * (16.7 / ms) : 0;

      // Всегда линия с круглыми концами: хвост укорачивается до точки сам, без скачка.
      ctx.strokeStyle = `rgba(${tint()},${alpha * shimmer * fade})`;
      ctx.lineWidth = particle.size;
      ctx.lineCap = 'round';
      const x = this.centerX + (particle.x - this.centerX) * this.pulse + this.shakeX;
      const y = this.centerY + (particle.y - this.centerY) * this.pulse + this.shakeY;
      ctx.beginPath();
      ctx.moveTo(x - stepX * tail, y - stepY * tail);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }

  kickDust(x, y, force) {
    for (const particle of this.dust) {
      const dx = particle.x - x;
      const dy = particle.y - y;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance < 120) {
        const push = (1 - distance / 120) * force;
        particle.velocityX += (dx / distance) * push;
        particle.velocityY += (dy / distance) * push;
      }
    }
  }

  // Взрыв из центра: все звёзды разлетаются и возвращаются на свои места.
  blastDust(force) {
    for (const particle of this.dust) {
      const dx = particle.x - this.centerX;
      const dy = particle.y - this.centerY;
      const distance = Math.hypot(dx, dy) || 1;
      particle.velocityX += (dx / distance) * force;
      particle.velocityY += (dy / distance) * force;
    }
  }

  /* Вспышка и эхо */

  drawFlash() {
    const { GATHER, clamp01, easeOutExpo } = StringsScene;
    const { ctx, centerX, centerY } = this;
    const since = this.clock - GATHER;
    if (since > 700 || since < -500) return;

    const intensity = since < 0 ? clamp01((since + 500) / 500) ** 3 : 1 - easeOutExpo(since / 700);
    const radius = 14 + 210 * clamp01(since / 700);

    const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    glow.addColorStop(0, `rgba(${tint()},${intensity})`);
    glow.addColorStop(0.18, `rgba(${tint()},${intensity * 0.3})`);
    glow.addColorStop(1, `rgba(${tint()},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  }

  drawEcho(delay) {
    const { GATHER, clamp01, easeOutExpo } = StringsScene;
    const progress = clamp01((this.clock - GATHER - delay) / 1500);
    if (progress <= 0 || progress >= 1) return;
    const distance = this.half * (0.2 + easeOutExpo(progress) * 2.4);
    const alpha = 0.3 * (1 - progress) ** 2;
    this.quadEnds(distance).forEach((ends) => this.drawLine(ends, alpha, null, 0));
  }

  /* Кадр */

  beginFrame(ms) {
    this.clock += ms;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.advanceStrings(ms);
  }

  drawEffects(ms, dustFade) {
    this.drawDust(ms, dustFade);
    this.drawEcho(120);
    this.drawEcho(340);
    this.drawFlash();
  }

  runPlucks() {
    const { FIRST_PLUCK_AT, PLUCK_GAP } = StringsScene;
    while (this.plucksDone < this.strings.length
      && this.clock >= FIRST_PLUCK_AT + this.plucksDone * PLUCK_GAP) {
      const direction = this.plucksDone % 2 === 0 ? 1 : -1;
      this.pluckAt(this.plucksDone, 0.36 + this.plucksDone * 0.09, 14 * direction);
      this.plucksDone += 1;
    }
  }

  idlePluck() {
    if (this.clock < this.nextIdlePluck) return;
    const index = Math.floor(Math.random() * this.strings.length);
    const amount = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 2);
    this.pluckAt(index, 0.3 + Math.random() * 0.4, amount);
    this.nextIdlePluck = this.clock + 2500 + Math.random() * 3000;
  }

  // Курсор, пересекая струну, щиплет её.
  pluckOnCrossing(event) {
    const { GATHER, BURST } = StringsScene;
    const current = { x: event.clientX, y: event.clientY };
    const previous = this.pointer;
    this.pointer = current;
    if (!previous || this.clock < GATHER + BURST) return;

    const speed = Math.hypot(current.x - previous.x, current.y - previous.y);
    this.quadEnds(this.half).forEach(([ax, ay, bx, by], index) => {
      const dx = bx - ax;
      const dy = by - ay;
      const before = dx * (previous.y - ay) - dy * (previous.x - ax);
      const after = dx * (current.y - ay) - dy * (current.x - ax);
      if (before * after >= 0) return;

      const position = ((current.x - ax) * dx + (current.y - ay) * dy) / (dx * dx + dy * dy);
      if (position < 0.05 || position > 0.95) return;

      const amount = Math.min(14, Math.max(3, speed * 0.35));
      this.pluckAt(index, position, after > 0 ? amount : -amount);
    });
  }
}
