"""Generate launcher icons from the project logo on a white background."""
from PIL import Image, ImageDraw
import os

SIZE = 512
WHITE = (255, 255, 255, 255)

root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
logo = Image.open(os.path.join(root, "logo.png")).convert("RGBA")

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=112, fill=255)
img.paste(Image.new("RGBA", (SIZE, SIZE), WHITE), (0, 0), mask)

resampling = getattr(Image, "Resampling", Image)
logo.thumbnail((SIZE, SIZE), resampling.LANCZOS)
img.alpha_composite(
    logo,
    ((SIZE - logo.width) // 2, (SIZE - logo.height) // 2),
)

res_root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "res")
out_dir = os.path.join(res_root, "drawable")
os.makedirs(out_dir, exist_ok=True)
for density, px in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]:
    d = os.path.join(res_root, "mipmap-" + density)
    os.makedirs(d, exist_ok=True)
    img.resize((px, px), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))
img.resize((192, 192), Image.LANCZOS).save(os.path.join(out_dir, "ic_launcher.png"))
print("icon written")
