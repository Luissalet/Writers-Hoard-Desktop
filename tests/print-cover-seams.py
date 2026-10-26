"""Independent decoded PDF image oracle: shared boundaries and exact edge clamp."""
import json, math, pathlib, sys
from pypdf import PdfReader
folder = pathlib.Path(sys.argv[1])
for item in json.loads((folder/'FILES.json').read_text()):
    if not item['name'].endswith('.pdf'):
        continue
    W,H,S,B = [item['layoutMm'][key] for key in ('trimWidthMm','trimHeightMm','spineMm','bleedMm')]
    scale = item['dpi']/25.4
    left,back,spine = [math.floor(value*scale+.5) for value in (B,W,W+S)]
    image = PdfReader(folder/item['name'], strict=True).pages[0].images[0].image.convert('RGB')
    for x in range(image.width):
        expected = (0,0,255) if x < left+back else (0,170,51) if x < left+spine else (255,0,0)
        actual = image.getpixel((x,0))
        assert actual == expected, f'C41_PRINT_EDGE_CLAMP_COLOR_LEAK {item["name"]} x={x}: {actual} expected={expected}'
print('PASS all four PDF embedded rasters: exact solid top edges, shared panel boundaries, zero-spine and fractional bleed without color leaks')
