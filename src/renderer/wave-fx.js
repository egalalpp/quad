// Живой фон: то, что слышно, становится светом.
//
// Рисуется на видеокарте в два прохода. Первый кладёт новое поверх прошлого кадра, чуть увеличенного
// и повёрнутого, поэтому всё оставляет за собой короткие шлейфы. Второй разводит цвета и светит.
// Свет не копится: из старого и нового берётся ярчайшее, иначе дроп заливает экран белым.
//
// Фон собран из мелочей, а не из сплошных колец. Искры летят от рамки, и каждая светит той частотой,
// что звучала, когда она родилась. Хэты зажигают звёздочки, бочка подталкивает искры и дым. В нарастании всё засасывает внутрь, на дропе искры рвутся в стороны
// полосами, по экрану проходит одна волна и лучи. Толщина всех линий считается в пикселях: края ровные.
class WaveFx {
  // Холст и буферы меньше окна, браузер сам растягивает картинку. Мелочь всё равно чёткая,
  // а памяти и работы видеокарте в два с лишним раза меньше.
  static SCALE = 0.66;
  static MAX_RATIO = 1.25;

  // История спектра: сколько полос и сколько кадров она хранит.
  static BINS = 128;
  static ROWS = 128;
  static LOW_HZ = 35;
  static HIGH_HZ = 14000;
  static SPECTRUM_FLOOR = 0.28;

  static RINGS = 4;
  static RING_FADE = 700;
  static TINT_MS = 900;
  static QUIET_RECTS = 2;

  // Сколько раз зажглись звёздочки: по этому числу выбираются новые места.
  static SEEDS = 97;

  static VERTEX = `#version 300 es
    out vec2 vUv;
    void main() {
      vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      vUv = corner;
      gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
    }`;

  // Общее для обоих проходов: место на экране, цвет и ровные линии.
  static COMMON = `
    uniform vec2 uCenter;
    uniform float uUnit;
    uniform float uFrame;
    uniform float uTime;
    uniform float uSpin;
    uniform float uAmount;
    uniform vec3 uTintA;
    uniform vec3 uTintB;

    const float TAU = 6.28318530718;
    const float PI = 3.14159265359;

    mat2 turn(float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return mat2(c, -s, s, c);
    }

    // Целочисленный хеш: не плывёт, сколько бы искры ни пролетели.
    float hash(uint x) {
      x ^= x >> 16u;
      x *= 0x7feb352du;
      x ^= x >> 15u;
      x *= 0x846ca68bu;
      x ^= x >> 16u;
      return float(x) / 4294967295.0;
    }

    float hash(float a, float b) {
      return hash(uint(a + 65536.0) * 1597334677u + uint(b + 65536.0) * 3812015801u);
    }

    // Линия заданной толщины в пикселях со сглаженным краем: ровная на любом размере окна.
    float stroke(float gap, float width) {
      float pixels = abs(gap) * uUnit;
      return 1.0 - smoothstep(width - 0.75, width + 0.75, pixels);
    }

    // Цвет переливается между двумя оттенками обложки.
    vec3 tintAt(float radius, float angle) {
      float shade = 0.5 + 0.5 * sin(angle * 2.0 + radius * 2.6 - uTime * 0.5);
      return mix(uTintA, uTintB, shade);
    }`;

  static SCENE = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 outColor;

    uniform sampler2D uPrevious;
    uniform sampler2D uSpectrum;
    uniform vec2 uSize;
    uniform float uHead;
    uniform float uHistory;
    uniform float uStep;
    uniform float uKick;
    uniform float uHeat;
    uniform float uDrop;
    uniform float uTension;
    uniform float uFlash;
    uniform float uTwist;
    uniform float uTravel;
    uniform float uSweep;
    uniform float uCrowd;
    uniform float uRays;
    uniform vec4 uRings[${WaveFx.RINGS}];
    ${WaveFx.COMMON}

