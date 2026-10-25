"""DWG conversion (dwgread subprocess): unit tests with a mocked binary +
integration test gated on the real converter (fixture DWG written by
dwgwrite at test time — no licensing question on fixtures)."""
import shutil
import subprocess
import sys
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.dwg_convert import (
    DWG_CODE_CONVERSION_FAILED,
    DWG_CODE_CONVERTER_MISSING,
    DWG_CODE_TIMEOUT,
    DWG_CODE_VERSION_UNSUPPORTED,
    DwgConversionError,
    dwg_bytes_to_dxf_bytes,
)

HAS_DWGREAD = shutil.which("dwgread") is not None
HAS_DWGWRITE = shutil.which("dwgwrite") is not None


def _rc(rc, stderr=b"garbage input"):
    def fake_run(cmd, capture_output, timeout):
        return subprocess.CompletedProcess(cmd, rc, stdout=b"", stderr=stderr)
    return fake_run


class TestDwgErrors:
    """Chaque échec porte une cause STABLE (`code`) ; le détail technique
    ne sort pas du worker (il n'est jamais écrit sur le document)."""

    def test_missing_binary_has_code(self):
        with mock.patch("core.dwg_convert.subprocess.run", side_effect=FileNotFoundError):
            with pytest.raises(DwgConversionError) as exc:
                dwg_bytes_to_dxf_bytes(b"AC1015fake")
        assert exc.value.code == DWG_CODE_CONVERTER_MISSING
        assert str(exc.value) == DWG_CODE_CONVERTER_MISSING

    def test_timeout_has_code(self):
        with mock.patch(
            "core.dwg_convert.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd="dwgread", timeout=60),
        ):
            with pytest.raises(DwgConversionError) as exc:
                dwg_bytes_to_dxf_bytes(b"AC1015fake")
        assert exc.value.code == DWG_CODE_TIMEOUT

    @pytest.mark.parametrize("header", [b"AC1027", b"AC1032", b"AC1040"])
    def test_recent_version_is_unsupported(self, header):
        with mock.patch("core.dwg_convert.subprocess.run", side_effect=_rc(1)):
            with pytest.raises(DwgConversionError) as exc:
                dwg_bytes_to_dxf_bytes(header + b"fake")
        assert exc.value.code == DWG_CODE_VERSION_UNSUPPORTED

    @pytest.mark.parametrize("header", [b"AC1009", b"AC1015", b"AC1024"])
    def test_supported_version_failing_is_conversion_failed(self, header):
        with mock.patch("core.dwg_convert.subprocess.run", side_effect=_rc(1)):
            with pytest.raises(DwgConversionError) as exc:
                dwg_bytes_to_dxf_bytes(header + b"fake")
        assert exc.value.code == DWG_CODE_CONVERSION_FAILED

    def test_zero_exit_without_output_is_conversion_failed(self):
        # rc 0 mais aucun DXF écrit : même cause que rc != 0 pour l'utilisateur.
        with mock.patch("core.dwg_convert.subprocess.run", side_effect=_rc(0)):
            with pytest.raises(DwgConversionError) as exc:
                dwg_bytes_to_dxf_bytes(b"AC1015fake")
        assert exc.value.code == DWG_CODE_CONVERSION_FAILED

    def test_raw_stderr_stays_out_of_the_error(self):
        with mock.patch(
            "core.dwg_convert.subprocess.run",
            side_effect=_rc(1, stderr=b"/opt/internal/path/secret.c:42"),
        ):
            with pytest.raises(DwgConversionError) as exc:
                dwg_bytes_to_dxf_bytes(b"AC1015fake")
        assert "secret" not in str(exc.value)
        assert "secret" not in exc.value.detail


@pytest.mark.skipif(not HAS_DWGREAD, reason="dwgread (LibreDWG) not installed on this host")
class TestDwgIntegration:
    def test_invalid_dwg_is_rejected_cleanly(self):
        with pytest.raises(DwgConversionError) as exc:
            dwg_bytes_to_dxf_bytes(b"AC1015 definitely not a real dwg")
        assert exc.value.code in (DWG_CODE_CONVERSION_FAILED, DWG_CODE_VERSION_UNSUPPORTED)
        with pytest.raises(DwgConversionError):
            dwg_bytes_to_dxf_bytes(b"AC1027 definitely not a real dwg")

    @pytest.mark.skipif(not HAS_DWGWRITE, reason="dwgwrite not installed on this host")
    def test_roundtrip_fixture_generated_by_dwgwrite(self, tmp_path):
        """dwgwrite builds a DWG from a DXF R2000; dwgread must read it back
        with the entities intact (line + circle). The DXF is authored with
        ezdxf: handwritten minimal DXFs lack the HEADER/table sections
        dwgwrite requires."""
        import ezdxf

        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = 4
        msp = doc.modelspace()
        msp.add_line((0, 0), (100, 50))
        msp.add_circle((50, 50), 25)
        dxf = tmp_path / "fixture.dxf"
        doc.saveas(dxf)

        dwg = tmp_path / "fixture.dwg"
        subprocess.run(
            ["dwgwrite", "-I", "DXF", "-o", str(dwg), str(dxf)],
            check=True, capture_output=True, timeout=60,
        )
        out = dwg_bytes_to_dxf_bytes(dwg.read_bytes())
        assert b"LINE" in out
        assert b"CIRCLE" in out
