#!/usr/bin/env python3
"""Draw session-rail's README pictures from code.

Every PNG and GIF in this folder is generated here, so a UI change can be
reflected by running this file instead of re-capturing a terminal. The scenes
are drawn at twice their published size for crisp text, with Menlo as the
terminal face, and downsampled only for the animated GIFs.

    python3 docs/make-assets.py            # all of them
    python3 docs/make-assets.py vertical   # one, while iterating

The rail glyphs are drawn as little rules rather than text: a terminal font
leaves gaps between box-drawing characters, and the rail reads better without
them. Requires Pillow.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent

# Terminal grid. Coordinates in this file are logical pixels (the size the
# README shows); everything is drawn at SCALE times that and kept there for
# stills, downsampled for GIFs.
SCALE = 2
CELL = 8.5
LINE = 20.0
FONT_SIZE = 28
MENLO = "/System/Library/Fonts/Menlo.ttc"

REGULAR = ImageFont.truetype(MENLO, FONT_SIZE, index=0)
BOLD = ImageFont.truetype(MENLO, FONT_SIZE, index=1)

BG = "#1a1b1e"
WINDOW = "#1b1c20"
PANEL = "#202126"
BORDER = "#303339"
TEXT = "#d7d8da"
DIM = "#8b8e94"
FAINT = "#5f636b"
ACCENT = "#d97757"
GREEN = "#4eba65"
YELLOW = "#e5c07b"
RED = "#f07171"
GRAY = "#6c7078"
CODE = "#c7c9cc"
INVERSE = "#d7d8da"
INVERSE_TEXT = "#1a1b1e"
PAGE = "#111216"


def s(value: float) -> int:
    return int(round(value * SCALE))


def sx(value: float) -> float:
    return value * SCALE


@dataclass
class Turn:
    sent: str
    duration: str | None = None
    files: list[str] = field(default_factory=list)
    outcome: str | None = None  # running | interrupted | error


@dataclass
class Prompt:
    text: str
    turn: Turn
    break_before: bool = False
    unreachable: bool = False


PROMPTS = [
    Prompt("Explain what src/debounce.ts does", Turn("14:02", "8s")),
    Prompt(
        "Add a cancel() method that calls the pending timeout's clearTimeout and "
        "returns whether it cancelled anything",
        Turn("14:06", "1m 12s", ["src/debounce.ts"]),
    ),
    Prompt(
        "Write tests for cancel() with and without a pending call",
        Turn("14:09", "46s", ["src/debounce.test.ts"]),
    ),
    Prompt("Why does the test fail on Node 18?", Turn("14:12", "3s", outcome="error")),
    Prompt("Fix the timer typing so it works in Node and browsers", Turn("14:15", "21s", ["src/debounce.ts", "src/types.ts"])),
    Prompt("Run the suite and update the README example", Turn("14:18", "2m 4s", ["README.md"], outcome="interrupted")),
    Prompt("Now add a leading-edge option", Turn("14:26", outcome="running"), break_before=True),
]

REPLIES = [
    (
        "It wraps a function so calls within the wait time collapse into one. "
        "Each call replaces the timer and keeps the latest arguments.",
        [("Read", "src/debounce.ts", "Read 84 lines")],
        [],
    ),
    (
        "Added cancel() to the returned object. It clears the pending timer, drops "
        "the stored arguments, and reports whether anything was waiting.",
        [("Edit", "src/debounce.ts", "Updated with 9 additions and 1 removal")],
        [
            "const cancel = () => {",
            "  clearTimeout(timer);",
            "  pending = undefined;",
            "  return wasPending;",
            "};",
        ],
    ),
    (
        "I'll add both cases: one where a call is waiting, and one where nothing is.",
        [
            ("Write", "src/debounce.test.ts", "Updated with 34 additions"),
            ("Bash", "npm test -- debounce", "12 passed (12)"),
        ],
        [],
    ),
    (
        "The test reads the timer before it is assigned on Node 18. The cancel path "
        "should guard for that instead of assuming a pending call.",
        [],
        [],
    ),
    (
        "The timer is typed as number, but Node returns a Timeout object. I'll use "
        "ReturnType<typeof setTimeout> in both places.",
        [("Edit", "src/debounce.ts", "Updated with 4 additions and 4 removals")],
        [],
    ),
    (
        "The suite is green. I added the cancel example to the README.",
        [("Bash", "npm test", "12 passed (12)")],
        [],
    ),
    ("A leading-edge call can run immediately and still allow one trailing call.", [], []),
]

OUTCOME_WORDS = {"running": "running", "interrupted": "interrupted", "error": "API error"}


def summary(prompt: Prompt, max_cells: int | None = None) -> str:
    """Sent time, turn details and files; names fewer files to fit max_cells."""
    turn = prompt.turn
    base = [turn.sent]
    if turn.duration:
        base.append(turn.duration)
    if turn.outcome:
        base.append(OUTCOME_WORDS[turn.outcome])
    candidates: list[list[str]] = []
    if turn.files:
        names = [Path(path).name for path in turn.files]
        candidates.append(base + [", ".join(names)])
        candidates.append(base + [f"{len(names)} file" if len(names) == 1 else f"{len(names)} files"])
    candidates.append(base)
    for parts in candidates:
        line = " · ".join(parts)
        if max_cells is None or len(line) <= max_cells:
            return line
    return " · ".join(base)


def cut(text: str, cells: int) -> str:
    flat = " ".join(text.split())
    if len(flat) <= cells:
        return flat
    return flat[: max(0, cells - 1)] + "…"


def wrap(text: str, cells: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    line = ""
    for word in words:
        if not line:
            line = word
        elif len(line) + 1 + len(word) <= cells:
            line += " " + word
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines or [""]


def rect(d: ImageDraw.ImageDraw, x: float, y: float, w: float, h: float, **kwargs) -> None:
    d.rounded_rectangle([sx(x), sx(y), sx(x + w), sx(y + h)], radius=s(kwargs.pop("radius", 0)), **kwargs)


def line(d: ImageDraw.ImageDraw, x1: float, y1: float, x2: float, y2: float, color: str, width: float = 1) -> None:
    d.line([sx(x1), sx(y1), sx(x2), sx(y2)], fill=color, width=max(1, s(width)))


def label(
    d: ImageDraw.ImageDraw,
    x: float,
    y_center: float,
    text: str,
    color: str,
    bold: bool = False,
    anchor: str = "lm",
) -> None:
    d.text((sx(x), sx(y_center)), text, font=BOLD if bold else REGULAR, fill=color, anchor=anchor)


def pill(d: ImageDraw.ImageDraw, x: float, y: float, w: float, h: float, fill: str, outline: str | None = None) -> None:
    rect(d, x, y, w, h, radius=h / 2, fill=fill, outline=outline, width=1 if outline else 0)


def window(width: float, height: float, title: str = "~/demo", right: str = "session-rail 0.11.0") -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", (s(width), s(height)), WINDOW)
    d = ImageDraw.Draw(img)
    # A rounded top edge is enough to read as a window; the page colour fills
    # the corners so the PNG keeps a plain rectangular shape on GitHub.
    d.rectangle([0, 0, s(width), s(10)], fill=WINDOW)
    for index, color in enumerate(("#ff5f57", "#febc2e", "#28c840")):
        d.ellipse(
            [sx(20 + index * 20), sx(14), sx(20 + index * 20 + 10), sx(24)],
            fill=color,
        )
    label(d, 94, 19, "claude", TEXT, bold=True)
    label(d, 94 + 6.5 * CELL + 10, 19, "—", DIM, bold=True)
    label(d, 94 + 8.5 * CELL + 14, 19, title, DIM)
    label(d, width - 20, 19, right, ACCENT, anchor="rm")
    line(d, 0, 37, width, 37, BORDER)
    return img, d


# ---------------------------------------------------------------- transcript


@dataclass
class TLine:
    kind: str  # user, cont, assistant, tool, result, code, blank
    text: str = ""


def build_lines(prompts: list[Prompt], cells: int = 68) -> tuple[list[TLine], list[int]]:
    lines: list[TLine] = []
    starts: list[int] = []
    for index, prompt in enumerate(prompts):
        starts.append(len(lines))
        wrapped = wrap(prompt.text, cells - 2)
        lines.append(TLine("user", wrapped[0]))
        lines.extend(TLine("cont", part) for part in wrapped[1:])
        reply, tools, code = REPLIES[index] if index < len(REPLIES) else ("", [], [])
        if reply:
            wrapped = wrap(reply, cells - 2)
            lines.append(TLine("assistant", wrapped[0]))
            lines.extend(TLine("cont", part) for part in wrapped[1:])
        for tool, arg, result in tools:
            lines.append(TLine("tool", f"{tool}({arg})"))
            lines.append(TLine("result", result))
        if code:
            lines.extend(TLine("code", part) for part in code)
        lines.append(TLine("blank"))
    return lines, starts


def draw_transcript(
    lines: list[TLine],
    width: float,
    height: float,
    top_line: float,
    cells: int,
    fade: bool = False,
) -> Image.Image:
    img = Image.new("RGB", (s(width), s(height)), WINDOW)
    d = ImageDraw.Draw(img)
    for index, item in enumerate(lines):
        y = (index - top_line) * LINE + LINE / 2
        if y < -LINE or y > height + LINE:
            continue
        if item.kind == "blank":
            continue
        if item.kind == "code":
            rect(d, 2 * CELL, y - LINE / 2, width - 4 * CELL, LINE, fill=PANEL)
            line(d, 2 * CELL, y - LINE / 2, 2 * CELL, y + LINE / 2, ACCENT, 1.5)
            label(d, 3.2 * CELL, y, item.text, CODE)
            continue
        if item.kind == "user":
            label(d, 0, y, ">", ACCENT, bold=True)
            label(d, 2 * CELL, y, cut(item.text, cells - 2), TEXT)
        elif item.kind == "cont":
            label(d, 2 * CELL, y, cut(item.text, cells - 2), TEXT)
        elif item.kind == "assistant":
            d.ellipse([sx(1.5), sx(y - 3.2), sx(1.5 + 6.4), sx(y + 3.2)], fill=ACCENT)
            label(d, 2 * CELL, y, cut(item.text, cells - 2), TEXT)
        elif item.kind == "tool":
            d.ellipse([sx(2.5), sx(y - 2.6), sx(2.5 + 5.2), sx(y + 2.6)], fill=DIM)
            label(d, 4 * CELL, y, cut(item.text, cells - 4), DIM)
        elif item.kind == "result":
            label(d, 4 * CELL, y, cut("└ " + item.text, cells - 4), FAINT)
    if fade:
        # The transcript scrolls under the input well; let the cut line soften
        # instead of ending in half a glyph.
        depth = s(8)
        overlay = Image.new("RGB", img.size, WINDOW)
        mask = Image.new("L", img.size, 0)
        pen = ImageDraw.Draw(mask)
        for offset in range(depth):
            pen.line(
                [(0, img.height - 1 - offset), (img.width, img.height - 1 - offset)],
                fill=int(255 * offset / depth),
            )
        img = Image.composite(overlay, img, mask)
    return img


# ---------------------------------------------------------------------- rail


def tick_color(prompt: Prompt, index: int, current: int) -> tuple[str, bool, bool]:
    """Colour, heavy, dotted for one row's tick."""
    outcome = prompt.turn.outcome
    if outcome == "error":
        return RED, False, False
    if outcome == "interrupted":
        return YELLOW, False, False
    if outcome == "running":
        return GREEN, False, False
    if index == current:
        return ACCENT, True, False
    if prompt.unreachable:
        return GRAY, False, True
    return DIM, False, False


