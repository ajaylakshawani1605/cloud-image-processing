"""Generate explicit demo fixtures without copyrighted assets."""
from pathlib import Path
from PIL import Image, ImageDraw
folder = Path(__file__).resolve().parents[1] / 'tests' / 'fixtures'
folder.mkdir(exist_ok=True)
image = Image.new('RGB', (1600, 1000), '#bbd7c3')
draw = ImageDraw.Draw(image)
draw.ellipse((1050,100,1350,400), fill='#f7e7a5')
draw.polygon([(0,1000),(550,180),(1100,1000)],fill='#34735d')
draw.polygon([(500,1000),(1200,400),(1600,1000)],fill='#609d7e')
draw.text((30,960),'CLOUDFRAME / GENERATED DEMO FIXTURE',fill='white')
for fmt in ['png','jpeg','webp']:
    image.save(folder / f'demo-landscape.{fmt}', format=fmt.upper())
print(f'Generated three demo images in {folder}')
