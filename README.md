# Wildlands

A small, local first-person voxel exploration and building game. It uses plain JavaScript and WebGL; there is no build step or dependency install.

## Run

Open `index.html` in a desktop browser with WebGL enabled. For the most consistent browser behavior, serve this folder with any local static file server.

## Controls

- **W A S D** move; **Shift** run; **Space** jump
- **Mouse** look around (click “Step into the wild” to capture the pointer; **Esc** releases it)
- **Left click** place the selected block; **Right click** remove a block
- **Shift + left click** also removes a block
- **1–5** select a block type

The five block types each start with 10 blocks. Removed blocks are returned to inventory. The world builds terrain chunks as you explore and retains up to 100 generated chunks in memory.
