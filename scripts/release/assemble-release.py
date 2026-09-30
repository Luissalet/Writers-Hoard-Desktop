"""Gather the six release attachments into release/publish-<version>/.

    python scripts/release/assemble-release.py <version> <linux-out dir>

Copies the Windows installer and blockmap from release/ and the AppImage from
the Linux build, renaming them to the hyphenated convention; fixes url/path in
latest-linux.yml (electron-builder writes the AppImage name with a space);
checks every YAML's sha512 and size against its binary; writes SHA256SUMS.txt.
"""
import base64, hashlib, pathlib, shutil, sys

V = sys.argv[1]
lin = pathlib.Path(sys.argv[2])
rel = pathlib.Path(__file__).resolve().parents[2] / 'release'
out = rel / f'publish-{V}'
out.mkdir(exist_ok=True)


def digest(path, algo):
    h = hashlib.new(algo)
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h


for src, dst in [
    (rel / f'Writers Hoard Setup {V}.exe', f'Writers-Hoard-Setup-{V}.exe'),
    (rel / f'Writers Hoard Setup {V}.exe.blockmap', f'Writers-Hoard-Setup-{V}.exe.blockmap'),
    (lin / f'Writers Hoard-{V}.AppImage', f'Writers-Hoard-{V}.AppImage'),
]:
    shutil.copy2(src, out / dst)


def fix_yml(src, name, old, new):
    text = src.read_text(encoding='utf-8').replace(old, new)
    assert f'version: {V}' in text, f'{name} is not for {V}'
    binary = out / new
    assert base64.b64encode(digest(binary, 'sha512').digest()).decode() in text, f'sha512 mismatch in {name}'
    assert f'size: {binary.stat().st_size}' in text, f'size mismatch in {name}'
    (out / name).write_text(text, encoding='utf-8', newline='\n')


fix_yml(rel / 'latest.yml', 'latest.yml', f'Writers-Hoard-Setup-{V}.exe', f'Writers-Hoard-Setup-{V}.exe')
fix_yml(lin / 'latest-linux.yml', 'latest-linux.yml', f'Writers Hoard-{V}.AppImage', f'Writers-Hoard-{V}.AppImage')

names = [f'Writers-Hoard-Setup-{V}.exe', f'Writers-Hoard-Setup-{V}.exe.blockmap', f'Writers-Hoard-{V}.AppImage', 'latest.yml', 'latest-linux.yml']
sums = ''.join(f'{digest(out / n, "sha256").hexdigest()}  {n}\n' for n in names)
(out / 'SHA256SUMS.txt').write_text(sums, encoding='utf-8', newline='\n')
print(sums, end='')
