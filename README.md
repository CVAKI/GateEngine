# Gate Engine

Developed by CVAKI.

**New: read [`HowItsWork.md`](HowItsWork.md)** - the complete file-format and component reference. Every new project gets a copy in its folder, so any AI agent (or person) can build valid projects from that one file, without the source code.

Desktop IDE for logic-gate circuits. Build circuits on plates, save a plate (for example an ALU) and reuse it as a part, and run the circuit live.

## Run it
You need Node.js 18 or newer.

```
npm install
npm start
```

Projects are saved as folders in `Documents/GateEngine/<project name>/` (plates are `plates/<name>.plate.json`).

Try the example: **Open project**, choose the `examples/Adders` folder (it has a Full Adder built from two Half Adder plates, plus an SR latch), then press **Live** (F5 or F6) and click the input switches.

## Using it
1. **New project**, give it a name. A plate called `main` is created.
2. **Drag** a gate from the right panel onto the plate (or double-click it to drop it in the middle).
3. **Wire**: press a pin (output on the right of a part, input on the left) and the wire follows your cursor.
   - **Left-click** on empty canvas to drop a corner: the wire turns 90 degrees (horizontal becomes vertical and back, up or down / left or right depending on where the cursor is).
   - **Click a pin** of the other kind to finish. A quick drag-and-release on a pin also works, with no corners (automatic route).
   - **Right-click** or **Backspace** undoes the last corner, **Esc** cancels.
   - Click a wire to select it, Delete removes it.