def draw_tick(d: ImageDraw.ImageDraw, x: float, y_center: float, color: str, heavy: bool, dotted: bool) -> None:
    if dotted:
        for offset in (-3.0, 0.0, 3.0):
            rect(d, x + offset - 0.8, y_center - 0.8, 1.6, 1.6, fill=color, radius=0.8)
        return
    w = 10.5 if heavy else 9.0
    h = 3.6 if heavy else 2.2
    rect(d, x - w / 2, y_center - h / 2, w, h, fill=color, radius=h / 2)


def draw_bar(d: ImageDraw.ImageDraw, x_center: float, y_center: float, color: str, heavy: bool, dotted: bool) -> None:
    if dotted:
        for offset in (-5.0, 0.0, 5.0):
            rect(d, x_center - 1, y_center + offset - 1.2, 2, 2.4, fill=color, radius=1)
        return
    w = 4.0 if heavy else 2.0
    rect(d, x_center - w / 2, y_center - 7, w, 14, fill=color, radius=1)


@dataclass
class RailRow:
    index: int
    top: float
    height: float


def rail_rows(entries: list[Prompt], current: int, hover: int | None, width_cells: int, expand: bool) -> list[RailRow]:
    """Rows as they stack, with a hovered row's card counted in."""
    rows: list[RailRow] = []
    top = 0.0
    for index, prompt in enumerate(entries):
        if index > 0 and prompt.break_before:
            rows.append(RailRow(-1, top, LINE))
            top += LINE
        rows.append(RailRow(index, top, LINE))
        top += LINE
        if expand and hover == index:
            lines = 0
            if cut(prompt.text, width_cells) != " ".join(prompt.text.split()):
                lines += len(wrap(prompt.text, width_cells - 3))
            lines += len(wrap(summary(prompt, width_cells - 3), width_cells - 3))
            rows.append(RailRow(-2 - index, top, lines * LINE))
            top += lines * LINE
    return rows


