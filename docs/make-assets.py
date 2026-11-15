#!/usr/bin/env python3
"""Draw session-rail's README pictures from code.

Every PNG and GIF in this folder is generated here, so a UI change can be
reflected by running this file instead of re-capturing a terminal. The scenes
are drawn at SCALE times the size the README shows, with Menlo as the terminal
face, and published at that scale so the text stays crisp on a 2x display.

    python3 docs/make-assets.py            # all of them
    python3 docs/make-assets.py vertical   # one, while iterating

The rail glyphs are drawn as little rules rather than text: a terminal font
leaves gaps between box-drawing characters, and the rail reads better without
them. Requires Pillow.
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
# The release the pictures name, read from the plugin so bumping the version
# redraws them without a second edit here.
VERSION = json.loads((HERE.parent / "plugins/session-rail/.claude-plugin/plugin.json").read_text())["version"]

# Terminal grid. Coordinates in this file are logical pixels (the size the
# README shows); everything is drawn at SCALE times that and published at that
# scale, stills and GIFs alike.
SCALE = 2
CELL = 8.5
LINE = 20.0
FONT_SIZE = 28
MENLO = "/System/Library/Fonts/Menlo.ttc"

REGULAR = ImageFont.truetype(MENLO, FONT_SIZE, index=0)
BOLD = ImageFont.truetype(MENLO, FONT_SIZE, index=1)

# The banner is not a terminal scene: it is drawn once for the README's head,
# so its type is larger than a row's and is kept in its own faces.
BANNER_TITLE = ImageFont.truetype(MENLO, 72, index=1)
BANNER_SUB = ImageFont.truetype(MENLO, 28, index=0)
BANNER_SMALL = ImageFont.truetype(MENLO, 22, index=0)
BANNER_CHIP = ImageFont.truetype(MENLO, 20, index=0)
BANNER_META = ImageFont.truetype(MENLO, 18, index=0)

BG = "#1a1b1e"
WINDOW = "#1b1c20"
PANEL = "#202126"
BORDER = "#303339"
TEXT = "#d7d8da"
# A rail row's ordinary text, as the plugin's theme.ts paints it.
RAIL_TEXT = "#D4D0CB"
DIM = "#8b8e94"
FAINT = "#5f636b"
# Claude's own accent, rgb(215,119,87), the `claude` theme key's dark colour.
ACCENT = "#d77757"
# The pane's times: the conversation's start and each resume line.
TIME = ACCENT
GREEN = "#4eba65"
YELLOW = "#e5c07b"
RED = "#f07171"
GRAY = "#6c7078"
CODE = "#c7c9cc"
# The hover panel's colours, as the plugin's dark defaults paint them: a warm
# neutral behind the row's body text for chrome, a bright highlight for the
# prompt, and a lighter tint of the accent for the pinned stats line.
CARD_BG = "#3A3531"
CARD_TEXT = RAIL_TEXT
# A hover card's prompt and hovered row take a highlight brighter than body
# text; its stats line takes the accent tint, so the prompt stays the card's
# brightest line.
CARD_PROMPT = "#FFFFFF"
ACCENT_ON_CARD = "#E6A182"
PAGE = "#111216"

# The light palette, as theme.ts draws it on a light terminal: the warm white
# page, its body text, and the same orange accent taken deeper so it reads.
LIGHT_WINDOW = "#FAF9F5"
LIGHT_PANEL = "#ECE9E1"
LIGHT_BORDER = "#D8D4CA"
LIGHT_TEXT = "#3D3A35"
LIGHT_RAIL_TEXT = "#35312D"
LIGHT_DIM = "#736E66"
LIGHT_FAINT = "#A9A39A"
LIGHT_ACCENT = "#9E4422"
LIGHT_CODE = "#4B4741"
# A light card's prompt and hovered row take black, brighter than body text.
LIGHT_CARD_PROMPT = "#000000"


@dataclass(frozen=True)
class Skin:
    """The terminal's own colors: the page, its rows, and the Chrome around
    them. The rail's card panel is not a skin; it comes from the card theme."""

    window: str
    panel: str
    border: str
    text: str
    rail_text: str
    dim: str
    faint: str
    accent: str
    code: str


DARK_SKIN = Skin(WINDOW, PANEL, BORDER, TEXT, RAIL_TEXT, DIM, FAINT, ACCENT, CODE)
LIGHT_SKIN = Skin(
    LIGHT_WINDOW,
    LIGHT_PANEL,
    LIGHT_BORDER,
    LIGHT_TEXT,
    LIGHT_RAIL_TEXT,
    LIGHT_DIM,
    LIGHT_FAINT,
    LIGHT_ACCENT,
    LIGHT_CODE,
)


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


def stats_sentence(prompt: Prompt) -> str:
    """The pane card's stats as the plugin writes them: one sentence."""
    turn = prompt.turn
    lead = f"At {turn.sent}" if turn.sent else ""

    def join(tail: str) -> str:
        if not lead:
            return tail
        return f"{lead}, {tail}" if tail else lead

    if turn.outcome == "running":
        return join("still running")
    took = f"ran {turn.duration}" if turn.duration else ""
    if turn.outcome == "interrupted":
        return join(f"{took} and was interrupted" if took else "was interrupted")
    if turn.outcome == "error":
        return join(f"{took} and ended with an API error" if took else "ended with an API error")
    names = [Path(path).name for path in turn.files]
    if not names:
        changed = ""
    elif len(names) == 1:
        changed = f"changed {names[0]}"
    elif len(names) == 2:
        changed = f"changed {names[0]} and {names[1]}"
    else:
        changed = f"changed {len(names)} files"
    if took and changed:
        return join(f"{took} and {changed}")
    return join(took or changed)


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


def panel_label(
    d: ImageDraw.ImageDraw,
    x: float,
    y_center: float,
    text: str,
    color: str = CARD_PROMPT,
    width: float | None = None,
) -> None:
    """A band card's line on its panel, bold, its background behind it."""
    w = width if width is not None else REGULAR.getlength(text) / SCALE + CELL
    rect(d, x - CELL / 2, y_center - LINE / 2, w, LINE, fill=CARD_BG)
    label(d, x, y_center, text, color, bold=True)


def pill(d: ImageDraw.ImageDraw, x: float, y: float, w: float, h: float, fill: str, outline: str | None = None) -> None:
    rect(d, x, y, w, h, radius=h / 2, fill=fill, outline=outline, width=1 if outline else 0)


def window(
    width: float,
    height: float,
    title: str = "~/demo",
    right: str = f"session-rail {VERSION}",
    skin: Skin = DARK_SKIN,
) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", (s(width), s(height)), skin.window)
    d = ImageDraw.Draw(img)
    # A rounded top edge is enough to read as a window; the page colour fills
    # the corners so the PNG keeps a plain rectangular shape on GitHub.
    d.rectangle([0, 0, s(width), s(10)], fill=skin.window)
    for index, color in enumerate(("#ff5f57", "#febc2e", "#28c840")):
        d.ellipse(
            [sx(20 + index * 20), sx(14), sx(20 + index * 20 + 10), sx(24)],
            fill=color,
        )
    label(d, 94, 19, "claude", skin.text, bold=True)
    label(d, 94 + 6.5 * CELL + 10, 19, "—", skin.dim, bold=True)
    label(d, 94 + 8.5 * CELL + 14, 19, title, skin.dim)
    label(d, width - 20, 19, right, skin.accent, anchor="rm")
    line(d, 0, 37, width, 37, skin.border)
    return img, d


# ---------------------------------------------------------------- transcript


