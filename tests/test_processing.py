from io import BytesIO
from pathlib import Path
import sys
import pytest
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
from processing import transform, PermanentError

def fixture(fmt='PNG', size=(640, 320), mode='RGB'):
    out = BytesIO()
    Image.new(mode, size, (90, 160, 120, 100) if mode == 'RGBA' else (90, 160, 120)).save(out, format=fmt)
    return out.getvalue()

@pytest.mark.parametrize('fmt', ['jpeg', 'png', 'webp'])
def test_real_encoding_and_resize(fmt):
    data, meta = transform(fixture(), {'format': fmt, 'width': 200, 'height': 200})
    with Image.open(BytesIO(data)) as image:
        assert image.size == (200, 100)
        assert image.format.lower() == fmt
    assert meta['size'] == len(data)

def test_rotation_precedes_resize_and_thumbnail():
    _, meta = transform(fixture(), {'rotate': 90, 'thumbnail': True})
    assert (meta['width'], meta['height']) == (160, 320)

def test_stretched_resize_and_grayscale():
    data, meta = transform(fixture(), {'format': 'png', 'width': 100, 'height': 90, 'preserveAspect': False, 'grayscale': True})
    assert (meta['width'], meta['height']) == (100, 90)
    with Image.open(BytesIO(data)) as image:
        r, g, b, _ = image.getpixel((0, 0))
        assert r == g == b

def test_alpha_composited_for_jpeg():
    data, _ = transform(fixture(mode='RGBA'), {'format': 'jpeg'})
    with Image.open(BytesIO(data)) as image:
        assert image.mode == 'RGB'
        assert image.getpixel((0, 0))[0] > 90

def test_watermark_changes_pixels():
    original, _ = transform(fixture(), {'format': 'png'})
    marked, _ = transform(fixture(), {'format': 'png', 'watermark': 'CloudFrame demo'})
    assert marked != original

@pytest.mark.parametrize('settings', [{'rotate': 45}, {'width': -1}, {'format': 'svg'}, {'quality': 0}, {'width': 8192, 'height': 8192, 'preserveAspect': False}, {'watermark': 'x' * 81}])
def test_untrusted_settings_rejected(settings):
    with pytest.raises(PermanentError):
        transform(fixture(), settings)

def test_corruption_is_permanent():
    with pytest.raises(PermanentError):
        transform(b'not-an-image', {})

def test_decoded_pixel_bomb_limit():
    with pytest.raises(PermanentError):
        transform(fixture(size=(100, 100)), {}, max_pixels=100)

def test_animated_image_rejected():
    out = BytesIO()
    Image.new('RGB', (20,20), 'red').save(out, format='WEBP', save_all=True, append_images=[Image.new('RGB',(20,20),'blue')])
    with pytest.raises(PermanentError):
        transform(out.getvalue(), {})
