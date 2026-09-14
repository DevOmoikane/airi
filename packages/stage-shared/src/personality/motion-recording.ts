import type { InferOutput } from 'valibot'
import type { DeepReadonly } from 'vue'

import { array, finite, literal, maxValue, minLength, minValue, number, object, pipe, safeParse } from 'valibot'

const live2dMotionSampleSchema = object({
  atMs: pipe(number(), finite(), minValue(0)),
  eyeX: pipe(number(), finite(), minValue(-1), maxValue(1)),
  eyeY: pipe(number(), finite(), minValue(-1), maxValue(1)),
  eyeSquint: pipe(number(), finite(), minValue(0), maxValue(1)),
  headX: pipe(number(), finite(), minValue(-1), maxValue(1)),
  headY: pipe(number(), finite(), minValue(-1), maxValue(1)),
  headZ: pipe(number(), finite(), minValue(-1), maxValue(1)),
  bodyX: pipe(number(), finite(), minValue(-1), maxValue(1)),
  bodyY: pipe(number(), finite(), minValue(-1), maxValue(1)),
  bodyZ: pipe(number(), finite(), minValue(-1), maxValue(1)),
  mouthForm: pipe(number(), finite(), minValue(-1), maxValue(1)),
  mouthOpen: pipe(number(), finite(), minValue(0), maxValue(1)),
  offsetX: pipe(number(), finite(), minValue(-1), maxValue(1)),
  offsetY: pipe(number(), finite(), minValue(-1), maxValue(1)),
})

const live2dMotionRecordingSchema = object({
  format: literal('airi-live2d-motion/v6'),
  durationMs: pipe(number(), finite(), minValue(0)),
  samples: pipe(array(live2dMotionSampleSchema), minLength(1)),
})

/** One normalized joystick pose at an elapsed time in a motion recording. */
export type Live2DMotionSample = InferOutput<typeof live2dMotionSampleSchema>

/** A portable, versioned Live2D joystick recording. */
export type Live2DMotionRecording = InferOutput<typeof live2dMotionRecordingSchema>

/** A live2D motion recording exposed as immutable application state. */
export type ReadonlyLive2DMotionRecording = DeepReadonly<Live2DMotionRecording>

/**
 * Parses and validates a Live2D joystick recording at the file boundary.
 *
 * @example
 * parseLive2DMotionRecording('{"format":"airi-live2d-motion/v6", ...}')
 * // => a validated recording
 */
export function parseLive2DMotionRecording(raw: string): Live2DMotionRecording {
  let input: unknown
  try {
    input = JSON.parse(raw)
  }
  catch {
    throw new Error('The file does not contain valid JSON.')
  }

  const result = safeParse(live2dMotionRecordingSchema, input)
  if (!result.success)
    throw new Error('The file is not an AIRI Live2D motion recording.')

  const { durationMs, samples } = result.output
  if (samples[0].atMs !== 0)
    throw new Error('The first motion sample must start at 0 ms.')

  for (let index = 1; index < samples.length; index++) {
    if (samples[index].atMs < samples[index - 1].atMs)
      throw new Error('The motion samples must be in time order.')
  }

  if (samples.at(-1)!.atMs > durationMs)
    throw new Error('A motion sample occurs after the recording duration.')

  return result.output
}

/**
 * Serializes a Live2D joystick recording as a readable JSON file.
 *
 * @example
 * stringifyLive2DMotionRecording({ format: 'airi-live2d-motion/v6', ... })
 * // => readable JSON ending with a newline
 */
export function stringifyLive2DMotionRecording(recording: ReadonlyLive2DMotionRecording): string {
  return `${JSON.stringify(recording, null, 2)}\n`
}