@dataclass
class TLine:
    kind: str  # user, cont, assistant, tool, result, code, blank
    text: str = ""


def build_lines(
    prompts: list[Prompt],
    cells: int = 68,
    replies: list[tuple[str, list[tuple[str, str, str]], list[str]]] = REPLIES,
) -> tuple[list[TLine], list[int]]:
    lines: list[TLine] = []
    starts: list[int] = []
    for index, prompt in enumerate(prompts):
        starts.append(len(lines))
        wrapped = wrap(prompt.text, cells - 2)
        lines.append(TLine("user", wrapped[0]))
        lines.extend(TLine("cont", part) for part in wrapped[1:])
        reply, tools, code = replies[index] if index < len(replies) else ("", [], [])
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
    skin: Skin = DARK_SKIN,
) -> Image.Image:
    img = Image.new("RGB", (s(width), s(height)), skin.window)
    d = ImageDraw.Draw(img)
    for index, item in enumerate(lines):
        y = (index - top_line) * LINE + LINE / 2
        if y < -LINE or y > height + LINE:
            continue
        if item.kind == "blank":
            continue
        if item.kind == "code":
            rect(d, 2 * CELL, y - LINE / 2, width - 4 * CELL, LINE, fill=skin.panel)
            line(d, 2 * CELL, y - LINE / 2, 2 * CELL, y + LINE / 2, skin.accent, 1.5)
            label(d, 3.2 * CELL, y, item.text, skin.code)
            continue
        if item.kind == "user":
            label(d, 0, y, ">", skin.accent, bold=True)
            label(d, 2 * CELL, y, cut(item.text, cells - 2), skin.text)
        elif item.kind == "cont":
            label(d, 2 * CELL, y, cut(item.text, cells - 2), skin.text)
        elif item.kind == "assistant":
            d.ellipse([sx(1.5), sx(y - 3.2), sx(1.5 + 6.4), sx(y + 3.2)], fill=skin.accent)
            label(d, 2 * CELL, y, cut(item.text, cells - 2), skin.text)
        elif item.kind == "tool":
            d.ellipse([sx(2.5), sx(y - 2.6), sx(2.5 + 5.2), sx(y + 2.6)], fill=skin.dim)
            label(d, 4 * CELL, y, cut(item.text, cells - 4), skin.dim)
        elif item.kind == "result":
            label(d, 4 * CELL, y, cut("└ " + item.text, cells - 4), skin.faint)
    if fade:
        # The transcript scrolls under the input well; let the cut line soften
        # instead of ending in half a glyph.
        depth = s(8)
        overlay = Image.new("RGB", img.size, skin.window)
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


def tick_color(
    prompt: Prompt,
    index: int,
    current: int,
    accent: str = ACCENT,
) -> tuple[str, bool, bool]:
    """Colour, heavy, dotted for one row's tick."""
    outcome = prompt.turn.outcome
    if outcome == "error":
        return RED, False, False
    if outcome == "interrupted":
        return YELLOW, False, False
    if outcome == "running":
        return GREEN, False, False
    if index == current:
        return accent, True, False
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


# The pane opens with when the conversation started; the list stacks under it.
START_STAMP = "2026-09-24 14:01:58"
HEAD_ROWS = 1


def short_stamp(stamp: str) -> str:
    """`2026-09-24 14:01:58` -> `09-24 14:01`, the heading's short stamp."""
    return stamp[5:16] if len(stamp) >= 16 else stamp


def rail_rows(entries: list[Prompt], current: int, hover: int | None, width_cells: int, expand: bool) -> list[RailRow]:
    """Rows as they stack: a hover card floats over them and moves none."""
    rows: list[RailRow] = []
    top = HEAD_ROWS * LINE
    for index, prompt in enumerate(entries):
        if index > 0 and prompt.break_before:
            rows.append(RailRow(-1, top, LINE))
            top += LINE
        rows.append(RailRow(index, top, LINE))
        top += LINE
    return rows


SPINNER_DOTS = {(0, 0), (1, 0), (1, 1), (1, 2)}


def draw_spinner(d: ImageDraw.ImageDraw, x: float, y_center: float) -> None:
    """A running turn's tick spins in place; the stills catch one frame (⠹).
    Drawn as dots because the terminal face has no Braille glyphs."""
    for column in range(2):
        for row in range(4):
            if (column, row) not in SPINNER_DOTS:
                continue
            cx = x - 1.8 + column * 3.6
            cy = y_center - 4.7 + row * 3.1
            d.ellipse(
                [sx(cx - 0.95), sx(cy - 0.95), sx(cx + 0.95), sx(cy + 0.95)],
                fill=GREEN,
            )


def card_lines(prompt: Prompt, width_cells: int, whole: bool) -> list[tuple[str, bool]]:
    """The card's lines: the prompt's rest (or its whole text), a blank panel
    line, and the stats sentence, wrapped to leave the scrollbar a column."""
    card_cells = max(8, width_cells - 3)
    if whole:
        body = wrap(" ".join(prompt.text.split()), card_cells)
    else:
        flat = " ".join(prompt.text.split())
        head = cut(flat, width_cells - 1)
        rest = flat[len(head[:-1]):].lstrip() if head.endswith("…") else ""
        body = wrap(rest, card_cells) if rest else []
    stats = wrap(stats_sentence(prompt), card_cells)
    lines: list[tuple[str, bool]] = [(part, False) for part in body]
    if lines and stats:
        lines.append(("", False))
    lines += [(part, True) for part in stats]
    return lines


