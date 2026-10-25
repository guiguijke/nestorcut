"""DWG -> DXF conversion via GNU LibreDWG's `dwgread` CLI (GPL v3).

DWG is a closed binary format no mature Python library reads. `dwgread`
runs as a plain subprocess ("mere aggregation" — our code never links
against it), converts locally inside the container (no external service,
vault/privacy safe), and writes a DXF that the normal pipeline then reads.

When the binary is missing (image built without LibreDWG) or the file is
unreadable (too recent, corrupted, R2013+ experimental), the error is
explicit and actionable — never silent garbage.
"""
import os
import subprocess
import tempfile

from worker_common.logger import setup_logger

logger = setup_logger("dwg_convert")

DWGREAD_BIN = os.environ.get("DWGREAD_BIN", "dwgread")
CONVERT_TIMEOUT_SEC = int(os.environ.get("DWG_CONVERT_TIMEOUT", "60"))


DWG_CODE_CONVERTER_MISSING = "dwg_converter_missing"
DWG_CODE_TIMEOUT = "dwg_timeout"
DWG_CODE_VERSION_UNSUPPORTED = "dwg_version_unsupported"
DWG_CODE_CONVERSION_FAILED = "dwg_conversion_failed"
DWG_OUTPUT_UNREADABLE = "dwg_output_unreadable"

# Dernière version DWG que LibreDWG lit correctement (R2010). Le magic
# `AC10xx` (en-tête, 6 octets) est comparé en ordre lexical : AC1027 (R2013)
# et au-delà sont rejetés proprement, sans toucher au reste du pipeline.
_LAST_SUPPORTED_DWG_VERSION = b"AC1024"


class DwgConversionError(Exception):
    """Raised when a DWG cannot be converted.

    `code` is the stable cause (DWG_CODE_* above): it is stored on the file
    document and mapped to a readable message by the app. `detail` is
    internal (worker log only) and never reaches the document.
    """

    def __init__(self, code: str, detail: str):
        super().__init__(code)
        self.code = code
        self.detail = detail


def dwg_bytes_to_dxf_bytes(dwg_bytes: bytes) -> bytes:
    """Converts DWG bytes to DXF bytes via dwgread. Raises
    DwgConversionError (stable `code`) on any failure."""
    with tempfile.TemporaryDirectory() as tmpdir:
        src = os.path.join(tmpdir, "input.dwg")
        dst = os.path.join(tmpdir, "output.dxf")
        with open(src, "wb") as f:
            f.write(dwg_bytes)
        try:
            result = subprocess.run(
                [DWGREAD_BIN, "-O", "DXF", "-o", dst, src],
                capture_output=True,
                timeout=CONVERT_TIMEOUT_SEC,
            )
        except FileNotFoundError:
            raise _failure(
                DWG_CODE_CONVERTER_MISSING,
                f"dwgread binary not found ({DWGREAD_BIN})",
            )
        except subprocess.TimeoutExpired:
            raise _failure(
                DWG_CODE_TIMEOUT,
                f"dwgread exceeded {CONVERT_TIMEOUT_SEC}s",
            )

        if result.returncode != 0 or not os.path.exists(dst):
            tail = (result.stderr or b"").decode("utf-8", "ignore")[-300:]
            version = bytes(dwg_bytes[:6])
            if version > _LAST_SUPPORTED_DWG_VERSION:
                raise _failure(
                    DWG_CODE_VERSION_UNSUPPORTED,
                    f"dwgread rc={result.returncode}, DWG version {version!r} "
                    "newer than R2010",
                    rc=result.returncode,
                    stderr=tail,
                )
            raise _failure(
                DWG_CODE_CONVERSION_FAILED,
                f"dwgread rc={result.returncode}, no DXF produced",
                rc=result.returncode,
                stderr=tail,
            )

        with open(dst, "rb") as f:
            dxf = f.read()

    logger.info("DWG converted", extra={"dxf_bytes": len(dxf)})
    return dxf


def _failure(code: str, detail: str, **extra) -> DwgConversionError:
    logger.error("DWG conversion failed", extra={"code": code, "detail": detail, **extra})
    return DwgConversionError(code, detail)
