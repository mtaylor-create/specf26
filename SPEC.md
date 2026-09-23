# Game Specification
A minecraft-like game, with single-player world exploration and block-based building.  

## Overview
The player plays in first-person and can wander a voxel-based procedurally-generated terrain.  The player can right-click or shift-click to remove a block from the terrain.  They can left-click to place a block.  The player can walk, run, and jump up to two blocks in height.

## Player and Camera
The player is in first-person, and the player character is 2 blocks in height.  The player can walk, run, and jump up to two blocks in height. Field of view is 110 degrees. The player has an inventory that initially contains 10 blocks each of 5 kinds of blocks.  

## Controls
WASD keys for walking and running
Hold shift to run
Press space to jump
Mouse controls camera direction
Small reticle in the center of the screen
- Right-clicking removes the block in front of the reticle. When blocks are removed, add one to inventory of appropriate type. 
- Left-clicking places a block in front of the reticle touching the nearest block (if there is a block within 2 spaces). If a block is placed, decrease the inventory of that block by 1.  Blocks cannot be placed if none of that type are in inventory.
Pressing the number keys selects a different block type in inventory


## World and Environment
The world has procedurally-generated hilly terrain with some caves.  For now, use a simple lighting engine that keeps all blocks illuminated, but more dimly if they are shaded by blocks above.  
The player should be able to dig down several blocks without falling through the floor. 
The player cannot fly and should stand on the nearest tile under them.  Make sure that the player cannot get stuck inside a block.   


## Core Gameplay
This is an open-world game.  The player should be able to walk in any direction and generate additional map chunks.  Limit this to maybe 100 chunks or whatever allows the game to run fluidly.  Fluid motion and camera view is exceptionally important here, so be efficient and simple with rendering.  

## Progression and Objectives
The player will likely try to build a house and explore caves.  There is no set win condition in this version.  

## Interface and Audio
Interface is keyboard and mouse (see Controls section above)
Add simple sound effects for movement, jumping, removing and adding blocks.  

## Technical Notes
Efficiency is important.  This game will not be fun if the frame rate is jittery or under 25FPS.  
This game should be written in Javascript.  
Assume this will all run locally and does not need to be hosted at this time.

## Future directions
We do not need these features now but may add them in the future:
- Multiplayer
- Enemies that can move 
- Plant life
