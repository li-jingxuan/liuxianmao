'use client'
// import { STAFF_STRINGS } from './editor-data'
import { SystemLayer } from './SystemLayer'
import { loadDocument, EXAMPLE } from '@liuxianmao/lxm-editor'
import { useEffect } from 'react'

export const EditorShell: React.FC = () => {

  useEffect(() => {
    const document = loadDocument(JSON.stringify(EXAMPLE.EXAMPLE_MVP_1.default))

    console.log('document: ', EXAMPLE.EXAMPLE_MVP_1, document)
  }, [])

  return <>
    <SystemLayer systems={null} />
  </>
}