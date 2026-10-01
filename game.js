(() => {
  'use strict';

  // Canvas and configuration -------------------------------------------------
  const canvas = document.getElementById('view');
  const gl = canvas.getContext('webgl', {
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    document.body.innerHTML =
      '<p style="padding:2rem;color:white">This game needs a browser with WebGL support.</p>';
    return;
  }

  const chunkSize = 16;
  const maxChunks = 100;
  const renderRadius = 4;
  const reach = 3;
  const worldHeight = 40;
  const gravity = 20;
  const jumpVelocity = 9.2;
  const types = [
    { name: 'Grass', color: [0.39, 0.57, 0.31], hint: 'Blocks grow best outside.' },
    { name: 'Dirt', color: [0.48, 0.36, 0.23], hint: 'A little earth goes a long way.' },
    { name: 'Stone', color: [0.48, 0.49, 0.45], hint: 'A solid foundation.' },
    { name: 'Sand', color: [0.77, 0.67, 0.43], hint: 'A warmer kind of ground.' },
    { name: 'Wood', color: [0.47, 0.3, 0.15], hint: 'Make something that feels like home.' },
  ];
  // Block ID zero is air; the remaining IDs map to types by subtracting one.
  const blockNames = ['air', 'grass', 'dirt', 'stone', 'sand', 'wood'];
  const blockId = { grass: 1, dirt: 2, stone: 3, sand: 4, wood: 5 };
  const inventory = [10, 10, 10, 10, 10];
  let selected = 0;
  let chunks = new Map();
  let seed = 267931;
  let lastTime = 0;
  let acc = 0;
  let dirtyMeshes = new Set();
  const chunkEdits = new Map();
  let running = false;
  let pointerLocked = false;
  let muted = false;
  let audio = null;
  let toastTimer = 0;
  // Position is the bottom-center of the player collision box.
  const player = {
    x: 8, y: 30, z: 8, vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0, grounded: false, step: 0,
  };
  const keys = new Set();

  // WebGL setup --------------------------------------------------------------
  const vertexShader = `
    attribute vec3 aPosition;
    attribute vec3 aColor;
    uniform mat4 uView;
    uniform mat4 uProjection;
    varying vec3 vColor;
    void main() {
      vColor = aColor;
      gl_Position = uProjection * uView * vec4(aPosition, 1.0);
    }
  `;
  const fragmentShader = `
    precision mediump float;
    varying vec3 vColor;
    void main() { gl_FragColor = vec4(vColor, 1.0); }
  `;

  function shader(type, source) {
    const result = gl.createShader(type);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
      throw Error(gl.getShaderInfoLog(result));
    }
    return result;
  }

  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexShader));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentShader));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw Error(gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);
  const loc = {
    pos: gl.getAttribLocation(program, 'aPosition'),
    color: gl.getAttribLocation(program, 'aColor'),
    view: gl.getUniformLocation(program, 'uView'),
    projection: gl.getUniformLocation(program, 'uProjection'),
  };
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);

  // World generation and chunk storage --------------------------------------
  // A seeded integer-coordinate hash makes procedural chunks repeatable.
  function hash2(x, z) {
    let n = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + seed) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function smoothNoise(x, z, scale) {
    const fx = x / scale;
    const fz = z / scale;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const u = fx - ix;
    const v = fz - iz;
    const smooth = (value) => value * value * (3 - 2 * value);
    const a = hash2(ix, iz);
    const b = hash2(ix + 1, iz);
    const c = hash2(ix, iz + 1);
    const d = hash2(ix + 1, iz + 1);
    return (a + (b - a) * smooth(u)) * (1 - smooth(v)) +
      (c + (d - c) * smooth(u)) * smooth(v);
  }

  function surface(x, z) {
    return Math.floor(
      8 + smoothNoise(x, z, 42) * 7 + smoothNoise(x + 177, z - 59, 15) * 4 +
      Math.sin(x * 0.085 + z * 0.043) * 1.5,
    );
  }

  function caveAt(x, y, z) {
    if (y > surface(x, z) - 3 || y < 2) return false;
    const noise =
      Math.sin(x * 0.21 + y * 0.24) * 0.34 +
      Math.sin(z * 0.23 - y * 0.18) * 0.31 +
      Math.sin((x + z + y) * 0.13) * 0.28;
    return noise > 0.64 &&
      hash2(Math.floor(x / 3) + y * 17, Math.floor(z / 3) - y * 7) > 0.27;
  }

  function key2(cx, cz) {
    return `${cx},${cz}`;
  }

  // Converts local chunk coordinates into the one-dimensional typed-array index.
  function index(x, y, z) {
    return (y * chunkSize + z) * chunkSize + x;
  }

  function generateChunk(cx, cz) {
    const blocks = new Uint8Array(chunkSize * worldHeight * chunkSize);
    const chunk = { cx, cz, blocks, buffer: null, count: 0 };

    for (let lx = 0; lx < chunkSize; lx++) {
      for (let lz = 0; lz < chunkSize; lz++) {
        const x = cx * chunkSize + lx;
        const z = cz * chunkSize + lz;
        const height = surface(x, z);
        const beach = height < 10;
        for (let y = 0; y <= height; y++) {
          if (caveAt(x, y, z)) continue;
          let id;
          if (y === height) id = beach ? 4 : 1;
          else if (y >= height - 3) id = beach ? 4 : 2;
          else id = 3;
          blocks[index(lx, y, lz)] = id;
        }
      }
    }

    // Regeneration starts from terrain, then reapplies player edits.
    const edits = chunkEdits.get(key2(cx, cz));
    if (edits) {
      for (const [blockIndex, id] of edits) blocks[blockIndex] = id;
    }
    return chunk;
  }

  function getChunk(cx, cz, create = true) {
    const key = key2(cx, cz);
    let chunk = chunks.get(key);
    if (!chunk && create) {
      chunk = generateChunk(cx, cz);
      chunks.set(key, chunk);
      dirtyMeshes.add(key);

      // A new neighbor can expose faces along an already-loaded chunk edge.
      for (const [nx, nz] of [[cx - 1, cz], [cx + 1, cz], [cx, cz - 1], [cx, cz + 1]]) {
        const neighborKey = key2(nx, nz);
        if (chunks.get(neighborKey)) dirtyMeshes.add(neighborKey);
      }

      while (chunks.size > maxChunks) {
        let farKey = null;
        let far = -1;
        for (const [candidateKey, candidate] of chunks) {
          const distance =
            (candidate.cx - player.x / chunkSize) ** 2 +
            (candidate.cz - player.z / chunkSize) ** 2;
          if (distance > far) {
            far = distance;
            farKey = candidateKey;
          }
        }
        if (farKey === key) break;
        const old = chunks.get(farKey);
        if (old && old.buffer) gl.deleteBuffer(old.buffer);
        chunks.delete(farKey);
        dirtyMeshes.delete(farKey);
      }
    }
    return chunk;
  }

  function getBlock(x, y, z, create = true) {
    // Bedrock below zero prevents the player from digging through the world.
    if (y < 0) return 3;
    if (y >= worldHeight) return 0;
    const cx = Math.floor(x / chunkSize);
    const cz = Math.floor(z / chunkSize);
    const chunk = getChunk(cx, cz, create);
    return chunk ? chunk.blocks[index(x - cx * chunkSize, y, z - cz * chunkSize)] : 0;
  }

  function setBlock(x, y, z, id) {
    if (y < 0 || y >= worldHeight) return;
    const cx = Math.floor(x / chunkSize);
    const cz = Math.floor(z / chunkSize);
    const chunk = getChunk(cx, cz);
    const key = key2(cx, cz);
    const blockIndex = index(x - cx * chunkSize, y, z - cz * chunkSize);
    chunk.blocks[blockIndex] = id;
    let edits = chunkEdits.get(key);
    if (!edits) {
      edits = new Map();
      chunkEdits.set(key, edits);
    }
    edits.set(blockIndex, id);
    dirtyMeshes.add(key);
    // Editing a boundary requires its adjacent chunk to rebuild too.
    if (x % chunkSize === 0) dirtyMeshes.add(key2(cx - 1, cz));
    if (x % chunkSize === chunkSize - 1) dirtyMeshes.add(key2(cx + 1, cz));
    if (z % chunkSize === 0) dirtyMeshes.add(key2(cx, cz - 1));
    if (z % chunkSize === chunkSize - 1) dirtyMeshes.add(key2(cx, cz + 1));
  }

  // Each visible face contains two triangles and a simple directional light value.
  const faces = [
    { n: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 0], [1, 1, 1], [1, 0, 1]], light: 0.82 },
    { n: [-1, 0, 0], v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 1], [0, 1, 0], [0, 0, 0]], light: 0.72 },
    { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 1], [1, 1, 0], [0, 1, 0]], light: 1 },
    { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 0], [1, 0, 1], [0, 0, 1]], light: 0.52 },
    { n: [0, 0, 1], v: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [1, 0, 1], [0, 1, 1], [0, 0, 1]], light: 0.77 },
    { n: [0, 0, -1], v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 0], [1, 1, 0], [1, 0, 0]], light: 0.68 },
  ];

  // Mesh generation and rendering ------------------------------------------
  function buildMesh(chunk) {
    const verts = [];
    const colors = [];
    for (let y = 0; y < worldHeight; y++) {
      for (let z = 0; z < chunkSize; z++) {
        for (let x = 0; x < chunkSize; x++) {
          const id = chunk.blocks[index(x, y, z)];
          if (!id) continue;
          const wx = chunk.cx * chunkSize + x;
          const wz = chunk.cz * chunkSize + z;
          const coveredAbove = getBlock(wx, y + 1, wz, false) > 0;
          for (const face of faces) {
            // Skip faces against another block; they can never be seen.
            if (getBlock(wx + face.n[0], y + face.n[1], wz + face.n[2], false)) continue;
            let shade = face.light;
            if (coveredAbove) shade *= 0.72;
            const base = types[id - 1].color;
            const variation = 0.94 + hash2(wx + y * 11, wz - y * 7) * 0.1;
            for (const vertex of face.v) {
              verts.push(wx + vertex[0], y + vertex[1], wz + vertex[2]);
              colors.push(
                base[0] * shade * variation,
                base[1] * shade * variation,
                base[2] * shade * variation,
              );
            }
          }
        }
      }
    }
    if (chunk.buffer) gl.deleteBuffer(chunk.buffer);
    chunk.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, chunk.buffer);
    // Positions are stored first, then matching colors, in one GPU buffer.
    const data = new Float32Array(verts.length + colors.length);
    data.set(verts);
    data.set(colors, verts.length);
    chunk.vertexFloatCount = verts.length;
    chunk.count = verts.length / 3;
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  }

  function updateMeshes() {
    if (!dirtyMeshes.size) return;
    // Rebuild only one chunk per animation frame to avoid visible hitches.
    let budget = 1;
    for (const key of dirtyMeshes) {
      const chunk = chunks.get(key);
      if (chunk) buildMesh(chunk);
      dirtyMeshes.delete(key);
      if (--budget <= 0) break;
    }
  }

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0, 0, f, 0, 0,
      0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0,
    ]);
  }

  function viewMatrix(ex, ey, ez, cx, cy, cz) {
    let zx = ex - cx;
    let zy = ey - cy;
    let zz = ez - cz;
    let length = Math.hypot(zx, zy, zz) || 1;
    zx /= length;
    zy /= length;
    zz /= length;
    let xx = zz;
    let xy = 0;
    let xz = -zx;
    length = Math.hypot(xx, xy, xz) || 1;
    xx /= length;
    xy /= length;
    xz /= length;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * ex + xy * ey + xz * ez),
      -(yx * ex + yy * ey + yz * ez),
      -(zx * ex + zy * ey + zz * ez), 1,
    ]);
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const width = Math.round(canvas.clientWidth * dpr);
    const height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  function draw() {
    resize();
    const eyeY = player.y + 1.7;
    const dirX = Math.sin(player.yaw) * Math.cos(player.pitch);
    const dirY = Math.sin(player.pitch);
    const dirZ = -Math.cos(player.yaw) * Math.cos(player.pitch);
    gl.clearColor(0.57, 0.73, 0.79, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(
      loc.projection, false,
      perspective(110 * Math.PI / 180, canvas.width / canvas.height, 0.06, 220),
    );
    gl.uniformMatrix4fv(
      loc.view, false,
      viewMatrix(player.x, eyeY, player.z, player.x + dirX, eyeY + dirY, player.z + dirZ),
    );
    const pcx = Math.floor(player.x / chunkSize);
    const pcz = Math.floor(player.z / chunkSize);
    for (let dz = -renderRadius; dz <= renderRadius; dz++) {
      for (let dx = -renderRadius; dx <= renderRadius; dx++) {
        if (dx * dx + dz * dz > renderRadius * renderRadius + 2) continue;
        const chunk = chunks.get(key2(pcx + dx, pcz + dz));
        if (!chunk || !chunk.count || dirtyMeshes.has(key2(chunk.cx, chunk.cz))) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, chunk.buffer);
        gl.enableVertexAttribArray(loc.pos);
        gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(loc.color);
        gl.vertexAttribPointer(loc.color, 3, gl.FLOAT, false, 0, chunk.vertexFloatCount * 4);
        gl.drawArrays(gl.TRIANGLES, 0, chunk.count);
      }
    }
  }

  // Player physics ----------------------------------------------------------
  function collides(x, y, z) {
    const minX = Math.floor(x - 0.3);
    const maxX = Math.floor(x + 0.3);
    const minY = Math.floor(y + 0.001);
    const maxY = Math.floor(y + 1.999);
    const minZ = Math.floor(z - 0.3);
    const maxZ = Math.floor(z + 0.3);
    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by <= maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          if (getBlock(bx, by, bz)) return true;
        }
      }
    }
    return false;
  }

  // Breaking movement into small steps prevents passing through solid blocks.
  function moveAxis(axis, amount) {
    if (!amount) return;
    const steps = Math.ceil(Math.abs(amount) / 0.18);
    const step = amount / steps;
    for (let i = 0; i < steps; i++) {
      const x = player.x + (axis === 'x' ? step : 0);
      const y = player.y + (axis === 'y' ? step : 0);
      const z = player.z + (axis === 'z' ? step : 0);
      if (!collides(x, y, z)) {
        player.x = x;
        player.y = y;
        player.z = z;
      } else {
        if (axis === 'y') {
          if (step < 0) player.grounded = true;
          player.vy = 0;
        } else if (player.grounded) {
          // Step up a single block if headroom is available.
          const up = collides(x, player.y + 1.01, z);
          if (!up) {
            player.y += 1;
            player.x = x;
            player.z = z;
          } else if (collides(x, player.y, z)) {
            if (axis === 'x') player.vx = 0;
            else player.vz = 0;
          }
        } else {
          if (axis === 'x') player.vx = 0;
          else player.vz = 0;
        }
        break;
      }
    }
  }

  function update(dt) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const magnitude = Math.hypot(forward, side) || 1;
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = run ? 8 : 4.6;
    const fx = Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    const rx = Math.cos(player.yaw);
    const rz = Math.sin(player.yaw);
    const targetX = ((fx * forward + rx * side) / magnitude) * speed;
    const targetZ = ((fz * forward + rz * side) / magnitude) * speed;
    const smoothing = 1 - Math.exp(-12 * dt);
    player.vx += (targetX - player.vx) * smoothing;
    player.vz += (targetZ - player.vz) * smoothing;
    moveAxis('x', player.vx * dt);
    moveAxis('z', player.vz * dt);
    player.grounded = false;
    player.vy = Math.max(player.vy - gravity * dt, -35);
    moveAxis('y', player.vy * dt);
    if (player.y < -5) {
      player.x = 8;
      player.z = 8;
      player.y = surface(8, 8) + 2;
      player.vy = 0;
    }
    if (Math.hypot(player.vx, player.vz) > 0.6 && player.grounded) {
      player.step += dt * (run ? 8 : 5);
      if (player.step > 0.47) {
        player.step = 0;
        sound('step');
      }
    }
    document.getElementById('coords').textContent =
      `${Math.floor(player.x)}, ${Math.floor(player.y)}, ${Math.floor(player.z)}`;
    document.getElementById('ground-status').textContent =
      player.grounded ? 'ON SOLID GROUND' : 'IN THE AIR';
  }

  // Block interactions ------------------------------------------------------
  // Grid DDA checks the voxel cells crossed by the camera ray from nearest to farthest.
  function raycast() {
    const ox = player.x;
    const oy = player.y + 1.62;
    const oz = player.z;
    const dx = Math.sin(player.yaw) * Math.cos(player.pitch);
    const dy = Math.sin(player.pitch);
    const dz = -Math.cos(player.yaw) * Math.cos(player.pitch);
    let x = Math.floor(ox);
    let y = Math.floor(oy);
    let z = Math.floor(oz);
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    const sz = Math.sign(dz);
    const ddx = dx ? Math.abs(1 / dx) : Infinity;
    const ddy = dy ? Math.abs(1 / dy) : Infinity;
    const ddz = dz ? Math.abs(1 / dz) : Infinity;
    let mx = dx > 0 ? (x + 1 - ox) * ddx : (ox - x) * ddx;
    let my = dy > 0 ? (y + 1 - oy) * ddy : (oy - y) * ddy;
    let mz = dz > 0 ? (z + 1 - oz) * ddz : (oz - z) * ddz;
    let previous = null;
    let distance = 0;
    for (let i = 0; i < 32 && distance <= reach; i++) {
      if (getBlock(x, y, z)) return { x, y, z, prev: previous };
      previous = { x, y, z };
      if (mx < my && mx < mz) {
        x += sx;
        distance = mx;
        mx += ddx;
      } else if (my < mz) {
        y += sy;
        distance = my;
        my += ddy;
      } else {
        z += sz;
        distance = mz;
        mz += ddz;
      }
    }
    return null;
  }

  function playerOverlapsBlock(x, y, z) {
    return player.x + 0.3 > x && player.x - 0.3 < x + 1 &&
      player.z + 0.3 > z && player.z - 0.3 < z + 1 &&
      player.y + 2 > y && player.y < y + 1;
  }

  function placeOrBreak(remove) {
    const hit = raycast();
    if (!hit) {
      if (!remove) toast('No block within reach');
      return;
    }
    if (remove) {
      const id = getBlock(hit.x, hit.y, hit.z);
      if (!id) return;
      setBlock(hit.x, hit.y, hit.z, 0);
      if (id >= 1 && id <= 5) inventory[id - 1]++;
      sound('break');
      renderHotbar();
      toast(`${blockNames[id][0].toUpperCase() + blockNames[id].slice(1)} collected`);
    } else {
      const { x, y, z } = hit.prev;
      const id = selected + 1;
      if (inventory[selected] <= 0) {
        toast('No blocks left in this slot');
        return;
      }
      if (getBlock(x, y, z) || playerOverlapsBlock(x, y, z)) {
        toast('There isnâ€™t room to place that');
        return;
      }
      setBlock(x, y, z, id);
      inventory[selected]--;
      sound('place');
      renderHotbar();
    }
  }

  // UI and audio ------------------------------------------------------------
  function renderHotbar() {
    const bar = document.getElementById('hotbar');
    bar.innerHTML = '';
    types.forEach((type, index) => {
      const slot = document.createElement('button');
      slot.className = `slot${selected === index ? ' selected' : ''}`;
      slot.setAttribute('aria-label', `${index + 1}: ${type.name}, ${inventory[index]} blocks`);
      slot.innerHTML =
        `<span class="number">${index + 1}</span><span class="block-icon ${type.name.toLowerCase()}"></span><span class="count">${inventory[index]}</span>`;
      slot.addEventListener('click', () => selectSlot(index));
      bar.appendChild(slot);
    });
    document.getElementById('selected-name').textContent = types[selected].name;
    document.getElementById('selected-hint').textContent = types[selected].hint;
  }

  function selectSlot(index) {
    selected = index;
    renderHotbar();
  }

  function toast(message) {
    const element = document.getElementById('toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 1200);
  }

  function sound(kind) {
    if (muted) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const now = audio.currentTime;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.connect(gain);
      gain.connect(audio.destination);
      const params = {
        step: [105, 0.035, 'sine'],
        jump: [210, 0.13, 'triangle'],
        break: [150, 0.11, 'square'],
        place: [330, 0.12, 'triangle'],
      }[kind];
      oscillator.type = params[2];
      oscillator.frequency.setValueAtTime(params[0], now);
      oscillator.frequency.exponentialRampToValueAtTime(
        params[0] * (kind === 'break' ? 0.52 : 1.45), now + params[1],
      );
      gain.gain.setValueAtTime(kind === 'step' ? 0.025 : 0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + params[1]);
      oscillator.start(now);
      oscillator.stop(now + params[1]);
    } catch (_) {
      // Audio failure should not prevent the game from running.
    }
  }

  // Lifecycle, input, and the main loop -------------------------------------
  function startGame() {
    running = true;
    document.getElementById('start-screen').classList.add('dismissed');
    document.getElementById('pause-screen').classList.add('hidden');
    canvas.requestPointerLock?.();
    player.y = surface(Math.floor(player.x), Math.floor(player.z)) + 1.02;
    getChunk(0, 0);
  }

  function enterPause() {
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    if (running) document.getElementById('pause-screen').classList.remove('hidden');
  }

  document.getElementById('play-button').addEventListener('click', startGame);
  document.getElementById('resume-button').addEventListener('click', () => {
    document.getElementById('pause-screen').classList.add('hidden');
    canvas.requestPointerLock?.();
  });
  document.getElementById('dismiss-hint').addEventListener('click', () => {
    document.getElementById('hint-card').style.display = 'none';
  });
  document.getElementById('sound-toggle').addEventListener('click', (event) => {
    muted = !muted;
    event.currentTarget.innerHTML = muted
      ? 'â™« <span>Sound off</span>'
      : 'â™« <span>Sound on</span>';
  });
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (!pointerLocked && running) document.getElementById('pause-screen').classList.remove('hidden');
  });
  document.addEventListener('mousemove', (event) => {
    if (!pointerLocked) return;
    player.yaw -= event.movementX * 0.0025;
    player.pitch = Math.max(-1.48, Math.min(1.48, player.pitch - event.movementY * 0.0025));
  });
  document.addEventListener('keydown', (event) => {
    keys.add(event.code);
    if (/^Digit[1-5]$/.test(event.code)) selectSlot(Number(event.code.slice(-1)) - 1);
    if (event.code === 'Space') {
      event.preventDefault();
      if (player.grounded && running) {
        player.vy = jumpVelocity;
        player.grounded = false;
        sound('jump');
      }
    }
    if (event.code === 'Escape' && running) enterPause();
  });
  document.addEventListener('keyup', (event) => keys.delete(event.code));
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('mousedown', (event) => {
    if (!running || !pointerLocked) return;
    const breaking = event.button === 2 ||
      (event.button === 0 && (event.shiftKey || keys.has('ShiftLeft') || keys.has('ShiftRight')));
    if (breaking) placeOrBreak(true);
    else if (event.button === 0) placeOrBreak(false);
  });
  document.addEventListener('pointerdown', (event) => {
    const pauseScreen = document.getElementById('pause-screen');
    if (running && !pointerLocked && !event.target.closest('button') &&
      !pauseScreen.classList.contains('hidden')) {
      canvas.requestPointerLock?.();
    }
  });

  function ensureNearbyChunks() {
    const cx = Math.floor(player.x / chunkSize);
    const cz = Math.floor(player.z / chunkSize);
    const missing = [];
    for (let dz = -renderRadius; dz <= renderRadius; dz++) {
      for (let dx = -renderRadius; dx <= renderRadius; dx++) {
        if (dx * dx + dz * dz > renderRadius * renderRadius + 2 ||
          chunks.has(key2(cx + dx, cz + dz))) continue;
        missing.push([dx * dx + dz * dz, cx + dx, cz + dz]);
      }
    }
    // Generate the closest chunks first and cap work per frame.
    missing.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(2, missing.length); i++) {
      getChunk(missing[i][1], missing[i][2]);
    }
  }

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000 || 0, 0.05);
    lastTime = now;
    if (running && pointerLocked) {
      // Fixed physics ticks make motion independent of rendering speed.
      acc += dt;
      while (acc >= 1 / 60) {
        update(1 / 60);
        acc -= 1 / 60;
      }
    }
    ensureNearbyChunks();
    updateMeshes();
    draw();
    requestAnimationFrame(frame);
  }

  // Prime one chunk; subsequent frames fill the rest of the viewing radius.
  player.x = 8;
  player.z = 8;
  player.y = surface(8, 8) + 1.02;
  getChunk(0, 0);
  renderHotbar();
  requestAnimationFrame(frame);
})();