    float noise(vec2 point) {
      vec2 cell = floor(point);
      vec2 local = fract(point);
      vec2 blend = local * local * (3.0 - 2.0 * local);
      return mix(
        mix(hash(cell.x, cell.y), hash(cell.x + 1.0, cell.y), blend.x),
        mix(hash(cell.x, cell.y + 1.0), hash(cell.x + 1.0, cell.y + 1.0), blend.x),
        blend.y
      );
    }

    float spectrum(float pitch, float age) {
      return texture(uSpectrum, vec2(pitch, uHead - age / uHistory)).r;
    }

    // Искры летят от рамки в три слоя глубины. Путь считается в логарифме радиуса,
    // поэтому у рамки они идут медленно и густо, а к краям разгоняются и редеют.
    // Каждая светит той частотой, что звучала в её сторону, когда она родилась.
    float sparks(float radius, float angle, float pitch) {
      float u = log(max(radius, 0.0001) / uFrame);
      if (u < 0.0) return 0.0;
      float level = spectrum(pitch, u * 0.35);
      float sound = 0.16 + 1.1 * level * level;
      float sum = 0.0;
      for (int layer = 0; layer < 3; layer += 1) {
        float f = float(layer);
        float count = 60.0 + 54.0 * f;
        float spacing = 0.5 - 0.1 * f;
        float speed = 0.75 + 0.3 * f;
        float size = 1.9 - 0.4 * f;
        float cell = fract((angle + PI) / TAU + f * 0.137) * count;
        float id = floor(cell);
        float shift = uTravel * speed / spacing + hash(id, f);
        float slot = floor(u / spacing - shift + 0.5);
        float own = hash(id + f * 1000.0, slot);
        if (own > uCrowd) continue;

        float salt = own * 4099.0;
        float jitter = (hash(salt, 1.0) - 0.5) * 0.4;
        float along = (u - (slot + shift) * spacing) * radius;
        float across = (fract(cell) - 0.5 - jitter) / count * TAU * radius;
        // Хвост тянется на весь путь искры с прошлого кадра, поэтому шлейф сплошной, а не пунктир.
        // Голова остаётся круглой, хвост смотрит туда, откуда искра прилетела.
        float trail = abs(uSweep) * speed * radius * uUnit * 1.4;
        float back = along * uSweep < 0.0 ? along / (1.0 + trail / size) : along;
        float distance = length(vec2(back, across)) * uUnit;
        float body = 1.0 - smoothstep(size - 0.7, size + 0.7, distance);
        float glow = 0.35 * exp(-distance / (size * 2.4));
        sum += (body + glow) * (0.45 + 0.55 * hash(salt, 2.0)) * (1.0 - 0.25 * f);
      }
      return sum * sound * smoothstep(0.0, 0.22, u) * exp(-u * 0.55);
    }

    // Лучи разгоняются к краям: на дропе это прыжок в гиперпространство.
    float rays(float radius, float angle) {
      const float COUNT = 64.0;
      float cell = (angle + PI) / TAU * COUNT;
      float id = floor(cell);
      float seed = hash(id, 3.0);
      float travel = fract(seed * 7.0 + uTravel * (0.15 + seed * 0.35));
      float head = uFrame + travel * travel * 3.4;
      float tail = 0.04 + travel * (0.2 + 0.8 * uDrop);
      float along = smoothstep(tail, 0.0, head - radius) * step(radius, head);
      float across = abs(fract(cell) - 0.5) / COUNT * TAU * radius;
      return along * stroke(across, 0.9) * seed;
    }

    // Мягкий дым вокруг рамки: дышит с бочкой и уносится шлейфами. Без линий, только свет.
    float haze(vec2 point, float radius) {
      vec2 p = turn(uTime * 0.05) * point;
      float smoke = 0.6 * noise(p * 2.1 + uTime * 0.12) + 0.4 * noise(p * 4.3 - uTime * 0.17);
      return exp(-max(radius - uFrame, 0.0) * 2.4) * smoke * smoke;
    }

