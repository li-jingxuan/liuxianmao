import hashlib
import json
from pathlib import Path
import re
import sys
import tarfile
import urllib.request


API = 'https://api.github.com/repos/li-jingxuan/liuxianmao'
BUILD_INPUTS = {
    'build-liuxianmao': ({
        'Dockerfile', '.dockerignore', '.npmrc', 'package.json', 'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'docs/design-v2/records/20261111_chord-catalog-data-audit-v2.json',
    }, ('apps/website/', 'packages/')),
    'build-gateway': ({
        'deploy/fnos/gateway.Dockerfile', 'deploy/fnos/proxy.cjs', 'deploy/fnos/verify.cjs',
    }, ()),
}


def github(path):
    request = urllib.request.Request(API + path, headers={'User-Agent': 'Liuxianmao-NAS-release'})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def check_main(commit):
    if not re.fullmatch('[0-9a-f]{40}', commit) or github('/git/ref/heads/main')['object']['sha'] != commit:
        raise SystemExit('Deployment requires the current GitHub main commit. Start a new run for main.')


def extract(target, commit, destination):
    check_main(commit)
    # 仅接受目标镜像实际需要的文件；每个文件的 Git blob 校验沿用发布前的源码完整性校验。
    files, prefixes = BUILD_INPUTS[target]
    tree = github('/git/trees/' + commit + '?recursive=1')
    if tree.get('truncated'):
        raise SystemExit('GitHub returned an incomplete tree.')
    expected = {}
    for entry in tree['tree']:
        name = entry['path']
        if entry['type'] == 'tree' or (name not in files and not name.startswith(prefixes)):
            continue
        if entry['type'] != 'blob' or entry['mode'] not in ('100644', '100755'):
            raise SystemExit(f'Unsupported Git entry: {name}')
        expected[name] = entry
    if not files <= expected.keys():
        raise SystemExit('The Git tree is missing required build files.')
    directories = {str(parent) for name in expected for parent in Path(name).parents}

    with tarfile.open(fileobj=sys.stdin.buffer, mode='r|gz') as archive:
        for member in archive:
            if member.isdir() and member.name in directories:
                continue
            entry = expected.pop(member.name, None)
            if not member.isfile() or entry is None or member.size != entry['size']:
                raise SystemExit(f'Unexpected archive entry: {member.name!r}')
            with archive.extractfile(member) as source:
                content = source.read()
            header = f'blob {len(content)}\0'.encode()
            if hashlib.sha1(header + content).hexdigest() != entry['sha']:
                raise SystemExit(f'Git checksum mismatch: {member.name!r}')
            path = destination / member.name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            path.chmod(0o755 if entry['mode'] == '100755' else 0o644)
    if expected:
        raise SystemExit(f'Archive omitted {len(expected)} build files.')


if __name__ == '__main__':
    if sys.argv[1] == 'check-main':
        check_main(sys.argv[2])
    else:
        extract(sys.argv[1], sys.argv[2], Path(sys.argv[3]))
