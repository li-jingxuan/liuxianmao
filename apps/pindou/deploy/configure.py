#!/usr/bin/env python3
"""Render both deployment environments from deploy/.env without shell evaluation."""
import argparse
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import quote


def read_env(path):
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)', line)
        if not match or match[1] in values:
            raise ValueError('Invalid or duplicate environment entry')
        value = match[2]
        # Master files use JSON double quotes (same convention as fnOS config).
        if value.startswith('"'):
            value = json.loads(value)
        elif any(character in value for character in "'\"\\$\n\r"):
            raise ValueError('Use JSON double quotes for special environment values')
        if re.search(r'(?<!\$)\$(?!\$)', value):
            raise ValueError('Encode literal dollars as $$')
        values[match[1]] = value.replace('$$', '$')
    return values


def write_env(path, values, comment='# Generated from deploy/.env; do not edit or source.\n'):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.pindou-')
    try:
        with os.fdopen(descriptor, 'w') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(comment)
            for key, value in values.items():
                if not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or any(ord(c) < 32 for c in str(value)):
                    raise ValueError('Invalid environment value')
                output.write(key + '=' + json.dumps(str(value).replace('$', '$$'), ensure_ascii=False) + '\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def render(master):
    ordinary = {k: v for k, v in master.items() if not k.startswith('FNOS_')}
    nas = dict(ordinary)
    nas.update({k[5:]: v for k, v in master.items() if k.startswith('FNOS_')})
    result = []
    for values in (ordinary, nas):
        for key in ('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'KEY_ISSUER_API_KEY', 'API_KEY_HASH_PEPPER', 'ARK_DOUBAO_API_KEY'):
            if not values.get(key):
                raise ValueError('Required configuration is missing')
        url = 'postgresql+psycopg://{}:{}@postgres:5432/{}'.format(
            *(quote(values[key], safe='') for key in ('POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB')))
        if values.get('DATABASE_URL') != url:
            raise ValueError('Database URL and credentials disagree; restore the correct configuration')
        postgres = {key: values[key] for key in ('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD')}
        # Settings parameters only: never put DB admin passwords/build flags or the
        # other deployment's credentials in API containers.
        api = {key: value for key, value in values.items() if key in API_KEYS}
        result.append((values, api, postgres))
    return result


# Keep runtime settings separate from image/build/deployment parameters.
API_KEYS = set('''APP_ENV API_HOST API_PORT API_RELOAD DATABASE_URL KEY_ISSUER_API_KEY
API_KEY_HASH_PEPPER IMAGE_ENHANCER ARK_DOUBAO_API_KEY ARK_DOUBAO_BASE_URL
ARK_DOUBAO_IMAGE_MODEL_PRO ARK_DOUBAO_IMAGE_MODEL_LITE ARK_DOUBAO_IMAGE_SIZE
ARK_DOUBAO_RESPONSE_FORMAT ARK_DOUBAO_WATERMARK ARK_DOUBAO_CONNECT_TIMEOUT_SECONDS
ARK_DOUBAO_READ_TIMEOUT_SECONDS ARK_DOUBAO_WRITE_TIMEOUT_SECONDS ARK_DOUBAO_POOL_TIMEOUT_SECONDS
ARK_DOUBAO_MAX_CONCURRENCY ARK_DOUBAO_QUEUE_TIMEOUT_SECONDS ARK_DOUBAO_MAX_RESPONSE_BYTES
SEEDREAM_INPUT_MAX_EDGE SEEDREAM_OUTPUT_MAX_PIXELS UPLOAD_MAX_BYTES UPLOAD_MAX_PIXELS
MIN_GRID_SIZE MAX_GRID_SIZE DEFAULT_COLOR_SET_SIZE COLOR_CHART_PATH MARD_COLOR_CHART_PATH IMAGE_BACKUP_DIR
EVENT_LOG_DIR IMAGE_DELIVERY_DIR IMAGE_DELIVERY_TTL_SECONDS IMAGE_DELIVERY_MAX_BYTES
IMAGE_DELIVERY_MAX_PIXELS IMAGE_DELIVERY_CLEANUP_INTERVAL_SECONDS NAS_ALBUM_ENABLED
NAS_ALBUM_BASE_URL NAS_ALBUM_ID FOREGROUND_MASK_ADAPTER
FOREGROUND_MODEL_VARIANT FOREGROUND_MASK_MAX_CONCURRENCY FOREGROUND_MASK_QUEUE_TIMEOUT_SECONDS
FOREGROUND_ONNX_INTRA_OP_THREADS FOREGROUND_ONNX_ALLOW_SPINNING'''.split())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', type=Path, default=Path(__file__).parent / '.env')
    parser.add_argument('--fnos-etc', type=Path, help='Installed fnOS etc directory; default is fnos/.runtime')
    parser.add_argument('--fnos-only', action='store_true', help='Render only fnOS files (used by its lifecycle helper)')
    args = parser.parse_args()
    try:
        root = args.env.resolve().parent
        ordinary, nas = render(read_env(args.env))
        fnos_etc = args.fnos_etc or root / 'fnos/.runtime'
        # Validate both environments fully before writing either one.
        if not args.fnos_only:
            ordinary[0]['WEB_API_ENV_FILE'] = '.runtime/web-api.env'
            write_env(root / '.runtime/web.env', ordinary[0])
            write_env(root / '.runtime/web-api.env', ordinary[1])
        write_env(fnos_etc / 'api.env', nas[1])
        write_env(fnos_etc / 'postgres.env', nas[2])
    except Exception:
        parser.exit(1, 'Configuration render failed: check format, required fields, paths and matching DB credentials; values suppressed.\n')
    print('Rendered Web and fnOS environments (0600); values not printed.')


if __name__ == '__main__':
    main()