def draw_rail(
    d: ImageDraw.ImageDraw,
    x: float,
    y: float,
    width_cells: int,
    entries: list[Prompt],
    current: int,
    hover: int | None,
    expand: bool = True,
    rows: int | None = None,
    offset: int = 0,
    pulse: int | None = None,
    skin: Skin = DARK_SKIN,
    accent: str = ACCENT,
    card_bg: str = CARD_BG,
    card_prompt: str = CARD_PROMPT,
    card_text: str = CARD_TEXT,
    accent_on_card: str = ACCENT_ON_CARD,
) -> None:
    """The docked vertical rail, one prompt a row, the hovered one expanded.

    With `rows`, the pane's body height, a card too tall for the room beside
    its row becomes a window with a scrollbar, and a card that opens above its
    row blanks it; the card shows the whole prompt from its first line.

    The colours default to the rail's dark palette; the theme painter passes a
    family's panel and accents so the same drawing can stand for each one.
    """
    stack = rail_rows(entries, current, hover, width_cells, expand)
    hover_row = next((row for row in stack if row.index == hover), None)

    # The pane's head: the conversation's own block, its start time flush with
    # the pane's right edge as every block heading's is. It starts at the text
    # column, as the resume and compacted lines do, so a card opening above
    # covers it whole.
    label(d, x + 3 * CELL, y + LINE / 2, "current session", accent)
    label(d, x + (width_cells + 2) * CELL, y + LINE / 2, short_stamp(START_STAMP), accent, anchor="rm")

    # Where the card opens, mirroring the plugin's cardFit.
    lines: list[tuple[str, bool]] = []
    side = "below"
    window = 0
    if hover_row is not None and hover is not None:
        row_top = int(round(hover_row.top / LINE))
        below_space = max(0, rows - row_top - 1) if rows is not None else 10**6
        above_space = row_top if rows is not None else 0
        probe = card_lines(entries[hover], width_cells, whole=False)
        side = "below"
        window = len(probe)
        if rows is not None:
            if len(probe) <= below_space:
                side, window = "below", len(probe)
            elif len(probe) <= above_space:
                side, window = "above", len(probe)
            elif above_space >= below_space:
                side, window = "above", above_space
            else:
                side, window = "below", below_space
        whole = side == "above"
        lines = probe if not whole else card_lines(entries[hover], width_cells, whole=True)

    blank_hover = hover_row is not None and side == "above"

    for row in stack:
        if row.index == -1:
            label(d, x + 3 * CELL, y + row.top + LINE / 2, "compacted", accent)
            continue
        index = row.index
        prompt = entries[index]
        cy = y + row.top + LINE / 2
        if hover == index:
            # The row and the card share one panel. A card that opens above
            # carries the whole prompt, so the row itself goes blank.
            rect(d, x - 3, y + row.top, (width_cells + 2) * CELL + 6, LINE, fill=card_bg, radius=3)
            if blank_hover:
                continue
            if prompt.turn.outcome == "running":
                draw_spinner(d, x + CELL, cy)
            else:
                color, heavy, dotted = tick_color(prompt, index, current, accent=accent)
                draw_tick(d, x + CELL, cy, color, heavy, dotted)
            # The row's cut mark is hidden while its card continues it.
            text = cut(prompt.text, width_cells - 1)
            if text.endswith("…"):
                text = text[:-1]
            label(d, x + 3 * CELL, cy, text, card_text, bold=True)
        elif pulse == index:
            # A jump briefly inverts the row it landed on.
            rect(d, x - 3, y + row.top, (width_cells + 2) * CELL + 6, LINE, fill=TEXT, radius=3)
            draw_tick(d, x + CELL, cy, WINDOW, True, False)
            label(d, x + 3 * CELL, cy, cut(prompt.text, width_cells - 1), WINDOW, bold=True)
        else:
            if prompt.turn.outcome == "running":
                draw_spinner(d, x + CELL, cy)
            else:
                color, heavy, dotted = tick_color(prompt, index, current, accent=accent)
                draw_tick(d, x + CELL, cy, color, heavy, dotted)
            label(d, x + 3 * CELL, cy, cut(prompt.text, width_cells - 1), skin.rail_text if index == current else skin.dim, bold=index == current)

    if hover_row is None or hover is None or window <= 0:
        return
    # The card floats beside its row: covered rows are not pushed, and a
    # window shows one screen of lines with a scrollbar on the right edge.
    # The stats are pinned at the card's foot; only the prompt above them is a
    # window, as the plugin's cardAllot shares the room.
    stats = [line for line in lines if line[1]]
    prompt_lines = lines[: len(lines) - len(stats)] if stats else lines
    while stats and prompt_lines and prompt_lines[-1][0] == "":
        prompt_lines = prompt_lines[:-1]
    total = len(prompt_lines)
    # As the plugin's cardAllot shares the room: stats first, then the blank
    # line when a prompt row and the gap both fit, then the prompt's window.
    gap = 1 if prompt_lines and stats and window - len(stats) >= 2 else 0
    shown = max(0, window - len(stats) - gap)
    first = max(0, min(offset, max(0, total - shown)))
    card_x = x + 3 * CELL
    card_w = (width_cells - 1) * CELL + 6
    drawn: list[tuple[str, bool]] = list(prompt_lines[first:first + shown])
    if shown and stats:
        drawn.append(("", False))
    drawn += stats
    drawn = drawn[:window]
    height = len(drawn)
    card_top = y + hover_row.top + LINE if side == "below" else y + hover_row.top - height * LINE
    for row_index, (text, is_stats) in enumerate(drawn):
        top = card_top + row_index * LINE
        rect(d, card_x, top, card_w, LINE, fill=card_bg)
        label(d, card_x + CELL / 2, top + LINE / 2, text, accent_on_card if is_stats else card_prompt, bold=not is_stats)
    if shown > 0 and total > shown:
        # The terminal's scrollbar, over the scrolling prompt alone.
        track_x = card_x + card_w - CELL / 2
        rect(d, track_x - 0.8, card_top + 1, 1.6, shown * LINE - 2, fill=skin.faint)
        thumb_h = max(1, round(shown * shown / total))
        thumb_top = round((shown - thumb_h) * first / max(1, total - shown))
        rect(d, track_x - 2, card_top + thumb_top * LINE + 1, 4, thumb_h * LINE - 2, fill=card_text, radius=2)


# ------------------------------------------------------ pane rows and blocks


@dataclass
class PaneRow:
    """One row of the pane as the plugin draws it: a plain prompt row, a block
    heading with its session's start time, the load button, or one of the
    rail's own lines. The hover cards are not part of this view."""

    kind: str  # head, heading, resume, compacted, load, prompt
    text: str = ""
    time: str = ""
    index: int = -1
    prompt: Prompt | None = None
    accent: bool = False
    spinner: bool = False


# Menlo has no U+29C9, which the plugin prints after a parent session's id, so
# the pictures draw the mark as two offset page outlines in the accent.
COPY_MARK = "⧉"


def draw_copy_mark(d: ImageDraw.ImageDraw, x: float, y_center: float, color: str) -> None:
    rect(d, x, y_center - 2.6, 4.4, 5.8, outline=color, width=1)
    rect(d, x + 2.4, y_center - 4.8, 4.4, 5.8, outline=color, width=1)


def pane_head(start: str = START_STAMP) -> PaneRow:
    return PaneRow("head", "current session", short_stamp(start))


def pane_heading(text: str, time: str = "", accent: bool = False) -> PaneRow:
    return PaneRow("heading", text, time, accent=accent)


def pane_resume(stamp: str) -> PaneRow:
    return PaneRow("resume", stamp)


def pane_prompt(entries: list[Prompt], index: int, spinner: bool = False) -> PaneRow:
    return PaneRow("prompt", index=index, prompt=entries[index], spinner=spinner)


def draw_pane(
    d: ImageDraw.ImageDraw,
    x: float,
    y: float,
    cells: int,
    rows: list[PaneRow],
    current: int = -1,
    skin: Skin = DARK_SKIN,
    accent: str | None = None,
    max_rows: int | None = None,
    pressed: int | None = None,
) -> None:
    """The docked pane's rows, as the plugin stacks them.

    A block heading puts its session's short start time flush with the pane's
    right edge, so several blocks' times line up down the rail. The load row is
    a primary button: a filled band around its label. With `max_rows`, the
    pane's own window keeps the newest rows, as it does while a long list is
    scrolled to the prompt being read.
    """
    accent = accent if accent is not None else skin.accent
    first = 0
    if max_rows is not None and len(rows) > max_rows:
        first = len(rows) - max_rows
    right = x + (cells + 2) * CELL
    for row_index, row in enumerate(rows[first:], start=first):
        cy = y + (row_index - first) * LINE + LINE / 2
        top = y + (row_index - first) * LINE
        if row.kind == "head":
            # The conversation's own block: the label at the text column and
            # the start time flush with the pane's right edge.
            label(d, x + 3 * CELL, cy, row.text, accent)
            if row.time:
                label(d, right, cy, row.time, accent, anchor="rm")
        elif row.kind == "heading":
            color = accent if row.accent else skin.dim
            text = row.text
            copy = text.endswith(COPY_MARK)
            if copy:
                text = text[: -len(COPY_MARK)].rstrip()
            label(d, x + 3 * CELL, cy, cut(text, cells - 3), color, bold=row.accent)
            if copy:
                text_w = REGULAR.getlength(cut(text, cells - 3)) / SCALE
                draw_copy_mark(d, x + 3 * CELL + text_w + 4, cy, color)
            if row.time:
                label(d, right, cy, row.time, color, anchor="rm")
        elif row.kind == "resume":
            label(d, x + 3 * CELL, cy, f"resumed at {row.time or row.text}", accent)
        elif row.kind == "compacted":
            label(d, x + 3 * CELL, cy, "compacted", accent)
        elif row.kind == "load":
            # A primary button: the terminal brackets its label in the accent.
            held = pressed == row_index
            text = cut(row.text, cells - 3)
            label(d, x + 3 * CELL, cy, "[", accent, bold=True)
            label(d, x + 3 * CELL + 1.4 * CELL, cy, text, skin.rail_text, bold=True)
            text_w = REGULAR.getlength(text) / SCALE
            label(d, x + 3 * CELL + 1.4 * CELL + text_w + CELL / 2, cy, "]", accent, bold=True)
            if held:
                line(d, x + 3 * CELL, top + LINE - 3, x + 3 * CELL + 2.4 * CELL + text_w, top + LINE - 3, accent, 1.5)
        elif row.kind == "prompt":
            prompt = row.prompt
            assert prompt is not None
            if row.spinner:
                draw_spinner(d, x + CELL, cy)
            else:
                color, heavy, dotted = tick_color(prompt, row.index, current, accent=accent)
                draw_tick(d, x + CELL, cy, color, heavy, dotted)
            if row.index == current:
                color = accent
            elif prompt.unreachable:
                color = skin.dim
            else:
                color = skin.rail_text
            label(
                d,
                x + 3 * CELL,
                cy,
                cut(prompt.text, cells - 1),
                color,
                bold=row.index == current,
            )


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
    panel_label(d, 24, 404, cut(card, 126), width=1052)
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
    panel_label(d, card_x, row_y, cut(card, 100), width=1076 - card_x)
    img.save(path, optimize=True)


