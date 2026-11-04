"""Images and media in Writer's reading/paperwork views must load through wh-publishing://, not the renderer origin.

The Hoards answer with their own paths (``/api/links/<id>/frames/<n>``); used as-is in ``src`` they resolve against
Writer's renderer origin and show as broken images.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / 'src' / 'engines' / 'publishing' / 'native'
RAW_SERVER_URL = re.compile(r'<(?:img|video|audio|source)\b[^>]*\bsrc=\{\s*[A-Za-z_][\w.]*\.url\s*\}')


def test_media_sources_never_use_a_raw_hoard_path():
    offenders = []
    for module in ('links', 'paperwork'):
        for path in (NATIVE / module).rglob('*.jsx'):
            for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
                if RAW_SERVER_URL.search(line):
                    offenders.append(f'{path.relative_to(ROOT)}:{number}')
    assert offenders == []


def test_video_insight_frame_strip_goes_through_the_module_transport():
    source = (NATIVE / 'links' / 'components' / 'VideoInsight.jsx').read_text(encoding='utf-8')
    assert 'publishingUrl(f.url, "links")' in source
