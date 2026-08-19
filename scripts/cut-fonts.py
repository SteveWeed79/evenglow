#!/usr/bin/env python3
"""
How the shipped font files were made, so the next person does not have to guess.

    pip install 'fonttools[woff]' brotli
    python3 scripts/cut-fonts.py

## Why this file exists

React Native cannot set variable-font axes — `fontFamily` resolves to exactly
one file and there is no way to ask for `SOFT 100` at runtime. So both display
and data faces ship as **static instances cut from the variable originals**, and
the cut is a build step that happened once, off to the side, with nothing
recording it.

The previous display face was `Fraunces-Soft30Wonk1-Bold.ttf`, and its name
recorded three of the four axes — `opsz` was not one of them. It was written
down, in prose, in `theme/fonts.ts`; recovering it instead by instancing the
variable font at candidate values and diffing outlines against the shipped file
was slower and, at first, wrong, because a coarse sweep put 24 and 36 within a
whisker of each other and neither is the answer. Reading the file that already
said 30 would have taken a minute.

So: the coordinates live here, in a form that runs, and the filenames carry all
four. A number in a sentence is a number somebody has to find.

## Sources

Both originals come from the **npm registry**, not from GitHub or a CDN: the
build environment reaches `registry.npmjs.org` directly and blocks the others,
and pinning to a published package version is better provenance than a branch
tip anyway.

Google publishes these fonts split by charset, so each face is instanced per
subset and the results merged. That loses 40 codepoints against the upstream
Fraunces release — combining diacritics, `≈ ≠ ≤ ≥`, `№`, and the `fi`/`fl`
ligature codepoints. None appears anywhere in the app, and every precomposed
accented character a farm name might carry is retained.
"""

import os
import subprocess
import sys
import tempfile

from fontTools.merge import Merger
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "apps/mobile/assets/fonts")

# Google splits every family into these; their union is the full font.
SUBSETS = ("latin", "latin-ext", "vietnamese")

PACKAGES = {
    "fraunces": "@fontsource-variable/fraunces@5.3.0",
    "recursive": "@fontsource-variable/recursive@5.3.0",
}

CUTS = [
    # ── display ─────────────────────────────────────────────────────────────
    #
    # `opsz 30` is not a preference, it is what the previous shipped file was
    # cut at — kept exactly so that raising SOFT changes the terminals and
    # nothing else. Confirmed against that file: mean outline delta 0.49 units
    # in a 2000-unit em across E, g, R, w and 8, which is font-version drift
    # rather than a different optical size.
    #
    # `fonts.ts` explains the choice of 30 and what would justify moving it (a
    # second instance and a `displayLarge` token, not a new pin here).
    #
    # `SOFT 100` is the axis at its maximum: the terminals round off as far as
    # the design allows. It was 30. Worth being exact about what that buys and
    # what it does not — SOFT does NOT thicken a stroke, so this is warmth, not
    # legibility. The hairline risk a high-contrast serif carries at 24dp is
    # unchanged by it.
    #
    # `WONK 1` keeps the wonky alternates, as before.
    (
        "fraunces",
        {"opsz": 30, "wght": 700, "SOFT": 100, "WONK": 1},
        "Fraunces-Opsz30Soft100Wonk1-Bold.ttf",
    ),
    # ── data ────────────────────────────────────────────────────────────────
    #
    # Recursive's `MONO` and `CASL` axes are the whole reason it is here: MONO 1
    # is the monospaced end, CASL 1 the casual one. Together they are the face
    # Recursive calls Mono Casual, and it replaces IBM Plex Mono — a face drawn
    # to read as engineered, which is the opposite of what this app is for.
    #
    # **Weight 500, not 400.** Set beside Plex Regular, Recursive at 400 is
    # visibly lighter and loses colour on the figures. 500 matches Plex's
    # weight, which matters because this face carries the counts and the app
    # has a 17dp floor for reading outdoors.
    (
        "recursive",
        {"MONO": 1, "CASL": 1, "wght": 500, "slnt": 0, "CRSV": 0},
        "RecursiveMonoCasual-Medium.ttf",
    ),
    (
        "recursive",
        {"MONO": 1, "CASL": 1, "wght": 700, "slnt": 0, "CRSV": 0},
        "RecursiveMonoCasual-Bold.ttf",
    ),
]


def fetch(work: str, family: str) -> str:
    """Unpacks one fontsource package and returns its `files/` directory."""
    into = os.path.join(work, family)
    os.makedirs(into, exist_ok=True)
    subprocess.run(["npm", "pack", PACKAGES[family]], cwd=into, check=True,
                   stdout=subprocess.DEVNULL)
    tar = next(f for f in os.listdir(into) if f.endswith(".tgz"))
    subprocess.run(["tar", "xzf", tar], cwd=into, check=True)
    return os.path.join(into, "package", "files")


def cut(files: str, family: str, coords: dict, out: str, work: str) -> None:
    parts = []
    for i, subset in enumerate(SUBSETS):
        src = os.path.join(files, f"{family}-{subset}-full-normal.woff2")
        if not os.path.exists(src):
            continue
        # `updateFontNames=False`: the name table keeps the family name, which
        # is what `fontFamily` in the app resolves against. Letting the
        # instancer rewrite it renames the family out from under RN.
        inst = instantiateVariableFont(TTFont(src), coords, inplace=False,
                                       updateFontNames=False)
        part = os.path.join(work, f"_{family}_{i}.ttf")
        inst.save(part)
        parts.append(part)

    if not parts:
        sys.exit(f"no subsets found for {family} — did the package layout change?")
    if len(parts) == 1:
        os.replace(parts[0], out)
    else:
        Merger().merge(parts).save(out)

    font = TTFont(out)
    print(f"  {os.path.basename(out)}  "
          f"{len(font.getBestCmap())} chars, {os.path.getsize(out) // 1024} KiB")


def main() -> None:
    with tempfile.TemporaryDirectory() as work:
        files = {}
        for family, coords, name in CUTS:
            if family not in files:
                print(f"fetching {PACKAGES[family]}")
                files[family] = fetch(work, family)
            axes = " ".join(f"{k}={v}" for k, v in coords.items())
            print(f"cutting {family} at {axes}")
            cut(files[family], family, coords, os.path.join(OUT, name), work)

    print("\nRun `pnpm check:assets` and `node scripts/make-icon.mjs` — the icon "
          "is drawn from the display face and does not regenerate on its own.")


if __name__ == "__main__":
    main()