SHORT_PROMPTS = [
    "Explain what src/debounce.ts does",
    "Add a cancel() method that clears the pending timeout",
    "Write tests for cancel() with and without a pending call",
    "Why does the test fail on Node 18?",
    "Fix the timer typing for Node and browsers",
    "Run the suite and update the README example",
    "Now add a leading-edge option",
    "Why is the trailing call skipped when wait is 0?",
    "Document the return value of the wrapped function",
    "Add a flush() method that runs the pending call now",
    "Check that cancel() after flush() is a no-op",
    "Cover the case where the timer handle is a number",
    "Simplify the option parsing with a defaults object",
    "Add a changeset and bump the minor version",
    "Run typecheck, the suite and the formatter",
    "Write the release notes for 0.13",
]

LONG_PROMPT = (
    "Walk me through the debounce helper end to end: how the timer is typed so it works in both "
    "Node and the browser, why every call replaces the pending timer instead of queueing, what "
    "cancel() and flush() should report when nothing is pending, and which tests cover the leading "
    "edge, the trailing edge and the wait between them. Then update the README example so it shows "
    "the default wait, the option names, and the return value callers can rely on. Finish by running "
    "the suite and listing any behavior that changes for code that passes its own timer handle, "
    "including the cases where clearTimeout is unavailable or returns nothing."
)

# The theme preview's eleven families, as the plugin's dark side paints them:
# the paper, and the accent tint its stats sample takes. The warm families and
# the status-adjacent ones use the orange card tint; the cool and purple ones
# their own accent.
PREVIEW_FAMILIES = [
    ("warm-taupe", "#3A3531", ACCENT_ON_CARD),
    ("warm-charcoal", "#332F2C", ACCENT_ON_CARD),
    ("sienna", "#3A2D28", ACCENT_ON_CARD),
    ("mauve", "#342E31", "#D8A8C4"),
    ("teal", "#1E3438", "#5CC8CC"),
    ("indigo", "#282F45", "#93A2E8"),
    ("burgundy", "#3A2227", ACCENT_ON_CARD),
    ("olive", "#2F321F", ACCENT_ON_CARD),
    ("plum", "#34243C", "#C08ADB"),
    ("ochre", "#3A3018", ACCENT_ON_CARD),
    ("slate", "#2A2E33", "#9DB4D6"),
]


PREVIEW_FAMILIES_LIGHT = [
    ("warm-taupe", "#E8E1D8", LIGHT_ACCENT),
    ("warm-charcoal", "#E5DED6", LIGHT_ACCENT),
    ("sienna", "#EBDDD4", LIGHT_ACCENT),
    ("mauve", "#E5DDE0", "#7A3A62"),
    ("teal", "#D8E8E5", "#0E6A70"),
    ("indigo", "#DEE3F4", "#3A4FA3"),
    ("burgundy", "#F1DEE3", LIGHT_ACCENT),
    ("olive", "#E5E7D3", LIGHT_ACCENT),
    ("plum", "#EBE0F3", "#6E3F9E"),
    ("ochre", "#F3E8D0", LIGHT_ACCENT),
    ("slate", "#DEE2E6", "#3F5A7A"),
]


def preview_scene(
    path: Path,
    families: list[tuple[str, str, str]],
    skin: Skin,
    side: str,
) -> None:
    """The theme preview pane: each family sampled as prompt and stats text on
    its own paper, the family in use marked, no color values printed. The
    samples take the side the palette is drawn on: white on a dark panel,
    black on a light one."""
    width, height = 1100, 580
    img, d = window(width, height, skin=skin)
    lines, starts = build_lines(PROMPTS, 42)
    img.paste(
        draw_transcript(lines, 360, 430, starts[2], 42, fade=True, skin=skin),
        (s(24), s(56)),
    )
    # The pane's divider: the preview docks beside the transcript.
    line(d, 410, 44, 410, height - 12, skin.border)
    x = 432
    y = 76
    label(d, x, y, f"Card themes · warm-taupe · {side} side", skin.rail_text, bold=True)
    y += 2 * LINE
    prompt = " Fix the flaky test "
    stats = " · At 12:57, 2m 30s "
    prompt_color = CARD_PROMPT if skin is DARK_SKIN else LIGHT_CARD_PROMPT
    prompt_w = REGULAR.getlength(prompt) / SCALE
    stats_w = REGULAR.getlength(stats) / SCALE
    sample_x = x + 17 * CELL
    for index, (name, paper, tint) in enumerate(families):
        current = index == 0
        label(d, x, y, "●" if current else " ", skin.accent, bold=current)
        label(d, x + 2 * CELL, y, name.ljust(15), skin.rail_text, bold=current)
        rect(d, sample_x - CELL / 2, y - LINE / 2 + 2, prompt_w + stats_w + CELL, LINE - 4, fill=paper)
        label(d, sample_x, y, prompt, prompt_color, bold=True)
        label(d, sample_x + prompt_w, y, stats, tint)
        y += LINE
    y += LINE
    label(d, x, y, "Pick one at /config › Card theme. Esc closes this.", skin.rail_text)
    img.save(path, optimize=True)


def still_preview(path: Path) -> None:
    """The eleven families on their dark panels."""
    preview_scene(path, PREVIEW_FAMILIES, DARK_SKIN, "dark")


def still_preview_light(path: Path) -> None:
    """The same eleven on their light panels, the side a light theme draws."""
    preview_scene(path, PREVIEW_FAMILIES_LIGHT, LIGHT_SKIN, "light")


CARD_SCENE = [
    Prompt(text, Turn(f"14:{2 + index:02d}", f"{6 + index * 3}s"))
    for index, text in enumerate(SHORT_PROMPTS)
] + [
    Prompt(LONG_PROMPT, Turn("15:02", "3m 08s", ["src/debounce.ts", "README.md"])),
    Prompt("Also document the flush() option", Turn("15:09", "34s", ["README.md"])),
    Prompt("Run the release checks", Turn("15:11", "18s")),
]
CARD_INDEX = len(SHORT_PROMPTS)


