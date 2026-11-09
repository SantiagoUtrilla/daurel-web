"""Genera la tarjeta Open Graph de DAUREL usando el logo existente, sin modificarlo.
Ejecución: python scripts/build-social-preview.py
Requiere Pillow. Salida: public/assets/social-preview.png (1200 x 630).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public/assets/social-preview.png"
LOGO = ROOT / "public/assets/logo-light.png"
WIDTH, HEIGHT = 1200, 630

background = Image.new("RGB", (WIDTH, HEIGHT), (9, 9, 9))
draw = ImageDraw.Draw(background)

# Detalles mínimos, acordes con la versión actual de la web.
draw.rectangle((76, 70, WIDTH-76, 73), fill=(196, 196, 191))
draw.rectangle((76, HEIGHT-78, WIDTH-76, HEIGHT-76), fill=(88, 88, 84))
logo = Image.open(LOGO).convert("RGBA")
target_width = 710
target_height = round(target_width * logo.height / logo.width)
logo = logo.resize((target_width, target_height), Image.Resampling.LANCZOS)
background.paste(logo, ((WIDTH-target_width)//2, 144), logo)

regular_candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "C:/Windows/Fonts/arial.ttf",
]
font_file = next((x for x in regular_candidates if Path(x).exists()), None)
if not font_file:
    raise RuntimeError("No se encontró una tipografía local para la imagen.")
font = ImageFont.truetype(font_file, 35)
small = ImageFont.truetype(font_file, 26)

def center_text(text, y, face, color):
    box = draw.textbbox((0, 0), text, font=face)
    x = (WIDTH - (box[2] - box[0])) // 2
    draw.text((x, y), text, font=face, fill=color)

center_text("ATENCIÓN LEGAL CLARA Y GUIADA", 367, font, (233, 232, 225))
center_text("daurel.com.mx", 470, small, (172, 171, 165))

OUT.parent.mkdir(parents=True, exist_ok=True)
background.save(OUT, format="PNG", optimize=True)
print(f"{OUT.relative_to(ROOT)}: {background.size}, {OUT.stat().st_size} bytes")