    // Волна дропа: круг и квадрат с открытыми углами. За фронтом остаётся мягкий след.
    float shocks(vec2 point, float radius) {
      float sum = 0.0;
      for (int i = 0; i < ${WaveFx.RINGS}; i += 1) {
        vec4 ring = uRings[i];
        if (ring.y < 0.004) continue;
        vec2 side = abs(turn(ring.w) * point);
        float high = max(side.x, side.y);
        float gap = mix(radius, high, ring.z) - ring.x;
        float open = mix(1.0, 1.0 - smoothstep(0.58, 0.84, min(side.x, side.y) / max(high, 0.001)), ring.z);
        float wake = gap < 0.0 ? 0.12 * exp(gap * 9.0) : 0.0;
        sum += ring.y * open * (stroke(gap, 1.1 + 1.6 * ring.y) + wake);
      }
      return sum;
    }

    void main() {
      vec2 point = (vUv * uSize - uCenter) / uUnit;
      float radius = length(point);
      float angle = atan(point.y, point.x);

      // Прошлый кадр: на ударах распирает наружу, в нарастании засасывает внутрь.
      // Все сдвиги умножены на длину кадра: на любом мониторе фон движется одинаково.
      float zoom = (0.0008 + 0.002 * uHeat + 0.006 * uKick * uHeat + 0.035 * uDrop * uDrop - 0.006 * uTension) * uStep;
      vec2 past = turn(uTwist * uStep * (0.5 + radius * 0.8)) * point * (1.0 - zoom);
      vec2 pastUv = (past * uUnit + uCenter) / uSize;

      // Чем быстрее всё несётся, тем сильнее размыт след: копии прошлых кадров сливаются в дым,
      // а не стоят лесенкой.
      float memory = mix(0.78, 0.86, uHeat);
      memory = mix(memory, 0.9, max(uDrop, uTension));
      vec2 inside = step(vec2(0.0), pastUv) * step(pastUv, vec2(1.0));
      vec3 before = textureLod(uPrevious, pastUv, 0.5 + 0.6 * uHeat + 1.0 * uDrop).rgb;
      vec3 echo = max(before * pow(memory, uStep) - 0.004 * uStep, 0.0) * inside.x * inside.y;

      float pitch = 1.0 - abs(fract((angle - uSpin) / (PI * 0.5)) * 2.0 - 1.0);
      float outside = smoothstep(uFrame * 0.95, uFrame * 1.35, radius);
      float lift = 1.0 + 0.8 * uKick * uHeat + 0.8 * uDrop;

      float light = sparks(radius, angle, pitch * 0.82 + 0.015) * lift * outside;
      light += rays(radius, angle) * uRays * outside;
      light += haze(point, radius) * (0.04 + 0.1 * uHeat + 0.2 * uKick * uHeat + 0.15 * uDrop) * outside;
      light += shocks(point, radius) * 0.8;
      light += uFlash * 0.45 * exp(-radius * 5.0);
      light = min(light, 1.3);

      vec3 fresh = tintAt(radius, angle) * light * uAmount;
      outColor = vec4(max(echo, fresh) + fresh * 0.2, 1.0);
    }`;

  static SHOW = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 outColor;

    uniform sampler2D uImage;
    uniform vec2 uPixels;
    uniform vec2 uCenterUv;
    uniform vec2 uSafe;
    uniform vec4 uQuiet[${WaveFx.QUIET_RECTS}];
    uniform float uQuietLevel;
    uniform float uSplit;
    uniform float uBloom;
    uniform float uExposure;
    uniform float uGlint;
    uniform float uGlintSeed;
    uniform float uGlintCrowd;
    ${WaveFx.COMMON}

    // Мелочь рисуется здесь, поверх, мимо эха: иначе прошлые кадры размножали бы её лесенкой.
    // Звёздочки на хэтах: каждый удар зажигает горстку новых в случайных местах.
    float glints(vec2 point) {
      const float CELL = 0.12;
      vec2 id = floor(point / CELL);
      float seed = hash(id.x + uGlintSeed * 211.0, id.y);
      if (seed > uGlintCrowd) return 0.0;
      float salt = seed * 40993.0;
      vec2 at = (id + 0.5 + (vec2(hash(salt, 1.0), hash(salt, 2.0)) - 0.5) * 0.5) * CELL;
      vec2 off = point - at;
      if (hash(salt, 4.0) < 0.4) off = turn(PI * 0.25) * off;
      vec2 d = abs(off) * uUnit;
      float reach = 2.5 + 5.0 * hash(salt, 3.0);
      float arms = exp(-d.y * 1.4) * max(0.0, 1.0 - d.x / reach) + exp(-d.x * 1.4) * max(0.0, 1.0 - d.y / reach);
      return 0.55 * arms + exp(-dot(d, d) * 0.5);
    }

    vec3 sparkle(vec2 pixel) {
      if (uGlint < 0.01) return vec3(0.0);
      vec2 point = (pixel - uCenter) / uUnit;
      float radius = length(point);
      float outside = smoothstep(uFrame * 1.1, uFrame * 1.5, radius);
      if (outside <= 0.0) return vec3(0.0);
      float light = glints(point) * uGlint * exp(-radius * 0.35);
      return tintAt(radius, atan(point.y, point.x)) * light * outside * uAmount;
    }

    // Под текстом фон притушен: чем ближе к строчкам, тем тише.
    float quiet(vec2 pixel) {
      float level = 1.0;
      for (int i = 0; i < ${WaveFx.QUIET_RECTS}; i += 1) {
        vec4 box = uQuiet[i];
        if (box.z <= box.x) continue;
        vec2 away = max(box.xy - pixel, pixel - box.zw);
        float distance = length(max(away, 0.0));
        level = min(level, mix(uQuietLevel, 1.0, smoothstep(0.0, 110.0, distance)));
      }
      return level;
    }

    void main() {
      vec2 away = vUv - uCenterUv;
      vec3 color = vec3(
        texture(uImage, vUv + away * uSplit).r,
        texture(uImage, vUv).g,
        texture(uImage, vUv - away * uSplit).b
      );
      vec3 glow = textureLod(uImage, vUv, 3.0).rgb * 0.55 + textureLod(uImage, vUv, 5.0).rgb * 0.45;
      vec2 pixel = vUv * uPixels;
      color += glow * uBloom + sparkle(pixel);
      color = 1.0 - exp(-color * uExposure);

      // Под меню и плеером фон притушен, иначе их не прочитать.
      float calm = smoothstep(uSafe.y * 0.7, uSafe.y * 1.7, pixel.y);
      calm *= mix(0.3, 1.0, smoothstep(uSafe.x * 0.5, uSafe.x * 2.2, pixel.x));
      color *= calm * quiet(pixel);

      outColor = vec4(color, max(color.r, max(color.g, color.b)));
    }`;

  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.isReady = false;
    this.buffers = [];
    this.rows = new Uint8Array(WaveFx.BINS);
    this.head = 0;
    this.ranges = null;
    this.rings = new Float32Array(WaveFx.RINGS * 4);
    this.ringSpeed = new Float32Array(WaveFx.RINGS);
    this.quiet = new Float32Array(WaveFx.QUIET_RECTS * 4);
    this.nextRing = 0;
    this.time = 0;
    this.travel = 0;
    this.sweep = 0;
    this.flash = 0;
    this.twist = 0;
    this.twistSide = 1;
    this.glint = 0;
    this.glintSeed = 0;
    this.seenHats = 0;
    this.lastDrop = 0;
    this.step = 16.7;
    this.tintA = [1, 1, 1];
    this.tintB = [1, 1, 1];
    this.tintGoalA = [1, 1, 1];
    this.tintGoalB = [1, 1, 1];
    this.size = null;
    this.spot = null;
    if (!this.gl) return;
    this.loser = this.gl.getExtension('WEBGL_lose_context');

