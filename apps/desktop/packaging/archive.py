"""Shared archive and digest helpers for desktop packaging scripts."""
import hashlib
import os
import shutil
import subprocess
import tarfile


def sha256(path):
    """Streaming SHA-256 hex digest of a file."""
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _owned_by_root(info):
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    return info


def tar_gz(src_dir, name, output, root_owner=False):
    """Packs src_dir/name into output as a .tar.gz, using pigz when available."""
    pigz = shutil.which("pigz")
    tar_bin = shutil.which("tar")
    if pigz and tar_bin:
        cmd = [tar_bin]
        if root_owner:
            cmd += ["--owner=0", "--group=0", "--numeric-owner"]
        cmd += ["-C", src_dir, "-cf", "-", name]
        with open(output, "wb") as out:
            tar_proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
            pigz_proc = subprocess.Popen([pigz, "-6"], stdin=tar_proc.stdout, stdout=out)
            tar_proc.stdout.close()
            pigz_rc = pigz_proc.wait()
            tar_rc = tar_proc.wait()
        if tar_rc != 0:
            raise subprocess.CalledProcessError(tar_rc, "tar")
        if pigz_rc != 0:
            raise subprocess.CalledProcessError(pigz_rc, "pigz")
        return
    with tarfile.open(output, "w:gz") as archive:
        archive.add(
            os.path.join(src_dir, name),
            arcname=name,
            filter=_owned_by_root if root_owner else None,
        )
