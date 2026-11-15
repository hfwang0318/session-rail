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


def window(width: float, height: float, title: str = "~/demo", right: str = f"session-rail {VERSION}") -> tuple[Image.Image, ImageDraw.ImageDraw]:
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


# The pane opens with when the conversation started; the list stacks under it.
START_STAMP = "2026-09-24 14:01:58"
HEAD_ROWS = 1


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
) -> None:
    """The docked vertical rail, one prompt a row, the hovered one expanded.

    With `rows`, the pane's body height, a card too tall for the room beside
    its row becomes a window with a scrollbar, and a card that opens above its
    row blanks it; the card shows the whole prompt from its first line.
    """
    stack = rail_rows(entries, current, hover, width_cells, expand)
    hover_row = next((row for row in stack if row.index == hover), None)

    # The pane's head: when the conversation opened. It starts at the text
    # column, as the resume and compacted lines do, so a card opening above
    # covers it whole.
    label(d, x + 3 * CELL, y + LINE / 2, f"started at {START_STAMP}", TIME)

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
            label(d, x + 3 * CELL, y + row.top + LINE / 2, "compacted", ACCENT)
            continue
        index = row.index
        prompt = entries[index]
        cy = y + row.top + LINE / 2
        if hover == index:
            # The row and the card share one panel. A card that opens above
            # carries the whole prompt, so the row itself goes blank.
            rect(d, x - 3, y + row.top, (width_cells + 2) * CELL + 6, LINE, fill=CARD_BG, radius=3)
            if blank_hover:
                continue
            if prompt.turn.outcome == "running":
                draw_spinner(d, x + CELL, cy)
            else:
                color, heavy, dotted = tick_color(prompt, index, current)
                draw_tick(d, x + CELL, cy, color, heavy, dotted)
            # The row's cut mark is hidden while its card continues it.
            text = cut(prompt.text, width_cells - 1)
            if text.endswith("…"):
                text = text[:-1]
            label(d, x + 3 * CELL, cy, text, CARD_TEXT, bold=True)
        elif pulse == index:
            # A jump briefly inverts the row it landed on.
            rect(d, x - 3, y + row.top, (width_cells + 2) * CELL + 6, LINE, fill=TEXT, radius=3)
            draw_tick(d, x + CELL, cy, WINDOW, True, False)
            label(d, x + 3 * CELL, cy, cut(prompt.text, width_cells - 1), WINDOW, bold=True)
        else:
            if prompt.turn.outcome == "running":
                draw_spinner(d, x + CELL, cy)
            else:
                color, heavy, dotted = tick_color(prompt, index, current)
                draw_tick(d, x + CELL, cy, color, heavy, dotted)
            label(d, x + 3 * CELL, cy, cut(prompt.text, width_cells - 1), RAIL_TEXT if index == current else DIM, bold=index == current)

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
        rect(d, card_x, top, card_w, LINE, fill=CARD_BG)
        label(d, card_x + CELL / 2, top + LINE / 2, text, ACCENT_ON_CARD if is_stats else CARD_PROMPT, bold=not is_stats)
    if shown > 0 and total > shown:
        # The terminal's scrollbar, over the scrolling prompt alone.
        track_x = card_x + card_w - CELL / 2
        rect(d, track_x - 0.8, card_top + 1, 1.6, shown * LINE - 2, fill=FAINT)
        thumb_h = max(1, round(shown * shown / total))
        thumb_top = round((shown - thumb_h) * first / max(1, total - shown))
        rect(d, track_x - 2, card_top + thumb_top * LINE + 1, 4, thumb_h * LINE - 2, fill=CARD_TEXT, radius=2)


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


def still_preview(path: Path) -> None:
    """The theme preview pane: each family sampled as prompt and stats text on
    its own paper, the family in use marked, no color values printed."""
    width, height = 1100, 580
    img, d = window(width, height)
    lines, starts = build_lines(PROMPTS, 42)
    img.paste(
        draw_transcript(lines, 360, 430, starts[2], 42),
        (s(24), s(56)),
    )
    # The pane's divider: the preview docks beside the transcript.
    line(d, 410, 44, 410, height - 12, BORDER)
    x = 432
    y = 76
    label(d, x, y, "Card themes · warm-taupe · dark side", RAIL_TEXT, bold=True)
    y += 2 * LINE
    prompt = " Fix the flaky test "
    stats = " · At 12:57, 2m 30s "
    prompt_w = REGULAR.getlength(prompt) / SCALE
    stats_w = REGULAR.getlength(stats) / SCALE
    sample_x = x + 17 * CELL
    for index, (name, paper, tint) in enumerate(PREVIEW_FAMILIES):
        current = index == 0
        label(d, x, y, "●" if current else " ", ACCENT, bold=current)
        label(d, x + 2 * CELL, y, name.ljust(15), RAIL_TEXT, bold=current)
        rect(d, sample_x - CELL / 2, y - LINE / 2 + 2, prompt_w + stats_w + CELL, LINE - 4, fill=paper)
        label(d, sample_x, y, prompt, CARD_PROMPT, bold=True)
        label(d, sample_x + prompt_w, y, stats, tint)
        y += LINE
    y += LINE
    label(d, x, y, "Pick one at /config › Card theme. Esc closes this.", RAIL_TEXT)
    img.save(path, optimize=True)


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
        "card-above": (still_card_above, HERE / "card-above.png"),
        "preview": (still_preview, HERE / "preview.png"),
        "demo": (make_demo, HERE / "demo.gif"),
        "below-gif": (make_below, HERE / "below.gif"),
        "above-gif": (make_card_above, HERE / "card-above.gif"),
    }
    for name, (run, path) in jobs.items():
        if wanted and name not in wanted:
            continue
        print(f"{name}: {path.name}")
        run(path)


if __name__ == "__main__":
    main()
