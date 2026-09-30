"""Turns the ink-wash scene art in public/Asset Heroo into the hero's transparent layers (public/hero/scene/*.webp).

The paintings come on a white ground. White is made transparent the way ink sits on paper ("colour to alpha"): pure
white disappears, a grey wash becomes a lighter, partly transparent grey, and black ink stays solid. Every edge is
feathered so no layer shows a cut line where it ends. Run it again after replacing any of the source paintings:

    python web/scripts/hero-scene.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'public' / 'Asset Heroo'
OUT = ROOT / 'public' / 'hero' / 'scene'

# source file -> (output name, feathered margin as a fraction of the width / height, longest side in px)
# The far range and the mist are soft washes and sit furthest back, so they ship smaller than the rest.
LAYERS = {
    'GunungJauh.png': ('mountains-far', 0.10, 0.08, 1440),
    'GunungTengah.png': ('mountains-mid', 0.08, 0.08, 1920),
    'Tembok.png': ('great-wall', 0.10, 0.08, 1920),
    'Kabut.png': ('mist', 0.12, 0.12, 1440),
}

WHITE_POINT = 248  # the generator's "white" is 254 with noise; anything this light counts as bare paper


def colour_to_alpha(rgb: np.ndarray) -> np.ndarray:
    """RGB floats 0..255 -> RGBA floats: white removed, ink kept at its original darkness."""
    c = np.clip(rgb / WHITE_POINT, 0, 1)  # 1 = paper
    alpha = 1 - c.min(axis=2)  # the darkest channel decides how much ink is there
    safe = np.maximum(alpha, 1e-6)[..., None]
    colour = 1 - (1 - c) / safe  # un-premultiply so the ink keeps its tone once composited on paper
    return np.dstack([np.clip(colour, 0, 1) * 255, alpha * 255])


def feather(w: int, h: int, mx: float, my: float) -> np.ndarray:
    """1 inside, easing to 0 across the margins, so a layer fades out instead of ending in a straight line."""
    def ramp(n: int, m: float) -> np.ndarray:
        edge = max(1, int(n * m))
        t = np.minimum(np.arange(n), np.arange(n)[::-1]) / edge
        t = np.clip(t, 0, 1)
        return t * t * (3 - 2 * t)  # smoothstep
    return np.outer(ramp(h, my), ramp(w, mx))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for src, (name, mx, my, limit) in LAYERS.items():
        im = Image.open(SRC / src)
        if im.mode == 'RGBA':  # already cut out: flatten on white first so every layer is treated the same way
            ground = Image.new('RGBA', im.size, (255, 255, 255, 255))
            ground.alpha_composite(im)
            im = ground
        rgba = colour_to_alpha(np.asarray(im.convert('RGB'), dtype=np.float64))
        rgba[..., 3] *= feather(im.width, im.height, mx, my)
        out = Image.fromarray(rgba.round().astype(np.uint8), 'RGBA')
        box = out.getchannel('A').point(lambda a: 255 if a > 3 else 0).getbbox()  # trim empty margins
        if box:
            out = out.crop(box)
        if max(out.size) > limit:
            k = limit / max(out.size)
            out = out.resize((round(out.width * k), round(out.height * k)), Image.LANCZOS)
        path = OUT / f'{name}.webp'
        out.save(path, 'WEBP', quality=72, alpha_quality=75, method=4)  # the ink lives in the alpha channel; lossy alpha keeps it light
        print(f'{src:18} -> {path.name:20} {out.size[0]}x{out.size[1]}  {path.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
