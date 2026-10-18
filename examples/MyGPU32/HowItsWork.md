# HowItsWork.md - Gate Engine reference (for people and for AI agents)

Developed by CVAKI. Gate Engine is a desktop IDE for logic-gate circuits. You build circuits on **plates**, reuse a plate as a **chip** inside another plate, and run the whole thing live.

**This file is complete on purpose.** An AI agent that has *never seen the source code* can read only this file and then write valid project files (`gate.project.json` + `*.plate.json`) that open and run in Gate Engine. If you are an AI agent: read sections 1 to 9, follow the checklist in section 12, and generate JSON with a script rather than by hand when a design is big.

---

## 1. What a project is (files on disk)

A project is a folder. In the desktop app it lives in `Documents/GateEngine/<project name>/`.

```
MyProject/
  gate.project.json          project file (name, main plate, explorer folders)
  HowItsWork.md              this file (copied in when a project is created)
  plates/
    main.plate.json          one file per plate
    ALU.plate.json
    my.cpu.plate.json        plate names may contain dots (not first or last)
```

- A plate's **name** is its file name without `.plate.json`. Chips refer to plates by that name.
- Names: letters, digits, `_`, `-`, space and `.`; max 64 characters; no `/ \ :` etc.
- To open a project in the app: **Open project** and choose the folder that contains `gate.project.json`.

## 2. `gate.project.json`

```json
{
  "name": "MyProject",
  "format": 1,
  "created": 1792264761944,
  "main": "main",
  "folders": [ { "id": "f1", "name": "ADDERS", "parent": null } ],
  "placement": { "halfadder": "f1", "fulladder": "f1" }
}
```

| key | meaning |
| --- | --- |
| `name` | project name |
| `format` | always `1` |
| `created` | milliseconds since 1970 (any number is fine) |
| `main` | name of the plate that opens first |
| `folders` | optional Explorer boxes (like folders). `id` is any unique string, `parent` is another folder id or `null` |
| `placement` | optional map: plate name -> folder id. Only organises the Explorer, never changes how circuits work |

## 3. A plate file: `plates/<name>.plate.json`

```json
{
  "format": 1,
  "name": "HalfAdder",
  "width": 45,
  "height": 28,
  "nodes": [
    { "id": "n1", "type": "INPUT",  "x": 10,  "y": 40,  "props": { "label": "A", "value": 0 } },
    { "id": "n2", "type": "INPUT",  "x": 10,  "y": 200, "props": { "label": "B", "value": 0 } },
    { "id": "n3", "type": "XOR",    "x": 200, "y": 40,  "props": { "inputs": 2 } },
    { "id": "n4", "type": "AND",    "x": 200, "y": 160, "props": { "inputs": 2 } },
    { "id": "n5", "type": "OUTPUT", "x": 350, "y": 60,  "props": { "label": "S" } },
    { "id": "n6", "type": "OUTPUT", "x": 350, "y": 180, "props": { "label": "C" } }
  ],
  "wires": [
    { "id": "w7",  "from": { "node": "n1", "pin": "q" }, "to": { "node": "n3", "pin": "i0" } },
    { "id": "w8",  "from": { "node": "n2", "pin": "q" }, "to": { "node": "n3", "pin": "i1" } },
    { "id": "w9",  "from": { "node": "n1", "pin": "q" }, "to": { "node": "n4", "pin": "i0" } },
    { "id": "w10", "from": { "node": "n2", "pin": "q" }, "to": { "node": "n4", "pin": "i1" } },
    { "id": "w11", "from": { "node": "n3", "pin": "y" }, "to": { "node": "n5", "pin": "d" } },
    { "id": "w12", "from": { "node": "n4", "pin": "y" }, "to": { "node": "n6", "pin": "d" } }
  ],
  "nextId": 13
}
```

