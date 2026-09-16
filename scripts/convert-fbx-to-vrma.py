#!/usr/bin/env python3
"""
Convert FBX animation files into VRM animation (.vrma) clips, usable by the
AIRI VRM player (@pixiv/three-vrm-animation).

Requires the "VRM Addon for Blender" (bl_ext.blender_org.vrm) installed and
enabled for the Blender you invoke. It only needs to be present in the
Blender installation's extension repo; this script enables it at runtime.

Usage (headless):

    blender --background --python scripts/convert-fbx-to-vrma.py -- \
        --input <file.fbx> --output <dir> [--fps 30]

    blender --background --python scripts/convert-fbx-to-vrma.py -- \
        --input <dir-with-fbx> --output <dir> [--fps 30] [--glob "*.fbx"]

The script imports each FBX, attaches a VRM1 extension to the imported
armature, assigns its bones to VRM1 human bones via a name mapping, then
exports the keyed action through the addon's VrmAnimationExporter. The
resulting .vrma is model-agnostic (normalized humanoid space) and is
retargeted at runtime by three-vrm-animation onto whatever VRM is loaded.

Call stack:

convert-fbx-to-vrma.py
  -> VrmAnimationExporter.execute (vrm_animation_exporter)
    -> setup_humanoid_t_pose (editor/t_pose)
      -> _export_vrm_animation
        -> _create_node_animation
          -> _set_frame_rotations (per-bone quaternion sampling)
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import bpy

VRM_ADDON = "bl_ext.blender_org.vrm"

# AGIA (Anime Girl Idle Animations) bone name -> VRM1 human bone name.
# AGIA finger bones are numbered 1..4; VRM1 only has 3 joints per finger, so
# the distal-most AGIA joint (Finger4/tip) is intentionally not mapped.
# Bone names are the HumanBoneName enum VALUES (e.g. "leftThumbProximal");
# they are resolved to property-group instances during assignment.


def _agia_to_vrm1_mapping() -> dict[str, str]:
    """Return {AGIA bone name: VRM1 human bone name (enum value)}."""
    mapping: dict[str, str] = {
        "Root_M": "hips",
        "Spine1_M": "spine",
        "Chest_M": "chest",
        "Neck_M": "neck",
        "Head_M": "head",
    }

    def side_pair(side_lower: str) -> None:
        side_upper = side_lower.capitalize()
        mapping[f"Hip_{side_upper[0]}"] = f"{side_lower}UpperLeg"
        mapping[f"Knee_{side_upper[0]}"] = f"{side_lower}LowerLeg"
        mapping[f"Ankle_{side_upper[0]}"] = f"{side_lower}Foot"
        mapping[f"Toes_{side_upper[0]}"] = f"{side_lower}Toes"
        mapping[f"Scapula_{side_upper[0]}"] = f"{side_lower}Shoulder"
        mapping[f"Shoulder_{side_upper[0]}"] = f"{side_lower}UpperArm"
        mapping[f"Elbow_{side_upper[0]}"] = f"{side_lower}LowerArm"
        mapping[f"Wrist_{side_upper[0]}"] = f"{side_lower}Hand"

    side_pair("left")
    side_pair("right")

    # VRM1 has 3 joints per finger; AGIA has 4 (the 4th/tip is not mapped).
    # For in-hand fingers (index/middle/ring/pinky), AGIA Finger1 == VRM
    # proximal, Finger2 == intermediate, Finger3 == distal. VRM1 calls the
    # pinky "little" ("leftLittleProximal", ...).
    for side_lower in ("left", "right"):
        for finger, vrm_finger in (("Index", "Index"), ("Middle", "Middle"), ("Ring", "Ring"), ("Pinky", "Little")):
            for agia_number, vrm_joint in ((1, "Proximal"), (2, "Intermediate"), (3, "Distal")):
                agia_name = f"{finger}Finger{agia_number}_{side_lower[0].upper()}"
                mapping[agia_name] = f"{side_lower}{vrm_finger}{vrm_joint}"
        for agia_number, vrm_joint in ((1, "ThumbMetacarpal"), (2, "ThumbProximal"), (3, "ThumbDistal")):
            agia_name = f"ThumbFinger{agia_number}_{side_lower[0].upper()}"
            mapping[agia_name] = f"{side_lower}{vrm_joint}"
    return mapping


def _enable_vrm_addon() -> None:
    if VRM_ADDON in bpy.context.preferences.addons:
        return
    bpy.ops.preferences.addon_enable(module=VRM_ADDON)
    if VRM_ADDON not in bpy.context.preferences.addons:
        raise RuntimeError(f"Failed to enable the {VRM_ADDON} addon")


def _clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def _find_keyed_armature() -> tuple[bpy.types.Object, bpy.types.Action]:
    candidates = []
    for obj in bpy.data.objects:
        if obj.type != "ARMATURE":
            continue
        animation_data = obj.animation_data
        if animation_data and animation_data.action:
            candidates.append((obj, animation_data.action))
    if not candidates:
        raise RuntimeError("No armature with a keyed action found in scene")
    if len(candidates) > 1:
        print("NOTICE: multiple keyed armatures, using the first", file=sys.stderr)
    return candidates[0]


def _assign_human_bones(armature: bpy.types.Object) -> None:
    ext = armature.data.vrm_addon_extension
    if ext is None:
        raise RuntimeError("vrm_addon_extension is missing on the armature data")
    human_bones = ext.vrm1.humanoid.human_bones
    # dict[HumanBoneName -> Vrm1HumanBonePropertyGroup], keyed by enum members.
    by_value = {
        name.value: group for name, group in human_bones.human_bone_name_to_human_bone().items()
    }
    bone_names = {bone.name for bone in armature.data.bones}
    assigned = []
    missing = []
    for agia_name, vrm_bone_value in _agia_to_vrm1_mapping().items():
        if agia_name not in bone_names:
            missing.append(agia_name)
            continue
        human_bone = by_value.get(vrm_bone_value)
        if human_bone is None:
            raise RuntimeError(f"Unknown VRM1 human bone: {vrm_bone_value}")
        human_bone.node.bone_name = agia_name
        assigned.append(agia_name)
    print(f"assigned {len(assigned)} human bones: {assigned}")
    if missing:
        print(f"NOTICE: not found in armature (skipped): {missing}")


def _export_vrma(
    context: bpy.types.Context,
    armature: bpy.types.Object,
    output_path: Path,
) -> None:
    from bl_ext.blender_org.vrm.exporter.vrm_animation_exporter import (
        VrmAnimationExporter,
    )

    result = VrmAnimationExporter.execute(context, output_path, armature)
    if result != {"FINISHED"}:
        raise RuntimeError(f"VrmAnimationExporter returned {result}")


def _convert_one(context: bpy.types.Context, fbx_path: Path, output_dir: Path, fps: int) -> Path:
    _clear_scene()
    bpy.ops.import_scene.fbx(filepath=str(fbx_path))
    armature, action = _find_keyed_armature()
    print(f"armature={armature.name} action={action.name} range={tuple(action.frame_range)}")

    frame_start, frame_end = (int(v) for v in action.frame_range)
    context.scene.frame_start = frame_start
    context.scene.frame_end = frame_end
    context.scene.render.fps = fps
    context.scene.render.fps_base = 1.0

    _assign_human_bones(armature)

    armature.animation_data.action = action
    output_path = (output_dir / fbx_path.stem).with_suffix(".vrma")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    _export_vrma(context, armature, output_path)
    return output_path


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert FBX animations to .vrma")
    parser.add_argument("--input", required=True, help="FBX file or directory of FBX files")
    parser.add_argument("--output", default=".", help="Output directory for .vrma files")
    parser.add_argument("--fps", type=int, default=30, help="Export frame rate (default: 30)")
    parser.add_argument("--glob", default="*.fbx", help="Glob pattern when --input is a directory")
    return parser.parse_args(argv)


def main() -> int:
    args = _parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    _enable_vrm_addon()
    vrm_init = getattr(bpy.types.Scene, "vrm_addon_extension", None)
    if vrm_init is None:
        raise RuntimeError("VRM extension property not registered on Scene")

    context = bpy.context
    input_path = Path(args.input)
    output_dir = Path(args.output)

    if input_path.is_dir():
        fbx_files = sorted(input_path.glob(args.glob))
        print(f"found {len(fbx_files)} FBX files in {input_path}")
    else:
        fbx_files = [input_path]

    if not fbx_files:
        print("no FBX files to convert", file=sys.stderr)
        return 1

    for fbx_path in fbx_files:
        try:
            out = _convert_one(context, fbx_path, output_dir, args.fps)
            print(f"OK {fbx_path.name} -> {out}")
        except Exception as error:  # noqa: BLE001 - keep batch going
            print(f"FAILED {fbx_path.name}: {error}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())