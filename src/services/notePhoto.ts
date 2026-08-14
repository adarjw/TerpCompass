/**
 * Photo crop for class notes. "Raw" mode stores the picked image untouched;
 * "cropped" auto-trims a margin off each edge — the desk/background border
 * typical of a notebook or whiteboard shot — entirely on-device via
 * expo-image-manipulator. Re-rendering the image also bakes in its EXIF
 * orientation, so a sideways phone photo comes out right-side-up.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const TRIM_FRACTION = 0.05;

export interface CroppedPhoto {
  uri: string;
  width: number;
  height: number;
}

export async function autoCropNotePhoto(uri: string): Promise<CroppedPhoto> {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const marginX = Math.round(original.width * TRIM_FRACTION);
  const marginY = Math.round(original.height * TRIM_FRACTION);
  const cropped = await ImageManipulator.manipulate(uri)
    .crop({
      originX: marginX,
      originY: marginY,
      width: original.width - marginX * 2,
      height: original.height - marginY * 2,
    })
    .renderAsync();
  const result = await cropped.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return { uri: result.uri, width: result.width, height: result.height };
}
