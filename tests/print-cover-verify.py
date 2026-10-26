"""Independent file/geometry/density checks; accepts a private harness output folder."""
import json, math, pathlib, sys, zlib, struct
from pypdf import PdfReader
from PIL import Image

directory = pathlib.Path(sys.argv[1]).resolve()
files = json.loads((directory / 'FILES.json').read_text(encoding='utf-8'))
receipt = []
for item in files:
    path = directory / item['name']
    layout = item['layoutMm']
    W, H, S, B = [layout[key] for key in ('trimWidthMm', 'trimHeightMm', 'spineMm', 'bleedMm')]
    media = [0, 0, (2 * W + S + 2 * B) * 72 / 25.4, (H + 2 * B) * 72 / 25.4]
    trim = [B * 72 / 25.4, B * 72 / 25.4, (B + 2 * W + S) * 72 / 25.4, (B + H) * 72 / 25.4]
    if path.suffix == '.pdf':
        reader = PdfReader(path, strict=True)
        assert not reader.is_encrypted and len(reader.pages) == 1
        page = reader.pages[0]
        for key, expected in (('/MediaBox', media), ('/CropBox', media), ('/BleedBox', media), ('/TrimBox', trim)):
            assert key in page, f'Explicit {key} missing'
            assert all(abs(float(a) - b) < .01 for a, b in zip(page[key], expected)), (key, page[key], expected)
        assert page.get('/Rotate', 0) == 0 and page.get('/UserUnit', 1) == 1
        assert not page.get('/Annots') and '/OpenAction' not in reader.trailer['/Root']
        assert len(page.images) == 1
        image = page.images[0].image
        assert image.size == (item['width'], item['height'])
        assert abs(image.width / (media[2] / 72) - item['dpi']) < 1
        receipt.append({'file': path.name, 'onePage': True, 'explicitBoxes': True, 'image': image.size})
    else:
        image = Image.open(path)
        assert image.size == (item['width'], item['height'])
        expected_format = 'JPEG' if path.suffix == '.jpg' else 'PNG'
        assert image.format == expected_format
        density = image.info.get('dpi')
        assert density and all(abs(value - 300) < .02 for value in density), density
        if image.format == 'PNG':
            data = path.read_bytes()
            at, count = 8, 0
            while at < len(data):
                length = struct.unpack('>I', data[at:at + 4])[0]
                kind, payload = data[at + 4:at + 8], data[at + 8:at + 8 + length]
                checksum = struct.unpack('>I', data[at + 8 + length:at + 12 + length])[0]
                assert zlib.crc32(kind + payload) & 0xffffffff == checksum
                if kind == b'pHYs':
                    count += 1
                    assert struct.unpack('>IIB', payload) == (11811, 11811, 1)
                at += length + 12
            assert count == 1
            pixels = image.convert('RGB')
            f = 300 / 25.4
            left = math.floor(B * f + .5)
            back = math.floor(W * f + .5)
            spine = math.floor((W + S) * f + .5)
            for x in range(pixels.width):
                expected = (0, 0, 255) if x < left + back else (0, 170, 51) if x < left + spine else (255, 0, 0)
                assert pixels.getpixel((x, 0)) == expected, ('Top bleed or panel seam', x, pixels.getpixel((x, 0)), expected)
            for x in (0, pixels.width - 1):
                for y in (0, left - 1):
                    assert pixels.getpixel((x, y)) == pixels.getpixel((x, left)), 'Corner/edge extension changed'
        receipt.append({'file': path.name, 'format': image.format, 'dpi': density, 'dimensions': image.size})
(directory / 'INDEPENDENT-VERIFY.json').write_text(json.dumps({'ok': True, 'checks': receipt}, indent=2), encoding='utf-8')
print('PASS independent pypdf strict boxes/image dimensions, Pillow PNG/JPEG real DPI, all PNG CRC and physical panel/bleed seams')
