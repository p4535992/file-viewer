import { modelRenderer, type renderFileViewerModel } from '@file-viewer/renderer-3d'
import {
  isCopcLasBuffer,
  type Geo3dDatasetFormat,
  type Geo3dRangeGetter,
} from '@file-viewer/renderer-3d/geo3d/inspect'

const detected: boolean = isCopcLasBuffer(new ArrayBuffer(0))
const format: Geo3dDatasetFormat = 'copc'
const range: Geo3dRangeGetter = async (begin, end) => new Uint8Array(end - begin)
type ModelHandler = typeof renderFileViewerModel
void [detected, format, range, modelRenderer]
export type { ModelHandler }

// @ts-expect-error The inspection API requires bytes, not a disguised SDK object.
isCopcLasBuffer('not-a-buffer')
// @ts-expect-error A base renderer is not an IFC or Giro3D runtime instance.
modelRenderer.nonexistentSdkMethod()
