from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

SIZE = 512
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Background gradient
top = (37, 99, 235, 255)
bottom = (15, 23, 42, 255)
for y in range(SIZE):
    t = y / (SIZE - 1)
    color = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(4))
    draw.line((0, y, SIZE, y), fill=color)

# Rounded mask for app icon shape
mask = Image.new("L", (SIZE, SIZE), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.rounded_rectangle((24, 24, SIZE - 24, SIZE - 24), radius=110, fill=255)
img.putalpha(mask)

# Subtle glow
glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow)
glow_draw.ellipse((80, 48, 432, 320), fill=(56, 189, 248, 90))
glow = glow.filter(ImageFilter.GaussianBlur(28))
img = Image.alpha_composite(img, glow)

# White sparkle/star
star = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
star_draw = ImageDraw.Draw(star)
cx, cy = 220, 220
star_draw.polygon(
    [
        (cx, cy - 110),
        (cx + 28, cy - 28),
        (cx + 110, cy),
        (cx + 28, cy + 28),
        (cx, cy + 110),
        (cx - 28, cy + 28),
        (cx - 110, cy),
        (cx - 28, cy - 28),
    ],
    fill=(255, 255, 255, 245),
)
star_draw.ellipse((300, 110, 344, 154), fill=(255, 255, 255, 230))
star_draw.ellipse((132, 308, 160, 336), fill=(255, 255, 255, 210))
star = star.filter(ImageFilter.GaussianBlur(0.5))
img = Image.alpha_composite(img, star)

# Accent badge
overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
overlay_draw = ImageDraw.Draw(overlay)
overlay_draw.rounded_rectangle(
    (292, 292, 418, 418),
    radius=34,
    fill=(16, 185, 129, 235),
)
overlay_draw.rectangle((332, 326, 378, 338), fill=(236, 253, 245, 245))
overlay_draw.rectangle((332, 346, 378, 358), fill=(236, 253, 245, 245))
overlay_draw.rectangle((332, 366, 378, 378), fill=(236, 253, 245, 245))
img = Image.alpha_composite(img, overlay)

png_path = ASSETS / "icon.png"
ico_path = ASSETS / "icon.ico"

img.save(png_path)
img.save(
    ico_path,
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

print(f"ICON_GENERATED {ico_path}")
