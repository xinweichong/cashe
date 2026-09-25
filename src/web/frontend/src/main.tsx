import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { applyTextSize, readTextSize } from './lib/textSize';

// Before first paint, so the saved text size never flashes in at default.
applyTextSize(readTextSize());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
