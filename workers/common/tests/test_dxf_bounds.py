import ezdxf
import pytest

from worker_common.geometry.dxf_bounds import (
    MAX_INSERT_DEPTH,
    assert_insert_copies,
    assert_insert_depth,
    decompose_bounded,
)


def test_a_minsert_of_an_empty_block_is_refused_before_it_runs():
    doc = ezdxf.new()
    doc.blocks.new("empty")
    doc.modelspace().add_blockref("empty", (0, 0), dxfattribs={
        "row_count": 32000, "column_count": 32000, "row_spacing": 1, "column_spacing": 1})
    with pytest.raises(ValueError, match="more than"):
        assert_insert_copies(doc)


def test_copies_multiply_through_nested_blocks():
    doc = ezdxf.new()
    leaf = doc.blocks.new("leaf")
    leaf.add_line((0, 0), (1, 0))
    mid = doc.blocks.new("mid")
    mid.add_blockref("leaf", (0, 0), dxfattribs={
        "row_count": 300, "column_count": 300, "row_spacing": 1, "column_spacing": 1})
    doc.modelspace().add_blockref("mid", (0, 0), dxfattribs={
        "row_count": 2, "row_spacing": 1000})
    # 2 × (1 + 90 000) occurrences : au-delà du plafond de 100 000.
    with pytest.raises(ValueError, match="more than"):
        assert_insert_copies(doc)


def test_a_graph_of_doubled_inserts_is_refused_before_it_runs():
    doc = ezdxf.new()
    doc.blocks.new("B0")
    for k in range(1, 31):
        blk = doc.blocks.new(f"B{k}")
        blk.add_blockref(f"B{k - 1}", (0, 0))
        blk.add_blockref(f"B{k - 1}", (0, 0))
    doc.modelspace().add_blockref("B30", (0, 0))
    with pytest.raises(ValueError, match="more than"):
        assert_insert_copies(doc)


def test_a_reasonable_minsert_passes_and_every_copy_is_decomposed():
    doc = ezdxf.new()
    blk = doc.blocks.new("tile")
    blk.add_line((0, 0), (1, 0))
    doc.modelspace().add_blockref("tile", (0, 0), dxfattribs={
        "row_count": 2, "column_count": 3, "row_spacing": 10, "column_spacing": 10})
    assert_insert_copies(doc)
    assert len(decompose_bounded(doc.modelspace())) == 6


def test_shallow_insert_is_accepted():
    doc = ezdxf.new()
    blk = doc.blocks.new("part")
    blk.add_line((0, 0), (10, 0))
    doc.modelspace().add_blockref("part", (0, 0))
    assert_insert_depth(doc)
    ents = decompose_bounded(doc.modelspace())
    assert len(ents) >= 1


def test_insert_chain_deeper_than_max_is_rejected():
    doc = ezdxf.new()
    prev = None
    depth = MAX_INSERT_DEPTH + 3
    for i in range(depth):
        name = f"B{i}"
        blk = doc.blocks.new(name)
        if prev is None:
            blk.add_line((0, 0), (1, 0))
        else:
            blk.add_blockref(prev, (0, 0))
        prev = name
    doc.modelspace().add_blockref(prev, (0, 0))
    with pytest.raises(ValueError, match="block nesting"):
        assert_insert_depth(doc)