| key | meaning |
| --- | --- |
| `format` | always `1` |
| `name` | must equal the file name (without `.plate.json`) |
| `width`, `height` | plate size in **grid units**; 1 unit = 10 px. Make it big enough for all parts (`x/10`, `y/10` of the farthest part plus its size) |
| `nodes` | the parts on the plate |
| `wires` | the connections |
| `nextId` | a number larger than every number used in `n<number>` and `w<number>` ids (the app uses it to create new ids) |

### Node

```json
{ "id": "n3", "type": "AND", "x": 200, "y": 40, "props": { "inputs": 3 } }
```

- `id`: unique on the plate, written `n` + number (`n1`, `n2`, ...).
- `type`: one of the types in section 5.
- `x`, `y`: top-left corner in **pixels** on the plate (use multiples of 10, the grid). Must be `>= 0` and inside `width*10 x height*10`.
- `props`: the settings of that type (section 5). Missing props get defaults; values are clamped to legal ranges.

### Wire

```json
{ "id": "w7", "from": { "node": "n1", "pin": "q" }, "to": { "node": "n3", "pin": "i0" }, "pts": [ { "x": 250, "y": 110 }, { "x": 250, "y": 300 } ] }
```

- Always goes **from an output pin to an input pin**.
- `from.pin` is an output pin name, `to.pin` is an input pin name (pin names per type are in section 5).
- **An input pin can have only one wire.** An output pin can feed many wires.
- Bus rule: a wire connects pins of the **same width** only (1-bit to 1-bit, 8-bit to 8-bit). A mismatch is an error and the circuit will not run.
- `pts` is optional: corner points (plate pixels) the wire is *drawn* through. It never changes the logic. Leave it out and the app routes the wire itself. If you give it, keep every segment horizontal or vertical.
- A wire whose node or pin does not exist is silently dropped when the plate is edited in the app, so double check names.

## 4. Pins, buses and the simulation model

- Everything is **1-bit signals**. A **bus** (N-bit wire) is just N 1-bit nets travelling together; the simulator keeps one net per bit.
- Bit numbering: bit 0 is the least significant bit. On a Bit input / Bit output the top-left cell is the highest bit.
- The circuit is flattened (every chip opened down to the gates) into one netlist and settled by repeated passes until nothing changes (so feedback loops such as SR latches work). A loop that never settles is reported as "did not settle".
- Flip-flops and latches power up in an arbitrary state. Give them a known input (or a reset) before reading them.
- A net nobody drives **floats** and reads 0. Two active tri-state drivers that disagree show a bus conflict.

## 5. Node types (the complete list)

`W` = bus width. Pin names are exact; use them in `wires`.

### Logic gates (no clock, no memory)
| type | inputs | output | props |
| --- | --- | --- | --- |
| `AND` `OR` `NAND` `NOR` `XOR` `XNOR` | `i0` ... `i(n-1)` | `y` | `inputs`: 2 to 8 (default 2) |
| `NOT`, `BUF` | `i0` | `y` | none |
| `TRI` (tri-state buffer) | `d` (data), `en` (enable) | `y` | none. Drives `y` only while `en` is 1, otherwise `y` floats |

`XOR` with more inputs is odd parity (1 when an odd number of inputs are 1).

### Inputs, outputs, sources
| type | pins | props | notes |
| --- | --- | --- | --- |
| `INPUT` | out `q` | `label` (max 16 chars), `value` (0 or 1, start value) | a switch. **On a plate used as a chip, it becomes an input pin named `label`** (pin id = the node id) |
| `OUTPUT` | in `d` | `label` | a light. On a chip it becomes an **output pin** |
| `BUS_IN` (Bit input) | out `q` (W bits) | `label`, `bits` (2 to **64**), `value`, `fmt` (`dec` `hex` `bin` `signed`) | N toggle cells, leaves as one bus wire. On a chip it becomes an N-bit input pin shown as `A[8]`. `value` is a number up to 53 bits; for wider buses write it as a hex string, for example `"0xFFFFFFFFFFFFFFFF"` |
| `BUS_OUT` (Bit output) | in `d` (W bits) | `label`, `bits` (2 to **64**), `fmt` | N lights. On a chip it becomes an N-bit output pin |
| `BUTTON` | out `q` | `label` | 1 while pressed (momentary) |
| `CLOCK` | out `q` | `label` | toggles by itself while running, at the Clock Hz shown in the toolbar (any speed, `0` = MAX) |
| `CONST1`, `CONST0` | out `q` | none | fixed 1 / 0 |