def draw_rail(
    d: ImageDraw.ImageDraw,
    x: float,
    y: float,
    width_cells: int,
    entries: list[Prompt],
    current: int,
    hover: int | None,
    expand: bool = True,
) -> None:
    """The docked vertical rail, one prompt a row, the hovered one expanded."""
    rows = rail_rows(entries, current, hover, width_cells, expand)
    for row in rows:
        if row.index == -1:
            label(d, x + CELL, y + row.top + LINE / 2, "─ compacted ─", ACCENT)
            continue
        if row.index < -1:
            index = -2 - row.index
            prompt = entries[index]
            offset = 0
            if cut(prompt.text, width_cells) != " ".join(prompt.text.split()):
                for part in wrap(prompt.text, width_cells - 3):
                    label(d, x + 3 * CELL, y + row.top + offset * LINE + LINE / 2, part, TEXT)
                    offset += 1
            for part in wrap(summary(prompt, width_cells - 3), width_cells - 3):
                label(d, x + 3 * CELL, y + row.top + offset * LINE + LINE / 2, part, DIM)
                offset += 1
            continue
        index = row.index
        prompt = entries[index]
        color, heavy, dotted = tick_color(prompt, index, current)
        cy = y + row.top + LINE / 2
        if hover == index:
            rect(d, x - 3, y + row.top, (width_cells + 2) * CELL + 6, LINE, fill=INVERSE, radius=3)
            draw_tick(d, x + CELL, cy, INVERSE_TEXT, heavy, dotted)
            label(d, x + 2 * CELL, cy, cut(prompt.text, width_cells), INVERSE_TEXT)
        else:
            draw_tick(d, x + CELL, cy, color, heavy, dotted)
            label(d, x + 2 * CELL, cy, cut(prompt.text, width_cells), TEXT if index == current else DIM)


