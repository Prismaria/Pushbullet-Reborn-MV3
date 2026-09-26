import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClassicPanel } from '../ClassicPanel'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClassicPanel />
  </StrictMode>
)
