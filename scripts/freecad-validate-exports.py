"""Import PARCELGRID DAE/DXF exports with FreeCAD and record CAD evidence."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import FreeCAD as App
import Mesh


FREECAD_RESOURCES = Path(App.getResourceDir()).parent
sys.path.append(str(FREECAD_RESOURCES / "Mod" / "BIM" / "importers"))

import importDAE  # noqa: E402
import importDXF  # noqa: E402


def geometric_bounds(obj):
    if hasattr(obj, "Mesh") and obj.Mesh and obj.Mesh.CountFacets > 0:
        return obj.Mesh.BoundBox, "mesh", obj.Mesh.CountFacets
    if hasattr(obj, "Shape") and obj.Shape and not obj.Shape.isNull():
        return obj.Shape.BoundBox, "shape", len(obj.Shape.Edges)
    return None, None, 0


def summarize_document(doc):
    objects = []
    bounds = []
    for obj in doc.Objects:
        bbox, geometry_type, element_count = geometric_bounds(obj)
        item = {
            "name": obj.Name,
            "label": obj.Label,
            "typeId": obj.TypeId,
            "geometryType": geometry_type,
            "elementCount": element_count,
        }
        if hasattr(obj, "Group"):
            item["children"] = [child.Name for child in obj.Group]
        if bbox is not None and bbox.isValid():
            item["boundsMm"] = {
                "min": [bbox.XMin, bbox.YMin, bbox.ZMin],
                "max": [bbox.XMax, bbox.YMax, bbox.ZMax],
                "size": [bbox.XLength, bbox.YLength, bbox.ZLength],
            }
            bounds.append(bbox)
        objects.append(item)

    combined = None
    if bounds:
        combined = App.BoundBox(bounds[0])
        for bbox in bounds[1:]:
            combined.add(bbox)

    return {
        "name": doc.Name,
        "label": doc.Label,
        "objectCount": len(doc.Objects),
        "geometryObjectCount": len(bounds),
        "combinedBoundsMm": None
        if combined is None
        else {
            "min": [combined.XMin, combined.YMin, combined.ZMin],
            "max": [combined.XMax, combined.YMax, combined.ZMax],
            "size": [combined.XLength, combined.YLength, combined.ZLength],
        },
        "objects": objects,
    }


def assert_roundtrip_bounds(source, reopened, label, tolerance_mm=0.1):
    source_bounds = source["combinedBoundsMm"]
    reopened_bounds = reopened["combinedBoundsMm"]
    if source_bounds is None or reopened_bounds is None:
        raise RuntimeError(f"{label} has no measurable geometry")
    for axis, (expected, actual) in enumerate(
        zip(source_bounds["size"], reopened_bounds["size"])
    ):
        if abs(expected - actual) > tolerance_mm:
            raise RuntimeError(
                f"{label} axis {axis} changed from {expected} mm to {actual} mm"
            )


def main():
    dae_value = os.environ.get("PARCELGRID_DAE_PATH")
    dxf_value = os.environ.get("PARCELGRID_DXF_PATH")
    output_value = os.environ.get("PARCELGRID_CAD_EVIDENCE_PATH")
    if not dae_value or not dxf_value or not output_value:
        raise SystemExit(
            "PARCELGRID_DAE_PATH, PARCELGRID_DXF_PATH, and "
            "PARCELGRID_CAD_EVIDENCE_PATH are required"
        )

    dae_path = Path(dae_value).resolve()
    dxf_path = Path(dxf_value).resolve()
    output_path = Path(output_value).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    draft_preferences = App.ParamGet("User parameter:BaseApp/Preferences/Mod/Draft")
    draft_preferences.SetBool("dxfUseLegacyImporter", False)
    draft_preferences.SetBool("dxfShowDialog", False)

    dae_doc = importDAE.open(str(dae_path))
    if dae_doc is None:
        raise RuntimeError("FreeCAD did not create a document for the DAE file")
    dae_doc.recompute()
    dae_summary = summarize_document(dae_doc)
    dae_fcstd = output_path.with_name("parcelgrid-synthetic-dae.FCStd")
    dae_doc.saveAs(str(dae_fcstd))
    App.closeDocument(dae_doc.Name)

    dae_reopened = App.openDocument(str(dae_fcstd))
    dae_reopened.recompute()
    dae_reopened_summary = summarize_document(dae_reopened)
    assert_roundtrip_bounds(dae_summary, dae_reopened_summary, "DAE FCStd reopen")

    dae_roundtrip_path = output_path.with_name(
        "parcelgrid-synthetic-dae-roundtrip.stl"
    )
    dae_meshes = [
        obj
        for obj in dae_reopened.Objects
        if hasattr(obj, "Mesh") and obj.Mesh and obj.Mesh.CountFacets > 0
    ]
    Mesh.export(dae_meshes, str(dae_roundtrip_path))
    App.closeDocument(dae_reopened.Name)

    dae_roundtrip_doc = App.newDocument("parcelgridSyntheticDaeRoundtrip")
    Mesh.insert(str(dae_roundtrip_path), dae_roundtrip_doc.Name)
    dae_roundtrip_doc.recompute()
    dae_roundtrip_summary = summarize_document(dae_roundtrip_doc)
    assert_roundtrip_bounds(
        dae_summary,
        dae_roundtrip_summary,
        "DAE to STL roundtrip",
        tolerance_mm=1.0,
    )
    App.closeDocument(dae_roundtrip_doc.Name)

    dxf_doc = importDXF.open(str(dxf_path))
    if dxf_doc is None:
        raise RuntimeError("FreeCAD did not create a document for the DXF file")
    dxf_doc.recompute()
    dxf_summary = summarize_document(dxf_doc)
    dxf_fcstd = output_path.with_name("parcelgrid-synthetic-dxf.FCStd")
    dxf_doc.saveAs(str(dxf_fcstd))
    App.closeDocument(dxf_doc.Name)

    dxf_reopened = App.openDocument(str(dxf_fcstd))
    dxf_reopened.recompute()
    dxf_reopened_summary = summarize_document(dxf_reopened)
    assert_roundtrip_bounds(dxf_summary, dxf_reopened_summary, "DXF FCStd reopen")

    dxf_roundtrip_path = output_path.with_name(
        "parcelgrid-synthetic-dxf-roundtrip.dxf"
    )
    dxf_geometry = [
        obj for obj in dxf_reopened.Objects if geometric_bounds(obj)[0] is not None
    ]
    importDXF.export(dxf_geometry, str(dxf_roundtrip_path))
    App.closeDocument(dxf_reopened.Name)

    dxf_roundtrip_doc = importDXF.open(str(dxf_roundtrip_path))
    if dxf_roundtrip_doc is None:
        raise RuntimeError("FreeCAD did not reopen the round-tripped DXF file")
    dxf_roundtrip_doc.recompute()
    dxf_roundtrip_summary = summarize_document(dxf_roundtrip_doc)
    assert_roundtrip_bounds(
        dxf_summary,
        dxf_roundtrip_summary,
        "DXF export/import roundtrip",
        tolerance_mm=1.0,
    )
    App.closeDocument(dxf_roundtrip_doc.Name)

    evidence = {
        "kind": "actual FreeCAD import evidence",
        "freecadVersion": ".".join(App.Version()[:3]),
        "freecadRevision": App.Version()[3],
        "dae": {
            "source": str(dae_path),
            "savedDocument": str(dae_fcstd),
            "reopenedDocument": dae_reopened_summary,
            "roundtripExport": str(dae_roundtrip_path),
            "roundtripDocument": dae_roundtrip_summary,
            **dae_summary,
        },
        "dxf": {
            "source": str(dxf_path),
            "savedDocument": str(dxf_fcstd),
            "reopenedDocument": dxf_reopened_summary,
            "roundtripExport": str(dxf_roundtrip_path),
            "roundtripDocument": dxf_roundtrip_summary,
            **dxf_summary,
        },
    }
    output_path.write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "freecadVersion": evidence["freecadVersion"],
        "daeObjects": dae_summary["objectCount"],
        "daeGeometryObjects": dae_summary["geometryObjectCount"],
        "dxfObjects": dxf_summary["objectCount"],
        "dxfGeometryObjects": dxf_summary["geometryObjectCount"],
        "daeRoundtripGeometryObjects": dae_roundtrip_summary["geometryObjectCount"],
        "dxfRoundtripGeometryObjects": dxf_roundtrip_summary["geometryObjectCount"],
        "output": str(output_path),
    }))


if __name__ == "__main__":
    main()