def still_card_above(path: Path) -> None:
    """A card taller than the room below opens above its row: the whole prompt
    from line one, the row blank, and a scrollbar for the lines past the window."""
    width, height = 1000, 640
    img, d = window(width, height)
    lines, starts = build_lines(CARD_SCENE, 68)
    img.paste(
        draw_transcript(lines, 616, 460, starts[CARD_INDEX] - 4, 68),
        (s(24), s(56)),
    )
    line(d, 650, 44, 650, height - 12, BORDER)
    draw_rail(d, 672, 64, 33, CARD_SCENE, CARD_INDEX, CARD_INDEX, rows=23)
    draw_composer(d, 24, 528, 616, "Ask Claude to change something…")
    img.save(path, optimize=True)


# ------------------------------------------------- long, resumed, continued


NO_REPLY: tuple[str, list[tuple[str, str, str]], list[str]] = ("", [], [])

LONG_SESSION_PROMPTS = [
    Prompt("Explain how src/importer.ts streams a CSV", Turn("09:02", "11s")),
    Prompt("Add a --delimiter flag and pass it through the parser", Turn("09:06", "48s", ["src/importer.ts"])),
    Prompt("Write tests for quoted fields with commas", Turn("09:11", "1m 20s", ["src/importer.test.ts"])),
    Prompt("Why does the last row drop when the file has no trailing newline?", Turn("09:18", "7s", outcome="error")),
    Prompt("Fix the CRLF handling in the row splitter", Turn("09:21", "36s", ["src/importer.ts"])),
    Prompt("Add a progress line every 10k rows", Turn("09:27", "2m 14s", ["src/importer.ts"])),
    Prompt("Run the suite and update the README usage block", Turn("09:31", "1m 05s", ["README.md"], outcome="interrupted")),
    Prompt("Now add a --dry-run flag that reports what would change", Turn("09:40", "57s", ["src/importer.ts"]), break_before=True),
    Prompt("Reuse one summary for dry-run and the real run", Turn("09:44", "1m 32s", ["src/importer.ts"])),
    Prompt("Why does dry-run still print the progress line?", Turn("09:52", "9s")),
    Prompt("Send progress to stderr and keep stdout for the summary", Turn("09:55", "44s", ["src/importer.ts"])),
    Prompt("Add a test for stderr output", Turn("09:58", "38s", ["src/importer.test.ts"])),
    Prompt("Document the exit codes in --help", Turn("10:03", "26s", ["src/cli.ts"])),
    Prompt("Check that --delimiter survives the dry-run path", Turn("10:07", "18s")),
    Prompt("Run the full suite on Node 18 and 22", Turn("10:12", "3m 40s", ["package.json"])),
    Prompt("Squash the importer commits and write the changelog entry", Turn("10:20", "1m 25s", ["CHANGELOG.md"])),
    Prompt("Open a PR and summarize the behavior changes", Turn("10:26", "2m 02s")),
    Prompt("Review the diff for the CRLF fix", Turn("10:35", "51s", ["src/importer.ts"])),
    Prompt("Address the review note about stream backpressure", Turn("10:41", "1m 48s", ["src/importer.ts"])),
    Prompt("Rerun the suite and push the fixup", Turn("10:47", "1m 12s")),
    Prompt("Write the release notes for 0.16", Turn("10:52", outcome="running")),
]

LONG_SESSION_REPLIES = [NO_REPLY] * 18 + [
    (
        "Switched to a for-await loop, so backpressure pauses the reader instead of "
        "buffering the file.",
        [("Edit", "src/importer.ts", "Updated with 11 additions and 6 removals")],
        [],
    ),
    (
        "Pushed the fixup. CI is running on the squashed branch.",
        [("Bash", "git push --force-with-lease", "main -> main")],
        [],
    ),
]

RESUME_PROMPTS = [
    Prompt("Refactor the fetch wrapper to retry on 5xx", Turn("14:02", "1m 30s", ["src/http.ts"])),
    Prompt("Add a test for the retry budget", Turn("14:08", "52s", ["src/http.test.ts"])),
    Prompt("Run the suite", Turn("14:12", "40s")),
    Prompt("Why does the retry test leak a timer?", Turn("14:15", "12s", outcome="error")),
    Prompt("Fix the timer leak before the break", Turn("14:23", "33s", ["src/http.ts"])),
    Prompt("Pick up the retry work: fix the leaked timer", Turn("09:14", "1m 05s", ["src/http.ts"])),
    Prompt("Make the budget configurable per call", Turn("09:20", "1m 44s", ["src/http.ts", "src/types.ts"])),
    Prompt("Document the retry options in the README", Turn("09:26", "38s", ["README.md"])),
    Prompt("Explain the final retry budget semantics", Turn("09:31", "1m 10s")),
    Prompt("Add a jittered backoff between attempts", Turn("09:36", "1m 12s", ["src/http.ts"])),
    Prompt("Run the suite and update the changelog", Turn("09:41", "1m 50s", ["CHANGELOG.md"])),
    Prompt("Open a PR and describe the new options", Turn("09:45", "2m 03s")),
    Prompt("Review the diff and answer the comment about jitter", Turn("09:52", outcome="running")),
]

RESUME_REPLIES = [NO_REPLY] * 3 + [
    (
        "The leak came from the fake timer the test installs: the retry timer was "
        "never cleared on the error path.",
        [("Read", "src/http.test.ts", "Read 96 lines")],
        [],
    ),
    (
        "Cleared the retry timer when the wrapper rejects, before the error is rethrown.",
        [("Edit", "src/http.ts", "Updated with 3 additions and 2 removals")],
        [],
    ),
    (
        "The budget is now checked per call: three attempts by default, or the option's value.",
        [("Edit", "src/http.ts", "Updated with 9 additions and 1 removal")],
        [],
    ),
    (
        "Added the options table and a note about which errors count against the budget.",
        [("Edit", "README.md", "Updated with 12 additions")],
        [],
    ),
    (
        "The budget counts attempts, not time: a 4xx answer ends the call, while a "
        "5xx or a timeout spends one of the three.",
        [],
        [],
    ),
    (
        "An attempt now waits a random share of the retry delay, so callers do not "
        "retry in step after an outage.",
        [("Edit", "src/http.ts", "Updated with 8 additions and 2 removals")],
        [],
    ),
    (
        "The suite passes, and the changelog names the new options.",
        [("Bash", "npm test", "31 passed (31)")],
        [],
    ),
    (
        "Opened the PR with the retry table and the jitter note in the description.",
        [("Bash", "gh pr create", "https://github.com/demo/pull/57")],
        [],
    ),
]

CONTINUED_PARENTS = [
    Prompt("Design the cache invalidation for the settings page", Turn("10:08", "2m 10s", ["docs/cache.md"]), unreachable=True),
    Prompt("Write the cache key helper", Turn("10:12", "1m 02s", ["src/cache.ts"]), unreachable=True),
    Prompt("Why does the profile page read stale settings?", Turn("10:18", "14s", outcome="error"), unreachable=True),
    Prompt("Invalidate on write instead of on read", Turn("10:21", "3m 06s", ["src/cache.ts"]), unreachable=True),
]

CONTINUED_CURRENT = [
    Prompt("Continue the cache work: add the invalidation test", Turn("17:10", "1m 20s", ["src/cache.test.ts"])),
    Prompt("Make the key helper tolerate nested folders", Turn("17:15", "54s", ["src/cache.ts"])),
    Prompt("Run the suite and check the profile page", Turn("17:19", "2m 12s")),
    Prompt("Explain the remaining stale-read case", Turn("17:24", outcome="running")),
]