Only **top-level** switches and buttons can be clicked while running. Inside a chip they come from the outside.

### Displays and tools
| type | pins | props |
| --- | --- | --- |
| `SEG7` (7-segment) | in `a` `b` `c` `d` `e` `f` `g` | none |
| `HEX` (hex display) | in `d0` `d1` `d2` `d3` (weights 1, 2, 4, 8) | none |
| `PROBE` | in `d` | `label` |
| `LABEL` | none | `label` (a text note, max 40 chars) |
| `TUNNEL_IN` | in `d` | `name` (max 6 chars) |
| `TUNNEL_OUT` | out `q` | `name` |

Tunnels with the **same `name` on the same plate** are one net, no wire needed. Several `TUNNEL_IN` with one name make a shared bus (use tri-state buffers in front of them).

### Bus tools
| type | pins | props |
| --- | --- | --- |
| `SPLIT` (splitter) | in `bus` (W bits) -> out `o0`, `o1`, ... | `bits` (2 to 64), `group` (bits per output pin, must divide `bits`, default 1), `flip` (true = highest bit drawn on top; pin names are always real bit numbers) |
| `MERGE` (merger) | in `i0`, `i1`, ... -> out `bus` (W bits) | same as `SPLIT` |

With `group` = 1: `o3` is bit 3. With `group` = 4 on a 16-bit bus: `o0` = bits 3..0, `o1` = bits 7..4, `o2` = bits 11..8, `o3` = bits 15..12, each pin is a 4-bit bus.

### Memory (new): `MEM` - RAM or ROM up to 64 TiB
| pins | meaning |
| --- | --- |
| in `a` (`abits` wide) | address |
| in `d` (`dbits` wide) | data in (RAM only) |
| in `we` | write enable (RAM only) |
| out `q` (`dbits` wide) | data out; **always shows the word at address `a`** (asynchronous read) |

| prop | meaning |
| --- | --- |
| `abits` | address bits, 1 to **64** |
| `dbits` | data bits, 1 to **64** |
| `mode` | `"ram"` (default) or `"rom"` (no `d` / `we` pins) |
| `write` | `"edge"` (default: write when `we` goes 0 -> 1) or `"level"` (write for as long as `we` is 1) |
| `label` | text, max 16 chars |
| `init` | start contents: `[["0x0","0xFF"],["0x10","42"]]` = pairs of `[address, value]`, hex (`0x..`) or decimal text. Everything else reads 0 |