    // Если фон снова позвали, пока контекст отдавался, он сразу просится обратно.
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.isReady = false;
      this.buffers = [];
      if (this.size) this.wake();
    });
    canvas.addEventListener('webglcontextrestored', () => this.prepare());
    this.prepare();
  }

  prepare() {
    const { gl } = this;
    this.scene = this.program(WaveFx.SCENE);
    this.show = this.program(WaveFx.SHOW);
    this.vertices = gl.createVertexArray();
    this.spectrum = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.spectrum);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, WaveFx.BINS, WaveFx.ROWS, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.isReady = Boolean(this.scene && this.show);
    if (this.isReady && this.size) this.resize(this.size.width, this.size.height);
  }

  compile(type, source) {
    const { gl } = this;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    console.error(gl.getShaderInfoLog(shader));
    return null;
  }

  program(fragment) {
    const { gl } = this;
    const vertexShader = this.compile(gl.VERTEX_SHADER, WaveFx.VERTEX);
    const fragmentShader = this.compile(gl.FRAGMENT_SHADER, fragment);
    if (!vertexShader || !fragmentShader) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return null;
    }

    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    const uniforms = {};
    for (let i = 0; i < count; i += 1) {
      const { name } = gl.getActiveUniform(program, i);
      uniforms[name.replace('[0]', '')] = gl.getUniformLocation(program, name);
    }
    return { program, uniforms };
  }

  createBuffer(width, height) {
    const { gl } = this;
    const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const frame = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture, frame };
  }

  freeBuffers() {
    const { gl } = this;
    this.buffers.forEach(({ texture, frame }) => {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(frame);
    });
    this.buffers = [];
  }

  // Размер окна. Буферы пересоздаются только здесь, поэтому сдвиг центра ничего не стоит.
  resize(width, height) {
    this.size = { width, height };
    if (!this.gl) return;
    if (this.gl.isContextLost()) {
      this.wake();
      return;
    }
    if (!this.isReady) return;

    this.ratio = Math.min(window.devicePixelRatio || 1, WaveFx.MAX_RATIO) * WaveFx.SCALE;
    this.canvas.width = Math.max(2, Math.round(width * this.ratio));
    this.canvas.height = Math.max(2, Math.round(height * this.ratio));

    this.freeBuffers();
    this.bufferWidth = this.canvas.width;
    this.bufferHeight = this.canvas.height;
    this.buffers = [0, 1].map(() => this.createBuffer(this.bufferWidth, this.bufferHeight));
  }

  // Контекст вернётся событием, а там уже пересоздастся всё нужное.
  wake() {
    try {
      this.loser?.restoreContext();
    } catch {
      // Ещё не отдан до конца: попросится обратно из события потери.
    }
  }

  // Откуда расходится фон, где меню и плеер и под каким текстом фон должен стихать.
  place({ centerX, centerY, half, safeBottom = 0, safeLeft = 0, quiet = [], quietLevel = 1 }) {
    this.spot = { centerX, centerY, half, safeBottom, safeLeft, quietLevel };
    this.quiet.fill(0);
    if (!this.size) return;
    const { height } = this.size;
    quiet.slice(0, WaveFx.QUIET_RECTS).forEach((box, index) => {
      this.quiet.set([box.left, height - box.bottom, box.right, height - box.top], index * 4);
    });
  }

  // Память нужна, только пока фон виден. Контекст видеокарты держит её и без буферов,
  // поэтому отдаётся целиком, а при следующем показе собирается заново.
  release() {
    if (!this.gl) return;
    this.freeBuffers();
    this.size = null;
    this.canvas.width = 1;
    this.canvas.height = 1;
    if (!this.gl.isContextLost()) this.loser?.loseContext();
  }

  setTints(first, second) {
    this.tintGoalA = first.map((value) => value / 255);
    this.tintGoalB = second.map((value) => value / 255);
  }

  spawnRing(strength, shape, angle, speed) {
    const at = this.nextRing * 4;
    this.rings.set([0, strength, shape, angle], at);
    this.ringSpeed[this.nextRing] = speed;
    this.nextRing = (this.nextRing + 1) % WaveFx.RINGS;
  }

  // Полосы идут по логарифму: так их делит слух, иначе весь бас уместился бы в паре столбцов.
  rangesFor(hzPerBin, count) {
    if (this.ranges?.hzPerBin === hzPerBin) return this.ranges;
    const { BINS, LOW_HZ, HIGH_HZ } = WaveFx;
    const edges = Array.from({ length: BINS + 1 }, (_item, index) => (
      Math.min(count - 1, Math.max(1, Math.round((LOW_HZ * (HIGH_HZ / LOW_HZ) ** (index / BINS)) / hzPerBin)))
    ));
    this.ranges = { hzPerBin, edges };
    return this.ranges;
  }

  writeSpectrum(bins, hzPerBin) {
    const { gl, rows } = this;
    const { BINS, ROWS, SPECTRUM_FLOOR } = WaveFx;
    const { edges } = this.rangesFor(hzPerBin, bins.length);

    for (let i = 0; i < BINS; i += 1) {
      let peak = 0;
      for (let bin = edges[i]; bin <= edges[i + 1]; bin += 1) peak = Math.max(peak, bins[bin]);
      rows[i] = Math.max(0, (peak / 255 - SPECTRUM_FLOOR) / (1 - SPECTRUM_FLOOR)) * 255;
    }

    this.head = (this.head + 1) % ROWS;
    gl.bindTexture(gl.TEXTURE_2D, this.spectrum);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, this.head, BINS, 1, gl.RED, gl.UNSIGNED_BYTE, rows);
  }

  // Удары узнаются по счёту, а не по кадру: фон рисует не каждый кадр и иначе пропускал бы их.
  followHits(pulse) {
    const { SEEDS } = WaveFx;
    const { hat } = pulse.hits;
    if (hat === this.seenHats) return;
    this.seenHats = hat;
    this.glintSeed = (this.glintSeed + 1) % SEEDS;
    this.glint = Math.max(this.glint, 0.35 + 0.65 * pulse.hat);
  }

  advance(ms, pulse, spin) {
    const { RING_FADE, RINGS, TINT_MS } = WaveFx;
    const { heat, kick, drop, tension } = pulse;
    const seconds = ms / 1000;
    this.time += seconds;
    this.step += (ms - this.step) * 0.05;

    // Искры: бочка подталкивает, дроп швыряет, нарастание тянет обратно к рамке.
    const speed = 0.16 + 0.35 * heat + 0.9 * kick * heat + 3.2 * drop - 0.6 * tension;
    this.sweep = seconds * speed;
    this.travel += this.sweep;

    this.followHits(pulse);
    this.glint *= 0.5 ** (ms / 80);

    if (drop > this.lastDrop + 0.5) {
      this.flash = 1;
      this.twistSide = -this.twistSide;
      this.spawnRing(1.2, 0, 0, 1.9);
      this.spawnRing(1, 1, -spin, 1.35);
    }
    this.lastDrop = drop;

    this.flash *= 0.5 ** (ms / 150);
    const twist = this.twistSide * (0.0012 + 0.004 * heat + 0.012 * drop) - 0.008 * tension;
    this.twist += (twist - this.twist) * (1 - 0.5 ** (ms / 180));

    for (let i = 0; i < RINGS; i += 1) {
      this.rings[i * 4] += this.ringSpeed[i] * seconds;
      this.rings[i * 4 + 1] *= 0.5 ** (ms / RING_FADE);
    }

    const blend = 1 - 0.5 ** (ms / TINT_MS);
    for (let i = 0; i < 3; i += 1) {
      this.tintA[i] += (this.tintGoalA[i] - this.tintA[i]) * blend;
      this.tintB[i] += (this.tintGoalB[i] - this.tintB[i]) * blend;
    }
  }

  // Место, цвет и время одинаковы в обоих проходах: холст и буферы одного размера.
  shareWith(uniforms, spin, amount) {
    const { gl } = this;
    const { centerX, centerY, half } = this.spot;
    const scale = this.bufferWidth / this.size.width;
    const unit = Math.min(this.bufferWidth, this.bufferHeight) / 2;
    gl.uniform2f(uniforms.uCenter, centerX * scale, (this.size.height - centerY) * scale);
    gl.uniform1f(uniforms.uUnit, unit);
    gl.uniform1f(uniforms.uFrame, (half * scale) / unit);
    gl.uniform1f(uniforms.uTime, this.time);
    gl.uniform1f(uniforms.uSpin, -spin);
    gl.uniform1f(uniforms.uAmount, amount);
    gl.uniform3fv(uniforms.uTintA, this.tintA);
    gl.uniform3fv(uniforms.uTintB, this.tintB);
  }

  drawScene(ms, pulse, spin, amount) {
    const { gl, buffers, scene: { program, uniforms } } = this;
    const { ROWS } = WaveFx;
    const { heat, kick, drop, tension } = pulse;
    const [source, target] = buffers;

    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.frame);
    gl.viewport(0, 0, this.bufferWidth, this.bufferHeight);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.texture);
    gl.uniform1i(uniforms.uPrevious, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.spectrum);
    gl.uniform1i(uniforms.uSpectrum, 1);

    this.shareWith(uniforms, spin, amount);
    gl.uniform2f(uniforms.uSize, this.bufferWidth, this.bufferHeight);
    gl.uniform1f(uniforms.uHead, (this.head + 0.5) / ROWS);
    gl.uniform1f(uniforms.uHistory, (ROWS * this.step) / 1000);
    gl.uniform1f(uniforms.uStep, ms / 16.7);
    gl.uniform1f(uniforms.uKick, kick);
    gl.uniform1f(uniforms.uHeat, heat);
    gl.uniform1f(uniforms.uDrop, drop);
    gl.uniform1f(uniforms.uTension, tension);
    gl.uniform1f(uniforms.uFlash, this.flash);
    gl.uniform1f(uniforms.uTwist, this.twist);
    gl.uniform1f(uniforms.uTravel, this.travel);
    gl.uniform1f(uniforms.uSweep, this.sweep);
    gl.uniform1f(uniforms.uCrowd, Math.min(1, 0.3 + 0.4 * heat + 0.3 * drop));
    gl.uniform1f(uniforms.uRays, 0.45 * Math.max(0.25 * heat * heat, drop) * (1 - tension));
    gl.uniform4fv(uniforms.uRings, this.rings);

    gl.bindVertexArray(this.vertices);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  drawResult(pulse, spin, amount) {
    const { gl, buffers, show: { program, uniforms }, ratio } = this;
    const { width, height } = this.size;
    const { centerX, centerY, safeBottom, safeLeft, quietLevel } = this.spot;
    const { heat, kick, drop, tension } = pulse;

    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, buffers[1].texture);
    gl.uniform1i(uniforms.uImage, 0);
    gl.uniform2f(uniforms.uPixels, this.canvas.width, this.canvas.height);
    gl.uniform2f(uniforms.uCenterUv, centerX / width, 1 - centerY / height);
    gl.uniform2f(uniforms.uSafe, safeLeft * ratio, safeBottom * ratio);
    gl.uniform4fv(uniforms.uQuiet, this.quiet.map((value) => value * ratio));
    gl.uniform1f(uniforms.uQuietLevel, quietLevel);
    // Цвета расходятся только на сильных ударах и на дропе: в обычном куске края чистые.
    gl.uniform1f(uniforms.uSplit, amount * (0.004 * kick * heat + 0.03 * drop));
    gl.uniform1f(uniforms.uBloom, 0.15 + 0.15 * heat + 0.3 * drop);
    gl.uniform1f(uniforms.uExposure, (0.9 + 0.2 * heat + 0.25 * this.flash) * (1 - 0.45 * tension));
    this.shareWith(uniforms, spin, amount);
    gl.uniform1f(uniforms.uGlint, this.glint * (0.45 + 0.55 * heat));
    gl.uniform1f(uniforms.uGlintSeed, this.glintSeed);
    gl.uniform1f(uniforms.uGlintCrowd, 0.03 + 0.07 * heat);
    gl.bindVertexArray(this.vertices);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // amount: 1 на полную, меньше для спокойного режима.
  render(ms, pulse, bins, hzPerBin, spin, amount) {
    if (!this.isReady || this.buffers.length === 0 || !this.spot) return;
    this.writeSpectrum(bins, hzPerBin);
    this.advance(ms, pulse, spin);
    this.drawScene(ms, pulse, spin, amount);
    this.drawResult(pulse, spin, amount);
    this.buffers.reverse();
  }
}
