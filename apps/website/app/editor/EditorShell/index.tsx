'use client'

import {
  loadDocument,
  EXAMPLE,
  buildLayout,
  ILXMLayout
} from '@liuxianmao/lxm-editor'
import { useMemo } from 'react'
import styles from './index.module.scss'

export const EditorShell: React.FC = () => {
  const lxmLayout = useMemo<ILXMLayout | null>(() => {

    const document = loadDocument(JSON.stringify(EXAMPLE.EXAMPLE_MVP_1.default))

    if(!document.ok) {
      return null
    }

    const layoutData = buildLayout(document.document, { x: 0, y: 0 })

    return layoutData
  }, [])

  if(!lxmLayout) {
    return <></>
  }

  console.log(lxmLayout)

  return <>
    {/* <SystemLayer systems={null} /> */}
    <svg 
      className={styles.scoreSvg}
      viewBox={`0 0 ${lxmLayout.width} ${lxmLayout.height}`}
      width={lxmLayout.width}
      height={lxmLayout.height}
    >
      {
        lxmLayout.measures.map((measure) => {
          const { strings, notes } = measure

          return <g key={measure.index}>
            <g>
              {/* 绘制弦线 */}
              {
                strings.map((string) => {
                  return <line
                    key={string.index} x1={string.x1} y1={string.y1}
                    x2={string.x2} y2={string.y2} stroke="black" strokeWidth={1}
                  />
                })
              }
            </g>

            <g>
              {/* 绘制音符 */}
              {
                notes.map((note) => {
                  return <text className={styles.fretNoteText} key={note.id} x={note.x} y={note.y + 4}>
                    {note.fretText}
                  </text>
                })
              }
            </g>

            <g>
              {/* 绘制小节线 */}
              {
                measure.barline.parts.map((part, index) => {
                  if(part.kind === "line") {
                    return <line
                      key={index} x1={part.x} y1={part.y1}
                      x2={part.x} y2={part.y2} stroke="black" strokeWidth={1}
                    />
                  }

                  return <></>
                })
              }
            </g>
          </g>
        })
      }
    </svg>
  </>
}