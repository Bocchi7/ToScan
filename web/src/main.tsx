import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('Missing React root');

createRoot(root).render(
  <StrictMode>
    <main><h1>ToScan</h1></main>
  </StrictMode>,
);