CONTINUED_REPLIES = [
    (
        "Added a test that writes settings, reads the profile, and expects the write "
        "to be visible at once.",
        [("Write", "src/cache.test.ts", "Updated with 28 additions")],
        [],
    ),
    (
        "Keys are now joined from path segments, so nested folders no longer collide.",
        [("Edit", "src/cache.ts", "Updated with 7 additions and 3 removals")],
        [],
    ),
    (
        "26 tests pass. The profile page reads the new settings on the first visit.",
        [("Bash", "npm test", "26 passed (26)")],
        [],
    ),
]


LONG_START = "2026-11-15 09:01:47"


def long_rows() -> list[PaneRow]:
    rows = [pane_head(LONG_START)]
    for index, prompt in enumerate(LONG_SESSION_PROMPTS):
        if index > 0 and prompt.break_before:
            rows.append(PaneRow("compacted"))
        rows.append(
            pane_prompt(
                LONG_SESSION_PROMPTS,
                index,
                spinner=prompt.turn.outcome == "running",
            )
        )
    return rows


def still_long_session(path: Path) -> None:
    """A compacted, twenty-prompt session: the rail is a map of the day, the
    compacted divider keeps the two halves apart, and the running turn spins
    its tick at the foot."""
    width, height = 1000, 680
    img, d = window(width, height)
    lines, _ = build_lines(LONG_SESSION_PROMPTS, 68, LONG_SESSION_REPLIES)
    img.paste(
        draw_transcript(lines, 616, 476, max(0, len(lines) - 23), 68),
        (s(24), s(56)),
    )
    line(d, 650, 44, 650, height - 12, BORDER)
    draw_pane(d, 672, 64, 33, long_rows(), current=18)
    draw_composer(d, 24, 560, 616, "Ask Claude to change something…")
    img.save(path, optimize=True)


def still_resume(path: Path) -> None:
    """A resumed session: the original start stays in the head, and a
    `resumed at …` line sets the next morning's prompts apart from the run
    that came before."""
    width, height = 1000, 640
    img, d = window(width, height)
    lines, _ = build_lines(RESUME_PROMPTS, 68, RESUME_REPLIES)
    # The newest row sits at the foot of the transcript, as it does in a live
    # session, so the view reads as the resumed run's later half.
    img.paste(
        draw_transcript(lines, 616, 460, max(0, len(lines) - 23), 68),
        (s(24), s(56)),
    )
    line(d, 650, 44, 650, height - 12, BORDER)
    rows = [pane_head("2026-09-24 14:01:58")]
    for index in range(len(RESUME_PROMPTS)):
        if index == 5:
            rows.append(pane_resume("2026-11-15 09:12:04"))
        rows.append(
            pane_prompt(
                RESUME_PROMPTS,
                index,
                spinner=RESUME_PROMPTS[index].turn.outcome == "running",
            )
        )
    draw_pane(d, 672, 64, 33, rows, current=10)
    draw_composer(d, 24, 528, 616, "Ask Claude to change something…")
    img.save(path, optimize=True)


def still_continued(path: Path) -> None:
    """A session forked from another: the load button on top, the parent
    block under its heading with dotted ticks (its rows live in the other
    transcript), then this session's own block."""
    width, height = 1080, 680
    img, d = window(width, height)
    lines, _ = build_lines(CONTINUED_CURRENT, 68, CONTINUED_REPLIES)
    img.paste(draw_transcript(lines, 616, 476, 0, 68), (s(24), s(56)))
    line(d, 650, 44, 650, height - 12, BORDER)
    # A pane wide enough for the load label's middle form and for the heading
    # and its stamp on one row, as offerLine and blockHeading decide. The head
    # is left out: the first block's heading already dates the conversation.
    rows = [
        PaneRow("load", "click to load parent session 4f3a9c21"),
        pane_heading("prompts from 4f3a9c21 ⧉", "11-15 10:42", accent=True),
    ]
    rows += [pane_prompt(CONTINUED_PARENTS, index) for index in range(len(CONTINUED_PARENTS))]
    rows.append(pane_heading("current session", "11-15 17:08", accent=True))
    rows += [pane_prompt(CONTINUED_CURRENT, index) for index in range(len(CONTINUED_CURRENT))]
    draw_pane(d, 672, 64, 41, rows, current=2)
    draw_composer(d, 24, 560, 616, "Ask Claude to change something…")
    img.save(path, optimize=True)


# -------------------------------------------------------------------- banner


def banner_text(
    d: ImageDraw.ImageDraw,
    x: float,
    y: float,
    text: str,
    font: ImageFont.FreeTypeFont,
    color: str,
    anchor: str = "lm",
) -> None:
    d.text((sx(x), sx(y)), text, font=font, fill=color, anchor=anchor)


def banner_feature_line(
    d: ImageDraw.ImageDraw,
    x: float,
    y: float,
    parts: list[str],
    font: ImageFont.FreeTypeFont,
    color: str,
    accent: str,
) -> None:
    """The small uppercase line under the title, its separators in the accent."""
    for index, part in enumerate(parts):
        if index:
            banner_text(d, x, y, " / ", font, accent)
            x += font.getlength(" / ") / SCALE
        banner_text(d, x, y, part, font, color)
        x += font.getlength(part) / SCALE


def banner_chip(d: ImageDraw.ImageDraw, x: float, y: float, text: str, font: ImageFont.FreeTypeFont) -> float:
    """A rounded tag naming one session operation; returns the width it took."""
    pad = 10
    width = font.getlength(text) / SCALE + pad * 2
    height = 26
    rect(d, x, y, width, height, radius=height / 2, fill="#2A2420", outline="#4A3A32", width=1)
    d.text((sx(x + width / 2), sx(y + height / 2)), text, font=font, fill=ACCENT, anchor="mm")
    return width


