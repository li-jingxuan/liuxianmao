#!/usr/bin/env python3
"""Use one deploy/.env for ordinary Compose or fnOS package builds."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

from configure import read_env, render

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('web', 'fnos'))
    parser.add_argument('arguments', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        master = read_env(ROOT / '.env')
        render(master)
    except Exception:
        parser.exit(1, 'Invalid deploy/.env; configuration values suppressed.\n')
    if args.mode == 'web':
        subprocess.run([sys.executable, str(ROOT / 'configure.py')], check=True)
        command = ['docker', 'compose', '--env-file', str(ROOT / '.runtime/web.env'),
                   '-p', 'pindou', '-f', str(ROOT / 'compose.yaml'), *args.arguments]
        environment = dict(os.environ)
        if master.get('DOCKER_BUILDER'):
            environment['BUILDX_BUILDER'] = master['DOCKER_BUILDER']
        subprocess.run(command, cwd=ROOT, env=environment, check=True)
    else:
        if len(args.arguments) != 1 or args.arguments[0] not in ('check', 'images', 'stage', 'package'):
            parser.error('fnos requires one action: check, images, stage or package')
        environment = dict(os.environ, **master)
        for key in ('API_IMAGE', 'WEB_IMAGE', 'PROXY_IMAGE', 'POSTGRES_IMAGE', 'PACKAGE_VERSION'):
            if 'FNOS_' + key in master:
                environment[key] = master['FNOS_' + key]
        environment['FNOS_DATA_DIR'] = master.get('FNOS_DATA_DIR', str(ROOT / 'fnos/data'))
        environment['FNOS_MASTER_ENV'] = str(ROOT / '.env')
        subprocess.run([str(ROOT / 'fnos/scripts/build.sh'), args.arguments[0]],
                       cwd=ROOT / 'fnos', env=environment, check=True)


if __name__ == '__main__':
    main()