# ------------------------------------------------------------------ composer


def draw_composer(
    d: ImageDraw.ImageDraw,
    x: float,
    y: float,
    width: float,
    placeholder: str,
    status: bool = True,
    model: str = "haiku · ~/demo",
) -> float:
    """The input well and the hint line under it; returns its bottom."""
    line(d, x, y, x + width, y, BORDER)
    label(d, x + 1.5 * CELL, y + 16, ">", ACCENT, bold=True)
    label(d, x + 3.5 * CELL, y + 16, placeholder, FAINT)
    line(d, x, y + 32, x + width, y + 32, BORDER)
    if status:
        label(d, x + 1.5 * CELL, y + 48, "haiku", DIM)
        label(d, x + 1.5 * CELL + 7 * CELL, y + 48, "·", BORDER)
        label(d, x + 1.5 * CELL + 9 * CELL, y + 48, "~/demo", DIM)
    return y + 64


def draw_mode_line(d: ImageDraw.ImageDraw, x: float, y: float) -> None:
    label(d, x, y, "▶▶", GREEN, bold=True)
    label(d, x + 4 * CELL, y, "auto mode on", TEXT)
    label(d, x + 4 * CELL + 13 * CELL, y, "(shift+tab to cycle)", FAINT)


# --------------------------------------------------------------------- stills


