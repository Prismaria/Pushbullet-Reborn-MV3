import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClassicOptions } from '../ClassicOptions'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClassicOptions />
  </StrictMode>
)