The memory is **sparse**: only words that were written take real memory. So `abits` 46 with `dbits` 8 is a **64 TiB** RAM (2^46 bytes) that costs nothing until you write to it. Capacity = 2^abits x dbits / 8 bytes. Wire a bus of the same width into `a` (use a `BUS_IN`, a `MERGE`, or a chip's bus pin).

### Screens
`SCREEN`, props `w`, `h`, `mode` (`"addr"` or `"direct"`), `color` (`"mono"` or `"rgb"`), `write` (`"edge"` or `"level"`), `view` (drawing size 60 to 400).
- `addr` mode (framebuffer, up to 1000 x 1000): pins `x` (bits needed for `w`), `y` (bits needed for `h`), `d` (1 bit, or 3 bits RGB), `we`, `clr`. Set x, y, d then raise `we`.
- `direct` mode (up to 16 x 16): one input pin per pixel, `p0` ... `p(w*h-1)`.

### `PLATE` - your own plate (or a built-in part) as a chip
```json
{ "id": "n10", "type": "PLATE", "x": 330, "y": 80, "props": { "ref": "HalfAdder" } }
```
- `ref` is a plate name from the same project's `plates/` folder **or** the name of a built-in part (section 6).
- The chip's pins come from the referenced plate: every `INPUT` / `BUS_IN` becomes an input pin, every `OUTPUT` / `BUS_OUT` becomes an output pin.
- **Pin name = the `id` of the port node inside the referenced plate** (not its label). Example: plate `HalfAdder` has `INPUT` `n1` (label A), so the chip input pin is `n1`. The label is only what is drawn.
- Pin order on the chip: top to bottom by the port node's `y` (then `x`).
- A plate may not contain itself (directly or through other chips).
- For **built-in** parts the pin names are also port node ids; get them from the part's plate (see section 6) or, easier, just place the built-in in the app and read its pin labels.

## 6. Built-in parts (use as `PLATE` with `props.ref` = exact name)

Each one is a real circuit of gates inside (double-click it in the app to look). Read-only.

| ref | inputs | outputs |
| --- | --- | --- |
| Half adder | A, B | S, C |
| Full adder | A, B, Cin | S, Cout |
| MUX 2:1 | D0, D1, S | Y |
| MUX 4:1 | D0-D3, S0, S1 | Y |
| Decoder 2:4 | A0, A1, EN | Y0-Y3 |
| DEMUX 1:4 | D, S0, S1 | Y0-Y3 |
| Encoder 4:2 | I0-I3 | A0, A1, V |
| Comparator 1-bit | A, B | GT, EQ, LT |
| Comparator 4-bit | A0-A3, B0-B3 | GT, LT, EQ |
| Adder 4-bit / 8-bit / 16-bit | A[n], B[n], Cin | S[n], Cout |
| AND 8-bit, OR 8-bit, XOR 8-bit | A[8], B[8] | Y[8] |
| NOT 8-bit | A[8] | Y[8] |
| MUX 2:1 8-bit | A[8], B[8], SEL | Y[8] |
| Add-Sub 8-bit | A[8], B[8], SUB | S[8], Cout |
| Incrementer 8-bit | A[8] | Y[8], Cout |
| Comparator 8-bit | A[8], B[8] | GT, EQ, LT |
| Register 8-bit | D[8], LD, CLK | Q[8] |
| SR latch | R, S | Q, Qn |
| D latch | D, E | Q, Qn |
| D flip-flop | D, CLK | Q, Qn |
| T flip-flop | T, CLK | Q, Qn |
| JK flip-flop | J, K, CLK | Q, Qn |
| Register 4-bit | D0-D3, LD, CLK | Q0-Q3 |
| Counter 4-bit | RST, CLK | Q0-Q3 |
| Shift register 4-bit | SI, CLK | Q0-Q3 |
| ROM 4x4 | A0, A1 | D0-D3 |
| RAM 4x1 | A0, A1, D, WE | Q |
| Hex decoder | D0-D3 | a, b, c, d, e, f, g |

Names in this table are the **labels** you see on the chip. In the JSON the pin is the port node id inside the built-in plate, so an AI that cannot open the app should prefer building from the primitive nodes in section 5 (always exact), or use `MEM` for memories, and use built-ins only when the pin ids are known.

## 7. Limits (what you can build)

| thing | limit |
| --- | --- |
| bus width (`BUS_IN`, `BUS_OUT`, `SPLIT`, `MERGE`) | 2 to **64** bits |
| memory address bits (`MEM.abits`) | 1 to **64** (46 bits x 8-bit data = **64 TiB**) |
| memory data bits (`MEM.dbits`) | 1 to **64** |
| clock speed | **no limit** on the Hz you type; `0` = MAX. The real speed depends on your PC and is shown as `(real ... Hz)` in the toolbar |
| gate inputs | 2 to 8 per gate |
| plate size | 10 to 500 grid units per side |
| chip nesting depth | 24 levels |
| screen | 1000 x 1000 (addr), 16 x 16 (direct) |

How a huge design stays possible: memories are sparse, buses are plain N-bit wires, and plates are reused as chips, so a design with one thousand identical lanes is one plate used a thousand times.

## 8. Recipe: a plate that is a reusable chip

1. Put `INPUT` / `BUS_IN` parts on the left and `OUTPUT` / `BUS_OUT` parts on the right; give each a `label`.
2. Wire the logic in between.
3. Save it as `plates/<Name>.plate.json`.
4. In any other plate add `{ "type": "PLATE", "props": { "ref": "<Name>" } }` and wire to its pins. The pin names are the port node ids from step 1.
5. Only the **top plate you press Run on** has live switches; ports inside chips are fed by the chip's pins.

## 9. Recipe: a 64 TiB memory in a plate

```json
{ "id": "n1", "type": "BUS_IN",  "x": 10,  "y": 10, "props": { "label": "ADDR", "bits": 46, "value": 0, "fmt": "hex" } },
{ "id": "n2", "type": "BUS_IN",  "x": 10,  "y": 80, "props": { "label": "DATA", "bits": 8,  "value": 0, "fmt": "hex" } },
{ "id": "n3", "type": "INPUT",   "x": 10,  "y": 150, "props": { "label": "WE", "value": 0 } },
{ "id": "n4", "type": "MEM",     "x": 200, "y": 40, "props": { "label": "RAM", "abits": 46, "dbits": 8, "mode": "ram", "write": "edge", "init": [] } },
{ "id": "n5", "type": "BUS_OUT", "x": 400, "y": 40, "props": { "label": "Q", "bits": 8, "fmt": "hex" } }
```
Wires: `n1.q -> n4.a`, `n2.q -> n4.d`, `n3.q -> n4.we`, `n4.q -> n5.d`. Set ADDR and DATA, raise WE: the byte is stored. Set ADDR back and it reads the byte. Addresses never written read 0.

## 10. Running it

- **Run (F5)**: frozen run. **Live (F6)**: always on, you can edit while it runs.
- Click switches / Bit input cells to change inputs. `CLOCK` parts toggle at the toolbar Hz.
- **Map** opens every chip down to the gates with live values.
- Double-click a chip to look inside (your plates open in a tab, built-ins are read-only).
- `npm test` runs the simulator tests (truth tables, buses, memory up to 64 TiB, series chips, map layout).

## 11. Source map (only if you have the code)

```
main.js, preload.js      Electron main process and file bridge (creates projects, copies this file in)
src/js/gates.js          node types, pins, sizes, props limits (the source of truth for section 5)
src/js/builtins.js       built-in parts made of gates
src/js/sim.js            netlist compiler + simulator (buses, tri-state, memory, screens)
src/js/editor/*.js       plate canvas
src/js/app.js            launcher, explorer, palette, inspector
examples/                ready projects: Adders, Series, Screen, RenderMap, MyGPU32
docs/ROADMAP.md          plan toward binary + real GPU
```

## 12. Checklist for AI agents generating projects

1. `gate.project.json` exists, `main` names an existing plate, `format` is 1.
2. Every plate file: `format` 1, `name` equals the file name, `nodes`, `wires`, `width`, `height`, `nextId` all present.
3. Node ids unique per plate, `type` from section 5 only, coordinates multiples of 10 and `>= 0`, inside the plate size.
4. Every wire goes output pin -> input pin with exact pin names; **each input pin has at most one wire**; widths match.
5. `PLATE` nodes: `props.ref` is an existing plate file name or built-in name; chip pins use the port node ids of that plate.
6. No plate contains itself.
7. Wide bus `BUS_IN.value` above 53 bits is a hex string.
8. Give every `INPUT` / `OUTPUT` / `BUS_*` a short `label`; add `LABEL` notes to explain sections.
9. Generate big repeated structures (lanes, register files) with a script and reuse plates as chips.
10. Never edit `nextId` downwards; set it to (highest id number + 1).