def still_vertical(path: Path) -> None:
    width, height = 1000, 640
    img, d = window(width, height)
    lines, starts = build_lines(PROMPTS, 68)
    top = starts[2]
    transcript_w = 616
    img.paste(
        draw_transcript(lines, transcript_w, 460, top, 68),
        (s(24), s(56)),
    )
    # Dock divider and rail.
    line(d, 650, 44, 650, height - 12, BORDER)
    draw_rail(d, 672, 64, 33, PROMPTS, 2, 1)
    draw_composer(d, 24, 528, transcript_w, "Ask Claude to change something…")
    img.save(path, optimize=True)


def still_horizontal(path: Path) -> None:
    width, height = 1100, 560
    img, d = window(width, height)
    lines, starts = build_lines(PROMPTS, 122)
    top = starts[3] - 2
    img.paste(draw_transcript(lines, 1052, 300, top, 122), (s(24), s(56)))
    # The band: the hovered prompt's card over the bars.
    hover = 3
    prompt = PROMPTS[hover]
    card = f"#{hover + 1} {prompt.text} · {summary(prompt)}"
    label(d, 24, 404, cut(card, 126), TEXT)
    bars_y = 430
    for index, entry in enumerate(PROMPTS):
        color, heavy, dotted = tick_color(entry, index, 2)
        draw_bar(d, 24 + index * CELL + CELL / 2, bars_y, color, heavy, dotted)
    draw_composer(d, 24, 452, 1052, "Ask Claude to change something…")
    img.save(path, optimize=True)


def still_below(path: Path) -> None:
    width, height = 1100, 520
    img, d = window(width, height)
    lines, starts = build_lines(PROMPTS, 122)
    top = starts[3] - 2
    img.paste(draw_transcript(lines, 1052, 300, top, 122), (s(24), s(56)))
    draw_composer(d, 24, 372, 1052, "Ask Claude to change something…", status=False)
    label(d, 24, 420, "haiku", DIM)
    label(d, 24 + 7 * CELL, 420, "·", BORDER)
    label(d, 24 + 9 * CELL, 420, "~/demo", DIM)
    draw_mode_line(d, 24, 440)
    # The rail's own row under the hint line: steps, bars, hovered card.
    hover = 3
    prompt = PROMPTS[hover]
    row_y = 474
    label(d, 24, row_y, "‹", DIM)
    bx = 24 + 2 * CELL
    for index, entry in enumerate(PROMPTS):
        color, heavy, dotted = tick_color(entry, index, 2)
        draw_bar(d, bx + index * CELL + CELL / 2, row_y, color, heavy, dotted)
    label(d, bx + len(PROMPTS) * CELL + CELL / 2, row_y, "›", DIM)
    card_x = bx + (len(PROMPTS) + 2) * CELL
    card = f"#{hover + 1} {prompt.text} · {summary(prompt)}"
    label(d, card_x, row_y, cut(card, 100), TEXT)
    img.save(path, optimize=True)


# ----------------------------------------------------------------------- gifs


DEMO_PROMPTS = [
    Prompt("Explain debounce.ts", Turn("14:02", "8s")),
    Prompt(
        "Add a cancel() method that clears the pending timeout and reports whether it cancelled anything",
        Turn("14:06", "1m 12s", ["src/debounce.ts"]),
    ),
    Prompt("Write tests for cancel()", Turn("14:09", "46s", ["src/debounce.test.ts"])),
    Prompt("Why does it fail on Node 18?", Turn("14:12", "3s", outcome="error")),
    Prompt("Fix the timer typing", Turn("14:15", "21s", ["src/debounce.ts", "src/types.ts"])),
    Prompt("Add a leading-edge option", Turn("14:26", outcome="running"), break_before=True),
]


