"""The browser and computer-control tools the Go daemon loads.

build.mjs stages them per target in dist/computer-tools/<target>/
(scripts/stage-computer-tools.mjs): cli/computer-tools/ with its frozen
manifest.json, and runtime/bin/node, the pinned Node.js they run on. They are
the same files as the Local Computer dependency package. The daemon looks for
them two folders above its executable (localtools.Installed in
apps/computer/local-daemon), so every package script copies both next to
resources/computer/ and checks the result: without them the daemon starts but
offers no browser or computer-control tool.
"""
import json
import os
import shutil
import subprocess
import sys
import tarfile
import zipfile

DESKTOP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAGED = os.path.join(DESKTOP, "dist", "computer-tools")
TOOLS = os.path.join("cli", "computer-tools")
# The frozen manifest's rules live in one place, shared with the Local
# Computer dependency package.
BUNDLE_SCRIPT = os.path.join(DESKTOP, "..", "..", "scripts", "computer-tool-bundle.mjs")


class Invalid(Exception):
    pass


def node_path(target):
    return os.path.join("runtime", "bin", "node.exe" if target.startswith("win32-") else "node")


def _bundle_script(*args):
    result = subprocess.run(["node", BUNDLE_SCRIPT, *args], capture_output=True, text=True)
    if result.returncode:
        raise Invalid(result.stderr.strip() or f"computer-tool-bundle.mjs {args[0]} failed")


def copy(resources, target, staged=STAGED):
    """Copies the target's staged tools into resources/ and checks them."""
    source = os.path.join(staged, target)
    if not os.path.isdir(os.path.join(source, TOOLS)):
        sys.exit(f"dist/ is missing the Computer tools for {target}; run "
                 f"`LINGER_DESKTOP_DAEMON_TARGETS={target} node build.mjs` first")
    for name in ("cli", "runtime"):
        shutil.copytree(os.path.join(source, name), os.path.join(resources, name))
    check(resources, target)


def verify(resources, target):
    """Raises Invalid unless resources/ holds the tools as the daemon expects:
    every file of the frozen manifest and nothing else, and an executable
    Node.js."""
    _bundle_script("verify", resources, target)


def check(resources, target):
    """Exits unless resources/ holds the tools as the daemon expects."""
    try:
        verify(resources, target)
    except Invalid as error:
        sys.exit(f"Computer tools in {resources}: {error}")


def refresh_signed(resources, kept=()):
    """Records the bytes code signing wrote into the tools' Mach-O files.

    Only Mach-O assets may differ from the manifest; any other change still
    fails the check that follows. Paths in kept were put back as the vendor
    signed them and must match as before.
    """
    _bundle_script("record-signed", resources, *kept)


def _archive_members(archive):
    """{name: size} of the archive's files and a reader of one of them."""
    if archive.endswith(".zip"):
        source = zipfile.ZipFile(archive)
        sizes = {info.filename: info.file_size for info in source.infolist() if not info.is_dir()}
        return source, sizes, source.read
    source = tarfile.open(archive, "r:gz")
    sizes = {info.name: info.size for info in source.getmembers() if info.isfile()}
    return source, sizes, lambda name: source.extractfile(name).read()


def verify_archive(archive, resources, target):
    """Raises Invalid unless the finished archive holds the tools at resources,
    its folder of the app's resources/ (for example Linger/resources/)."""
    source, sizes, read = _archive_members(archive)
    with source:
        name = f"{resources}cli/computer-tools/manifest.json"
        if name not in sizes:
            raise Invalid(f"{os.path.basename(archive)} has no {name}")
        manifest = json.loads(read(name))
        if manifest.get("target") != target or not isinstance(manifest.get("assets"), list):
            raise Invalid(f"{name} is not the Computer tool manifest for {target}")
        for asset in manifest["assets"]:
            member = f"{resources}cli/computer-tools/{asset['path']}"
            if sizes.get(member) != asset["size_bytes"]:
                raise Invalid(f"{os.path.basename(archive)} lacks {member} as listed")
        node = resources + node_path(target).replace(os.sep, "/")
        if not sizes.get(node):
            raise Invalid(f"{os.path.basename(archive)} has no {node}")
        return len(manifest["assets"])


def check_archive(archive, resources, target):
    """Exits unless the finished archive holds the tools; prints what it found."""
    try:
        count = verify_archive(archive, resources, target)
    except Invalid as error:
        sys.exit(f"Computer tools: {error}")
    print(f"{os.path.basename(archive)}: Computer tools for {target} present ({count} files and Node.js)")
