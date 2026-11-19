"""Checks of the Computer tools every desktop package must carry.

    python3 -m unittest discover -s apps/desktop/packaging -p '*_test.py'
"""
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import unittest
import zipfile

import archive
import computer_tools

HERE = os.path.dirname(os.path.abspath(__file__))
MACHO = b"\xcf\xfa\xed\xfe" + b"\0" * 28
PLAYWRIGHT_ENTRY = "node_modules/@playwright/mcp/cli.js"
PI_EXTENSION = "extensions/pi-mcp.mjs"
# The pins the shared validator holds the manifest to.
FROZEN = json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e",
    "import { COMPUTER_TOOL_VERSIONS as versions, CUA_ARCHIVES as cua } from "
    + json.dumps("file://" + os.path.join(HERE, "..", "..", "..", "scripts", "computer-tool-bundle.mjs"))
    + "; console.log(JSON.stringify({ versions, cua }))",
]))


def sha256(path):
    with open(path, "rb") as source:
        return hashlib.sha256(source.read()).hexdigest()


def stage(root, target):
    """A resources/ folder holding tools laid out as stage-computer-tools.mjs writes them."""
    tools = os.path.join(root, "cli", "computer-tools")
    files = {
        PLAYWRIGHT_ENTRY: b"console.log('playwright')\n",
        PI_EXTENSION: b"export default {}\n",
        "node_modules/native/prebuilt.node": MACHO,
    }
    cua = FROZEN["cua"].get(target, {})
    for relative in cua.get("required", []):
        files[relative] = MACHO + relative.encode()
    assets = []
    for relative in sorted(files):
        path = os.path.join(tools, *relative.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as out:
            out.write(files[relative])
        assets.append({"path": relative, "size_bytes": len(files[relative]),
                       "sha256": sha256(path), "mode": 0o644})
    # JSON.stringify of the asset list, as bundle-computer-tools.mjs digests it.
    digest = hashlib.sha256(json.dumps(assets, separators=(",", ":")).encode()).hexdigest()
    manifest = {"schema_version": 1, "versions": FROZEN["versions"], "target": target,
                "playwright_entry": PLAYWRIGHT_ENTRY, "pi_extension": PI_EXTENSION,
                "cua_entry": cua.get("entry", ""), "packages": [],
                "assets": assets, "artifact_sha256": digest}
    with open(os.path.join(tools, "manifest.json"), "w") as out:
        json.dump(manifest, out)
    node = os.path.join(root, computer_tools.node_path(target))
    os.makedirs(os.path.dirname(node))
    with open(node, "wb") as out:
        out.write(b"node")
    os.chmod(node, 0o755)
    return tools


class ComputerToolsTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root)

    def resources(self, target="linux-x64"):
        resources = os.path.join(self.root, target, "resources")
        return resources, stage(resources, target)

    def test_accepts_the_staged_tools_of_every_shipped_target(self):
        for target in ("darwin-arm64", "linux-x64", "win32-x64"):
            resources, _ = self.resources(target)
            computer_tools.verify(resources, target)

    def test_rejects_resources_without_the_tools(self):
        resources = os.path.join(self.root, "resources")
        os.makedirs(os.path.join(resources, "computer"))
        with self.assertRaisesRegex(computer_tools.Invalid, "manifest.json"):
            computer_tools.verify(resources, "linux-x64")
        with self.assertRaises(SystemExit):
            computer_tools.check(resources, "linux-x64")

    def test_rejects_changed_unlisted_or_missing_files(self):
        resources, tools = self.resources()
        with open(os.path.join(tools, PI_EXTENSION), "ab") as out:
            out.write(b"//")
        with self.assertRaisesRegex(computer_tools.Invalid, "do not match their manifest"):
            computer_tools.verify(resources, "linux-x64")

        resources, tools = self.resources("win32-x64")
        with open(os.path.join(tools, "extra.js"), "w") as out:
            out.write("1")
        with self.assertRaisesRegex(computer_tools.Invalid, "do not match their manifest"):
            computer_tools.verify(resources, "win32-x64")

        resources, _ = self.resources("darwin-arm64")
        os.remove(os.path.join(resources, "runtime", "bin", "node"))
        with self.assertRaisesRegex(computer_tools.Invalid, "missing or not executable"):
            computer_tools.verify(resources, "darwin-arm64")

    def test_rejects_tools_for_another_target(self):
        resources, _ = self.resources("darwin-arm64")
        with self.assertRaisesRegex(computer_tools.Invalid, "Invalid Computer tool manifest"):
            computer_tools.verify(resources, "darwin-x64")

    def test_copy_places_the_staged_tools_next_to_the_daemon_folder(self):
        staged = os.path.join(self.root, "dist", "computer-tools")
        stage(os.path.join(staged, "linux-x64"), "linux-x64")
        resources = os.path.join(self.root, "app", "resources")
        os.makedirs(resources)
        computer_tools.copy(resources, "linux-x64", staged=staged)
        computer_tools.verify(resources, "linux-x64")
        with self.assertRaises(SystemExit):
            computer_tools.copy(resources, "win32-x64", staged=staged)

    def test_refresh_records_only_resigned_macho_files(self):
        resources, tools = self.resources("darwin-arm64")
        for relative in ("node_modules/native/prebuilt.node", "cua/cua-driver"):
            with open(os.path.join(tools, relative), "ab") as out:
                out.write(b"signature")
        computer_tools.refresh_signed(resources, kept=["cua/cua-driver"])
        # The vendor-signed driver must come back unchanged.
        with self.assertRaisesRegex(computer_tools.Invalid, "do not match their manifest"):
            computer_tools.verify(resources, "darwin-arm64")

        resources, tools = self.resources("linux-x64")
        with open(os.path.join(tools, "node_modules/native/prebuilt.node"), "ab") as out:
            out.write(b"signature")
        computer_tools.refresh_signed(resources)
        computer_tools.verify(resources, "linux-x64")
        with open(os.path.join(tools, PLAYWRIGHT_ENTRY), "ab") as out:
            out.write(b"//")
        computer_tools.refresh_signed(resources)
        with self.assertRaisesRegex(computer_tools.Invalid, "do not match their manifest"):
            computer_tools.verify(resources, "linux-x64")

    def test_finished_archives_must_hold_the_tools(self):
        resources, _ = self.resources("linux-x64")
        app = os.path.dirname(resources)
        archive = os.path.join(self.root, "Linger.tar.gz")
        with tarfile.open(archive, "w:gz") as out:
            out.add(app, arcname="Linger")
        self.assertEqual(computer_tools.verify_archive(archive, "Linger/resources/", "linux-x64"), 3)

        resources, _ = self.resources("win32-x64")
        archive = os.path.join(self.root, "Linger.zip")
        with zipfile.ZipFile(archive, "w") as out:
            for root, _, files in os.walk(resources):
                for name in files:
                    path = os.path.join(root, name)
                    out.write(path, "Linger/resources/" + os.path.relpath(path, resources))
        self.assertEqual(computer_tools.verify_archive(archive, "Linger/resources/", "win32-x64"), 4)

        bare = os.path.join(self.root, "bare.tar.gz")
        with tarfile.open(bare, "w:gz") as out:
            info = tarfile.TarInfo("Linger/resources/computer/linger-computer-daemon")
            info.size = 4
            out.addfile(info, io.BytesIO(b"bin\n"))
        with self.assertRaisesRegex(computer_tools.Invalid, "has no Linger/resources/cli"):
            computer_tools.verify_archive(bare, "Linger/resources/", "linux-x64")
        with self.assertRaises(SystemExit):
            computer_tools.check_archive(bare, "Linger/resources/", "linux-x64")


class MacSigningTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("mac_package", os.path.join(HERE, "mac", "package.py"))
        self.mac = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mac)

    def test_tools_node_gets_the_node_entitlements(self):
        self.assertTrue(self.mac.bundled_node("Contents/Resources/runtime/bin/node"))
        self.assertFalse(self.mac.bundled_node("Contents/Resources/computer/linger-computer-daemon"))

    def test_cua_app_keeps_its_vendor_signature(self):
        app = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, app)
        args = self.mac.Signing("rcodesign").app_args(app)
        self.assertIn("Contents/Resources/cli/computer-tools/cua/CuaDriver.app",
                      args[args.index("--exclude") + 1])


class ArchiveHelperTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root)

    def test_tar_gz_preserves_symlinks_and_applies_root_owner_option(self):
        bundle = os.path.join(self.root, "Linger")
        os.makedirs(bundle)
        file_path = os.path.join(bundle, "hello.txt")
        with open(file_path, "wb") as out:
            out.write(b"linger\n")
        os.symlink("hello.txt", os.path.join(bundle, "link.txt"))

        owned = os.path.join(self.root, "owned.tar.gz")
        archive.tar_gz(self.root, "Linger", owned, root_owner=True)
        with tarfile.open(owned, "r:gz") as tf:
            members = {m.name: m for m in tf.getmembers()}
            self.assertEqual(members["Linger/hello.txt"].uid, 0)
            self.assertEqual(members["Linger/hello.txt"].gid, 0)
            self.assertTrue(members["Linger/link.txt"].issym())
            self.assertEqual(members["Linger/link.txt"].linkname, "hello.txt")

        plain = os.path.join(self.root, "plain.tar.gz")
        archive.tar_gz(self.root, "Linger", plain)
        self.assertEqual(archive.sha256(plain), sha256(plain))


if __name__ == "__main__":
    unittest.main()