def still_banner(path: Path) -> None:
    """The README's head: the rail as a prompt index, with the session blocks
    a continuation, a branch and a compaction draw around it."""
    width, height = 800, 340
    img = Image.new("RGB", (s(width), s(height)), PAGE)
    d = ImageDraw.Draw(img)
    rect(d, 10, 10, width - 20, height - 20, radius=16, fill=WINDOW)
    # A faint plotter grid, set in from the rounded edge.
    for gx in range(26, width - 24, 24):
        line(d, gx, 26, gx, height - 26, "#222327", 0.5)
    for gy in range(26, height - 24, 24):
        line(d, 26, gy, width - 26, gy, "#222327", 0.5)
    rect(d, 10, 10, width - 20, height - 20, radius=16, outline=BORDER)

    rect(d, 46, 48, 26, 3, fill=ACCENT)
    banner_text(d, 46, 88, "session-rail", BANNER_TITLE, TEXT)
    banner_text(d, 46, 128, "Every prompt, every branch, one rail.", BANNER_SUB, RAIL_TEXT)
    banner_feature_line(d, 46, 164, ["PROMPT INDEX", "SESSION HISTORY", "BRANCHES"], BANNER_SMALL, DIM, ACCENT)
    x = 46.0
    for text in ("compaction", "resume", "/branch", "/fork"):
        x += banner_chip(d, x, 190, text, BANNER_CHIP) + 8
    banner_text(d, 46, 246, "Every branch, fork and compaction, drawn in place.", BANNER_SMALL, DIM)
    banner_text(d, 46, 302, "Claude Code 2.1.287+  ·  terminal & desktop", BANNER_META, DIM)

    # The pane's own rows: the earlier block above, this session's below, with
    # a compaction and a resume between them. The first current prompt is the
    # one being read, so its tick and row take the accent.
    rect(d, 410, 40, 344, 260, radius=12, fill="#23201D", outline=CARD_BG)
    d.ellipse([sx(422), sx(55), sx(428), sx(61)], fill=ACCENT)
    banner_text(d, 438, 58, "SESSION HISTORY", BANNER_META, DIM)
    entries = [
        Prompt("Add a cache-aside read to the loader", Turn("10:42", "2m 01s"), unreachable=True),
        Prompt("Why is the write invisible until reload?", Turn("10:46", "11s"), unreachable=True),
        Prompt("Ship the session-rail README", Turn("17:08", "1m 20s", ["README.md"])),
        Prompt("Wire the branch transcript", Turn("17:12", "48s", ["index.tsx"])),
        Prompt("Run the full test suite", Turn("17:14", outcome="running")),
        Prompt("Tune the hover card", Turn("17:18", "32s", ["theme.ts"])),
    ]
    rows = [
        pane_heading("prompts from 4f3a9c21 ⧉", "10:42", accent=True),
        pane_prompt(entries, 0),
        pane_prompt(entries, 1),
        pane_heading("current session", "17:08", accent=True),
        pane_prompt(entries, 2),
        pane_prompt(entries, 3),
        pane_prompt(entries, 4, spinner=True),
        PaneRow("compacted"),
        pane_resume("09:12"),
        pane_prompt(entries, 5),
    ]
    draw_pane(d, 424, 78, 36, rows, current=2)
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
    pulse: int | None = None,
) -> Image.Image:
    page, _ = frame_page(caption)
    win, d = window(768, 420, title="~/demo")
    lines, _ = build_lines(DEMO_PROMPTS, 54)
    win.paste(draw_transcript(lines, 470, 260, top, 54), (s(20), s(50)))
    line(d, 482, 44, 482, 410, BORDER)
    draw_rail(d, 500, 50, 26, DEMO_PROMPTS, current, hover, pulse=pulse)
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
        pulse = 1 if 19 <= frame <= 24 else None
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
        frames.append(demo_frame(current, hover, top, at, ring, caption, pulse))
    save_gif(frames, path)


ABOVE_DEMO_PROMPTS = [
    Prompt(text, Turn(f"14:{2 + index:02d}", f"{6 + index * 2}s"))
    for index, text in enumerate(SHORT_PROMPTS[:10])
] + [
    Prompt(LONG_PROMPT, Turn("15:02", "3m 08s", ["src/debounce.ts", "README.md"])),
    Prompt("Also document the flush() option", Turn("15:09", "34s", ["README.md"])),
]
ABOVE_INDEX = 10


def above_frame(top: float, offset: int, pointer_at: tuple[float, float] | None) -> Image.Image:
    page, _ = frame_page("a tall card opens above its row  ·  the wheel scrolls it")
    win, d = window(768, 420)
    lines, _ = build_lines(ABOVE_DEMO_PROMPTS, 54)
    win.paste(draw_transcript(lines, 470, 260, top, 54), (s(20), s(50)))
    line(d, 482, 44, 482, 410, BORDER)
    draw_rail(d, 500, 50, 26, ABOVE_DEMO_PROMPTS, ABOVE_INDEX, ABOVE_INDEX, rows=14, offset=offset)
    draw_composer(d, 20, 344, 470, "Ask Claude to change something…", status=False)
    draw_mode_line(d, 20, 386)
    if pointer_at is not None:
        pointer(d, pointer_at[0], pointer_at[1])
    page.paste(win, (s(16), s(14)))
    return page


def make_card_above(path: Path) -> None:
    lines, starts = build_lines(ABOVE_DEMO_PROMPTS, 54)
    del lines
    drop = 50 + ABOVE_INDEX * LINE + LINE / 2
    at = (500 + 7 * CELL, drop)
    origin = (700, 390)
    # The scroll window the frame function computes: enough lines to fill the
    # rail above the row, out of the card's full length.
    total = len(card_lines(ABOVE_DEMO_PROMPTS[ABOVE_INDEX], 26, whole=True))
    window = ABOVE_INDEX
    last = max(0, total - window)
    frames: list[Image.Image] = []
    for frame in range(56):
        if frame <= 7:
            t = ease(frame / 7)
            pos = (origin[0] + (at[0] - origin[0]) * t, origin[1] + (at[1] - origin[1]) * t)
            offset = 0
        elif frame <= 22:
            pos, offset = at, 0
        else:
            pos = at
            offset = round(last * ease((frame - 22) / 24))
        frames.append(above_frame(starts[ABOVE_INDEX] - 3, offset, pos))
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
        panel_label(d, card_x, row_y, cut(card, 62), width=748 - card_x)
    if pointer_at is not None:
        pointer(d, pointer_at[0], pointer_at[1], ring)
    page.paste(win, (s(16), s(14)))
    return page


# The chain the continued-session GIF walks: the session the person forked
# from, then the session that one continued.
PARENT_ONE = "4f3a9c21"
PARENT_TWO = "3b1e77d0"
GIF_PARENT_TWO = [
    Prompt("Sketch the settings page read path", Turn("09:12", "48s", ["docs/cache.md"]), unreachable=True),
    Prompt("Add a cache-aside read to the profile loader", Turn("09:18", "2m 01s", ["src/profile.ts"]), unreachable=True),
    Prompt("Why is the settings write invisible until reload?", Turn("09:26", "11s", outcome="error"), unreachable=True),
]


def continued_rows(level: int) -> list[PaneRow]:
    """The pane at each press: the current block alone, then one earlier
    session, then the session that one continued. The load row stays on top
    while a further session waits, and leaves when the chain ends."""
    # No head: the current block's heading dates the continued session, so the
    # pane's own start line is left out (see firstOpens).
    rows: list[PaneRow] = []
    pending = {0: PARENT_ONE, 1: PARENT_TWO}.get(level)
    if pending is not None:
        rows.append(PaneRow("load", f"load parent {pending}"))
    if level >= 1:
        rows.append(pane_heading(f"prompts from {PARENT_ONE} ⧉", accent=True))
        rows += [pane_prompt(CONTINUED_PARENTS, index) for index in range(len(CONTINUED_PARENTS))]
    if level >= 2:
        rows.append(pane_heading(f"prompts from {PARENT_TWO} ⧉", accent=True))
        rows += [pane_prompt(GIF_PARENT_TWO, index) for index in range(len(GIF_PARENT_TWO))]
    rows.append(pane_heading("current session", accent=True))
    rows += [pane_prompt(CONTINUED_CURRENT, index) for index in range(len(CONTINUED_CURRENT))]
    return rows


def continued_frame(
    level: int,
    pressed: bool,
    pointer_at: tuple[float, float],
    caption: str,
) -> Image.Image:
    page, _ = frame_page(caption)
    win, d = window(768, 420)
    lines, _ = build_lines(CONTINUED_CURRENT, 54, CONTINUED_REPLIES)
    win.paste(draw_transcript(lines, 440, 260, 0, 54), (s(20), s(50)))
    line(d, 452, 44, 452, 410, BORDER)
    draw_pane(d, 470, 50, 26, continued_rows(level), current=2, max_rows=17, pressed=0 if pressed else None)
    draw_composer(d, 20, 344, 440, "Ask Claude to change something…", status=False)
    draw_mode_line(d, 20, 386)
    pointer(d, pointer_at[0], pointer_at[1])
    page.paste(win, (s(16), s(14)))
    return page


