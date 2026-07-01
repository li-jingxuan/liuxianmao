import { ILXMMeasureLayout } from '@liuxianmao/lxm-editor'
import React from 'react'

export interface IMeasureLayer {
  measures: ILXMMeasureLayout[]
}

export const MeasureLayerComponent: React.FC<IMeasureLayer> = props => {

  return <>
  </>
}

export const MeasureLayer = React.memo(MeasureLayerComponent)
