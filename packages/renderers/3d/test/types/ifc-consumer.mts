import { createIfcRenderer, type IfcExtensionContext, type IfcRuntimeContext } from '@file-viewer/renderer-3d/ifc'
import { Components, FragmentsManager } from '@thatopen/components'
import type { FragmentsModel, FragmentsModels } from '@thatopen/fragments'

type IsAny<T> = 0 extends (1 & T) ? true : false
type ExpectFalse<T extends false> = T
export type ComponentsAreReal = ExpectFalse<IsAny<IfcRuntimeContext['components']>>
export type ModelsAreReal = ExpectFalse<IsAny<IfcExtensionContext['model']>>

function configureRuntime(context: IfcRuntimeContext): void {
  const components: Components = context.components
  const fragments: FragmentsModels = context.fragments
  components.get(FragmentsManager)
  const cancellation: AbortSignal = context.signal
  void [fragments, cancellation]
  // @ts-expect-error This is rejected by the actual Components API.
  context.components.nonexistentFileViewerMethod()
  // @ts-expect-error Models do not exist in the pre-load runtime context.
  void context.model
}

function configure(context: IfcExtensionContext): void {
  const model: FragmentsModel = context.model
  const modelId: string = model.modelId
  model.getItemsData([1])
  context.select(1)
  void modelId
  // @ts-expect-error A real SDK model cannot be assigned to a primitive.
  const wrong: number = context.model
  void wrong
}

createIfcRenderer({ configureRuntime, configure })