def make_continued(path: Path) -> None:
    """Loading a continuation's earlier sessions one press at a time. The
    parent's rows arrive with dotted ticks, its heading names the session, and
    the button moves to the next session back until the chain ends."""
    load_at = (470 + 12 * CELL, 50 + LINE / 2)
    origin = (700, 390)
    frames: list[Image.Image] = []
    level, pressed, caption = 0, False, "continued session · press to load one level"
    for frame in range(60):
        if frame <= 7:
            t = ease(frame / 7)
            at = (origin[0] + (load_at[0] - origin[0]) * t, origin[1] + (load_at[1] - origin[1]) * t)
            level = 0
        elif frame <= 14:
            at = load_at
            pressed = 12 <= frame <= 14
            level = 0
        elif frame <= 26:
            at, pressed, level = load_at, False, 1
            caption = "its prompts join the rail · dotted: no jump reaches them"
        elif frame <= 33:
            at, pressed, level = load_at, 29 <= frame <= 33, 1
        else:
            at, pressed, level = load_at, False, 2
            caption = "one session per press · the chain ends four back"
        frames.append(continued_frame(level, pressed, at, caption))
    save_gif(frames, path)


THEME_DEMO_PROMPTS = [
    Prompt("Explain what src/debounce.ts does", Turn("14:02", "8s")),
    Prompt(
        "Add a cancel() method that clears the pending timeout and reports whether it cancelled anything",
        Turn("14:06", "1m 12s", ["src/debounce.ts"]),
    ),
    Prompt("Write tests for cancel()", Turn("14:09", "46s", ["src/debounce.test.ts"])),
    Prompt("Why does the test fail on Node 18?", Turn("14:12", "3s", outcome="error")),
    Prompt("Fix the timer typing", Turn("14:15", "21s", ["src/debounce.ts"])),
    Prompt("Add a leading-edge option", Turn("14:26", outcome="running")),
]
THEME_ACCENTS = {
    "mauve": "#D8A8C4",
    "teal": "#5CC8CC",
    "indigo": "#93A2E8",
    "plum": "#C08ADB",
    "slate": "#9DB4D6",
}


def theme_frame(family: str, paper: str, tint: str) -> Image.Image:
    page, _ = frame_page(f"card themes · {family} · one card, eleven families")
    win, d = window(768, 420)
    lines, _ = build_lines(THEME_DEMO_PROMPTS, 54)
    win.paste(draw_transcript(lines, 470, 260, 0, 54), (s(20), s(50)))
    line(d, 482, 44, 482, 410, BORDER)
    accent = THEME_ACCENTS.get(family, ACCENT)
    draw_rail(
        d,
        500,
        50,
        26,
        THEME_DEMO_PROMPTS,
        2,
        1,
        skin=DARK_SKIN,
        accent=accent,
        card_bg=paper,
        accent_on_card=tint,
    )
    draw_composer(d, 20, 344, 470, "Ask Claude to change something…", status=False)
    draw_mode_line(d, 20, 386)
    pointer(d, 500 + 8 * CELL, 50 + HEAD_ROWS * LINE + LINE / 2 + LINE)
    page.paste(win, (s(16), s(14)))
    return page


def make_themes(path: Path) -> None:
    """One hover card, drawn once per card family in the dark scheme: the
    panel, its prompt highlight and the accent tint move together."""
    families = [
        (name, paper, tint) for name, paper, tint in PREVIEW_FAMILIES
    ]
    frames: list[Image.Image] = []
    for name, paper, tint in families:
        frames.extend(theme_frame(name, paper, tint) for _ in range(5))
    save_gif(frames, path)


def long_session_frame(
    current: int,
    top: float,
    rows: list[PaneRow],
    body: int,
) -> Image.Image:
    page, _ = frame_page("a long session · scroll up: the rail follows")
    win, d = window(768, 420)
    lines, _ = build_lines(LONG_SESSION_PROMPTS, 54, LONG_SESSION_REPLIES)
    win.paste(draw_transcript(lines, 440, 260, top, 54, fade=True), (s(20), s(50)))
    line(d, 452, 44, 452, 410, BORDER)
    pos = next(
        i for i, row in enumerate(rows) if row.kind == "prompt" and row.index == current
    )
    start = max(0, min(pos - 13, len(rows) - body))
    draw_pane(d, 470, 50, 26, rows[start:start + body], current=current)
    draw_composer(d, 20, 344, 440, "Ask Claude to change something…", status=False)
    draw_mode_line(d, 20, 386)
    page.paste(win, (s(16), s(14)))
    return page


def make_long_session(path: Path) -> None:
    """Scrolling a compacted session back through its history: the bold row
    follows the topmost prompt on screen, and the pane's own window moves to
    keep that row visible while the list is taller than the pane."""
    _, starts = build_lines(LONG_SESSION_PROMPTS, 54, LONG_SESSION_REPLIES)
    rows = long_rows()
    body = 18
    first, last = starts[15], starts[4]
    frames: list[Image.Image] = []
    for frame in range(24):
        top = first + (last - first) * ease(frame / 23)
        current = next(
            (index for index, start in enumerate(starts) if start >= top),
            len(starts) - 1,
        )
        frames.append(long_session_frame(current, top, rows, body))
    save_gif(frames, path, duration=140)


def save_gif(frames: list[Image.Image], path: Path, duration: int = 80, colors: int = 256) -> None:
    # Published at the drawing scale, with no downsample: the README asks for
    # 800x500 in its slot, so a 2x frame puts one source pixel on each device
    # pixel of a Retina display — the same crispness the stills keep. The
    # halved 800x500 frames this used to write were blurry at that density,
    # and publishing at 2x costs only about a quarter more file, far less than
    # the quadrupled pixel count suggests: the pixels a downsample adds are
    # antialiased glyph edges, which change every frame, while the pixels 2x
    # adds are flat text interior and background that the GIF's delta
    # encoding skips. 256 colors, up from 128, leaves those edges far less
    # quantized, for about five per cent more again.
    palette = [frame.convert("P", palette=Image.Palette.ADAPTIVE, colors=colors) for frame in frames]
    palette[0].save(
        path,
        save_all=True,
        append_images=palette[1:],
        duration=duration,
        loop=0,
        optimize=True,
        disposal=2,
    )


def main() -> None:
    wanted = set(sys.argv[1:])
    jobs = {
        "banner": (still_banner, HERE / "banner.png"),
        "vertical": (still_vertical, HERE / "vertical.png"),
        "horizontal": (still_horizontal, HERE / "horizontal.png"),
        "below": (still_below, HERE / "below.png"),
        "card-above": (still_card_above, HERE / "card-above.png"),
        "long-session": (still_long_session, HERE / "long-session.png"),
        "resume": (still_resume, HERE / "resume.png"),
        "continued": (still_continued, HERE / "continued.png"),
        "preview": (still_preview, HERE / "preview.png"),
        "themes-light": (still_preview_light, HERE / "themes-light.png"),
        "demo": (make_demo, HERE / "demo.gif"),
        "long-session-gif": (make_long_session, HERE / "long-session.gif"),
        "below-gif": (make_below, HERE / "below.gif"),
        "above-gif": (make_card_above, HERE / "card-above.gif"),
        "continued-gif": (make_continued, HERE / "continued.gif"),
        "themes-gif": (make_themes, HERE / "themes.gif"),
    }
    for name, (run, path) in jobs.items():
        if wanted and name not in wanted:
            continue
        print(f"{name}: {path.name}")
        run(path)


if __name__ == "__main__":
    main()
