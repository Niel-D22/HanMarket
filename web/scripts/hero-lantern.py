"""Paints the hero lantern into the pagoda's world (public/hero/lantern.webp).

The plain lantern (public/Asset Heroo/lantern-plain.webp) is a clean, saturated red that read as a sticker on the
ink painting. This pulls it into the painting:
  - its red moves toward the roof's lacquer red: a little less saturated, a touch warmer, a touch darker;
  - it takes the rice paper's grain, so it has the same surface as everything around it;
  - the eave above it shades its top;
  - 漢 is brushed on its body in ink, wrapped around the curve and lit by the lantern's own shading. The character
    used to be a separate seal floating over the pillar; on the lantern it is part of the scene.
The output keeps the source's size and framing, so the lantern still hangs from the same point on the eave.

    python web/scripts/hero-lantern.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'public' / 'Asset Heroo' / 'lantern-plain.webp'
PAPER = ROOT / 'public' / 'hero' / 'bg-paper.webp'
OUT = ROOT / 'public' / 'hero' / 'lantern.webp'
FONT = Path('C:/Windows/Fonts/STKAITI.TTF')  # 华文楷体: a regular brush hand with the traditional 漢

# the paper body of the lantern in the source, in px (measured from the red area)
BODY_CX, BODY_R = 320, 119  # centre and half width of the straight part
BODY_TOP, BODY_BOTTOM = 150, 545
CHAR_CY, CHAR_SIZE = 350, 164

SATURATION = 0.86  # the roof's reds are dull lacquer; the lantern stays the brightest red in the scene, just less loud
VALUE = 0.8
HUE_SHIFT = 0.008  # of a full turn, toward vermilion
GRAIN = 0.55  # how strongly the paper's grain shows on the lantern
EAVE_SHADE = 0.16  # how much darker the top of the body is under the eave
INK = np.array([26, 18, 14], dtype=float)
INK_OPACITY = 0.9


def rgb_to_hsv(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    safe = np.where(d == 0, 1, d)
    h = np.where(mx == r, ((g - b) / safe) % 6, h)
    h = np.where(mx == g, (b - r) / safe + 2, h)
    h = np.where(mx == b, (r - g) / safe + 4, h)
    h = np.where(d == 0, 0, h) / 6
    s = np.where(mx == 0, 0, d / np.where(mx == 0, 1, mx))
    return np.dstack([h, s, mx])


def hsv_to_rgb(hsv: np.ndarray) -> np.ndarray:
    h, s, v = hsv[..., 0] % 1, hsv[..., 1], hsv[..., 2]
    i = np.floor(h * 6).astype(int) % 6
    f = h * 6 - np.floor(h * 6)
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    choices = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]
    out = np.zeros(h.shape + (3,))
    for k, (a, b, c) in enumerate(choices):
        m = i == k
        out[m] = np.stack([a[m], b[m], c[m]], -1)
    return out


def paper_grain(w: int, h: int) -> np.ndarray:
    """The rice paper's fine texture as a multiplier around 1 (the broad tone is removed, only the grain is kept)."""
    paper = Image.open(PAPER).convert('L')
    tile = paper.crop((0, 0, min(paper.width, w), min(paper.height, h))).resize((w, h))
    lum = np.asarray(tile, dtype=float)
    broad = np.asarray(tile.filter(ImageFilter.GaussianBlur(12)), dtype=float)
    fine = (lum - broad) / 255
    rng = np.random.default_rng(7)
    speck = np.asarray(Image.fromarray((rng.random((h, w)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), dtype=float) / 255 - 0.5
    return 1 + GRAIN * (fine * 2.2 + speck * 0.12)


def brushed_character(w: int, h: int) -> np.ndarray:
    """漢 as an ink mask 0..1, wrapped around the lantern's curve with a slightly dry brush edge."""
    flat = Image.new('L', (w, h), 0)
    ImageDraw.Draw(flat).text((BODY_CX, CHAR_CY), '漢', font=ImageFont.truetype(str(FONT), CHAR_SIZE), fill=255, anchor='mm', stroke_width=3, stroke_fill=255)  # a loaded brush, so it reads at phone size
    flat = np.asarray(flat, dtype=float) / 255
    # a point at x on the lantern's face is at angle asin((x - cx) / R) around it; read the flat character at that
    # arc length, so the strokes near the sides are foreshortened as they turn away
    x = np.arange(w, dtype=float)
    u = np.clip((x - BODY_CX) / BODY_R, -0.999, 0.999)
    src_x = BODY_CX + np.arcsin(u) * BODY_R * 0.92
    wrapped = np.stack([np.interp(src_x, x, row) for row in flat])
    wrapped[:, np.abs(x - BODY_CX) >= BODY_R] = 0
    # dry brush: the ink thins in places where the brush ran light, and bleeds a hair into the paper
    rng = np.random.default_rng(3)
    dry = np.asarray(Image.fromarray((rng.random((h, w)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6)), dtype=float) / 255
    wrapped *= np.clip(1 + (dry - 0.5) * 3.2, 0.35, 1)
    bled = Image.fromarray((np.clip(wrapped, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
    return np.asarray(bled, dtype=float) / 255


def main() -> None:
    src = np.asarray(Image.open(SRC).convert('RGBA'), dtype=float)
    h, w = src.shape[:2]
    rgb, alpha = src[..., :3] / 255, src[..., 3]

    # 1. the red, toward the roof's lacquer; the black caps and cord barely change because their saturation is low
    hsv = rgb_to_hsv(rgb)
    redness = np.clip((hsv[..., 1] - 0.3) / 0.4, 0, 1)
    hsv[..., 0] = hsv[..., 0] + HUE_SHIFT * redness
    hsv[..., 1] = hsv[..., 1] * (1 - (1 - SATURATION) * redness)
    hsv[..., 2] = hsv[..., 2] * (1 - (1 - VALUE) * redness)
    rgb = hsv_to_rgb(hsv)

    # 2. the paper's surface
    rgb = rgb * paper_grain(w, h)[..., None]

    # 3. the eave's shadow over the top of the body
    y = np.arange(h, dtype=float)[:, None]
    shade = 1 - EAVE_SHADE * np.clip((BODY_TOP + 110 - y) / 110, 0, 1)
    rgb = rgb * shade[..., None]

    # 4. the character, lit by the lantern's own shading (its luminance relative to the body's middle)
    lum = rgb.mean(-1)
    body_mid = np.median(lum[CHAR_CY - 20:CHAR_CY + 20, BODY_CX - 20:BODY_CX + 20])
    light = np.clip(lum / max(body_mid, 1e-6), 0.6, 1.3)[..., None]
    ink = np.clip(INK / 255 * light, 0, 1)
    mask = brushed_character(w, h) * INK_OPACITY * (alpha > 200)
    rgb = rgb * (1 - mask[..., None]) + ink * mask[..., None]

    out = np.dstack([np.clip(rgb, 0, 1) * 255, alpha]).round().astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(OUT, 'WEBP', quality=90, alpha_quality=100, method=6)
    print(f'wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
