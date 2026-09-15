# Project File Guide

`index.html` - Static entry point. Most web servers automatically open this file.

`css/interface-design.css` - Controls the game's layout, typography, colors, menus, HUD, and visual effects.

`js/player-profile-storage.js` - Loads and saves persistent coins, skins, upgrades, and best-run statistics.

`js/shop-catalog.js` - Defines the skins and upgrades shown in the shop.

`js/keyboard-controls.js` - Converts keyboard input into movement directions and handles key state.

`js/game-world-config.js` - Stores shared constants, world rules, fish lineages, and body-shape profiles.

`js/fish-behavior.js` - Implements fish movement, AI decisions, eating, growth, stamina, and evolution.

`js/ecosystem-simulation.js` - Manages spawning, food, predation, particles, shockwaves, and ecosystem balance.

`js/canvas-renderer.js` - Draws fish, food, particles, effects, and the game world on the canvas.

`js/game-controller.js` - Connects the screens, shop, HUD, game loop, profile, ecosystem, and renderer.
