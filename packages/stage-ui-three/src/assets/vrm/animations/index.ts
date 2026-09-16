/**
 * All converted AGIA idle clips, keyed by the emotion source file name.
 *
 * Converted from Anime Girl Idle Animations v1.2.1 FBX files via
 * `scripts/convert-fbx-to-vrma.py`. Bone data is normalized to the T-pose,
 * so every clip retargets to any VRM at runtime.
 */
export const agiaIdles = {
  angry_01_hands_on_waist: new URL('./AGIA_Idle_angry_01_hands_on_waist.vrma', import.meta.url),
  angry_02_fists_front: new URL('./AGIA_Idle_angry_02_fists_front.vrma', import.meta.url),
  boyish_01_right_hand_on_neck: new URL('./AGIA_Idle_boyish_01_right_hand_on_neck.vrma', import.meta.url),
  brave_01_hand_on_chest: new URL('./AGIA_Idle_brave_01_hand_on_chest.vrma', import.meta.url),
  calm_01_hands_on_back: new URL('./AGIA_Idle_calm_01_hands_on_back.vrma', import.meta.url),
  calm_02_hands_on_front: new URL('./AGIA_Idle_calm_02_hands_on_front.vrma', import.meta.url),
  cat_01: new URL('./AGIA_Idle_cat_01.vrma', import.meta.url),
  classy_01_left_hand_on_waist: new URL('./AGIA_Idle_classy_01_left_hand_on_waist.vrma', import.meta.url),
  concern_01_right_hand_front: new URL('./AGIA_Idle_concern_01_right_hand_front.vrma', import.meta.url),
  cry_01: new URL('./AGIA_Idle_cry_01.vrma', import.meta.url),
  cute_01_hands_on_front: new URL('./AGIA_Idle_cute_01_hands_on_front.vrma', import.meta.url),
  cute_02_hands_stick_out: new URL('./AGIA_Idle_cute_02_hands_stick_out.vrma', import.meta.url),
  cute_03_leaning_forward: new URL('./AGIA_Idle_cute_03_leaning_forward.vrma', import.meta.url),
  deny_01: new URL('./AGIA_Idle_deny_01.vrma', import.meta.url),
  energetic_01_right_fist_up: new URL('./AGIA_Idle_energetic_01_right_fist_up.vrma', import.meta.url),
  energetic_02_right_hand_piece: new URL('./AGIA_Idle_energetic_02_right_hand_piece.vrma', import.meta.url),
  energetic_03_flex: new URL('./AGIA_Idle_energetic_03_flex.vrma', import.meta.url),
  fedup_01_slouching: new URL('./AGIA_Idle_fedup_01_slouching.vrma', import.meta.url),
  fedup_02_right_hand_on_face: new URL('./AGIA_Idle_fedup_02_right_hand_on_face.vrma', import.meta.url),
  generic_01: new URL('./AGIA_Idle_generic_01.vrma', import.meta.url),
  laugh_01: new URL('./AGIA_Idle_laugh_01.vrma', import.meta.url),
  pitiable_01_right_hand_on_back_head: new URL('./AGIA_Idle_pitiable_01_right_hand_on_back_head.vrma', import.meta.url),
  point_finger_01: new URL('./AGIA_Idle_point_finger_01.vrma', import.meta.url),
  sexy_01_right_hand_pointy_finger: new URL('./AGIA_Idle_sexy_01_right_hand_pointy_finger.vrma', import.meta.url),
  sexy_02_pose: new URL('./AGIA_Idle_sexy_02_pose.vrma', import.meta.url),
  sexy_03_lean_forward: new URL('./AGIA_Idle_sexy_03_lean_forward.vrma', import.meta.url),
  stress_01_both_hands_on_back_head: new URL('./AGIA_Idle_stress_01_both_hands_on_back_head.vrma', import.meta.url),
  surprise_01_hands_open_front: new URL('./AGIA_Idle_surprise_01_hands_open_front.vrma', import.meta.url),
  think_01: new URL('./AGIA_Idle_think_01.vrma', import.meta.url),
  what_01: new URL('./AGIA_Idle_what_01.vrma', import.meta.url),
} as const

export const animations = {
  idleLoop: new URL('./idle_loop.vrma', import.meta.url),
  ...agiaIdles,
}

export const agiaIdleUrls = Object.values(agiaIdles).map(url => url.toString())
