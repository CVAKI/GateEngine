# Gate Engine roadmap

## What exists now (v0.1, the frontend)
- Desktop app (Electron) with launcher, projects stored as real folders, explorer, tabs, component palette, inspector, status bar, dark theme using the logo colors.
- Plates with a size you choose (width and height in grid units, 1 unit = 10 px).
- Gates: AND, OR, NOT, NAND, NOR, XOR, XNOR, Buffer (AND/OR/NAND/NOR/XOR/XNOR take 2 to 8 inputs).
- I/O parts: Input switch, Button, Clock, Constant 0/1, Output LED.
- Any plate can be dropped into another plate as a part. Its Input and Output parts become its pins. Plates can nest (a full adder made of half adders).
- Live simulation: the circuit is flattened into one netlist and run. The sim is CPU-side JavaScript for now.
- Undo/redo, zoom, wire routing, save/save all, rename/copy/delete plates.
- The GPU badge shows the WebGPU adapter detected on the machine. It does not run the simulation yet.

## Added in v0.2
- Wires turn 90 degrees at every click while you draw them; wires remember their corners.
- Plates can be dragged from the explorer onto another plate and show as chips; double-click goes inside. While running, going inside shows live values.
- 20 built-in parts made of real gates (MUX 2:1/4:1, DEMUX, decoder, encoder, half/full adder, 1-bit and 4-bit comparator, SR/D/T/JK, register, counter, shift register, ROM 4x4, RAM 4x1, hex decoder), plus 7-segment, hex display, probe, tunnel and label parts.

## Added in v0.3
- Left-drag moves parts reliably, and double-click opens any chip (the redraw-on-press bug that swallowed double-clicks is fixed).
- **Live mode**: simulation always on, switches clickable while editing, netlist rebuilt after every edit.
- Right-click a part or wire: "Delete it?" popup.
- **Tri-state buffer**: nets can have several drivers; a net nobody drives floats (Z, reads 0) and contention is reported.
- **Splitter / Merger**: multi-bit bus wires (2 to 16 bits). Implemented as one net per bit, so the flat netlist stays 1-bit and the future GPU backend is unchanged.
- **Pixel screen** up to 1000 x 1000 (framebuffer mode: X, Y, colour, WE, CLR) and a direct per-pixel-pin mode (up to 16 x 16). The sim keeps the framebuffer; the editor draws it on a canvas.

## Added in v0.4
- **Bit input / Bit output** parts: N cells (2 to 16) with one bus wire, clickable while running, shown as decimal / hex / binary / signed.
- **Bus-width plate ports**: a Bit input or Bit output on a plate becomes an N-bit bus pin when the plate is used as a chip (`A[8]`). Built into the netlist compiler as one net per bit, so the flat netlist is still 1-bit.
- **Series chips** with bus pins: Adder 4/8/16, Add-Sub 8, Incrementer 8, AND/OR/XOR/NOT 8, MUX 2:1 8, Comparator 8, Register 8. All made of real gates, tested against real arithmetic.
- **Fill handle** (drag a part down or right to stack copies, labels count up), Inspector **Stack**, and **Ctrl+D**.
- **Box select**: Ctrl + drag a box, Shift/Ctrl + click, Ctrl+A; move, copy (Ctrl+D) and delete a whole group at once.
- Wire humps at crossings, double-click rename of inputs/outputs, non-selectable UI text, small "Dev CVAKI" credit.
- Example project `examples/Series` (add/subtract, comparator, an accumulator chip with bus pins).

## Added in v0.5
- **Render map**: a plate named `*.map` gets a Render map button that opens a study view with every nested chip expanded down to the gates, an automatic left-to-right layout, live values, a signal trace across chip borders, an open-depth control and an overview. Layout lives in `src/js/maplayout.js` (pure, tested), the viewer in `src/js/mapview.js`.
- Plate names can contain dots (the file keeps its dot: `gpu.map.plate.json`).

## Still needs engine work
- A real pull-up / pull-down and an X (unknown) state. Floating nets read 0 for now.
- Bigger memories and a ROM whose contents you edit in a table (today: copy the ROM plate and rewire).
- Screen: a full-size pop-out viewer and PNG export. Today the screen is shown at its "View size" and scales with zoom.

## Components to add (full list)
**Wiring:** splitter, merger, n-bit bus, tunnel (named net), tri-state buffer, pull-up, pull-down, junction.
**Inputs and outputs:** probe, 7-segment display, hex display, keyboard input, text label, rotary or DIP switch.
**Combinational:** half adder, full adder, ripple and carry-lookahead adders, subtractor, comparator, MUX, DEMUX, decoder, encoder, priority encoder, barrel shifter, parity generator, multiplier, ALU.
**Sequential:** SR latch, D latch, D / JK / T flip-flops, register, shift register, counter, register file, ROM, RAM, FIFO.
**CPU/GPU blocks:** program counter, instruction decoder, control unit, ALU lane, SIMD lane array, cache line, memory controller.
**Plate extras:** rotation and mirroring of parts, box select and copy/paste, plate tiles and background designs, custom PNG skins for gates, plate notes.

## Backend plan: from gates to binary to real GPU
1. **Netlist (done).** `compile()` in `src/js/sim.js` flattens plates into `gates[]` (type, input nets, output net), `sources[]` and `nets`. This is the intermediate representation.
2. **Levelize.** Sort gates by logic depth, detect combinational loops, mark flip-flops and latches as state elements.
3. **Bytecode.** Pack the netlist into a compact binary: a header, a net table, and fixed-width gate records (opcode, in0, in1, out). Save it as `.gbin` next to the plate. This is the "compiled binary".
4. **Executors.**
   - CPU interpreter (reference, used for tests).
   - WebGPU compute shader: one thread per gate per level, nets bit-packed 32 test vectors per word, so one dispatch simulates 32 circuits or 32 clock steps.
   - Later a native runner (Rust + wgpu) for big designs without the Electron overhead.
5. **Export.** Verilog / structural netlist export so a design can move to other tools.
6. **Peripherals.** Memory-mapped RAM/ROM, a framebuffer part, and a clock/debug panel (waveforms, breakpoints, single-step) so a GPU or CPU built in Gate Engine can actually run a program.

## UI polish after the backend works
- Redo the visuals from the Stitch design.
- Swap the SVG gate symbols for your transparent PNG skins. The symbol drawing is in `GateDefs.bodySVG` in `src/js/gates.js`; each gate would render an `<image>` instead.
- Waveform viewer, multiple windows, themes.


### Added in v0.6
- **Map** for every plate (no `.map` name needed); the button is just called Map.
- **Boxes** in the Explorer (folders for plates: drag plates and boxes in and out, stored in `gate.project.json`).
- Roomier toolbar spacing.

### Added in v0.6.1
- Buses up to 32 bits, clock up to 2000 Hz, faster simulator loop.
- `examples/MyGPU32`: a 32-bit GPU (Bresenham lines and filled rectangles, 64x64 colour screen, demo ROM).


### Added in v0.7
- Buses up to 64 bits (BigInt-exact above 53 bits), clock Hz without an upper limit (0 = MAX, real speed shown).
- `MEM` part: sparse RAM / ROM up to 2^64 words x 64 bits (46 address bits x 8 data bits = 64 TiB).
- `HowItsWork.md`: complete file-format and component reference, copied into every project.
- Still the real limit for giant designs: the CPU simulator speed. The GPU engine (step 4 above) is what will make multi-million-gate designs run fast.
