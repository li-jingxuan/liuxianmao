import tempfile
import unittest
from pathlib import Path

from configure import read_env, render, write_env


class ConfigTests(unittest.TestCase):
    def master(self):
        return dict(POSTGRES_DB='pindou', POSTGRES_USER='pindou', POSTGRES_PASSWORD='dummy',
                    DATABASE_URL='postgresql+psycopg://pindou:dummy@postgres:5432/pindou',
                    KEY_ISSUER_API_KEY='ordinary-admin', API_KEY_HASH_PEPPER='ordinary-pepper',
                    ARK_DOUBAO_API_KEY='shared-ark', FNOS_KEY_ISSUER_API_KEY='nas-admin',
                    FNOS_API_KEY_HASH_PEPPER='nas-pepper', WEB_IMAGE='dummy:1', FNOS_WEB_IMAGE='dummy:2')

    def test_separate_credentials_and_shared_defaults(self):
        web, nas = render(self.master())
        self.assertEqual(web[1]['KEY_ISSUER_API_KEY'], 'ordinary-admin')
        self.assertEqual(nas[1]['KEY_ISSUER_API_KEY'], 'nas-admin')
        self.assertEqual(nas[1]['API_KEY_HASH_PEPPER'], 'nas-pepper')
        self.assertEqual(web[1]['ARK_DOUBAO_API_KEY'], nas[1]['ARK_DOUBAO_API_KEY'])
        self.assertNotIn('POSTGRES_PASSWORD', web[1])
        self.assertNotIn('FNOS_KEY_ISSUER_API_KEY', web[0])
        self.assertNotIn('WEB_IMAGE', nas[1])

    def test_special_characters_round_trip_and_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'private.env'
            values = {'SECRET': 'literal$with"quote\\slash'}
            write_env(target, values)
            self.assertEqual(read_env(target), values)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_database_mismatch_fails(self):
        master = self.master()
        master['FNOS_POSTGRES_PASSWORD'] = 'other-password'
        with self.assertRaises(ValueError):
            render(master)

    def test_album_settings_only_reach_nas(self):
        master = self.master()
        master.update(FNOS_NAS_ALBUM_BASE_URL='http://host.docker.internal:5666',
                      FNOS_NAS_ALBUM_ID='25')
        web, nas = render(master)
        self.assertEqual(nas[1]['NAS_ALBUM_ID'], '25')
        self.assertEqual(nas[1]['NAS_ALBUM_BASE_URL'], 'http://host.docker.internal:5666')
        self.assertNotIn('NAS_ALBUM_ID', web[1])

    def test_encoded_passwords_and_fnos_only_output(self):
        import subprocess
        import sys
        master = self.master()
        master['FNOS_POSTGRES_PASSWORD'] = 'pa$ss:/@'
        master['FNOS_DATABASE_URL'] = 'postgresql+psycopg://pindou:pa%24ss%3A%2F%40@postgres:5432/pindou'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_env(root / '.env', master)
            subprocess.run([sys.executable, str(Path(__file__).with_name('configure.py')),
                            '--env', str(root / '.env'), '--fnos-etc', str(root / 'etc'), '--fnos-only'], check=True, capture_output=True)
            self.assertFalse((root / '.runtime').exists())
            self.assertEqual(read_env(root / 'etc/postgres.env')['POSTGRES_PASSWORD'], 'pa$ss:/@')
            self.assertEqual(read_env(root / 'etc/api.env')['API_KEY_HASH_PEPPER'], 'nas-pepper')

    def test_invalid_or_duplicate_input_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            for text in ('SECRET="one"\nSECRET="two"\n', 'SECRET="unescaped$dollar"\n', 'not-an-entry\n'):
                path.write_text(text)
                with self.assertRaises(ValueError):
                    read_env(path)


if __name__ == '__main__':
    unittest.main()
