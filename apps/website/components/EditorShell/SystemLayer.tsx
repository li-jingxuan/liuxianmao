import { MeasureLayer } from './MeasureLayer'
import React from 'react'

export interface ISystemLayer {
  systems: null
}

export const SystemLayerComponent: React.FC<ISystemLayer> = (props) => {

  return <>
    <MeasureLayer measures={[]}></MeasureLayer>
  </>
}

export const SystemLayer = React.memo(SystemLayerComponent)