def ease(value: float) -> float:
    value = min(1.0, max(0.0, value))
    return value * value * (3 - 2 * value)


def pointer(d: ImageDraw.ImageDraw, x: float, y: float, ring: float | None = None) -> None:
    if ring is not None:
        color = ACCENT if ring < 0.6 else BORDER
        d.ellipse([sx(x - 6 - ring * 10), sx(y - 6 - ring * 10), sx(x + 6 + ring * 10), sx(y + 6 + ring * 10)], outline=color, width=s(1.5))
    points = [
        (x, y),
        (x, y + 16),
        (x + 4.2, y + 12),
        (x + 7.4, y + 18.4),
        (x + 10.4, y + 16.9),
        (x + 7.2, y + 10.6),
        (x + 13, y + 10.6),
    ]
    d.polygon([(sx(px), sx(py)) for px, py in points], fill="#f2f3f4", outline="#101114", width=s(1.2))


def frame_page(caption: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    """The 800x500 page: a dark field, the terminal inset, and a caption."""
    page = Image.new("RGB", (s(800), s(500)), PAGE)
    draw = ImageDraw.Draw(page)
    measure = REGULAR.getlength(caption) / SCALE
    w = measure + 36
    x = (800 - w) / 2
    y = 464
    pill(draw, x, y, w, 26, "#24262c", "#3a3d44")
    label(draw, 400, y + 13, caption, TEXT, anchor="mm")
    return page, draw


def demo_frame(
    current: int,
    hover: int | None,
    top: float,
    pointer_at: tuple[float, float] | None,
    ring: float | None,
    caption: str,
) -> Image.Image:
    page, _ = frame_page(caption)
    win, d = window(768, 420, title="~/demo")
    lines, _ = build_lines(DEMO_PROMPTS, 54)
    win.paste(draw_transcript(lines, 470, 260, top, 54), (s(20), s(50)))
    line(d, 482, 44, 482, 410, BORDER)
    draw_rail(d, 500, 50, 26, DEMO_PROMPTS, current, hover)
    draw_composer(d, 20, 344, 470, "Ask Claude to change something…", status=False)
    draw_mode_line(d, 20, 386)
    if pointer_at is not None:
        pointer(d, pointer_at[0], pointer_at[1], ring)
    page.paste(win, (s(16), s(14)))
    return page


def make_demo(path: Path) -> None:
    lines, starts = build_lines(DEMO_PROMPTS, 54)
    del lines
    frames: list[Image.Image] = []
    total = 60
    start = starts[2]
    end = starts[1]
    # Row centres: the second row is fixed; the fifth only moves when a card is open.
    row_two = 50 + LINE / 2 + LINE
    row_five = 50 + LINE / 2 + 4 * LINE
    origin = (700, 390)
    click_at = (570, row_two)
    for frame in range(total):
        if frame <= 7:
            t = ease(frame / 7)
            at = (origin[0] + (click_at[0] - origin[0]) * t, origin[1] + (click_at[1] - origin[1]) * t)
            hover, current, top, ring = None, 2, start, None
        elif frame <= 22:
            at, hover, current, top = click_at, 1, 2, start
            ring = (frame - 19) / 4 if 19 <= frame <= 22 else None
        elif frame <= 34:
            t = ease((frame - 23) / 11)
            at, hover, current, top, ring = click_at, None, 1, start + (end - start) * t, None
        elif frame <= 42:
            at, hover, current, top, ring = click_at, None, 1, end, None
        else:
            t = ease((frame - 42) / 7)
            target = (570, row_five)
            at = (click_at[0] + (target[0] - click_at[0]) * t, click_at[1] + (target[1] - click_at[1]) * t)
            hover, current, top, ring = (4 if frame >= 49 else None), 1, end, None
        caption = "hover to read a prompt  ·  click to jump"
        frames.append(demo_frame(current, hover, top, at, ring, caption))
    save_gif(frames, path)


def make_below(path: Path) -> None:
    frames: list[Image.Image] = []
    lines, starts = build_lines(DEMO_PROMPTS, 84)
    del lines
    start = starts[2]
    end = starts[3]
    bx = 22 + 2 * CELL
    target_four = bx + 3 * CELL + CELL / 2
    target_two = bx + 1 * CELL + CELL / 2
    row_y = 358
    for frame in range(60):
        hover = None
        current = 2
        top = start
        at = None
        ring = None
        if frame <= 7:
            t = ease(frame / 7)
            at = (600 + (target_four - 600) * t, 392 + (row_y - 392) * t)
        elif frame <= 16:
            hover, at = 3, (target_four, row_y)
        elif frame <= 20:
            hover, at = 3, (target_four, row_y)
            ring = (frame - 16) / 4
        elif frame <= 32:
            t = ease((frame - 20) / 12)
            current, top, at = 3, start + (end - start) * t, (target_four, row_y)
        elif frame <= 41:
            current, top, at = 3, end, (target_four, row_y)
        else:
            t = ease((frame - 41) / 7)
            at = (target_four + (target_two - target_four) * t, row_y)
            current, top = 3, end
            hover = 1 if frame >= 48 else None
        frames.append(below_frame(current, hover, top, at, ring))
    save_gif(frames, path)


def below_frame(current: int, hover: int | None, top: float, pointer_at: tuple[float, float] | None, ring: float | None) -> Image.Image:
    page, _ = frame_page("below: the rail under the hint line  ·  hover, click or step")
    win, d = window(768, 420)
    lines, _ = build_lines(DEMO_PROMPTS, 84)
    win.paste(draw_transcript(lines, 720, 160, top, 84), (s(20), s(48)))
    draw_composer(d, 20, 236, 720, "Ask Claude to change something…", status=False)
    label(d, 22, 302, "haiku", DIM)
    label(d, 22 + 7 * CELL, 302, "·", BORDER)
    label(d, 22 + 9 * CELL, 302, "~/demo", DIM)
    draw_mode_line(d, 22, 322)
    row_y = 358
    label(d, 22, row_y, "‹", DIM)
    bx = 22 + 2 * CELL
    for index, prompt in enumerate(DEMO_PROMPTS):
        color, heavy, dotted = tick_color(prompt, index, current)
        draw_bar(d, bx + index * CELL + CELL / 2, row_y, color, heavy, dotted)
    label(d, bx + len(DEMO_PROMPTS) * CELL + CELL / 2, row_y, "›", DIM)
    card_x = bx + (len(DEMO_PROMPTS) + 2) * CELL
    if hover is None:
        prompt = DEMO_PROMPTS[current]
        label(d, card_x, row_y, f"#{current + 1}/{len(DEMO_PROMPTS)} {cut(prompt.text, 60)}", DIM)
    else:
        prompt = DEMO_PROMPTS[hover]
        card = f"#{hover + 1} {prompt.text} · {summary(prompt)}"
        label(d, card_x, row_y, cut(card, 62), TEXT)
    if pointer_at is not None:
        pointer(d, pointer_at[0], pointer_at[1], ring)
    page.paste(win, (s(16), s(14)))
    return page


def save_gif(frames: list[Image.Image], path: Path) -> None:
    # Published at half the drawing scale: 800x500 keeps the file small while
    # the 2x source makes the text edges hold up.
    small = [frame.convert("RGB").resize((800, 500), Image.Resampling.LANCZOS) for frame in frames]
    palette = [frame.convert("P", palette=Image.Palette.ADAPTIVE, colors=128) for frame in small]
    palette[0].save(
        path,
        save_all=True,
        append_images=palette[1:],
        duration=80,
        loop=0,
        optimize=True,
        disposal=2,
    )


def main() -> None:
    wanted = set(sys.argv[1:])
    jobs = {
        "vertical": (still_vertical, HERE / "vertical.png"),
        "horizontal": (still_horizontal, HERE / "horizontal.png"),
        "below": (still_below, HERE / "below.png"),
        "demo": (make_demo, HERE / "demo.gif"),
        "below-gif": (make_below, HERE / "below.gif"),
    }
    for name, (run, path) in jobs.items():
        if wanted and name not in wanted:
            continue
        print(f"{name}: {path.name}")
        run(path)


if __name__ == "__main__":
    main()
