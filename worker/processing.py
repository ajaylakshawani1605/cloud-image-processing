"""Pure, bounded Pillow processing. No network, filenames or shell input."""
from io import BytesIO
import warnings
from PIL import Image, ImageOps, ImageDraw, UnidentifiedImageError

class PermanentError(Exception):
    pass

def transform(data: bytes, settings: dict, max_pixels: int = 25_000_000):
    Image.MAX_IMAGE_PIXELS = max_pixels
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as source:
                if source.format not in ('JPEG', 'PNG', 'WEBP') or getattr(source, 'n_frames', 1) != 1:
                    raise PermanentError('Only single-frame JPEG, PNG and WebP are supported')
                if source.width * source.height > max_pixels:
                    raise PermanentError('Image exceeds the safe pixel limit')
                source.verify()
            with Image.open(BytesIO(data)) as source:
                source.load()
                image = ImageOps.exif_transpose(source).convert('RGBA')
        rotation = settings.get('rotate', 0)
        if rotation not in (0, 90, 180, 270):
            raise PermanentError('Unsupported rotation')
        if rotation:
            image = image.rotate(-rotation, expand=True)
        w, h = settings.get('width'), settings.get('height')
        if any(v is not None and (type(v) is not int or v < 1 or v > 8192) for v in (w, h)):
            raise PermanentError('Invalid output dimensions')
        if w or h:
            if settings.get('preserveAspect', True) or not (w and h):
                ratio = min((w / image.width if w else float('inf')), (h / image.height if h else float('inf')))
                size = (max(1, round(image.width * ratio)), max(1, round(image.height * ratio)))
            else:
                size = (w, h)
            if size[0] * size[1] > max_pixels:
                raise PermanentError('Output exceeds the safe pixel limit')
            image = image.resize(size, Image.Resampling.LANCZOS)
        if settings.get('thumbnail'):
            image.thumbnail((320, 320), Image.Resampling.LANCZOS)
        if settings.get('grayscale'):
            alpha = image.getchannel('A')
            image = ImageOps.grayscale(image).convert('RGBA')
            image.putalpha(alpha)
        watermark = settings.get('watermark', '')
        if watermark:
            if len(watermark) > 80:
                raise PermanentError('Watermark exceeds 80 characters')
            draw = ImageDraw.Draw(image)
            box = draw.textbbox((0, 0), watermark)
            x, y = max(4, image.width - box[2] - 12), max(4, image.height - 24)
            draw.rectangle((max(0, x-4), max(0, y-4), min(image.width, x+box[2]+4), min(image.height, y+20)), fill=(0, 0, 0, 160))
            draw.text((x, y), watermark, fill=(255, 255, 255, 255))
        fmt = settings.get('format', 'webp')
        if fmt not in ('jpeg', 'png', 'webp'):
            raise PermanentError('Unsupported output format')
        quality = settings.get('quality', 82)
        if type(quality) is not int or not 1 <= quality <= 100:
            raise PermanentError('Quality must be between 1 and 100')
        if fmt == 'jpeg':
            background = Image.new('RGB', image.size, 'white')
            background.paste(image, mask=image.getchannel('A'))
            image = background
        output = BytesIO()
        options = {'optimize': True, 'compress_level': round((100-quality)*9/99)} if fmt == 'png' else {'quality': quality}
        image.save(output, format=fmt.upper(), **options)
        result = output.getvalue()
        return result, {'width': image.width, 'height': image.height, 'size': len(result), 'format': fmt, 'mime': f'image/{fmt}'}
    except (Image.DecompressionBombError, Image.DecompressionBombWarning, UnidentifiedImageError, OSError, ValueError) as exc:
        raise PermanentError('Image is corrupt, unsupported, or exceeds safe limits') from exc