4. **Plate size**: click empty canvas, then edit Width and Height in the Inspector.
5. **Chips**: put Input switch parts (the chip's input pins) and Output LED parts (its output pins) on a plate and label them. Save it. Then **drag the plate from the explorer** (or from "Your plates") onto another plate: it appears as a chip. **Double-click the chip** to open the plate inside it.
6. **Built-in parts** (right panel): MUX, DEMUX, decoder, encoder, adders, comparators, SR/D/T/JK flip-flops, 4-bit register, counter, shift register, ROM, RAM, hex-to-7-segment decoder, and the 8-bit series chips (item 17). Each one is built from real gates and smaller built-in chips. **Double-click** a built-in chip to look inside, all the way down to NAND/NOR gates. They are read-only; use **Copy to project to edit** in the bar at the top of the canvas to get an editable copy.
7. **Displays and tools**: 7-segment, Hex display, Probe, Tunnel in/out (same name on one plate = same net, no wire needed), Label (a text note).
8. **Live** (F5 or F6): one button that starts the simulation and, as **Stop**, ends it. While it runs you can click switches and buttons, and keep editing: add any part from Components, draw wires, move things, and the circuit rebuilds itself on every change (switch positions and screen contents are kept; flip-flops restart). Clock parts toggle by themselves at the Hz you set. **Double-click any chip to see its gates light up live**; press **Esc** or click the breadcrumb to come back out. Your choice is remembered.
10. **Move and open parts**: press and drag any part with the **left mouse button** to move it (snaps to the grid). Dragging empty plate space pans the view. **Double-click any chip** (built-in or your own) to open it: built-in parts show their gates inside, your own plates open in a tab.
11. **Delete**: **right-click** a part or wire and a popup asks "Delete it?". Cancel keeps it; Undo (Ctrl+Z) brings it back. The Delete key still deletes straight away.
12. **Tri-state buffer**: passes D to Y only while EN is 1, otherwise the output floats (grey dashed wire, reads as 0). To share one wire between several drivers, send each tri-state output into a **Tunnel in** with the same name and read it with a **Tunnel out**. Two drivers that disagree light an orange **BUS CONFLICT** badge. See `examples/Screen` > SharedBus.
13. **Splitter / Merger (buses)**: a **Merger** turns N single wires into one thick N-bit bus wire; a **Splitter** turns it back into N wires. A bus wire only connects to a bus pin of the same width (2 to 16 bits, set in the Inspector).
14. **Pixel screen** (Screens group), up to **1000 x 1000** pixels, two modes (Inspector):
    - **Framebuffer**: pins **X**, **Y** (as many bits as the size needs, e.g. 10 for 1000), **D** the colour (1 bit, or 3-bit **RGB**), **WE** and **CLR**. Set X, Y and D, then raise WE: that pixel is written (choose "When WE rises" or "While WE is 1"). CLR wipes the screen. Build X and Y with Mergers. This is how a CPU/GPU you build would draw.
    - **Direct**: up to 16 x 16, every pixel has its **own input pin** sitting on the pixel. Wire a signal to a pixel and it lights up.
    Try `examples/Screen` (PixelPaint).

15. **Bit input / Bit output** (Input / Output group): one part with N toggle cells (2 to 16 bits, set in the Inspector) that leaves as one thick N-bit bus wire. The top-left cell is the highest bit, and a number shows above it (decimal, hex, binary or signed). **Click a cell** while the circuit runs to flip that bit, or type a start value in the Inspector. **Bit output** is the same with one light per bit. Wire a Bit input straight into a chip's bus pin, or through a **Splitter** to get single wires.
16. **Bus pins on chips**: put a Bit input or Bit output on a plate and that plate gets an N-bit bus pin (shown as `A[8]`) when you reuse it as a chip. A bus wire only joins pins of the same width.
17. **Series chips** (built-in group "Series (bus)"): ready-made N-bit parts built from columns of full adders, gates and MUXes: **Adder 4 / 8 / 16-bit**, **Add-Sub 8-bit**, **Incrementer 8-bit**, **AND / OR / XOR / NOT 8-bit**, **MUX 2:1 8-bit**, **Comparator 8-bit**, **Register 8-bit**. Double-click one to see the column inside.
18. **Fill handle (stack copies like Excel)**: select a part and drag the small cyan square at its bottom-right corner **down** (a column) or **right** (a row): dashed outlines show the copies, release to make them. Labels count up (IN1, IN2, ...; A, B, ...). One Undo removes the whole fill. The Inspector has the same thing as **Stack** (type a count, press Column or Row), and **Ctrl+D** copies the part once.
19. **Box select and move a group**: hold **Ctrl** and drag on empty plate to draw a box; every part it touches is picked. **Shift or Ctrl + click** adds or removes one part, **Ctrl+A** picks everything. **Move the group**: drag anywhere inside the dashed box (or its "Move" tab, or any picked part), press the **arrow keys** (Shift = 5 steps), or use the arrow buttons in the Inspector. Wire bends between the picked parts move too, and one Undo puts it all back. Arrow keys also move a single selected part. **Ctrl+D** copies the group with its wires, **Delete** (or right-click) removes it, **Esc** clears. A plain drag on empty plate still pans the view.
    20. **Wire humps**: where one wire crosses another (a different signal), the horizontal one hops over it with a small bump, so you can tell a crossing from a join. Wires of the same signal never hop.
21. **Name your inputs and outputs**: double-click an Input, Output, Bit input, Bit output, Button, Clock or Probe to name it (or type it in the Inspector, up to 16 characters). On a plate you reuse as a chip, that name is the pin name, so the chip explains itself. The text of the interface itself is not selectable, so a stray drag or Ctrl+A no longer highlights everything.
22. **Credit**: the Gate Engine logo is the app's logo. A small "Dev CVAKI" credit with the CVAKI fox sits in the bottom-right corner of the launcher and in the status bar. Replace `src/cvaki.png` to change it.
    Try `examples/Series`: an add/subtract chip, an 8-bit comparator and an Accumulator plate that has its own bus pins.

23. **IntelliJ-style layout**: Explorer, editor and Components are rounded floating panels with gaps between them. Slim icon rails on the far left and right hide or show the Explorer and Components panels (remembered). The editor has pill tabs, the project name is a widget in the top bar, and the toolbar and status bar are flat. Colors are unchanged.

24. **Map** (every plate has a **Map** button, in the toolbar and on its Explorer row): opens a study view of that plate with **every chip opened up, level inside level, all the way down to the gates**. It keeps **your layout** (parts stay where you put them, wires keep their bends) and the plate shrinks to fit what is on it. **Layout > Auto flow** re-arranges everything left to right by logic depth. Plate names may still end in `.map` for old projects; that suffix is just not shown.

- **Top bar that never breaks**: one line at any window size (GPU name, button labels and extras drop out as the window narrows), no **New plate** button up there (it lives in the Explorer), **Clock** is one tidy pill with the real speed in the status bar, and on a narrow window only one side panel stays open at a time. The project name is a menu: switch to another project, **New project**, **Open project**, **New window**; opening a project asks **This window** or **New window**, like a normal IDE.
25. **Boxes** (Explorer): the box button next to **+** makes a box, like a folder in a file tree. Drag plates (or boxes) into it, or onto the project name to move them back out. Deleting a box moves its plates up one level, nothing else is deleted. Boxes live in `gate.project.json`; plates keep their own file names, so chips never break.
26. **32-bit buses and fast clocks**: Bit input / output, splitter and merger now go up to **32 bits**, and the clock goes up to **2000 Hz** (several half-periods per frame; the real speed depends on your PC). The simulator's inner loop is about twice as fast. `examples/MyGPU32` is a 32-bit line / rectangle GPU built with it (read its `README_GPU32.md`).
    - It runs its own live simulation: wires glow, gates light up, bus wires show their value. Click an input switch or a bit of a Bit input to flip it, **Pause clock** stops the clocks.
    - **Click any wire to trace the signal**: that whole net lights up (yellow) through every chip border and the rest dims; the corner readout shows its live value. Click empty space to stop.
    - **Open chips** (top bar) limits how deep it opens: 1 level, 2 levels, ... or All levels. Scroll to zoom, drag to pan, **Fit** shows everything, and the small overview in the corner lets you jump around a big map. Esc closes.
    - Feedback loops (latches) are drawn as lanes above the gates. `Label` notes inside the chips are shown under their circuit.
    - Plate names may now contain dots (not at the start or end). Try `examples/RenderMap` (`alu.map`, `counter.map`, `latch.map`).

27. **No more size limits (v0.7)**:
    - **Buses up to 64 bits** (Bit input / output, splitter, merger). Values wider than 53 bits are exact (BigInt) and saved as hex text.
    - **Memory part** (Memory group): RAM or ROM with up to **64 address bits** and **64 data bits**. It is sparse, so **46 address bits x 8 data bits = a 64 TiB RAM** costs nothing until you write to it. Set start contents in `props.init`. Pins A, D, WE, Q.
    - **Clock with no limit**: type any Hz. `0` means MAX (as fast as your PC can go). The real speed is shown as `(real ... Hz)` next to the box.
    - **HowItsWork.md** is copied into every project folder (and sits in the app root). It documents every part, pin, prop and the JSON structure.

Flip-flops and latches power up in an arbitrary state (like real hardware). Clock them once with a known input, or use a reset, before reading them.

| Shortcut | Action |
| --- | --- |
| Ctrl+S / Ctrl+Shift+S | Save plate / save all |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Delete | Delete selected part or wire (while drawing a wire: undo last corner) |
| Esc | Cancel a wire / go back out of a chip |
| Double-click chip | Open it (your plate: new tab. Built-in or while running: look inside) |
| Right-click part or wire | Ask "Delete it?" then delete |
| Left-drag part / empty plate | Move the part / pan the view |
| Ctrl + drag empty plate | Box select a group (then drag any picked part to move all) |
| Shift / Ctrl + click part | Add or remove it from the group |
| Ctrl+A | Select every part |
| Arrow keys (Shift = 5 steps) | Move the selected part or group |
| Ctrl+D | Copy the selected part or group once |
| F5 / F6 | Live: start / stop |
| F6 | Live mode on / off |
| Ctrl + mouse wheel | Zoom |
| Middle mouse drag | Pan |

## Project layout
```
main.js, preload.js      Electron main process and the safe file bridge
src/index.html           UI shell
src/styles.css           Dark theme (colors from the logo)
src/js/gates.js          Gate shapes, pins and sizes, displays, chip look
src/js/builtins.js       Built-in parts, each one built from gates
src/js/sim.js            Netlist compiler + simulator
src/js/editor/           Plate canvas, split by job (load order is in index.html):
  helpers.js             grid snap, wire routing, hop paths (EditorKit)
  core.js                the Editor class + constructor
  lifecycle.js           load plate, step into chips, breadcrumbs
  history.js             undo / redo, changed()
  geometry.js            coordinates, pin positions, part state
  render.js              SVG drawing + pixel screens
  simulation.js          Run / Live, clock, live values
  pointer.js             mouse: press, drag part, pan, right-click
  wiring.js              draw wires, branch from a wire, drag segments, connect
  editing.js             add / change / resize / delete parts
  selection.js           select, box select, group move / copy
  fill.js                fill handle (stack copies)
  view.js                zoom, fit
src/js/maplayout.js      Render map layout: opens every chip down to the gates, layers, lanes, nets (no DOM)
src/js/mapview.js        Render map window: pan / zoom, live values, signal trace
src/js/shell.js          Tool-window rails (hide / show panels)
src/js/app.js            Launcher, explorer, tabs, palette, inspector
tests/sim.test.js        npm test: truth tables, nested plates, latch
tests/builtins.test.js   npm test: every built-in part (adders, flip-flops, counter, RAM, ...)
tests/bus.test.js        npm test: tri-state buses, splitter / merger, pixel screens
tests/series.test.js     npm test: bit input / output, bus pins on chips, every series chip against real arithmetic
tests/maplayout.test.js  npm test: Render map gate counts match the simulator, clean wires, nets through chip borders
HowItsWork.md            Full reference of parts, pins and the JSON structure (also copied into each project)
STITCH_PROMPT.md         Prompt for the Stitch UI design
docs/ROADMAP.md          Component list and the plan toward binary + GPU
```

## Build an installer
`npm run dist` (uses electron-builder).

## Notes
- The simulator runs on the CPU for now. The GPU badge shows the detected WebGPU adapter; the GPU compute engine is step 4 in `docs/ROADMAP.md`.
- Gate symbols are SVG placeholders until your transparent PNG skins are ready.

## Installers for Windows, macOS and Linux
`npm run dist` builds for the system you are on. Per system: `npm run dist:win` (.exe installer + portable .exe), `npm run dist:mac` (.dmg), `npm run dist:linux` (.AppImage). Results land in `dist/`.
A Mac build only works on a Mac (Apple's rules), and a Linux build is easiest on Linux/WSL. To get all three without owning all three machines, push the project to GitHub and run **Actions > Build installers**: `.github/workflows/build.yml` builds on Windows, macOS and Linux and gives you the three downloads. Unsigned apps show a warning the first time (Windows SmartScreen, macOS "unidentified developer": right-click > Open).
#   G a t e E n g i n e  
 