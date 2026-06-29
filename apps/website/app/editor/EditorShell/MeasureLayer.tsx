import React from 'react'

export interface IMeasureLayer {
  measures: []
}

export const MeasureLayerComponent: React.FC<IMeasureLayer> = props => {

  return <></>
}

export const MeasureLayer = React.memo(MeasureLayerComponent)
