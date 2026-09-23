# Requirements Assessment

Assessment date: 2026-09-23

Overall result: **Does not meet the specification.** The game initializes and accepts movement input, but a critical camera-matrix defect prevents the voxel world from rendering correctly. No implementation fixes were made as part of this review.

Priority meanings used below:

- **CRITICAL** — prevents the main game experience from functioning.
- **HIGH** — breaks a required core behavior or can destroy meaningful player work.
- **LOW** — a localized requirement mismatch or visible defect with a narrower impact.
- **WARNING** — a verification, portability, or maintainability concern that is not yet a demonstrated functional failure.

## Findings

### 1. CRITICAL — The camera view matrix collapses the rendered world

**Requirement:** First-person exploration with fluid camera control and a visible voxel world.

**Location:** `game.js:46`

`viewMatrix()` constructs its horizontal basis as `(-zy, zx, 0)`, which is based on the world Z axis even though the game treats Y as the vertical axis. At the initial camera direction, the camera's backward vector is `(0, 0, 1)`, so this calculation produces a zero-length horizontal basis. The resulting view matrix has zero X and Y basis vectors, and the terrain triangles collapse instead of appearing on screen.

This was reproduced in headless Chrome with software WebGL. The WebGL context remained valid, 66 non-empty mesh buffers were created, more than 4,600 draw calls completed without GL errors, and the sampled framebuffer location remained the sky-clear color across 200 draws. The captured page likewise showed the HUD over an empty sky. Instrumentation recorded the default view matrix as effectively:

```text
[0, 0, 0, 0,
 0, 0, 0, 0,
 0, 0, 1, 0,
 0, 0,-8, 1]
```

The player can technically move, but the primary explore/build experience is not usable when the terrain cannot be seen correctly.

### 2. HIGH — Player edits are discarded when chunks are evicted

**Requirements:** Open-world exploration; the player should be able to build a house and explore caves; retain a bounded number of chunks while remaining fluid.

**Locations:** `game.js:36`, `game.js:40`

Placed and removed blocks exist only in each chunk's in-memory `Uint8Array`. When the 100-chunk limit is exceeded, `getChunk()` deletes the farthest chunk and its entire block array. Returning later regenerates that chunk only from the terrain seed; there is no edit log or other persistence for player changes.

As a result, a house or excavation disappears after the player travels far enough for its chunk to leave the cache and then returns. This undermines the central building objective and causes loss of player work.

### 3. HIGH — The configured jump cannot clear a two-block rise

**Requirement:** The player can jump up to two blocks in height.

**Locations:** `game.js:51`, `game.js:52`, `game.js:66`

Jumping sets vertical velocity to `9`, while each fixed update subtracts gravity (`20 * 1/60`) before applying movement. A simulation of the submitted update order gives a maximum rise of approximately `1.95` blocks. Clearing a two-block ledge requires the player's feet to reach at least `2.0` blocks, and the collision code's automatic step-up handles only about one block (`+1.01`). Therefore a two-block ledge cannot be cleared as specified.

### 4. LOW — Block interaction range is longer than specified

**Requirement:** Placement is allowed when a block is within two spaces.

**Locations:** `game.js:6`, `game.js:53`

The raycast reach is set to `3`, so placement and removal can target blocks up to three units away rather than the specified two-space limit.

### 5. LOW — Chunk-border meshes are not invalidated correctly at negative coordinates

**Requirement:** Building and digging should work throughout the open world.

**Location:** `game.js:40`

Neighbor invalidation uses expressions such as `x % chunkSize === chunkSize - 1`. JavaScript remainders are negative for negative operands, so a world coordinate such as `x = -1` has remainder `-1`, not `15`. Editing the positive edge of a negative-coordinate chunk therefore fails to mark the adjacent chunk for remeshing. Removing blocks there can leave missing exposed faces; placing blocks can leave stale hidden faces until some unrelated remesh occurs.

### 6. LOW — Cave and overhang lighting does not account for non-adjacent blocks above

**Requirement:** Blocks should remain illuminated but become dimmer when shaded by blocks above.

**Location:** `game.js:42`

The shading test checks only the immediately adjacent block at `y + 1`. A block exposed inside a tall cave, tunnel, or overhang is rendered as unshaded whenever that one neighboring cell is air, even if solid terrain exists farther above it. This does not provide the requested above-block shading for cave interiors.

### 7. WARNING — The frame-rate requirement needs to be retested after rendering is corrected

**Requirement:** Fluid motion and camera view, with frame rate not under 25 FPS.

The smoke test observed about `38.6 FPS` at a 1418×802 canvas using Chrome's software WebGL renderer, which is above the stated minimum. However, the invalid view matrix collapses the geometry, so the current measurement is not representative of the workload produced by a correctly rendered world. The repository also has no benchmark, FPS telemetry, or automated performance test. Compliance with this requirement is therefore not established.

### 8. WARNING — The nominally local game requests fonts from the network

**Requirement:** The game is expected to run locally without hosting.

**Location:** `style.css:1`

The stylesheet imports three font families from Google Fonts. The game falls back to generic fonts when offline, so this did not prevent startup, but the intended presentation is not fully local and can vary or incur a failed network request in an offline environment.

## Test record

- `node --check game.js` passed; no JavaScript syntax errors were found.
- Chrome successfully created a WebGL 1.0 context; no runtime JavaScript exceptions or WebGL errors were observed during the smoke test.
- The start screen and HUD loaded. All five inventory slots initially displayed `10`, and Grass was selected.
- Clicking the play control acquired pointer lock. Holding W changed the displayed position from `8, 16, 8` to `8, 16, 2`, with the player reported as grounded.
- Static review confirmed implementations for WASD movement, Shift running, Space jumping, number-key selection, placement/removal inventory updates, collision, procedural terrain/caves, the chunk cap, the centered reticle, and synthesized movement/jump/place/remove sounds. The critical camera issue prevented meaningful end-to-end visual testing of building and digging.
- The repository contains no automated test suite. Sound output was reviewed in code but not judged acoustically in the headless environment.
