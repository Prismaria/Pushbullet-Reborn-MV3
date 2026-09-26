import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClassicChatWindow } from '../ClassicChatWindow'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClassicChatWindow />
  </StrictMode>
)
